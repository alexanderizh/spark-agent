import { useEffect, useMemo, useState } from 'react'
import { Button as LobeButton, Select, TextArea } from '@lobehub/ui'
import { Button, Checkbox, Empty, Modal, Spin } from 'antd'
import type { RemoteAgentDispatchRequest, RemoteAgentTask } from '@spark/protocol'
import type { UIMessage } from '../../../services/event-mapper'
import { useIpcInvoke } from '../../../hooks/useIpc'
import { useToast } from '../../../components/Toast'
import { translate, useI18n } from '../../../i18n'
import { useRemoteAgentSession } from './RemoteAgentSession'
import './remote-agent.less'

const MAX_SHARED_ATTACHMENT_BYTES = 8 * 1024 * 1024
const MAX_INSTRUCTION_BYTES = 256 * 1024

interface ShareOption {
  id: string
  messageId: string
  kind: 'message' | 'attachment'
  text?: string
  path?: string
  name?: string
  mimeType?: string
  disabled?: boolean
}

function messageText(message: UIMessage): string {
  const displayContent = message.userMessageDisplayContent?.trim()
  if (displayContent) return displayContent
  return message.blocks
    .filter(
      (block): block is Extract<(typeof message.blocks)[number], { kind: 'text' }> =>
        block.kind === 'text',
    )
    .map((block) => block.content)
    .join('\n')
    .trim()
}

function mimeTypeFromPath(filePath: string): string {
  const extension = filePath.split('.').at(-1)?.toLowerCase()
  switch (extension) {
    case 'png':
      return 'image/png'
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'gif':
      return 'image/gif'
    case 'webp':
      return 'image/webp'
    case 'svg':
      return 'image/svg+xml'
    case 'pdf':
      return 'application/pdf'
    case 'txt':
    case 'md':
    case 'json':
    case 'csv':
      return extension === 'md' ? 'text/markdown' : `text/${extension}`
    default:
      return 'application/octet-stream'
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length))
    binary += String.fromCharCode(...chunk)
  }
  return btoa(binary)
}

function shareOptionsOf(messages: UIMessage[]): ShareOption[] {
  const options: ShareOption[] = []
  for (const message of messages) {
    if (message.role !== 'user') continue
    const text = messageText(message)
    if (text.length > 0) {
      options.push({
        id: `message:${message.id}`,
        messageId: message.id,
        kind: 'message',
        text,
      })
    }
    for (const [index, attachment] of (message.attachments ?? []).entries()) {
      if (attachment.type === 'directory') {
        options.push({
          id: `attachment:${message.id}:${index}`,
          messageId: message.id,
          kind: 'attachment',
          name: attachment.name ?? attachment.path.split(/[\\/]/).at(-1) ?? 'directory',
          disabled: true,
        })
      } else {
        options.push({
          id: `attachment:${message.id}:${index}`,
          messageId: message.id,
          kind: 'attachment',
          path: attachment.path,
          name: attachment.name ?? attachment.path.split(/[\\/]/).at(-1) ?? 'attachment',
          mimeType: mimeTypeFromPath(attachment.path),
        })
      }
    }
  }
  return options
}

function labelForMessage(messages: UIMessage[], messageId: string): string {
  const index = messages.findIndex((message) => message.id === messageId)
  return index >= 0
    ? `${translate('remoteAgent.message')} ${index + 1}`
    : translate('remoteAgent.message')
}

