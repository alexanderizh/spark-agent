import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@lobehub/ui'
import { DatePicker, Select } from 'antd'
import { Icons } from '../Icons'
import { ProjectSelect, projectValueToStorage } from './ProjectSelect'
import { useApp } from '../AppContext'
import { useSessionSidebar } from '../SessionSidebarContext'
import { executeTaskViaSession } from '../views/BoardView'
import type { TaskCard } from '../views/BoardView'
import type { SessionId } from '@spark/protocol'
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

/**
 * 把绝对路径编码成 `safe-file://` URL。
 *
 * Electron 渲染进程 webSecurity=true，无法直接通过 `file://` 读取本地图片
 * （会被同源策略拦截，显示破图）。本应用注册了特权协议 `safe-file://`
 * （见 main/services/SafeFileProtocol.ts），渲染端拿到 `safe-file://x/<base64>`
 * 后即可直接给 `<img src>` 使用。与 BoardView / ComposerV2 保持一致。
 */
function encodeToSafeFileUrl(absolutePath: string): string {
  const encoded = btoa(unescape(encodeURIComponent(absolutePath)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
  return `safe-file://x/${encoded}`
}

function resolveImageSrc(filePath: string): string {
  if (!filePath) return filePath
  const trimmed = filePath.trim()
  const lower = trimmed.toLowerCase()
  if (lower.startsWith('http://') || lower.startsWith('https://') || lower.startsWith('data:') || lower.startsWith('safe-file:') || lower.startsWith('blob:')) return trimmed
  if (lower.startsWith('file://')) {
    try {
      const decoded = decodeURI(trimmed.replace(/^file:\/\//, ''))
      return encodeToSafeFileUrl(decoded.startsWith('/') ? decoded : `/${decoded}`)
    } catch {
      return trimmed
    }
  }
  if (trimmed.startsWith('/') || /^[A-Za-z]:[\\/]/.test(trimmed)) {
    return encodeToSafeFileUrl(trimmed)
  }
  return trimmed
}

function getInitialPosition() {
  if (typeof window === 'undefined') return { x: 0, y: 0 }
  return {
    x: Math.max(24, Math.round(window.innerWidth / 2 - 300)),
    y: Math.max(24, Math.round(window.innerHeight / 2 - 260)),
  }
}

export function GlobalQuickTaskModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, setTweak } = useApp()
  const sessionCtx = useSessionSidebar()
  const [content, setContent] = useState('')
  const [project, setProject] = useState<string | undefined>(undefined)
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

  const resolveDefaults = useCallback((): QuickTaskDefaults => {
    const activeSession = sessionCtx.sessions.find((session) => session.id === sessionCtx.activeSessionId) ?? null
    const agent = activeSession?.agentId != null
      ? sessionCtx.agents.find((item) => item.id === activeSession.agentId)
      : sessionCtx.agents.find((item) => item.isDefault) ?? sessionCtx.agents[0]
    return {
      processingAgent: t.view === 'chat' ? (agent?.name ?? '') : (sessionCtx.agents.find((item) => item.isDefault)?.name ?? ''),
    }
  }, [sessionCtx.activeSessionId, sessionCtx.agents, sessionCtx.sessions, t.view])

  useEffect(() => {
    if (!open) return
    const timer = window.setTimeout(() => {
      const defaults = resolveDefaults()
      setProject(undefined)
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

  const handleSubmit = useCallback(async (opts?: { runNow?: boolean }) => {
    const text = content.trim()
    if (!text || submitting || !project) return
    setSubmitting(true)
    try {
      const res = await window.spark.invoke('board:create', {
        title: text.split('\n').find(Boolean)?.slice(0, 80) ?? '快捷任务',
        description: text,
        status: 'todo',
        priority,
        assignee: processingAgent,
        project: projectValueToStorage(project),
        tags: [],
        dueDate,
        processingAgent,
        acceptanceCriteria: '',
        testAgent: '',
        attachments,
        sortOrder: 0,
      })
      const createdTask = res.task as TaskCard
      window.dispatchEvent(new CustomEvent('spark:refresh-view'))
      setContent('')
      onClose()

      if (opts?.runNow && createdTask) {
        const projectGroups = sessionCtx.projectGroups.map((g) => ({
          workspace: { name: g.workspace.name, id: g.workspace.id },
        }))
        const result = await executeTaskViaSession(createdTask, sessionCtx.agents, projectGroups)
        if (result) {
          sessionCtx.setActiveSession(result.sessionId as SessionId)
          setTweak('view', 'chat')
        } else {
          console.warn(`[QuickTask] Failed to execute task "${createdTask.title}" immediately`)
        }
      }
    } finally {
      setSubmitting(false)
    }
  }, [attachments, content, dueDate, onClose, priority, processingAgent, project, sessionCtx, setTweak, submitting])

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
            <ProjectSelect value={project} onChange={setProject} invalid={!project} placeholder="选择项目" />
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
          <div className="quick-task-actions">
            <Button onClick={() => void handleSubmit()} disabled={!content.trim() || !project} loading={submitting}>创建任务</Button>
            <Button type="primary" onClick={() => void handleSubmit({ runNow: true })} disabled={!content.trim() || !project} loading={submitting}>创建并执行</Button>
          </div>
        </div>
      </section>
    </div>
  )
}
