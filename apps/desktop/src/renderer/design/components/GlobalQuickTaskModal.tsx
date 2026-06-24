import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@lobehub/ui'
import { DatePicker, Select } from 'antd'
import { Icons } from '../Icons'
import { useApp } from '../AppContext'
import { useSessionSidebar } from '../SessionSidebarContext'
import './GlobalQuickTaskModal.less'

type Priority = 'low' | 'medium' | 'high' | 'urgent'
type TaskAttachment = {
  id: string
  type: 'image' | 'file'
  name: string
  path: string
  previewPath?: string
}

type QuickTaskDefaults = {
  project: string
  processingAgent: string
}

const PRIORITY_OPTIONS: Array<{ label: string; value: Priority }> = [
  { label: '低', value: 'low' },
  { label: '中', value: 'medium' },
  { label: '高', value: 'high' },
  { label: '紧急', value: 'urgent' },
]

function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

function resolveImageSrc(filePath: string): string {
  if (!filePath) return ''
  if (filePath.startsWith('file://') || filePath.startsWith('data:')) return filePath
  return `file://${filePath}`
}

function getInitialPosition() {
  if (typeof window === 'undefined') return { x: 0, y: 0 }
  return {
    x: Math.max(24, Math.round(window.innerWidth / 2 - 300)),
    y: Math.max(24, Math.round(window.innerHeight / 2 - 260)),
  }
}