export function RemoteAgentDispatchModal({
  open,
  messages,
  onClose,
  onDispatched,
}: {
  open: boolean
  messages: UIMessage[]
  onClose: () => void
  onDispatched: (task: RemoteAgentTask) => void
}) {
  useI18n()
  const { sessionId, devices, refreshRelay } = useRemoteAgentSession()
  const { toast } = useToast()
  const [deviceId, setDeviceId] = useState('')
  const [projectId, setProjectId] = useState('')
  const [agentId, setAgentId] = useState('')
  const [instruction, setInstruction] = useState('')
  const [selectedContext, setSelectedContext] = useState<Set<string>>(() => new Set())
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([])
  const [agents, setAgents] = useState<Array<{ id: string; name: string }>>([])
  const [projectsLoading, setProjectsLoading] = useState(false)
  const [agentsLoading, setAgentsLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [targetError, setTargetError] = useState<string | null>(null)

  const { invoke: listProjects } = useIpcInvoke('remote-agent:target:list-projects')
  const { invoke: listAgents } = useIpcInvoke('remote-agent:target:list-agents')
  const { invoke: dispatchTask } = useIpcInvoke('remote-agent:task:dispatch')
  const { invoke: readBinary } = useIpcInvoke('file:read-binary')

  const onlineDevices = useMemo(() => devices.filter((device) => device.online), [devices])
  const shareOptions = useMemo(() => shareOptionsOf(messages), [messages])
  const selectableOptions = useMemo(
    () => shareOptions.filter((option) => option.disabled !== true),
    [shareOptions],
  )
  const selectedCount = useMemo(
    () => shareOptions.filter((option) => selectedContext.has(option.id)).length,
    [selectedContext, shareOptions],
  )
  const selectedBytes = useMemo(
    () =>
      shareOptions.reduce(
        (total, option) =>
          total +
          (selectedContext.has(option.id) && option.kind === 'message'
            ? new TextEncoder().encode(option.text ?? '').byteLength
            : 0),
        0,
      ),
    [selectedContext, shareOptions],
  )
  const instructionTooLong =
    new TextEncoder().encode(instruction).byteLength > MAX_INSTRUCTION_BYTES
  const contextTooLong =
    new TextEncoder().encode(instruction.trim()).byteLength + selectedBytes > MAX_INSTRUCTION_BYTES
  const contextItemsExceeded = selectedContext.size > 100

  useEffect(() => {
    if (!open) return
    setInstruction('')
    setSelectedContext(new Set())
    setTargetError(null)
    void refreshRelay(true)
  }, [open, refreshRelay])

  useEffect(() => {
    if (!open || deviceId || onlineDevices.length === 0) return
    setDeviceId(onlineDevices[0]?.deviceId ?? '')
  }, [deviceId, onlineDevices, open])

  useEffect(() => {
    if (!open || !deviceId) {
      setProjects([])
      setProjectId('')
      setAgents([])
      setAgentId('')
      return
    }
    let current = true
    setProjectsLoading(true)
    setTargetError(null)
    setProjects([])
    setProjectId('')
    setAgents([])
    setAgentId('')
    void listProjects({ deviceId })
      .then((response) => {
        if (!current) return
        setProjects(response.projects)
        setProjectId(response.projects[0]?.id ?? '')
      })
      .catch((error: unknown) => {
        if (current) setTargetError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        if (current) setProjectsLoading(false)
      })
    return () => {
      current = false
    }
  }, [deviceId, listProjects, open])

  useEffect(() => {
    if (!open || !deviceId || !projectId) {
      setAgents([])
      setAgentId('')
      return
    }
    let current = true
    setAgentsLoading(true)
    setTargetError(null)
    setAgents([])
    setAgentId('')
    void listAgents({ deviceId, projectId })
      .then((response) => {
        if (!current) return
        setAgents(response.agents)
        setAgentId(response.agents[0]?.id ?? '')
      })
      .catch((error: unknown) => {
        if (current) setTargetError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        if (current) setAgentsLoading(false)
      })
    return () => {
      current = false
    }
  }, [deviceId, listAgents, open, projectId])

  const toggleContext = (id: string) => {
    setSelectedContext((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const applyContextBatch = (kind: 'all' | 'none' | 'messages' | 'attachments') => {
    if (kind === 'none') {
      setSelectedContext(new Set())
      return
    }
    setSelectedContext(
      new Set(
        selectableOptions
          .filter((option) =>
            kind === 'all'
              ? true
              : kind === 'messages'
                ? option.kind === 'message'
                : option.kind === 'attachment',
          )
          .map((option) => option.id),
      ),
    )
  }

  const buildSharedContext = async (): Promise<RemoteAgentDispatchRequest['sharedContext']> => {
    const result: RemoteAgentDispatchRequest['sharedContext'] = []
    let attachmentBytes = 0
    for (const option of shareOptions) {
      if (!selectedContext.has(option.id)) continue
      if (option.kind === 'message') {
        const text = option.text ?? ''
        if (new TextEncoder().encode(text).byteLength > MAX_INSTRUCTION_BYTES) {
          throw new Error(translate('remoteAgent.instructionTooLong'))
        }
        result.push({ kind: 'message', sourceMessageId: option.messageId, text })
        continue
      }
      if (option.disabled || option.path == null) continue
      const response = await readBinary({
        filePath: option.path,
        maxBytes: MAX_SHARED_ATTACHMENT_BYTES,
      })
      if (response.error != null || response.content == null) {
        throw new Error(response.error ?? translate('remoteAgent.dispatchFailed'))
      }
      const bytes = new Uint8Array(response.content)
      attachmentBytes += bytes.byteLength
      if (bytes.byteLength > MAX_SHARED_ATTACHMENT_BYTES) {
        throw new Error(translate('remoteAgent.fileTooLarge'))
      }
      if (attachmentBytes > MAX_SHARED_ATTACHMENT_BYTES) {
        throw new Error(translate('remoteAgent.sharedBytesExceeded'))
      }
      result.push({
        kind: 'attachment',
        sourceMessageId: option.messageId,
        name: option.name ?? 'attachment',
        mimeType: option.mimeType ?? 'application/octet-stream',
        dataBase64: bytesToBase64(bytes),
      })
    }
    return result
  }

  const submit = async () => {
    if (submitting) return
    if (!deviceId || !projectId || !agentId) {
      toast.error(translate('remoteAgent.targetUnavailable'))
      return
    }
    if (!instruction.trim()) {
      toast.error(translate('remoteAgent.instruction'))
      return
    }
    if (instructionTooLong) {
      toast.error(translate('remoteAgent.instructionTooLong'))
      return
    }
    if (contextTooLong) {
      toast.error(translate('remoteAgent.contextTooLong'))
      return
    }
    if (contextItemsExceeded) {
      toast.error(translate('remoteAgent.contextItemsExceeded'))
      return
    }

    setSubmitting(true)
    setTargetError(null)
    try {
      const sharedContext = await buildSharedContext()
      const task = await dispatchTask({
        sourceSessionId: sessionId,
        targetDeviceId: deviceId,
        targetProjectId: projectId,
        targetAgentId: agentId,
        instruction: instruction.trim(),
        sharedContext,
      })
      onDispatched(task)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setTargetError(message)
      toast.error(message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      title={translate('remoteAgent.dispatch')}
      width={660}
      footer={null}
      destroyOnHidden
      onCancel={() => {
        if (!submitting) onClose()
      }}
      className="remote-agent-dispatch-modal"
    >
      <div className="remote-agent-dispatch-form">
        <div className="remote-agent-field-row">
          <label htmlFor="remote-agent-device">{translate('remoteAgent.device')}</label>
          <Select
            id="remote-agent-device"
            className="remote-agent-select"
            value={deviceId || undefined}
            placeholder={translate('remoteAgent.selectDevice')}
            disabled={submitting || onlineDevices.length === 0}
            options={onlineDevices.map((device) => ({
              label: device.name,
              value: device.deviceId,
            }))}
            notFoundContent={translate('remoteAgent.noDevices')}
            onChange={(value) => setDeviceId(value ?? '')}
          />
          {onlineDevices.length === 0 && <small>{translate('remoteAgent.noDevices')}</small>}
        </div>

        <div className="remote-agent-field-row">
          <label htmlFor="remote-agent-project">{translate('remoteAgent.project')}</label>
          <Select
            id="remote-agent-project"
            className="remote-agent-select"
            value={projectId || undefined}
            placeholder={
              projectsLoading
                ? translate('remoteAgent.loading')
                : translate('remoteAgent.selectProject')
            }
            disabled={submitting || projectsLoading || projects.length === 0}
            loading={projectsLoading}
            options={projects.map((project) => ({ label: project.name, value: project.id }))}
            onChange={(value) => setProjectId(value ?? '')}
          />
        </div>

        <div className="remote-agent-field-row">
          <label htmlFor="remote-agent-agent">{translate('remoteAgent.agent')}</label>
          <Select
            id="remote-agent-agent"
            className="remote-agent-select"
            value={agentId || undefined}
            placeholder={
              agentsLoading
                ? translate('remoteAgent.loading')
                : translate('remoteAgent.selectAgent')
            }
            disabled={submitting || agentsLoading || agents.length === 0}
            loading={agentsLoading}
            options={agents.map((agent) => ({ label: agent.name, value: agent.id }))}
            onChange={(value) => setAgentId(value ?? '')}
          />
        </div>

        <div className="remote-agent-field-row">
          <label htmlFor="remote-agent-instruction">{translate('remoteAgent.instruction')}</label>
          <TextArea
            id="remote-agent-instruction"
            className="remote-agent-instruction"
            value={instruction}
            maxLength={262144}
            rows={5}
            resize
            disabled={submitting}
            placeholder={translate('remoteAgent.instructionPlaceholder')}
            onChange={(event) => setInstruction(event.target.value)}
          />
          {instructionTooLong && (
            <small className="is-error">{translate('remoteAgent.instructionTooLong')}</small>
          )}
          {!instructionTooLong && contextTooLong && (
            <small className="is-error">{translate('remoteAgent.contextTooLong')}</small>
          )}
        </div>

        <section className="remote-agent-context-picker">
          <div className="remote-agent-context-heading">
            <div className="remote-agent-context-heading-row">
              <strong>{translate('remoteAgent.context')}</strong>
              {shareOptions.length > 0 && (
                <span className="remote-agent-context-counter">
                  {translate('remoteAgent.contextSelected', {
                    selected: selectedCount,
                    total: selectableOptions.length,
                  })}
                </span>
              )}
            </div>
            <span>{translate('remoteAgent.contextHint')}</span>
          </div>
          {shareOptions.length === 0 ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={translate('remoteAgent.noContext')}
            />
          ) : (
            <>
              <div className="remote-agent-context-toolbar">
                <Button
                  size="small"
                  type="text"
                  disabled={submitting || selectedCount === selectableOptions.length}
                  onClick={() => applyContextBatch('all')}
                >
                  {translate('remoteAgent.contextSelectAll')}
                </Button>
                <Button
                  size="small"
                  type="text"
                  disabled={submitting || selectedCount === 0}
                  onClick={() => applyContextBatch('none')}
                >
                  {translate('remoteAgent.contextClear')}
                </Button>
                <Button
                  size="small"
                  type="text"
                  disabled={submitting}
                  onClick={() => applyContextBatch('messages')}
                >
                  {translate('remoteAgent.contextMessagesOnly')}
                </Button>
                <Button
                  size="small"
                  type="text"
                  disabled={submitting}
                  onClick={() => applyContextBatch('attachments')}
                >
                  {translate('remoteAgent.contextAttachmentsOnly')}
                </Button>
              </div>
              <div className="remote-agent-context-list">
                {shareOptions.map((option) => (
                  <Checkbox
                    key={option.id}
                    className={`remote-agent-context-option${option.disabled ? ' is-disabled' : ''}`}
                    checked={selectedContext.has(option.id)}
                    disabled={submitting || option.disabled === true}
                    onChange={() => toggleContext(option.id)}
                  >
                    <span className="remote-agent-context-option-copy">
                      <strong>
                        {option.kind === 'message'
                          ? labelForMessage(messages, option.messageId)
                          : (option.name ?? translate('remoteAgent.attachment'))}
                        {option.kind === 'attachment' &&
                          ` · ${labelForMessage(messages, option.messageId)}`}
                      </strong>
                      <span>
                        {option.kind === 'message'
                          ? option.text
                          : option.disabled
                            ? translate('remoteAgent.directoryUnsupported')
                            : translate('remoteAgent.attachment')}
                      </span>
                    </span>
                  </Checkbox>
                ))}
              </div>
            </>
          )}
        </section>

        {targetError != null && (
          <div className="remote-agent-error" role="alert">
            {targetError}
          </div>
        )}
        {submitting && (
          <div className="remote-agent-submit-progress">
            <Spin size="small" /> {translate('remoteAgent.dispatching')}
          </div>
        )}
        <div className="remote-agent-form-actions">
          <LobeButton disabled={submitting} onClick={onClose}>
            {translate('remoteAgent.cancel')}
          </LobeButton>
          <LobeButton
            type="primary"
            loading={submitting}
            disabled={
              !deviceId ||
              !projectId ||
              !agentId ||
              !instruction.trim() ||
              instructionTooLong ||
              contextTooLong ||
              contextItemsExceeded ||
              projectsLoading ||
              agentsLoading
            }
            onClick={() => void submit()}
          >
            {translate('remoteAgent.submit')}
          </LobeButton>
        </div>
      </div>
    </Modal>
  )
}
