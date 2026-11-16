import type { UIBlock, UIMessage } from '../../../services/event-mapper'
import { translate, type TranslationKey } from '../../../i18n'

export type RemoteAgentToolCallBlock = Extract<UIBlock, { kind: 'tool_call' }>

export type RemoteAgentToolAction =
  | 'devices_list'
  | 'device_inspect'
  | 'sessions_list'
  | 'session_open'
  | 'message_send'
  | 'events_read'
  | 'operation_cancel'
  | 'artifact_transfer'
  | 'unknown'

export interface RemoteAgentToolCallEntry {
  block: RemoteAgentToolCallBlock
  messageId: string
  timestamp?: string
}

export interface RemoteAgentToolCallPresentation {
  action: RemoteAgentToolAction
  status: 'pending' | 'running' | 'success' | 'error'
  requestText: string
  outputText: string
  remoteStatus?: string
}

const REMOTE_AGENT_TOOL_PREFIX = 'mcp__spark_remote__'
const REMOTE_ABSOLUTE_PATH_PATTERN =
  /(?:\/(?:Users|home|root|private|tmp|var|Volumes|mnt|opt|workspace)\/[^\s"'`<>()[\]{}]+|[A-Za-z]:[\\/][^\s"'`<>()[\]{}]+)/gu
const MAX_PREVIEW_LENGTH = 8_000

export function isRemoteAgentToolCall(block: UIBlock): boolean {
  return block.kind === 'tool_call' && block.toolName.startsWith(REMOTE_AGENT_TOOL_PREFIX)
}

export function getRemoteAgentToolAction(toolName: string): RemoteAgentToolAction {
  if (!toolName.startsWith(REMOTE_AGENT_TOOL_PREFIX)) return 'unknown'
  const action = toolName.slice(REMOTE_AGENT_TOOL_PREFIX.length)
  switch (action) {
    case 'devices_list':
    case 'device_inspect':
    case 'sessions_list':
    case 'session_open':
    case 'message_send':
    case 'events_read':
    case 'operation_cancel':
    case 'artifact_transfer':
      return action
    default:
      return 'unknown'
  }
}

export function extractRemoteAgentToolCalls(messages: UIMessage[]): RemoteAgentToolCallEntry[] {
  const entries: RemoteAgentToolCallEntry[] = []
  for (const message of messages) {
    if (message.role !== 'assistant') continue
    for (const block of message.blocks) {
      if (block.kind !== 'tool_call' || !isRemoteAgentToolCall(block)) continue
      entries.push({
        block,
        messageId: message.id,
        ...(message.timestamp != null ? { timestamp: message.timestamp } : {}),
      })
    }
  }
  return entries
}

/** Merge each matching events_read result into its original message_send timeline position. */
export function projectRemoteAgentTimelineMessages(messages: UIMessage[]): UIMessage[] {
  const sendAnchors = new Map<string, string>()
  const latestReads = new Map<string, RemoteAgentToolCallBlock>()

  for (const message of messages) {
    if (message.role !== 'assistant') continue
    for (const block of message.blocks) {
      if (block.kind !== 'tool_call' || !isRemoteAgentToolCall(block)) continue
      const key = operationKey(block)
      if (key == null) continue
      const action = getRemoteAgentToolAction(block.toolName)
      if (action === 'message_send' && !sendAnchors.has(key)) {
        sendAnchors.set(key, block.toolCallId)
      } else if (action === 'events_read') {
        latestReads.set(key, block)
      }
    }
  }

  if (sendAnchors.size === 0 || latestReads.size === 0) return messages
  const readsByAnchor = new Map<string, RemoteAgentToolCallBlock>()
  for (const [key, anchorToolCallId] of sendAnchors) {
    const read = latestReads.get(key)
    if (read == null) continue
    readsByAnchor.set(anchorToolCallId, read)
  }
  if (readsByAnchor.size === 0) return messages

  return messages.map((message) => {
    if (message.role !== 'assistant') return message
    let changed = false
    const blocks = message.blocks.flatMap((block): UIBlock[] => {
      if (block.kind !== 'tool_call' || !isRemoteAgentToolCall(block)) return [block]
      const action = getRemoteAgentToolAction(block.toolName)
      const key = action === 'events_read' ? operationKey(block) : null
      if (key != null && sendAnchors.has(key)) {
        changed = true
        return []
      }
      const read = readsByAnchor.get(block.toolCallId)
      if (read == null) return [block]
      changed = true
      return [
        {
          ...block,
          ...(read.output != null ? { output: read.output } : {}),
          ...(read.status === 'error'
            ? { status: 'error' as const, error: read.error ?? block.error }
            : {}),
        },
      ]
    })
    return changed ? { ...message, blocks } : message
  })
}

export function presentRemoteAgentToolCall(
  block: RemoteAgentToolCallBlock,
): RemoteAgentToolCallPresentation {
  const action = getRemoteAgentToolAction(block.toolName)
  const response = parseToolResponse(block.output)
  const eventSummary = summarizeRemoteEvents(response?.['events'])
  const remoteStatus = stringField(response, 'operationStatus') ?? stringField(response, 'status')

  return {
    action,
    status: block.status === 'error' || remoteStatus === 'failed' ? 'error' : block.status,
    requestText: summarizeRequest(action, block.toolInput),
    outputText:
      block.error != null
        ? redactPaths(block.error)
        : (eventSummary ?? summarizeResponse(action, response, block.output)),
    ...(remoteStatus != null ? { remoteStatus } : {}),
  }
}

function summarizeRequest(action: RemoteAgentToolAction, input: Record<string, unknown>): string {
  switch (action) {
    case 'message_send': {
      const text = typeof input['text'] === 'string' ? input['text'].trim() : ''
      const questionReply = input['questionReply']
      const parts = [text]
      if (isRecord(questionReply)) parts.push(translate('remoteAgent.call.request.questionReply'))
      return parts.filter(Boolean).join('\n') || translate('remoteAgent.call.request.send')
    }
    case 'events_read': {
      const waitSeconds = numberField(input, 'waitSeconds')
      return waitSeconds != null && waitSeconds > 0
        ? translate('remoteAgent.call.request.eventsReadWait', { seconds: waitSeconds })
        : translate('remoteAgent.call.request.eventsRead')
    }
    case 'artifact_transfer': {
      const direction = input['direction']
      const sourcePath = stringField(input, 'sourcePath')
      const name = sourcePath == null ? null : basename(sourcePath)
      if (direction === 'to_remote') {
        return name
          ? translate('remoteAgent.call.request.sendFile', { name })
          : translate('remoteAgent.call.request.sendFileGeneric')
      }
      if (direction === 'to_local') return translate('remoteAgent.call.request.fetchFile')
      return translate('remoteAgent.call.request.transfer')
    }
    case 'operation_cancel':
      return translate('remoteAgent.call.request.cancel')
    case 'session_open':
      return translate('remoteAgent.call.request.openSession')
    case 'device_inspect':
      return translate('remoteAgent.call.request.inspectDevice')
    case 'devices_list':
      return translate('remoteAgent.call.request.discoverDevices')
    case 'sessions_list':
      return translate('remoteAgent.call.request.listSessions')
    default:
      return translate('remoteAgent.call.request.generic')
  }
}

function operationKey(block: RemoteAgentToolCallBlock): string | null {
  const action = getRemoteAgentToolAction(block.toolName)
  if (action !== 'message_send' && action !== 'events_read') return null
  const inputLinkId = stringField(block.toolInput, 'linkId')
  const inputOperationId = stringField(block.toolInput, 'operationId')
  const response = parseToolResponse(block.output)
  const linkId = inputLinkId ?? stringField(response, 'linkId')
  const operationId = inputOperationId ?? stringField(response, 'operationId')
  if (linkId == null || operationId == null) return null
  return `${linkId}\u0000${operationId}`
}

function summarizeResponse(
  action: RemoteAgentToolAction,
  response: Record<string, unknown> | null,
  rawOutput: string | undefined,
): string {
  if (response == null)
    return rawOutput == null ? '' : redactPaths(rawOutput).slice(0, MAX_PREVIEW_LENGTH)

  switch (action) {
    case 'message_send':
      return (
        targetStatusLabel(stringField(response, 'targetStatus')) ??
        translate('remoteAgent.call.result.done')
      )
    case 'session_open':
      return stringField(response, 'status') === 'ready'
        ? translate('remoteAgent.call.result.sessionReady')
        : translate('remoteAgent.call.result.uncertain')
    case 'devices_list': {
      const devices = arrayField(response, 'devices')
      if (devices == null) break
      const names = devices.flatMap((device) => {
        if (!isRecord(device) || typeof device['name'] !== 'string') return []
        return [device['name']]
      })
      return names.length > 0
        ? translate('remoteAgent.call.result.devicesFound', {
            count: names.length,
            names: names.join(translate('remoteAgent.call.result.nameSeparator')),
          })
        : translate('remoteAgent.call.result.noDevices')
    }
    case 'device_inspect': {
      const projects = arrayField(response, 'projects')
      const agents = arrayField(response, 'agents')
      const names = [
        ...(projects ?? []).flatMap((entry) =>
          isRecord(entry) && typeof entry['name'] === 'string' ? [entry['name']] : [],
        ),
        ...(agents ?? []).flatMap((entry) =>
          isRecord(entry) && typeof entry['name'] === 'string' ? [entry['name']] : [],
        ),
      ]
      return names.length > 0
        ? translate('remoteAgent.call.result.itemsFound', {
            names: names.join(translate('remoteAgent.call.result.nameSeparator')),
          })
        : translate('remoteAgent.call.result.directoryRead')
    }
    case 'sessions_list': {
      const sessions = arrayField(response, 'sessions')
      return sessions == null
        ? translate('remoteAgent.call.result.sessionsRead')
        : translate('remoteAgent.call.result.sessionsFound', { count: sessions.length })
    }
    case 'operation_cancel':
      return response['confirmed'] === true
        ? translate('remoteAgent.call.result.cancelConfirmed')
        : translate('remoteAgent.call.result.cancelPending')
    case 'artifact_transfer': {
      const name = stringField(response, 'name')
      return name == null
        ? translate('remoteAgent.call.result.transferDone')
        : translate('remoteAgent.call.result.transferNamed', { name: basename(name) })
    }
    case 'events_read': {
      const status = stringField(response, 'operationStatus')
      return status == null
        ? translate('remoteAgent.call.result.eventsRead')
        : (targetStatusLabel(status) ?? translate('remoteAgent.call.result.eventsRead'))
    }
    default:
      break
  }

  return rawOutput == null
    ? translate('remoteAgent.call.result.done')
    : redactPaths(rawOutput).slice(0, MAX_PREVIEW_LENGTH)
}

function summarizeRemoteEvents(value: unknown): string | null {
  if (!Array.isArray(value)) return null
  const messages = new Set<string>()
  const errors = new Set<string>()
  const artifacts = new Set<string>()
  let latestStatus: string | null = null

  for (const event of value) {
    if (!isRecord(event)) continue
    if (
      event['type'] === 'assistant_message' &&
      (event['mode'] === 'complete' || event['isFinal'] === true) &&
      typeof event['content'] === 'string' &&
      event['content'].trim().length > 0
    ) {
      messages.add(event['content'].trim())
    } else if (
      event['type'] === 'agent_error' &&
      typeof event['statusMessage'] === 'string' &&
      event['statusMessage'].trim().length > 0
    ) {
      errors.add(event['statusMessage'].trim())
    } else if (event['type'] === 'agent_status') {
      if (typeof event['status'] === 'string') latestStatus = event['status']
      if (
        event['status'] === 'error' &&
        typeof event['statusMessage'] === 'string' &&
        event['statusMessage'].trim().length > 0
      ) {
        errors.add(event['statusMessage'].trim())
      }
    } else if (event['type'] === 'presented_files' && Array.isArray(event['files'])) {
      for (const file of event['files']) {
        if (isRecord(file) && typeof file['title'] === 'string') artifacts.add(file['title'])
      }
    }
  }

  const parts = [...messages, ...errors]
  if (artifacts.size > 0) {
    parts.push(
      translate('remoteAgent.call.result.artifacts', {
        names: [...artifacts].join(translate('remoteAgent.call.result.nameSeparator')),
      }),
    )
  }
  if (parts.length === 0 && latestStatus != null) {
    const label = targetStatusLabel(latestStatus)
    if (label != null) parts.push(label)
  }
  return parts.length > 0 ? redactPaths(parts.join('\n\n')).slice(0, MAX_PREVIEW_LENGTH) : null
}

function parseToolResponse(output: string | undefined): Record<string, unknown> | null {
  if (output == null) return null
  const normalized = output
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
  try {
    const parsed: unknown = JSON.parse(normalized)
    if (!isRecord(parsed)) return null
    const structured = parsed['structuredContent']
    if (isRecord(structured)) return structured
    if (Array.isArray(parsed['content'])) {
      for (const item of parsed['content']) {
        if (!isRecord(item) || typeof item['text'] !== 'string') continue
        try {
          const contentValue: unknown = JSON.parse(item['text'])
          if (isRecord(contentValue)) return contentValue
        } catch {
          continue
        }
      }
    }
    return parsed
  } catch {
    return null
  }
}

function targetStatusLabel(status: string | null): string | null {
  if (status == null) return null
  const labels: Record<string, TranslationKey> = {
    accepted: 'remoteAgent.call.status.accepted',
    uncertain: 'remoteAgent.call.status.uncertain',
    submitting: 'remoteAgent.call.status.submitting',
    queued: 'remoteAgent.call.status.queued',
    running: 'remoteAgent.call.status.running',
    completed: 'remoteAgent.call.status.completed',
    failed: 'remoteAgent.call.status.failed',
    cancel_requested: 'remoteAgent.call.status.cancelRequested',
    cancelled: 'remoteAgent.call.status.cancelled',
    error: 'remoteAgent.call.status.failed',
    idle: 'remoteAgent.call.status.idle',
  }
  const key = labels[status]
  return key == null ? null : translate(key)
}

function arrayField(record: Record<string, unknown>, key: string): unknown[] | null {
  const value = record[key]
  return Array.isArray(value) ? value : null
}

function numberField(record: Record<string, unknown>, key: string): number | null {
  const value = record[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function stringField(record: Record<string, unknown> | null, key: string): string | null {
  const value = record?.[key]
  return typeof value === 'string' ? value : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function basename(value: string): string {
  return value.split(/[\\/]/).filter(Boolean).at(-1) ?? value
}

function redactPaths(value: string): string {
  return value.replace(REMOTE_ABSOLUTE_PATH_PATTERN, '[本机路径]')
}