export function GlobalQuickTaskModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useApp()
  const sessionCtx = useSessionSidebar()
  const [content, setContent] = useState('')
  const [project, setProject] = useState('')
  const [processingAgent, setProcessingAgent] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [priority, setPriority] = useState<Priority>('medium')
  const [attachments, setAttachments] = useState<TaskAttachment[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [position, setPosition] = useState(getInitialPosition)
  const dragRef = useRef<{ startX: number; startY: number; x: number; y: number } | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  const agentOptions = useMemo(
    () => sessionCtx.agents.filter((agent) => agent.enabled).map((agent) => ({ label: agent.name, value: agent.name, id: agent.id })),
    [sessionCtx.agents],
  )

  const projectOptions = useMemo(
    () => sessionCtx.projectGroups
      .map((group) => group.workspace)
      .filter((workspace) => workspace.name && workspace.name !== '不使用项目' && workspace.name !== 'No project')
      .map((workspace) => ({ label: workspace.name, value: workspace.name, id: workspace.id })),
    [sessionCtx.projectGroups],
  )

  const resolveDefaults = useCallback((): QuickTaskDefaults => {
    const activeSession = sessionCtx.sessions.find((session) => session.id === sessionCtx.activeSessionId) ?? null
    const workspaceId = activeSession?.workspaceIds[0] ?? sessionCtx.activeWorkspaceId ?? null
    const workspace = workspaceId != null ? sessionCtx.workspaces.find((item) => item.id === workspaceId) : null
    const agent = activeSession?.agentId != null
      ? sessionCtx.agents.find((item) => item.id === activeSession.agentId)
      : sessionCtx.agents.find((item) => item.isDefault) ?? sessionCtx.agents[0]
    return {
      project: t.view === 'chat' ? (workspace?.name ?? '') : '',
      processingAgent: t.view === 'chat' ? (agent?.name ?? '') : (sessionCtx.agents.find((item) => item.isDefault)?.name ?? ''),
    }
  }, [sessionCtx.activeSessionId, sessionCtx.activeWorkspaceId, sessionCtx.agents, sessionCtx.sessions, sessionCtx.workspaces, t.view])

  useEffect(() => {
    if (!open) return
    const timer = window.setTimeout(() => {
      const defaults = resolveDefaults()
      setProject(defaults.project)
      setProcessingAgent(defaults.processingAgent)
      setDueDate('')
      setPriority('medium')
      setAttachments([])
      setPosition(getInitialPosition())
      textareaRef.current?.focus()
    }, 0)
    return () => window.clearTimeout(timer)
  }, [open, resolveDefaults])

  const handlePaste = useCallback(async (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const imageItems = Array.from(event.clipboardData?.items ?? []).filter((item) => item.type.startsWith('image/'))
    if (imageItems.length === 0) return
    event.preventDefault()
    const newAttachments: TaskAttachment[] = []
    for (let i = 0; i < imageItems.length; i += 1) {
      const file = imageItems[i]?.getAsFile()
      if (!file) continue
      const dataUrl = await readBlobAsDataUrl(file)
      const result = await window.spark.invoke('file:save-pasted-image', {
        dataUrl,
        suggestedBaseName: `quick-task-image-${i + 1}`,
        ...(file.type ? { mimeType: file.type } : {}),
      })
      newAttachments.push({
        id: `${Date.now()}-${i}-${result.filePath}`,
        type: 'image',
        name: result.fileName,
        path: result.filePath,
        previewPath: result.filePath,
      })
    }
    if (newAttachments.length > 0) setAttachments((prev) => [...prev, ...newAttachments])
  }, [])

  const handleSubmit = useCallback(async () => {
    const text = content.trim()
    if (!text || submitting) return
    setSubmitting(true)
    try {
      await window.spark.invoke('board:create', {
        title: text.split('\n').find(Boolean)?.slice(0, 80) ?? '快捷任务',
        description: text,
        status: 'todo',
        priority,
        assignee: processingAgent,
        project,
        tags: [],
        dueDate,
        processingAgent,
        acceptanceCriteria: '',
        testAgent: '',
        attachments,
        sortOrder: 0,
      })
      window.dispatchEvent(new CustomEvent('spark:refresh-view'))
      setContent('')
      onClose()
    } finally {
      setSubmitting(false)
    }
  }, [attachments, content, dueDate, onClose, priority, processingAgent, project, submitting])

  const handleMouseDown = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    dragRef.current = { startX: event.clientX, startY: event.clientY, x: position.x, y: position.y }
    event.preventDefault()
  }, [position.x, position.y])

  useEffect(() => {
    if (!open) return
    const handleMove = (event: MouseEvent) => {
      const drag = dragRef.current
      if (!drag) return
      setPosition({
        x: Math.max(12, Math.min(window.innerWidth - 120, drag.x + event.clientX - drag.startX)),
        y: Math.max(12, Math.min(window.innerHeight - 80, drag.y + event.clientY - drag.startY)),
      })
    }
    const handleUp = () => { dragRef.current = null }
    window.addEventListener('mousemove', handleMove)
    window.addEventListener('mouseup', handleUp)
    return () => {
      window.removeEventListener('mousemove', handleMove)
      window.removeEventListener('mouseup', handleUp)
    }
  }, [open])

  if (!open) return null

  return (
    <div className="quick-task-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className="quick-task-backdrop" />
      <section className="quick-task-modal" style={{ left: position.x, top: position.y }} onMouseDown={(event) => event.stopPropagation()}>
        <div className="quick-task-drag-handle" onMouseDown={handleMouseDown}>
          <div>
            <span className="quick-task-kicker">快捷录入</span>
            <h2>新建任务</h2>
          </div>
          <button className="quick-task-close" onClick={onClose} aria-label="关闭快捷任务录入">
            <Icons.X size={16} />
          </button>
        </div>

        <textarea
          ref={textareaRef}
          className="quick-task-input"
          value={content}
          onChange={(event) => setContent(event.target.value)}
          onPaste={handlePaste}
          placeholder="直接输入任务正文；支持 Ctrl/Cmd+V 粘贴图片…"
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void handleSubmit()
            if (event.key === 'Escape') onClose()
          }}
        />

        {attachments.length > 0 && (
          <div className="quick-task-attachments">
            {attachments.map((attachment) => (
              <button key={attachment.id} className="quick-task-thumb" onClick={() => setAttachments((prev) => prev.filter((item) => item.id !== attachment.id))} title="点击移除图片">
                <img src={resolveImageSrc(attachment.previewPath ?? attachment.path)} alt={attachment.name} />
                <span><Icons.X size={10} /></span>
              </button>
            ))}
          </div>
        )}

        <div className="quick-task-fields">
          <label>
            <span>项目</span>
            <Select value={project || undefined} onChange={(value) => setProject(value ?? '')} allowClear showSearch placeholder="选择项目" options={projectOptions} />
          </label>
          <label>
            <span>执行 Agent</span>
            <Select value={processingAgent || undefined} onChange={(value) => setProcessingAgent(value ?? '')} allowClear showSearch placeholder="选择 Agent" options={agentOptions} />
          </label>
          <label>
            <span>到期时间</span>
            <DatePicker value={dueDate || undefined} onChange={(dateString) => setDueDate(dateString ?? '')} placeholder="选择日期" style={{ width: '100%' }} allowClear />
          </label>
          <label>
            <span>优先级</span>
            <Select value={priority} onChange={(value) => setPriority(value)} options={PRIORITY_OPTIONS} />
          </label>
        </div>

        <div className="quick-task-footer">
          <span>快捷键：⌘/Ctrl + B 呼出，⌘/Ctrl + Enter 创建</span>
          <Button type="primary" onClick={handleSubmit} disabled={!content.trim()} loading={submitting}>创建任务</Button>
        </div>
      </section>
    </div>
  )
}
