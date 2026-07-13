/**
 * BoardView — 全局任务看板（类飞书看板）
 *
 * 功能：
 *  - 多列看板（待办 / 进行中 / Bug 修复 / 已完成 / 已关闭）
 *  - 内联创建/编辑页面（非弹窗）
 *  - 右键菜单：打开详情、复制、删除
 *  - 拖拽改变状态
 *  - 回收站（软删除 → 永久删除）
 *  - IPC 持久化
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { Dropdown, Button, Tooltip } from '@lobehub/ui'
import { DatePicker, Space, Switch } from 'antd'
import type { DragEvent, ReactNode } from 'react'
import { Icons } from '../Icons'
import { useApp } from '../AppContext'
import { useSessionSidebar } from '../SessionSidebarContext'
import { useIpcInvoke } from '../hooks/useIpc'
import { useRefreshable } from '../hooks/useRefreshable'
import { Input as LobeInput, Select as LobeSelect, TextArea as LobeTextArea } from '@lobehub/ui'
import type { SessionAttachment, SessionId } from '@spark/protocol'
import { ProjectSelect, projectValueToStorage, storageToProjectValue } from '../components/ProjectSelect'
import './BoardView.less'

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type Priority = 'low' | 'medium' | 'high' | 'urgent'

export type TaskStatus = 'todo' | 'in-progress' | 'done' | 'accepted' | 'closed' | 'bug-fix'

export type TaskComment = {
  id: string
  taskId: string
  author: string
  content: string
  createdAt: string
}

export type TaskAttachment = {
  id: string
  type: 'image' | 'file'
  name: string
  path: string
  previewPath?: string
}

export type TaskCard = {
  id: string
  title: string
  description: string
  status: TaskStatus
  priority: Priority
  assignee: string
  project: string
  tags: string[]
  dueDate: string
  processingAgent: string
  acceptanceCriteria: string
  testAgent: string
  comments: TaskComment[]
  attachments: TaskAttachment[]
  sortOrder: number
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

type BoardPage =
  | { view: 'kanban' }
  | { view: 'create'; defaultStatus: TaskStatus }
  | { view: 'edit'; card: TaskCard }

/* ------------------------------------------------------------------ */
/*  Attachment helpers                                                 */
/* ------------------------------------------------------------------ */

const IMAGE_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'ico',
  'tiff', 'tif', 'avif', 'heic', 'heif',
])

function isImagePath(filePath: string): boolean {
  const ext = filePath.split('.').pop()?.toLowerCase()
  return ext != null && IMAGE_EXTENSIONS.has(ext)
}

function fileNameFromPath(filePath: string): string {
  return filePath.split(/[\\/]/).filter(Boolean).pop() ?? filePath
}

function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read blob'))
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result)
      else reject(new Error('Failed to read blob'))
    }
    reader.readAsDataURL(blob)
  })
}

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

function boardAttachmentImageCandidates(attachment: TaskAttachment): string[] {
  return [attachment.previewPath, attachment.path]
    .filter((value, index, list): value is string => Boolean(value?.trim()) && list.indexOf(value) === index)
    .map((value) => resolveImageSrc(value))
}

function BoardAttachmentImage({
  attachment,
  className,
  placeholderClassName,
  onPreview,
  children,
}: {
  attachment: TaskAttachment
  className?: string
  placeholderClassName?: string
  onPreview?: (src: string) => void
  children?: ReactNode
}) {
  const candidates = useMemo(
    () => boardAttachmentImageCandidates(attachment),
    [attachment.path, attachment.previewPath],
  )
  const [candidateIndex, setCandidateIndex] = useState(0)

  useEffect(() => {
    setCandidateIndex(0)
  }, [candidates])

  const currentSrc = candidateIndex < candidates.length ? candidates[candidateIndex]! : null
  const broken = currentSrc == null

  const handleError = useCallback(() => {
    setCandidateIndex((current) => current + 1)
  }, [])

  const handleClick = useCallback(() => {
    if (currentSrc == null || onPreview == null) return
    onPreview(currentSrc)
  }, [currentSrc, onPreview])

  return (
    <div
      className={`${className ?? ''}${broken ? ' is-missing' : ''}`.trim()}
      onClick={handleClick}
      title={broken ? `${attachment.name} 不可访问` : attachment.name}
    >
      {broken ? (
        <div className={placeholderClassName}>
          <Icons.Image size={16} />
          <span>图片不可用</span>
        </div>
      ) : (
        <img src={currentSrc} alt={attachment.name} onError={handleError} />
      )}
      {children}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const COLUMNS: { key: TaskStatus; label: string; color: string; icon: string; headerBg: string; headerFg: string; colBg: string; colClass: string }[] = [
  { key: 'todo', label: '待办', color: '#6b7280', icon: '📋', headerBg: 'rgba(107,114,128,0.12)', headerFg: '#6b7280', colBg: 'rgba(107,114,128,0.04)', colClass: 'col-todo' },
  { key: 'in-progress', label: '进行中', color: '#3b82f6', icon: '🔄', headerBg: 'rgba(59,130,246,0.12)', headerFg: '#3b82f6', colBg: 'rgba(59,130,246,0.04)', colClass: 'col-in-progress' },
  { key: 'bug-fix', label: 'Bug 修复', color: '#ef4444', icon: '🐛', headerBg: 'rgba(239,68,68,0.12)', headerFg: '#ef4444', colBg: 'rgba(239,68,68,0.04)', colClass: 'col-bug-fix' },
  { key: 'done', label: '已完成', color: '#10b981', icon: '✅', headerBg: 'rgba(16,185,129,0.12)', headerFg: '#10b981', colBg: 'rgba(16,185,129,0.04)', colClass: 'col-done' },
  { key: 'accepted', label: '已验收', color: '#8b5cf6', icon: '🎯', headerBg: 'rgba(139,92,246,0.12)', headerFg: '#8b5cf6', colBg: 'rgba(139,92,246,0.04)', colClass: 'col-accepted' },
  { key: 'closed', label: '已关闭', color: '#9ca3af', icon: '📦', headerBg: 'rgba(156,163,175,0.12)', headerFg: '#9ca3af', colBg: 'rgba(156,163,175,0.04)', colClass: 'col-closed' },
]

/* ------------------------------------------------------------------ */
/*  Column Visibility (localStorage cached)                            */
/* ------------------------------------------------------------------ */

const BOARD_COLUMNS_STORAGE_KEY = 'board-visible-columns'

/**
 * 首次打开 / 无用户偏好时的默认可见列。
 * 精简为核心四列:待办 → 进行中 → 已完成 → 已关闭。
 * 用户在「面板」下拉里的自定义会覆盖此默认值。
 */
const DEFAULT_VISIBLE_COLUMNS: TaskStatus[] = ['todo', 'in-progress', 'done', 'closed']

/** Load visible columns from localStorage, fallback to DEFAULT_VISIBLE_COLUMNS */
function loadVisibleColumns(): TaskStatus[] {
  try {
    const stored = localStorage.getItem(BOARD_COLUMNS_STORAGE_KEY)
    if (stored) {
      const parsed = JSON.parse(stored) as TaskStatus[]
      // Validate: only return valid statuses that still exist in COLUMNS
      const validStatuses = COLUMNS.map(c => c.key)
      const validParsed = parsed.filter(s => validStatuses.includes(s))
      if (validParsed.length > 0) return validParsed
    }
  } catch { /* ignore */ }
  return DEFAULT_VISIBLE_COLUMNS
}

/** Save visible columns to localStorage */
function saveVisibleColumns(columns: TaskStatus[]): void {
  try {
    localStorage.setItem(BOARD_COLUMNS_STORAGE_KEY, JSON.stringify(columns))
  } catch { /* ignore */ }
}

const PRIORITY_CONFIG: Record<Priority, { label: string; color: string; bg: string; icon: string }> = {
  low: { label: '低', color: 'var(--text-muted)', bg: 'var(--hover)', icon: '⚪' },
  medium: { label: '中', color: 'var(--info)', bg: 'var(--info-bg)', icon: '🔵' },
  high: { label: '高', color: 'var(--warning)', bg: 'var(--warning-bg)', icon: '🟡' },
  urgent: { label: '紧急', color: 'var(--danger)', bg: 'var(--danger-bg)', icon: '🔴' },
}

function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

function now(): string {
  return new Date().toISOString()
}

/* ------------------------------------------------------------------ */
/*  Persistence (IPC → main process → ~/.spark-agent/board-tasks.json) */
/* ------------------------------------------------------------------ */

async function ipcLoadTasks(): Promise<TaskCard[]> {
  try {
    const res = await window.spark.invoke('board:list', { includeDeleted: true })
    return ((res.tasks ?? []) as unknown as Array<Record<string, unknown>>).map(normalizeTask)
  } catch { return [] }
}

function normalizeTask(raw: Record<string, unknown>): TaskCard {
  const commentsRaw = raw.commentsJson ?? raw.comments ?? '[]'
  const comments = typeof commentsRaw === 'string' ? JSON.parse(commentsRaw) : (Array.isArray(commentsRaw) ? commentsRaw : [])
  const attachmentsRaw = raw.attachmentsJson ?? raw.attachments ?? '[]'
  const attachments = typeof attachmentsRaw === 'string' ? JSON.parse(attachmentsRaw) : (Array.isArray(attachmentsRaw) ? attachmentsRaw : [])
  return {
    id: raw.id as string,
    title: raw.title as string,
    description: raw.description as string,
    status: raw.status as TaskStatus,
    priority: raw.priority as Priority,
    assignee: (raw.assignee as string) ?? '',
    project: (raw.project as string) ?? '',
    tags: (raw.tags as string[]) ?? [],
    dueDate: (raw.dueDate as string) ?? '',
    processingAgent: (raw.processingAgent as string) ?? '',
    acceptanceCriteria: (raw.acceptanceCriteria as string) ?? '',
    testAgent: (raw.testAgent as string) ?? '',
    comments,
    attachments,
    sortOrder: (raw.sortOrder as number) ?? 0,
    createdAt: raw.createdAt as string,
    updatedAt: raw.updatedAt as string,
    deletedAt: (raw.deletedAt as string | null) ?? null,
  }
}

async function ipcCreateTask(partial: Omit<TaskCard, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>): Promise<TaskCard> {
  const res = await window.spark.invoke('board:create', partial)
  return res.task as TaskCard
}

async function ipcUpdateTask(updated: TaskCard): Promise<TaskCard> {
  const res = await window.spark.invoke('board:update', {
    id: updated.id,
    title: updated.title,
    description: updated.description,
    status: updated.status,
    priority: updated.priority,
    assignee: updated.assignee,
    project: updated.project,
    tags: updated.tags,
    dueDate: updated.dueDate,
    processingAgent: updated.processingAgent,
    acceptanceCriteria: updated.acceptanceCriteria,
    testAgent: updated.testAgent,
    attachments: updated.attachments,
    sortOrder: updated.sortOrder,
  })
  return res.task as TaskCard
}

async function ipcBatchUpdateSortOrders(updates: Array<{ id: string; sortOrder: number }>): Promise<TaskCard[]> {
  const res = await window.spark.invoke('board:batch-update', {
    updates: updates.map((u) => ({ id: u.id, sortOrder: u.sortOrder })),
  })
  return (res.tasks ?? []) as TaskCard[]
}

async function ipcDeleteTask(id: string): Promise<void> {
  await window.spark.invoke('board:delete', { id })
}

async function ipcRestoreTask(id: string): Promise<TaskCard> {
  const res = await window.spark.invoke('board:restore', { id })
  return res.task as TaskCard
}

async function ipcPermanentDeleteTask(id: string): Promise<void> {
  await window.spark.invoke('board:permanent-delete', { id })
}

/* ------------------------------------------------------------------ */
/*  Auto-Execute Helpers                                               */
/* ------------------------------------------------------------------ */

// Polling cadence: each tick reconciles task statuses against live session
// state and decides what to dispatch / restart / retire. The agent_status event
// stream additionally wakes us up early (see handleAutoExecuteToggle), so this
// interval is a safety net, not the only driver.
const AUTO_POLL_INTERVAL_MS = 60 * 1000 // 1 minute
// How many tasks auto-execution will run in parallel.
const AUTO_MAX_CONCURRENCY = 2
// If a dispatched session stays "running" beyond this, treat it as stuck,
// cancel it, and re-dispatch the task (counts toward AUTO_MAX_RETRIES).
const AUTO_TASK_RUNTIME_LIMIT_MS = 45 * 60 * 1000 // 45 min
// After we first notice a session is no longer running, wait this long before
// declaring the task interrupted — gives the agent time to flush its final
// board_update(status: done/bug-fix) write.
const AUTO_SETTLE_GRACE_MS = 8 * 1000
// Max times a single task will be re-dispatched after an interruption before we
// give up and park it in bug-fix for a human.
const AUTO_MAX_RETRIES = 2
// When the agent_status stream signals a terminal status, debounce the wake-up
// tick by this long so the agent's board_update has time to land first.
const AUTO_EVENT_WAKEUP_DEBOUNCE_MS = 1500

// Terminal agent statuses — session is no longer actively running
const SESSION_TERMINAL_STATUSES = new Set(['idle', 'completed', 'cancelled', 'error'])

// Task statuses that mean auto-execution is done with a task — it has reached a
// final column and should be retired from the dispatch table. bug-fix counts as
// finished: we respect the agent's own failure verdict and don't auto-restart it.
const FINISHED_TASK_STATUSES = new Set<TaskStatus>(['done', 'accepted', 'closed', 'bug-fix'])

function isFinishedTaskStatus(status: TaskStatus): boolean {
  return FINISHED_TASK_STATUSES.has(status)
}

// Runtime tracking for one auto-dispatched task. Kept in a ref Map keyed by
// taskId (not sessionId) so a re-dispatch can swap the sessionId cleanly.
type AutoDispatchEntry = {
  taskId: string
  sessionId: string
  startedAt: number
  // First tick (ms) we observed the session stopped running; null while running.
  terminalSeenAt: number | null
  retries: number
}

/**
 * Best-effort query of whether a session currently has an active execution loop.
 * Uses session:get-queue (in-memory activeLoops.has), which is the most reliable
 * live signal — better than persisted sessions.status, which can lag during a
 * long turn and make a healthy run look "done".
 */
async function isSessionRunning(sessionId: string): Promise<boolean> {
  try {
    const res = await window.spark.invoke('session:get-queue', { sessionId: sessionId as SessionId })
    return !!((res as { running?: boolean } | null | undefined))?.running
  } catch {
    // Session not found / IPC failed → treat as not running so the caller can
    // decide whether the task needs re-dispatching.
    return false
  }
}

/** Best-effort cancel of a running turn; errors are swallowed (non-fatal hint). */
async function safeCancelSession(sessionId: string): Promise<void> {
  try {
    await window.spark.invoke('session:cancel', { sessionId: sessionId as SessionId })
  } catch {
    // ignore — we only cancel as a recovery hint
  }
}

/** Create a session for a board task and send the task as a prompt */
export async function executeTaskViaSession(
  task: TaskCard,
  agents: AgentOption[],
  projectGroups: { workspace: { name: string; id: string } }[],
): Promise<{ sessionId: string; turnId: string } | null> {
  try {
    // Resolve provider（仅作为兜底——优先用 agent.providerProfileId）
    const providerRes = await window.spark.invoke('provider:list', {})
    const profiles = (providerRes?.profiles ?? []) as Array<{ id: string; isDefault: boolean }>
    const fallbackProfile = profiles.find((p) => p.isDefault) ?? profiles[0]
    if (!fallbackProfile) {
      console.warn(`[AutoExecute] No provider available, skipping task "${task.title}"`)
      return null
    }

    // Resolve agent
    const agentRes = await window.spark.invoke('agent:list', { includeDisabled: false })
    const allAgents = (agentRes?.agents ?? []) as Array<{
      id: string
      name: string
      isDefault: boolean
      enabled: boolean
      providerProfileId?: string | null
      modelId?: string | null
    }>
    let resolvedAgentId = 'platform-manager-agent'
    let resolvedAgent: {
      providerProfileId?: string | null
      modelId?: string | null
    } | null = null
    if (task.processingAgent) {
      const matched = allAgents.find((a) => a.name === task.processingAgent && a.enabled)
      if (matched) {
        resolvedAgentId = matched.id
        resolvedAgent = matched
      } else {
        const defaultAgent = allAgents.find((a) => a.isDefault && a.enabled)
        if (defaultAgent) {
          resolvedAgentId = defaultAgent.id
          resolvedAgent = defaultAgent
        } else if (allAgents[0]) {
          resolvedAgentId = allAgents[0].id
          resolvedAgent = allAgents[0]
        }
      }
    } else {
      const defaultAgent = allAgents.find((a) => a.isDefault && a.enabled)
      if (defaultAgent) {
        resolvedAgentId = defaultAgent.id
        resolvedAgent = defaultAgent
      } else if (allAgents[0]) {
        resolvedAgentId = allAgents[0].id
        resolvedAgent = allAgents[0]
      }
    }

    // Provider：优先用 agent.providerProfileId；agent 未配置时回退默认 provider。
    // 这样能保证 session 的 provider 与 agent.modelId 匹配，避免 provider/model 错配。
    const agentProviderId = resolvedAgent?.providerProfileId
    const effectiveProfileId =
      agentProviderId != null && agentProviderId.length > 0 ? agentProviderId : fallbackProfile.id
    const agentModelId = resolvedAgent?.modelId

    // Resolve workspace
    let workspaceId: string | undefined
    if (task.project) {
      const group = projectGroups.find((g) => g.workspace.name === task.project)
      workspaceId = group?.workspace.id
    }
    if (!workspaceId) {
      // Resolve no-project workspace
      const wsRes = await window.spark.invoke('workspace:list', { includeArchived: false })
      const workspaces = (wsRes?.workspaces ?? []) as Array<{ id: string; name: string }>
      const noProject = workspaces.find((w) => w.name === '不使用项目')
      workspaceId = noProject?.id ?? workspaces[0]?.id
    }

    // Update task status to 'in-progress'
    await ipcUpdateTask({ ...task, status: 'in-progress', updatedAt: now() })

    // Build prompt
    const promptParts = [`## 任务：${task.title}`]
    if (task.description) promptParts.push(`\n### 描述\n${task.description}`)
    if (task.acceptanceCriteria) promptParts.push(`\n### 验收条件\n${task.acceptanceCriteria}`)
    if (task.processingAgent) promptParts.push(`\n### 处理 Agent\n${task.processingAgent}`)
    if (task.testAgent) promptParts.push(`\n### 测试 Agent\n${task.testAgent}`)

    // 任务附件：映射为 SessionAttachment，随 turn 一并发送给会话
    const turnAttachments: SessionAttachment[] = (task.attachments ?? [])
      .filter((a) => a.type === 'image' || a.type === 'file')
      .map((a) => ({ type: a.type, path: a.path }))

    if (turnAttachments.length > 0) {
      const imageCount = turnAttachments.filter((a) => a.type === 'image').length
      const fileCount = turnAttachments.length - imageCount
      const segs: string[] = []
      if (imageCount > 0) segs.push(`${imageCount} 张图片`)
      if (fileCount > 0) segs.push(`${fileCount} 个文件`)
      promptParts.push(`\n### 任务附件\n本任务携带 ${segs.join('、')}，已在消息中一并提供，请结合附件内容处理。`)
    }

    promptParts.push('\n请严格按照上述任务要求完成开发工作。完成后请审查代码并确保测试通过。')
    promptParts.push(
      [
        '\n### 任务状态回写（必须）',
        `本任务的 taskId 为：\`${task.id}\`。`,
        '完成后必须调用平台工具 `mcp__spark_platform__board_update` 写回任务状态：',
        '- 全部完成且验收通过：`{ id: "' + task.id + '", status: "done" }`',
        '- 出现无法解决的问题或失败：`{ id: "' + task.id + '", status: "bug-fix" }`',
        '不要遗漏此步骤，状态回写后任务才算闭环。',
      ].join('\n'),
    )
    const prompt = promptParts.join('\n')

    // Create session
    // 不传 agentAdapter/permissionMode/reasoningEffort —— 让 createSession 按 agent 配置回退。
    // 这样 agent 自身的 adapter/permission/effort 才会生效，而不是被 runtime 默认覆盖。
    const createRes = await window.spark.invoke('session:create', {
      providerProfileId: effectiveProfileId,
      agentId: resolvedAgentId,
      ...(agentModelId != null && agentModelId.length > 0 ? { modelId: agentModelId } : {}),
      ...(workspaceId ? { workspaceId } : {}),
      title: `[📋] ${task.title}`,
    })
    const sessionId = createRes.sessionId

    // Send turn
    const turnRes = await window.spark.invoke('session:submit-turn', {
      sessionId,
      message: prompt,
      ...(turnAttachments.length > 0 ? { attachments: turnAttachments } : {}),
    })

    return { sessionId: sessionId as unknown as string, turnId: turnRes.turnId as unknown as string }
  } catch (err) {
    console.error(`[AutoExecute] Failed to execute task "${task.title}":`, err)
    return null
  }
}

/* ------------------------------------------------------------------ */
/*  Context Menu State                                                 */
/* ------------------------------------------------------------------ */

type CtxMenuState = {
  x: number
  y: number
  card: TaskCard
} | null

type AgentOption = { id: string; name: string; isDefault?: boolean }

/* ------------------------------------------------------------------ */
/*  Task Form Page (inline create / edit)                              */
/* ------------------------------------------------------------------ */

function TaskFormPage({
  mode,
  card,
  agents,
  teamDefs,
  onBack,
  onSubmit,
}: {
  mode: 'create' | 'edit'
  card?: TaskCard
  agents: AgentOption[]
  teamDefs: AgentOption[]
  onBack: () => void
  onSubmit: (
    data: Omit<TaskCard, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>,
    opts?: { runNow?: boolean },
  ) => void | Promise<void>
}) {
  const [title, setTitle] = useState(card?.title ?? '')
  const [description, setDescription] = useState(card?.description ?? '')
  const [priority, setPriority] = useState<Priority>(card?.priority ?? 'medium')
  const [status, setStatus] = useState<TaskStatus>(card?.status ?? 'todo')
  const [assignee, setAssignee] = useState(card?.assignee ?? '')
  const [project, setProject] = useState<string | undefined>(storageToProjectValue(card?.project))
  const [tags, setTags] = useState(card?.tags.join(', ') ?? '')
  const [dueDate, setDueDate] = useState(card?.dueDate ?? '')
  const [processingAgent, setProcessingAgent] = useState(
    card?.processingAgent ?? agents.find((a) => a.isDefault)?.name ?? '',
  )
  const [acceptanceCriteria, setAcceptanceCriteria] = useState(card?.acceptanceCriteria ?? '')
  const [testAgent, setTestAgent] = useState(card?.testAgent ?? '')
  const [attachments, setAttachments] = useState<TaskAttachment[]>(card?.attachments ?? [])
  const [previewImage, setPreviewImage] = useState<string | null>(null)
  const titleRef = useRef<any>(null)
  const textareaRef = useRef<any>(null)
  // 兜底：创建模式下 agents 异步晚到时，一次性填充默认 agent
  const defaultAgentFilledRef = useRef(false)
  useEffect(() => {
    if (defaultAgentFilledRef.current) return
    if (mode !== 'create' || card?.processingAgent) { defaultAgentFilledRef.current = true; return }
    if (processingAgent) { defaultAgentFilledRef.current = true; return }
    const def = agents.find((a) => a.isDefault)?.name
    if (def) {
      setProcessingAgent(def)
      defaultAgentFilledRef.current = true
    }
  }, [mode, agents, card?.processingAgent, processingAgent])

  useEffect(() => {
    const t = setTimeout(() => {
      const el = titleRef.current?.input ?? titleRef.current
      el?.focus?.()
    }, 100)
    return () => clearTimeout(t)
  }, [])

  const handleSubmit = useCallback((opts?: { runNow?: boolean }) => {
    if (!title.trim() || !project) return
    onSubmit({
      title: title.trim(),
      description: description.trim(),
      status,
      priority,
      assignee: assignee.trim(),
      project: projectValueToStorage(project),
      tags: tags.split(',').map(t => t.trim()).filter(Boolean),
      dueDate,
      processingAgent,
      acceptanceCriteria: acceptanceCriteria.trim(),
      testAgent,
      comments: card?.comments ?? [],
      attachments,
      sortOrder: card?.sortOrder ?? 0,
    }, opts)
  }, [title, description, status, priority, assignee, project, tags, dueDate, processingAgent, acceptanceCriteria, testAgent, card?.comments, attachments, onSubmit])

  const [runningNow, setRunningNow] = useState(false)
  const handleRunNow = useCallback(() => {
    if (runningNow || !title.trim() || !project) return
    setRunningNow(true)
    Promise.resolve(handleSubmit({ runNow: true })).finally(() => setRunningNow(false))
  }, [handleSubmit, runningNow, title, project])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmit()
    if (e.key === 'Escape') onBack()
  }, [handleSubmit, onBack])

  // Paste image handler
  const handlePaste = useCallback(async (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(event.clipboardData?.items ?? [])
    const imageItems = items.filter((item) => item.type.startsWith('image/'))
    if (imageItems.length === 0) return

    event.preventDefault()
    try {
      const newAttachments: TaskAttachment[] = []
      for (let i = 0; i < imageItems.length; i++) {
        const file = imageItems[i]!.getAsFile()
        if (!file) continue
        const dataUrl = await readBlobAsDataUrl(file)
        const result = await window.spark.invoke('file:save-pasted-image', {
          dataUrl,
          suggestedBaseName: `board-image-${i + 1}`,
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
      if (newAttachments.length > 0) {
        setAttachments(prev => [...prev, ...newAttachments])
      }
    } catch (err) {
      console.error('粘贴图片失败', err)
    }
  }, [])

  // Upload file handler
  const handleUploadFile = useCallback(async () => {
    try {
      const selected = await window.spark.invoke('dialog:open-file', {
        title: '添加文件或图片',
        multiple: true,
      })
      const filePaths: string[] = selected.filePaths ?? (selected.filePath ? [selected.filePath] : [])
      if (selected.canceled || filePaths.length === 0) return

      const newAttachments: TaskAttachment[] = await Promise.all(
        filePaths.map(async (filePath, index) => {
          const type = isImagePath(filePath) ? 'image' : 'file'
          const base: TaskAttachment = {
            id: `${Date.now()}-${index}-${filePath}`,
            type,
            name: fileNameFromPath(filePath),
            path: filePath,
          }
          if (type !== 'image') return base
          try {
            const preview = await window.spark.invoke('file:prepare-image-preview', { sourcePath: filePath })
            return { ...base, previewPath: preview.filePath }
          } catch {
            return base
          }
        }),
      )
      setAttachments(prev => [...prev, ...newAttachments])
    } catch (err) {
      console.error('上传文件失败', err)
    }
  }, [])

  const handleRemoveAttachment = useCallback((id: string) => {
    setAttachments(prev => prev.filter(a => a.id !== id))
  }, [])

  const imageAttachments = attachments.filter(a => a.type === 'image')
  const fileAttachments = attachments.filter(a => a.type === 'file')

  const isEdit = mode === 'edit'

  return (
    <div className="task-form-page" onKeyDown={handleKeyDown}>
      {/* Header */}
      <div className="tfp-header">
        <button className="tfp-back-btn" onClick={onBack}>
          <Icons.ChevronLeft size={18} />
          <span>返回看板</span>
        </button>
        <h2 className="tfp-title">{isEdit ? '编辑任务' : '创建任务'}</h2>
        <div className="tfp-header-actions">
          <Button
            size="middle"
            type="text"
            icon={<Icons.Play size={13} />}
            onClick={handleRunNow}
            disabled={!title.trim() || !project || runningNow}
            loading={runningNow}
          >
            立即执行
          </Button>
          <Button size="middle" type="text" onClick={onBack}>取消</Button>
          <Button
            type="primary"
            size="middle"
            onClick={() => handleSubmit()}
            disabled={!title.trim() || !project}
          >
            {isEdit ? '保存修改' : '创建任务'}
          </Button>
        </div>
      </div>

      {/* Form body */}
      <div className="tfp-body">
        <div className="tfp-main">
          {/* Project */}
          <div className="tfp-field">
            <label className="tfp-label">项目</label>
            <ProjectSelect value={project} onChange={setProject} invalid={!project} placeholder="选择项目" />
          </div>

          {/* Title */}
          <div className="tfp-field">
            <label className="tfp-label">标题</label>
            <LobeInput
              ref={titleRef}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="输入任务标题…"
              className="tfp-input"
            />
          </div>

          {/* Description */}
          <div className="tfp-field">
            <label className="tfp-label">描述</label>
            <LobeTextArea
              ref={textareaRef}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              onPaste={handlePaste}
              placeholder="输入任务描述（可选），支持 Ctrl+V 粘贴图片…"
              rows={6}
              className="tfp-textarea"
            />
          </div>

          {/* Attachments */}
          {attachments.length > 0 && (
            <div className="tfp-field">
              <label className="tfp-label">附件 ({attachments.length})</label>
              <div className="tfp-attachments">
                {imageAttachments.length > 0 && (
                  <div className="tfp-attachment-gallery">
                    {imageAttachments.map(att => (
                      <BoardAttachmentImage
                        key={att.id}
                        attachment={att}
                        className="tfp-attachment-img"
                        placeholderClassName="tfp-attachment-placeholder"
                        onPreview={setPreviewImage}
                      >
                        <button className="tfp-attachment-remove" onClick={(e) => { e.stopPropagation(); handleRemoveAttachment(att.id) }}>
                          <Icons.X size={10} />
                        </button>
                        <div className="tfp-attachment-name">{att.name}</div>
                      </BoardAttachmentImage>
                    ))}
                  </div>
                )}
                {fileAttachments.length > 0 && (
                  <div className="tfp-attachment-files">
                    {fileAttachments.map(att => (
                      <div key={att.id} className="tfp-attachment-file">
                        <Icons.File size={13} />
                        <span className="tfp-attachment-fname">{att.name}</span>
                        <button className="tfp-attachment-remove" onClick={() => handleRemoveAttachment(att.id)}>
                          <Icons.X size={10} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Upload toolbar */}
          <div className="tfp-upload-bar">
            <button className="tfp-upload-btn" onClick={handleUploadFile} title="上传图片或文件">
              <Icons.Upload size={14} />
              <span>上传图片/文件</span>
            </button>
            <span className="tfp-upload-hint">支持在描述区域 Ctrl+V 粘贴图片</span>
          </div>

          {/* Status + Priority row */}
          <div className="tfp-row">
            <div className="tfp-field tfp-field-half">
              <label className="tfp-label">状态</label>
              <LobeSelect value={status} onChange={(value) => setStatus(value as TaskStatus)} className="tfp-select" options={COLUMNS.map(c => ({ label: `${c.icon} ${c.label}`, value: c.key }))} />
            </div>
            <div className="tfp-field tfp-field-half">
              <label className="tfp-label">优先级</label>
              <LobeSelect value={priority} onChange={(value) => setPriority(value as Priority)} className="tfp-select" options={(Object.keys(PRIORITY_CONFIG) as Priority[]).map((p) => {
                  const cfg = PRIORITY_CONFIG[p]
                  return { label: `${cfg.icon} ${cfg.label}`, value: p }
                })} />
            </div>
          </div>

          {/* Assignee + Due date row */}
          <div className="tfp-row">
            <div className="tfp-field tfp-field-half">
              <label className="tfp-label">负责人</label>
              <LobeSelect value={assignee} onChange={(value) => setAssignee(value as string)} placeholder="选择负责人" className="tfp-select" allowClear showSearch options={agents.map(a => ({ label: a.name, value: a.name }))} />
            </div>
            <div className="tfp-field tfp-field-half">
              <label className="tfp-label">截止日期</label>
              <DatePicker
                {...(dueDate ? { value: dueDate } : {})}
                onChange={(dateString) => setDueDate(dateString ?? '')}
                placeholder="年/月/日"
                style={{ width: '100%' }}
                allowClear
              />
            </div>
          </div>

          {/* Processing Agent + Test Agent row */}
          <div className="tfp-row">
            <div className="tfp-field tfp-field-half">
              <label className="tfp-label">处理 Agent</label>
              <LobeSelect value={processingAgent} onChange={(value) => setProcessingAgent(value as string)} placeholder="选择处理 Agent" className="tfp-select" allowClear showSearch options={[
                  ...agents.map(a => ({ label: a.name, value: a.name })),
                  ...teamDefs.map(t => ({ label: `[团队] ${t.name}`, value: `team:${t.name}` })),
                ]} />
            </div>
            <div className="tfp-field tfp-field-half">
              <label className="tfp-label">测试 Agent（可选）</label>
              <LobeSelect value={testAgent} onChange={(value) => setTestAgent(value as string)} placeholder="选择测试 Agent" className="tfp-select" allowClear showSearch options={[
                  ...agents.map(a => ({ label: a.name, value: a.name })),
                  ...teamDefs.map(t => ({ label: `[团队] ${t.name}`, value: `team:${t.name}` })),
                ]} />
            </div>
          </div>

          {/* Acceptance Criteria */}
          <div className="tfp-field">
            <label className="tfp-label">验收条件</label>
            <LobeTextArea
              value={acceptanceCriteria}
              onChange={(e) => setAcceptanceCriteria(e.target.value)}
              placeholder="输入任务完成后的验收标准（可选）…"
              rows={3}
              className="tfp-textarea"
            />
          </div>

          {/* Tags */}
          <div className="tfp-field" style={{paddingBottom: 20}}>
            <label className="tfp-label">标签</label>
            <LobeInput value={tags} onChange={(e) => setTags(e.target.value)} placeholder="用逗号分隔多个标签" className="tfp-input" />
          </div>

          {/* Tags preview */}
          {tags.length > 0 && (
            <div className="tfp-tags-preview">
              {tags.split(',').map(t => t.trim()).filter(Boolean).map((tag, i) => (
                <span key={i} className="tfp-tag">{tag}</span>
              ))}
            </div>
          )}

          {/* Meta info for edit mode */}
          {isEdit && card && (
            <div className="tfp-meta">
              <span>创建于 {formatDate(card.createdAt)}</span>
              <span>更新于 {formatDate(card.updatedAt)}</span>
            </div>
          )}
        </div>

        {/* Comments section (edit mode only) */}
        {isEdit && card && (
          <TaskCommentsPanel
            card={card}
            onAddComment={onAddComment}
            onDeleteComment={onDeleteComment}
            onUpdateComment={onUpdateComment}
          />
        )}
      </div>

      {/* Image preview overlay */}
      {previewImage && (
        <div className="tfp-preview-overlay" onClick={() => setPreviewImage(null)}>
          <div className="tfp-preview-content" onClick={(e) => e.stopPropagation()}>
            <img src={previewImage} alt="预览" />
            <button className="tfp-preview-close" onClick={() => setPreviewImage(null)}>
              <Icons.X size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/* Comment handlers — hoisted outside to avoid circular deps */

const onAddComment = async (taskId: string, author: string, content: string) => {
  const res = await window.spark.invoke('board:comment:create', { taskId, author, content })
  return res.comment as TaskComment
}

const onDeleteComment = async (taskId: string, commentId: string) => {
  await window.spark.invoke('board:comment:delete', { taskId, commentId })
}

const onUpdateComment = async (taskId: string, commentId: string, content: string) => {
  const res = await window.spark.invoke('board:comment:update', { taskId, commentId, content })
  return res.comment as TaskComment
}

/* ------------------------------------------------------------------ */
/*  Comments Panel (edit mode sidebar)                                 */
/* ------------------------------------------------------------------ */

function TaskCommentsPanel({
  card,
  onAddComment: addComment,
  onDeleteComment: deleteComment,
  onUpdateComment: updateComment,
}: {
  card: TaskCard
  onAddComment: (taskId: string, author: string, content: string) => Promise<TaskComment>
  onDeleteComment: (taskId: string, commentId: string) => Promise<void>
  onUpdateComment: (taskId: string, commentId: string, content: string) => Promise<TaskComment>
}) {
  const [newComment, setNewComment] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')

  const handleAdd = useCallback(async () => {
    if (!newComment.trim()) return
    await addComment(card.id, '', newComment.trim())
    setNewComment('')
  }, [card.id, newComment, addComment])

  const handleSaveEdit = useCallback(async (commentId: string) => {
    if (!editContent.trim()) return
    await updateComment(card.id, commentId, editContent.trim())
    setEditingId(null)
    setEditContent('')
  }, [card.id, editContent, updateComment])

  return (
    <div className="tfp-comments">
      <label className="tfp-label">评论 ({card.comments?.length ?? 0})</label>
      <div className="tfp-comment-list">
        {(card.comments ?? []).map((c) => (
          <div key={c.id} className="tfp-comment">
            <div className="tfp-comment-head">
              <span className="tfp-comment-author">{c.author || '用户'}</span>
              <span className="tfp-comment-time">{formatDate(c.createdAt)}</span>
            </div>
            {editingId === c.id ? (
              <div className="tfp-comment-edit">
                <LobeTextArea value={editContent} onChange={(e) => setEditContent(e.target.value)} rows={2} className="tfp-comment-edit-input" />
                <div className="tfp-comment-edit-actions">
                  <Button size="middle" type="primary" onClick={() => handleSaveEdit(c.id)} disabled={!editContent.trim()}>保存</Button>
                  <Button size="middle" type="text" onClick={() => { setEditingId(null); setEditContent('') }}>取消</Button>
                </div>
              </div>
            ) : (
              <div className="tfp-comment-body">{c.content}</div>
            )}
            {editingId !== c.id && (
              <div className="tfp-comment-actions">
                <Button size="middle" type="text" onClick={() => { setEditingId(c.id); setEditContent(c.content) }}>编辑</Button>
                <Button size="middle" type="text" danger onClick={async () => {
                  if (!window.confirm('确定删除该评论？')) return
                  await deleteComment(card.id, c.id)
                }}>删除</Button>
              </div>
            )}
          </div>
        ))}
        {(card.comments == null || card.comments.length === 0) && (
          <div className="tfp-comment-empty">
            <div className="tfp-comment-empty-icon">
              <Icons.Chat size={32} />
            </div>
            <div className="tfp-comment-empty-text">暂无评论</div>
          </div>
        )}
      </div>
      <div className="tfp-comment-input-row">
        <LobeTextArea
          placeholder="输入评论…（Ctrl+Enter 发送）"
          className="tfp-comment-input"
          rows={2}
          value={newComment}
          onChange={(e) => setNewComment(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && newComment.trim()) handleAdd()
          }}
        />
        <Button size="middle" type="primary" disabled={!newComment.trim()} onClick={handleAdd}>发送</Button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Recycle Bin Panel                                                  */
/* ------------------------------------------------------------------ */

function RecycleBinPanel({
  cards,
  onRestore,
  onPermanentDelete,
  onClose,
}: {
  cards: TaskCard[]
  onRestore: (id: string) => void
  onPermanentDelete: (id: string) => void
  onClose: () => void
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div className="board-modal-backdrop" onClick={onClose}>
      <div className="board-recycle-panel" onClick={(e) => e.stopPropagation()}>
        <div className="brp-header">
          <div className="brp-title">
            <Icons.Trash size={16} /> 回收站
          </div>
          <button className="board-icon-btn" onClick={onClose}><Icons.X size={16} /></button>
        </div>
        <div className="brp-body">
          {cards.length === 0 ? (
            <div className="empty-compact">
              <div className="empty-icon"><Icons.Archive size={18} /></div>
              <div className="empty-title">回收站为空</div>
            </div>
          ) : (
            <div className="brp-list">
              {cards.map(card => (
                <div key={card.id} className="brp-item">
                  <div className="brp-item-info">
                    <div className="brp-item-title">{card.title}</div>
                    <div className="brp-item-meta">
                      删除于 {formatDate(card.deletedAt ?? card.updatedAt)}
                    </div>
                  </div>
                  <div className="brp-item-actions">
                    <Button type='text' size='small' onClick={() => onRestore(card.id)}>恢复</Button>
                    <Button type='text' size='small' danger  onClick={() => onPermanentDelete(card.id)}>彻底删除</Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Context Menu                                                       */
/* ------------------------------------------------------------------ */

function CardContextMenu({
  menu,
  onOpenDetail,
  onRunNow,
  onCopy,
  onDelete,
  onClose,
}: {
  menu: CtxMenuState
  onOpenDetail: (card: TaskCard) => void
  onRunNow: (card: TaskCard) => void
  onCopy: (card: TaskCard) => void
  onDelete: (id: string) => void
  onClose: () => void
}) {
  if (!menu) return null
  return (
    <>
      <div className="board-ctx-backdrop" onClick={onClose} />
      <div className="board-ctx-menu" style={{ top: menu.y, left: menu.x }}>
        <button className="board-ctx-item" onClick={() => { onOpenDetail(menu.card); onClose() }}>
          <Icons.Eye size={14} /> 打开详情
        </button>
        <button className="board-ctx-item" onClick={() => { onRunNow(menu.card); onClose() }}>
          <Icons.Play size={14} /> 立即执行
        </button>
        <button className="board-ctx-item" onClick={() => { onCopy(menu.card); onClose() }}>
          <Icons.Copy size={14} /> 复制任务
        </button>
        <div className="board-ctx-divider" />
        <button className="board-ctx-item board-ctx-danger" onClick={() => { onDelete(menu.card.id); onClose() }}>
          <Icons.Trash size={14} /> 删除
        </button>
      </div>
    </>
  )
}

/* ------------------------------------------------------------------ */
/*  Task Card                                                          */
/* ------------------------------------------------------------------ */

function KanbanCard({
  card,
  onOpen,
  onContextMenu,
  onDragStart,
  onDragOver,
  onDragEnd,
  onAccept,
  isDragOverBefore,
  isDragOverAfter,
  isDragging,
  selectionMode,
  isSelected,
  onToggleSelection,
}: {
  card: TaskCard
  onOpen: (card: TaskCard) => void
  onContextMenu: (e: React.MouseEvent, card: TaskCard) => void
  onDragStart: (e: DragEvent, card: TaskCard) => void
  onDragOver: (e: DragEvent, card: TaskCard) => void
  onDragEnd: () => void
  onAccept: (card: TaskCard) => void
  isDragOverBefore: boolean
  isDragOverAfter: boolean
  isDragging: boolean
  selectionMode?: boolean
  isSelected?: boolean
  onToggleSelection?: (taskId: string) => void
}) {
  const pCfg = PRIORITY_CONFIG[card.priority]
  const colCfg = COLUMNS.find(c => c.key === card.status)
  const isOverdue = card.dueDate && new Date(card.dueDate) < new Date() && card.status !== 'done' && card.status !== 'accepted' && card.status !== 'closed'

  const handleClick = useCallback((e: React.MouseEvent) => {
    if (selectionMode) {
      e.preventDefault()
      onToggleSelection?.(card.id)
    } else {
      onOpen(card)
    }
  }, [selectionMode, card.id, onToggleSelection, onOpen])

  return (
    <>
      {isDragOverBefore && <div className="board-card-drop-indicator" />}
      <div
        className={`board-card board-card-${card.priority}${isDragging ? ' board-card-dragging' : ''}${isSelected ? ' board-card-selected' : ''}`}
        draggable={!selectionMode}
        onDragStart={(e) => !selectionMode && onDragStart(e, card)}
        onDragOver={(e) => !selectionMode && onDragOver(e, card)}
        onDragEnd={() => !selectionMode && onDragEnd()}
        onClick={handleClick}
        onContextMenu={(e) => !selectionMode && onContextMenu(e, card)}
      >
      {selectionMode && (
        <div className="bc-select-checkbox">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => onToggleSelection?.(card.id)}
          />
        </div>
      )}
      <div className="bc-indicator">
        <span className="bc-priority-badge" style={{ background: pCfg.bg, color: pCfg.color }}>
          {pCfg.icon} {pCfg.label}
        </span>
        {card.tags.length > 0 && (
          <span className="bc-tag-count">{card.tags.length} 标签</span>
        )}
      </div>

      <div className="bc-title">{card.title}</div>

      {card.project && (
        <div className="bc-project">{card.project}</div>
      )}

      {card.description && (
        <div className="bc-desc">{card.description}</div>
      )}

      {card.attachments && card.attachments.length > 0 && (
        <div className="bc-attachments">
          {card.attachments.filter(a => a.type === 'image').slice(0, 2).map((att) => (
            <BoardAttachmentImage
              key={att.id}
              attachment={att}
              className="bc-attachment-thumb"
              placeholderClassName="bc-attachment-placeholder"
            />
          ))}
          {card.attachments.filter(a => a.type === 'file').length > 0 && (
            <span className="bc-file-count">
              <Icons.File size={10} /> {card.attachments.filter(a => a.type === 'file').length} 文件
            </span>
          )}
          {card.attachments.length > 2 && (
            <span className="bc-attachment-more">+{card.attachments.length - 2}</span>
          )}
        </div>
      )}

      {card.tags.length > 0 && (
        <div className="bc-tags">
          {card.tags.slice(0, 3).map((tag, i) => (
            <span key={i} className="bc-tag">{tag}</span>
          ))}
          {card.tags.length > 3 && <span className="bc-tag bc-tag-more">+{card.tags.length - 3}</span>}
        </div>
      )}

      <div className="bc-footer">
        <div className="bc-meta-left">
          {card.assignee && (
            <span className="bc-assignee">
              <span className="bc-avatar">{card.assignee[0]?.toUpperCase()}</span>
              {card.assignee}
            </span>
          )}
          {card.comments && card.comments.length > 0 && (
            <span className="bc-comment-count">💬 {card.comments.length}</span>
          )}
          {card.attachments && card.attachments.length > 0 && (
            <span className="bc-attachment-count">
              <Icons.Image size={11} /> {card.attachments.filter(a => a.type === 'image').length}
              {card.attachments.filter(a => a.type === 'file').length > 0 && (
                <> <Icons.File size={11} /> {card.attachments.filter(a => a.type === 'file').length}</>
              )}
            </span>
          )}
        </div>
        <div className="bc-meta-right">
          {card.dueDate && (
            <span className={`bc-due ${isOverdue ? 'bc-due-overdue' : ''}`}>
              <Icons.Clock size={11} /> {formatShortDate(card.dueDate)}
            </span>
          )}
          {card.status === 'done' && (
            <button
              className="bc-accept-btn"
              title="标记为已验收"
              onClick={(e) => { e.stopPropagation(); onAccept(card) }}
            >
              🎯 验收
            </button>
          )}
          <span className="bc-status-dot" style={{ background: colCfg?.color }} title={colCfg?.label} />
        </div>
      </div>
      </div>
      {isDragOverAfter && <div className="board-card-drop-indicator" />}
    </>
  )
}

/* ------------------------------------------------------------------ */
/*  Date Helpers                                                       */
/* ------------------------------------------------------------------ */

function formatDate(iso: string): string {
  if (!iso) return '-'
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function formatShortDate(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/* ------------------------------------------------------------------ */
/*  Main Board View                                                    */
/* ------------------------------------------------------------------ */

export function BoardView() {
  const { requestConfirm, setTweak } = useApp()
  const sessionCtx = useSessionSidebar()
  const { invoke: listAgents } = useIpcInvoke('agent:list')
  const { invoke: listTeamDefs } = useIpcInvoke('team:list-defs')
  const [tasks, setTasks] = useState<TaskCard[]>([])
  const [agents, setAgents] = useState<AgentOption[]>([])
  const [teamDefs, setTeamDefs] = useState<AgentOption[]>([])
  const [page, setPage] = useState<BoardPage>({ view: 'kanban' })
  const [ctxMenu, setCtxMenu] = useState<CtxMenuState>(null)
  const [showRecycle, setShowRecycle] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [filterPriority, setFilterPriority] = useState<Priority | 'all'>('all')
  const [filterStatus, setFilterStatus] = useState<TaskStatus | 'all'>('all')
  const [filterProject, setFilterProject] = useState<string>('all')
  const dragCardRef = useRef<TaskCard | null>(null)
  const [dragOverCardId, setDragOverCardId] = useState<string | null>(null)
  const [dragOverPosition, setDragOverPosition] = useState<'before' | 'after'>('before')
  const [dragOverColumn, setDragOverColumn] = useState<TaskStatus | null>(null)
  const [autoExecute, setAutoExecute] = useState(false)
  // How many tasks auto-execution currently has in flight (drives the label).
  const [autoActiveCount, setAutoActiveCount] = useState(0)
  // Dispatch table: taskId -> tracking entry. Only tasks auto-execution itself
  // dispatched live here, so manual "run now" tasks and pre-existing in-progress
  // tasks are never touched (per "don't decide based on running tasks").
  const autoDispatchRef = useRef<Map<string, AutoDispatchEntry>>(new Map())
  const autoFlagRef = useRef(false) // live toggle value, immune to stale closures
  const autoTickLockRef = useRef(false)
  const autoPollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const autoEventUnsubRef = useRef<(() => void) | null>(null)
  const autoEventWakeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Always points at the latest autoTick so the interval / event wake-up invoke a
  // current closure even after agents/projectGroups change and autoTick rebuilds.
  const autoTickRef = useRef<() => void>(() => {})
  // Visible columns state (cached in localStorage)
  const [visibleColumns, setVisibleColumns] = useState<TaskStatus[]>(loadVisibleColumns)
  // 受控下拉：筛选弹窗 / 显示状态面板弹窗
  const [filterOpen, setFilterOpen] = useState(false)
  const [columnOpen, setColumnOpen] = useState(false)
  // Selection mode for export
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set())

  // Refresh handler
  const refreshData = useCallback(() => {
    ipcLoadTasks().then(setTasks)
    listAgents({ includeDisabled: false }).then((res: any) => {
      const agentList: AgentOption[] = (res.agents ?? [])
        .filter((a: any) => a.enabled)
        .map((a: any) => ({ id: a.id, name: a.name, isDefault: a.isDefault === true }))
      setAgents(agentList)
    }).catch(() => {})
    listTeamDefs({ includeDisabled: false }).then((res: any) => {
      const teamList: AgentOption[] = (res.teams ?? [])
        .filter((t: any) => t.enabled)
        .map((t: any) => ({ id: t.id, name: t.name }))
      setTeamDefs(teamList)
    }).catch(() => {})
  }, [listAgents, listTeamDefs])
  const triggerRefresh = useRefreshable(refreshData)

  // Visible columns handlers
  const handleToggleColumn = useCallback((status: TaskStatus) => {
    setVisibleColumns(prev => {
      // Ensure at least one column is visible
      if (prev.includes(status) && prev.length <= 1) return prev
      const next = prev.includes(status)
        ? prev.filter(s => s !== status)
        : [...prev, status]
      saveVisibleColumns(next)
      return next
    })
  }, [])

  const handleSelectAllColumns = useCallback(() => {
    const all = COLUMNS.map(c => c.key)
    setVisibleColumns(all)
    saveVisibleColumns(all)
  }, [])

  // Load tasks, agents and team defs from IPC on mount
  useEffect(() => {
    refreshData()
  }, [refreshData])

  // Dispatch one 'todo' task: create its session, send the turn, and register it
  // in the dispatch table. Failures are non-fatal — the task stays 'todo' and we
  // simply don't track it, so the next tick retries it.
  const dispatchNewTask = useCallback(
    async (
      task: TaskCard,
      projectGroups: { workspace: { name: string; id: string } }[],
    ) => {
      const result = await executeTaskViaSession(task, agents, projectGroups)
      if (!result) {
        console.warn(`[AutoExecute] dispatch failed for "${task.title}", will retry next tick`)
        return
      }
      autoDispatchRef.current.set(task.id, {
        taskId: task.id,
        sessionId: result.sessionId,
        startedAt: Date.now(),
        terminalSeenAt: null,
        retries: 0,
      })
      setAutoActiveCount(autoDispatchRef.current.size)
      setTasks((prev) =>
        prev.map((t) =>
          t.id === task.id ? { ...t, status: 'in-progress' as TaskStatus, updatedAt: now() } : t,
        ),
      )
    },
    [agents],
  )

  // Re-dispatch an interrupted/stuck task into a fresh session. Honors the retry
  // cap; past it the task is parked in bug-fix so a human can look at it instead
  // of us looping forever on a genuinely broken task.
  const redispatchTask = useCallback(
    async (
      entry: AutoDispatchEntry,
      task: TaskCard,
      projectGroups: { workspace: { name: string; id: string } }[],
    ) => {
      autoDispatchRef.current.delete(entry.taskId)
      setAutoActiveCount(autoDispatchRef.current.size)

      if (entry.retries + 1 > AUTO_MAX_RETRIES) {
        console.warn(
          `[AutoExecute] task "${task.title}" exhausted ${AUTO_MAX_RETRIES} retries, marking bug-fix`,
        )
        const updated: TaskCard = { ...task, status: 'bug-fix', updatedAt: now() }
        await ipcUpdateTask(updated)
        setTasks((prev) => prev.map((t) => (t.id === task.id ? updated : t)))
        return
      }

      const result = await executeTaskViaSession(task, agents, projectGroups)
      if (!result) {
        // Re-dispatch failed — drop the task back to 'todo' so the slot-filler
        // can pick it up again on a later tick, rather than orphaning it.
        console.warn(`[AutoExecute] re-dispatch failed for "${task.title}", reverting to todo`)
        const reverted: TaskCard = { ...task, status: 'todo', updatedAt: now() }
        await ipcUpdateTask(reverted)
        setTasks((prev) => prev.map((t) => (t.id === task.id ? reverted : t)))
        return
      }

      autoDispatchRef.current.set(entry.taskId, {
        taskId: entry.taskId,
        sessionId: result.sessionId,
        startedAt: Date.now(),
        terminalSeenAt: null,
        retries: entry.retries + 1,
      })
      setAutoActiveCount(autoDispatchRef.current.size)
    },
    [agents],
  )

  // Reconcile the dispatch table against live task + session state: retire
  // finished entries, restart interrupted/stuck ones, and fill concurrency
  // slots with fresh 'todo' tasks. Idempotent and lock-guarded, so it's safe to
  // fire from both the interval and the agent_status wake-up. Crucially, the
  // loop only ever looks at tasks it dispatched itself — never at the global set
  // of running sessions — so manual "run now" tasks and stuck runs that aren't
  // ours can't drive the decision (per the requirement).
  const autoTick = useCallback(async () => {
    if (!autoFlagRef.current) return
    if (autoTickLockRef.current) return
    autoTickLockRef.current = true
    try {
      const projectGroups = sessionCtx.projectGroups.map((g) => ({
        workspace: { name: g.workspace.name, id: g.workspace.id },
      }))

      const allTasks = await ipcLoadTasks()
      const liveMap = new Map(allTasks.filter((t) => !t.deletedAt).map((t) => [t.id, t]))
      const nowMs = Date.now()

      // Phase 1 — reconcile already-dispatched tasks.
      for (const entry of Array.from(autoDispatchRef.current.values())) {
        // Toggle may have flipped off mid-tick — bail before doing any more
        // dispatch/redispatch, otherwise a session we stop tracking here could
        // get re-enrolled against the user's explicit "stop".
        if (!autoFlagRef.current) return
        const task = liveMap.get(entry.taskId)

        // Task vanished or reached a final column → retire.
        if (!task || isFinishedTaskStatus(task.status)) {
          autoDispatchRef.current.delete(entry.taskId)
          continue
        }

        const running = await isSessionRunning(entry.sessionId)

        if (running) {
          entry.terminalSeenAt = null
          // Still alive but over the runtime limit → assume stuck, cancel + retry.
          if (nowMs - entry.startedAt > AUTO_TASK_RUNTIME_LIMIT_MS) {
            console.warn(`[AutoExecute] task "${task.title}" exceeded runtime limit, restarting`)
            await safeCancelSession(entry.sessionId)
            await redispatchTask(entry, task, projectGroups)
          }
          continue
        }

        // Session no longer running. First time we noticed? Record it and give
        // the agent a grace window to flush its final board_update write.
        if (entry.terminalSeenAt == null) {
          entry.terminalSeenAt = nowMs
          continue
        }
        if (nowMs - entry.terminalSeenAt < AUTO_SETTLE_GRACE_MS) continue

        // Grace expired, task still in-progress → interrupted (agent ended
        // without writing a final status). Re-fetch first in case board_update
        // landed during the grace window.
        const fresh = (await ipcLoadTasks()).find((t) => t.id === entry.taskId)
        if (!fresh || isFinishedTaskStatus(fresh.status)) {
          autoDispatchRef.current.delete(entry.taskId)
          continue
        }
        console.warn(
          `[AutoExecute] task "${fresh.title}" appears interrupted (session ended without status write), restarting`,
        )
        await redispatchTask(entry, fresh, projectGroups)
      }

      // Phase 2 — fill concurrency slots with new 'todo' tasks.
      if (autoFlagRef.current) {
        const slots = AUTO_MAX_CONCURRENCY - autoDispatchRef.current.size
        if (slots > 0) {
          const pending = allTasks
            .filter((t) => !t.deletedAt && t.status === 'todo')
            .filter((t) => !autoDispatchRef.current.has(t.id))
            .slice(0, slots)
          for (const task of pending) {
            await dispatchNewTask(task, projectGroups)
          }
        }
      }

      setAutoActiveCount(autoDispatchRef.current.size)
    } catch (err) {
      console.error('[AutoExecute] tick failed:', err)
    } finally {
      autoTickLockRef.current = false
    }
  }, [sessionCtx.projectGroups, dispatchNewTask, redispatchTask])

  // Keep autoTickRef in sync so the interval / wake-up always invoke the latest
  // closure (agents/projectGroups may rebuild autoTick after a refresh).
  useEffect(() => {
    autoTickRef.current = autoTick
  }, [autoTick])

  // Tear down auto-execution: stop the poll timer, release the event
  // subscription, clear wake-up timers, and drop the dispatch table. Sessions
  // already running are left alone to finish naturally — we only stop
  // dispatching new tasks and restarting interrupted ones. Re-enabling the
  // toggle starts fresh from 'todo'.
  const stopAutoExecute = useCallback(() => {
    autoFlagRef.current = false
    if (autoPollTimerRef.current) {
      clearInterval(autoPollTimerRef.current)
      autoPollTimerRef.current = null
    }
    if (autoEventWakeTimerRef.current) {
      clearTimeout(autoEventWakeTimerRef.current)
      autoEventWakeTimerRef.current = null
    }
    if (autoEventUnsubRef.current) {
      autoEventUnsubRef.current()
      autoEventUnsubRef.current = null
    }
    autoDispatchRef.current.clear()
    setAutoActiveCount(0)
  }, [])

  const handleAutoExecuteToggle = useCallback(
    (checked: boolean) => {
      setAutoExecute(checked)
      if (!checked) {
        stopAutoExecute()
        return
      }
      autoFlagRef.current = true
      // Wake up early whenever any session goes terminal — debounced so the
      // agent's final board_update has time to land before we reconcile. This is
      // an optimization; the 1-minute interval is the reliable fallback.
      const off = window.spark?.on?.(
        'stream:session:agent-event',
        (event: any) => {
          if (!autoFlagRef.current) return
          if (event?.type !== 'agent_status') return
          if (!SESSION_TERMINAL_STATUSES.has(event.status as string)) return
          if (autoEventWakeTimerRef.current) clearTimeout(autoEventWakeTimerRef.current)
          autoEventWakeTimerRef.current = setTimeout(
            () => autoTickRef.current(),
            AUTO_EVENT_WAKEUP_DEBOUNCE_MS,
          )
        },
      )
      autoEventUnsubRef.current = typeof off === 'function' ? off : null
      autoPollTimerRef.current = setInterval(
        () => autoTickRef.current(),
        AUTO_POLL_INTERVAL_MS,
      )
      // Kick off immediately so the user sees action without waiting a minute.
      autoTickRef.current()
    },
    [stopAutoExecute],
  )

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopAutoExecute()
    }
  }, [stopAutoExecute])

  // Derived
  const activeTasks = useMemo(() => tasks.filter(t => !t.deletedAt), [tasks])
  const deletedTasks = useMemo(() => tasks.filter(t => !!t.deletedAt), [tasks])

  const filteredTasks = useMemo(() => {
    let result = activeTasks
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      result = result.filter(t =>
        t.title.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.assignee.toLowerCase().includes(q) ||
        t.project?.toLowerCase().includes(q) ||
        t.tags.some(tag => tag.toLowerCase().includes(q))
      )
    }
    if (filterPriority !== 'all') result = result.filter(t => t.priority === filterPriority)
    if (filterStatus !== 'all') result = result.filter(t => t.status === filterStatus)
    if (filterProject !== 'all') result = result.filter(t => (t.project ?? '') === filterProject)
    return result
  }, [activeTasks, searchQuery, filterPriority, filterStatus, filterProject])

  const projectOptions = useMemo(() => {
    return sessionCtx.projectGroups
      .map(g => g.workspace)
      .filter(w => w.name && w.name !== '不使用项目' && w.name !== 'No project')
      .map(w => ({ value: w.name, label: w.name }))
  }, [sessionCtx.projectGroups])

  const columnTasks = useMemo(() => {
    const map: Record<TaskStatus, TaskCard[]> = { 'todo': [], 'in-progress': [], 'bug-fix': [], 'done': [], 'accepted': [], 'closed': [] }
    for (const t of filteredTasks) map[t.status].push(t)
    // Sort each column by sortOrder
    for (const key of Object.keys(map) as TaskStatus[]) {
      map[key].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    }
    return map
  }, [filteredTasks])

  const columnSelectorContent = (
    <div className="board-column-selector">
      <div className="bcs-header">
        <span>显示状态面板</span>
        <button className="bcs-select-all" onClick={handleSelectAllColumns}>全选</button>
      </div>
      <div className="bcs-list">
        {COLUMNS.map(col => {
          const isVisible = visibleColumns.includes(col.key)
          return (
            <label key={col.key} className="bcs-item">
              <input
                type="checkbox"
                checked={isVisible}
                onChange={() => handleToggleColumn(col.key)}
              />
              <span className="bcs-dot" style={{ background: col.color }} />
              <span className="bcs-label">{col.label}</span>
              <span className="bcs-count">{columnTasks[col.key]?.length ?? 0}</span>
            </label>
          )
        })}
      </div>
    </div>
  )

  // Handlers
  const runTaskNow = useCallback(async (task: TaskCard) => {
    const pg = sessionCtx.projectGroups.map((g) => ({
      workspace: { name: g.workspace.name, id: g.workspace.id },
    }))
    const result = await executeTaskViaSession(task, agents, pg)
    if (result) {
      setTasks(prev => prev.map(t =>
        t.id === task.id ? { ...t, status: 'in-progress' as TaskStatus, updatedAt: now() } : t,
      ))
      sessionCtx.setActiveSession(result.sessionId as SessionId)
      setTweak('view', 'chat')
    }
    return result
  }, [agents, sessionCtx, setTasks, setTweak])

  const handleCreate = useCallback(async (
    partial: Omit<TaskCard, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>,
    opts?: { runNow?: boolean },
  ) => {
    const created = await ipcCreateTask(partial)
    setTasks(prev => [...prev, created])
    if (opts?.runNow) {
      await runTaskNow(created)
    }
    setPage({ view: 'kanban' })
  }, [runTaskNow])

  const handleSave = useCallback(async (
    partial: Omit<TaskCard, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>,
    opts?: { runNow?: boolean },
  ) => {
    if (page.view !== 'edit') return
    const card = page.card
    const updated = await ipcUpdateTask({
      ...card,
      ...partial,
      updatedAt: now(),
    })
    setTasks(prev => prev.map(t => t.id === updated.id ? updated : t))
    if (opts?.runNow) {
      await runTaskNow(updated)
    }
    setPage({ view: 'kanban' })
  }, [page, runTaskNow])

  const handleRunNow = useCallback(async (card: TaskCard) => {
    await runTaskNow(card)
  }, [runTaskNow])

  const handleSoftDelete = useCallback(async (id: string) => {
    const ok = await requestConfirm({ title: '删除任务', description: '任务将移至回收站，可以恢复。', confirmText: '删除', danger: true })
    if (!ok) return
    await ipcDeleteTask(id)
    setTasks(prev => prev.map(t => t.id === id ? { ...t, deletedAt: now(), updatedAt: now() } : t))
    setPage({ view: 'kanban' })
  }, [requestConfirm])

  const handleRestore = useCallback(async (id: string) => {
    const restored = await ipcRestoreTask(id)
    setTasks(prev => prev.map(t => t.id === id ? restored : t))
  }, [])

  const handlePermanentDelete = useCallback(async (id: string) => {
    const ok = await requestConfirm({ title: '彻底删除', description: '此操作不可撤销，任务将被永久删除。', confirmText: '彻底删除', danger: true })
    if (!ok) return
    await ipcPermanentDeleteTask(id)
    setTasks(prev => prev.filter(t => t.id !== id))
  }, [requestConfirm])

  const handleCopy = useCallback(async (card: TaskCard) => {
    const created = await ipcCreateTask({ ...card, title: `${card.title} (副本)` })
    setTasks(prev => [...prev, created])
  }, [])

  // Export tasks to JSON file
  const handleExport = useCallback(async (selectedOnly: boolean = false) => {
    try {
      const tasksToExport = selectedOnly
        ? activeTasks.filter(t => selectedTaskIds.has(t.id))
        : activeTasks

      if (tasksToExport.length === 0) {
        window.alert('没有可导出的任务')
        return
      }

      const exportData = {
        version: 1,
        exportedAt: new Date().toISOString(),
        tasks: tasksToExport.map(t => ({
          title: t.title,
          description: t.description,
          status: t.status,
          priority: t.priority,
          assignee: t.assignee,
          project: t.project,
          tags: t.tags,
          dueDate: t.dueDate,
          processingAgent: t.processingAgent,
          acceptanceCriteria: t.acceptanceCriteria,
          testAgent: t.testAgent,
        })),
      }

      const jsonStr = JSON.stringify(exportData, null, 2)
      const result = await window.spark.invoke('dialog:save-file', {
        title: '导出任务',
        defaultPath: `tasks-${new Date().toISOString().slice(0, 10)}.json`,
        filters: [{ name: 'JSON', extensions: ['json'] }],
      })

      if (result.canceled || !result.filePath) return

      await window.spark.invoke('file:write-text', {
        path: result.filePath,
        content: jsonStr,
      })

      // Exit selection mode after export
      if (selectedOnly) {
        setSelectionMode(false)
        setSelectedTaskIds(new Set())
      }
    } catch (err) {
      console.error('导出任务失败', err)
      window.alert('导出失败: ' + (err instanceof Error ? err.message : String(err)))
    }
  }, [activeTasks, selectedTaskIds])

  // Import tasks from JSON file
  const handleImport = useCallback(async () => {
    try {
      const result = await window.spark.invoke('dialog:open-file', {
        title: '导入任务',
        filters: [{ name: 'JSON', extensions: ['json'] }],
      })

      if (result.canceled || !result.filePaths?.length) return

      const filePath = result.filePaths[0]
      if (!filePath) return

      const fileResult = await window.spark.invoke('file:read-text', { path: filePath })
      const data = JSON.parse(fileResult.content)

      // Validate structure
      if (!data.tasks || !Array.isArray(data.tasks)) {
        window.alert('无效的任务文件格式')
        return
      }

      const count = data.tasks.length
      // Stats per status for confirmation message
      const validStatuses = COLUMNS.map(c => c.key)
      const importedStatusCounts: Partial<Record<TaskStatus, number>> = {}
      let invalidStatusCount = 0
      for (const t of data.tasks) {
        const rawStatus = (t.status as string) || 'todo'
        if (validStatuses.includes(rawStatus as TaskStatus)) {
          importedStatusCounts[rawStatus as TaskStatus] = (importedStatusCounts[rawStatus as TaskStatus] ?? 0) + 1
        } else {
          invalidStatusCount += 1
        }
      }
      const breakdown = COLUMNS
        .filter(c => (importedStatusCounts[c.key] ?? 0) > 0)
        .map(c => `${c.label} ${importedStatusCounts[c.key]}`)
        .join('、')
      const breakdownSuffix = breakdown ? `\n\n状态分布：${breakdown}` : ''
      const fallbackSuffix = invalidStatusCount > 0 ? `\n（${invalidStatusCount} 个无法识别的状态将按"待办"导入）` : ''
      const confirmImport = window.confirm(`确定导入 ${count} 个任务？${breakdownSuffix}${fallbackSuffix}`)
      if (!confirmImport) return

      // Batch create tasks — preserve original status from file, fallback to 'todo'
      const createdTasks: TaskCard[] = []
      for (const t of data.tasks) {
        const rawStatus = (t.status as string) || 'todo'
        const status: TaskStatus = validStatuses.includes(rawStatus as TaskStatus)
          ? (rawStatus as TaskStatus)
          : 'todo'
        const created = await ipcCreateTask({
          title: t.title || '未命名任务',
          description: t.description || '',
          status,
          priority: (t.priority || 'medium') as Priority,
          assignee: t.assignee || '',
          project: t.project || '',
          tags: t.tags || [],
          dueDate: t.dueDate || '',
          processingAgent: t.processingAgent || '',
          acceptanceCriteria: t.acceptanceCriteria || '',
          testAgent: t.testAgent || '',
          comments: [],
          attachments: [],
          sortOrder: 0,
        })
        createdTasks.push(created)
      }

      setTasks(prev => [...prev, ...createdTasks])
      window.alert(`成功导入 ${createdTasks.length} 个任务`)
    } catch (err) {
      console.error('导入任务失败', err)
      window.alert('导入失败: ' + (err instanceof Error ? err.message : String(err)))
    }
  }, [])

  // Toggle task selection
  const handleToggleSelection = useCallback((taskId: string) => {
    setSelectedTaskIds(prev => {
      const next = new Set(prev)
      if (next.has(taskId)) {
        next.delete(taskId)
      } else {
        next.add(taskId)
      }
      return next
    })
  }, [])

  // Select all filtered tasks
  const handleSelectAll = useCallback(() => {
    setSelectedTaskIds(new Set(filteredTasks.map(t => t.id)))
  }, [filteredTasks])

  // Select / deselect every task in a single column
  const handleToggleColumnSelection = useCallback((status: TaskStatus) => {
    setSelectedTaskIds(prev => {
      const colIds = columnTasks[status].map(t => t.id)
      if (colIds.length === 0) return prev
      const allSelected = colIds.every(id => prev.has(id))
      const next = new Set(prev)
      if (allSelected) {
        for (const id of colIds) next.delete(id)
      } else {
        for (const id of colIds) next.add(id)
      }
      return next
    })
  }, [columnTasks])

  // Batch delete selected tasks (soft delete → recycle bin)
  const handleBatchDelete = useCallback(async () => {
    if (selectedTaskIds.size === 0) return
    const count = selectedTaskIds.size
    const ok = await requestConfirm({
      title: '批量删除任务',
      description: `将把 ${count} 个任务移至回收站，可在回收站中恢复。`,
      confirmText: '删除',
      danger: true,
    })
    if (!ok) return
    const ids = Array.from(selectedTaskIds)
    const deletedAt = now()
    // Persist in parallel; resolve on full success
    await Promise.all(ids.map(id => window.spark.invoke('board:delete', { id })))
    setTasks(prev => prev.map(t => selectedTaskIds.has(t.id) ? { ...t, deletedAt, updatedAt: deletedAt } : t))
    setSelectedTaskIds(new Set())
    setSelectionMode(false)
  }, [selectedTaskIds, requestConfirm])

  // Clear selection
  const handleClearSelection = useCallback(() => {
    setSelectedTaskIds(new Set())
  }, [])

  // Exit selection mode
  const handleExitSelectionMode = useCallback(() => {
    setSelectionMode(false)
    setSelectedTaskIds(new Set())
  }, [])

  const handleAccept = useCallback(async (card: TaskCard) => {
    const updated = await ipcUpdateTask({ ...card, status: 'accepted', updatedAt: now() })
    setTasks(prev => prev.map(t => t.id === updated.id ? updated : t))
  }, [])

  // Drag & Drop
  const handleDragStart = useCallback((e: DragEvent, card: TaskCard) => {
    dragCardRef.current = card
    e.dataTransfer.effectAllowed = 'move'
    const el = e.currentTarget as HTMLElement
    e.dataTransfer.setDragImage(el, el.offsetWidth / 2, 20)
  }, [])

  // Drag over a card — determine insert position (before/after)
  const handleCardDragOver = useCallback((e: DragEvent, card: TaskCard, status: TaskStatus) => {
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const midY = rect.top + rect.height / 2
    setDragOverCardId(card.id)
    setDragOverPosition(e.clientY < midY ? 'before' : 'after')
    setDragOverColumn(status)
  }, [])

  // Drag over the column body (empty area or gap between cards)
  const handleColumnDragOver = useCallback((e: DragEvent, status: TaskStatus) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverColumn(status)
    const col = (e.currentTarget as HTMLElement).closest('.board-col')
    col?.classList.add('board-col-drag-over')
  }, [])

  const handleColumnDragLeave = useCallback((e: DragEvent) => {
    const col = (e.currentTarget as HTMLElement).closest('.board-col')
    col?.classList.remove('board-col-drag-over')
    // Only clear if actually leaving the column body
    const related = e.relatedTarget as HTMLElement | null
    if (!col?.contains(related)) {
      setDragOverColumn(null)
      setDragOverCardId(null)
    }
  }, [])

  const handleDragEnd = useCallback(() => {
    dragCardRef.current = null
    setDragOverCardId(null)
    setDragOverPosition('before')
    setDragOverColumn(null)
    document.querySelectorAll('.board-col-drag-over').forEach(el => el.classList.remove('board-col-drag-over'))
  }, [])

  const handleDrop = useCallback(async (e: DragEvent, targetStatus: TaskStatus) => {
    e.preventDefault()
    const col = (e.currentTarget as HTMLElement).closest('.board-col')
    col?.classList.remove('board-col-drag-over')

    const card = dragCardRef.current
    if (!card) return
    dragCardRef.current = null

    const overCardId = dragOverCardId
    const overPosition = dragOverPosition
    setDragOverCardId(null)
    setDragOverPosition('before')
    setDragOverColumn(null)

    const isSameColumn = card.status === targetStatus

    // Get current column tasks (sorted by sortOrder)
    const colTasks = columnTasks[targetStatus].filter(t => t.id !== card.id)
    const insertIdx = overCardId
      ? colTasks.findIndex(t => t.id === overCardId)
      : colTasks.length // drop at end if no target card (empty area)

    if (insertIdx === -1 && overCardId) return // shouldn't happen

    // Calculate new sortOrder based on position
    let newSortOrder: number
    const effectiveIdx = overCardId
      ? (overPosition === 'before' ? insertIdx : insertIdx + 1)
      : colTasks.length

    if (colTasks.length === 0) {
      newSortOrder = 0
    } else if (effectiveIdx <= 0) {
      newSortOrder = (colTasks[0]?.sortOrder ?? 0) - 100
    } else if (effectiveIdx >= colTasks.length) {
      newSortOrder = (colTasks[colTasks.length - 1]?.sortOrder ?? 0) + 100
    } else {
      const prev = colTasks[effectiveIdx - 1]!
      const next = colTasks[effectiveIdx]!
      newSortOrder = Math.round(((prev.sortOrder ?? 0) + (next.sortOrder ?? 0)) / 2)
    }

    // Optimistic update
    const updatedCard: TaskCard = { ...card, status: targetStatus, sortOrder: newSortOrder }
    setTasks(prev => prev.map(t => t.id === card.id ? updatedCard : t))

    // Persist: single update for cross-column move + reorder, or same-column reorder
    await ipcUpdateTask(updatedCard)

    // After many reorder operations, sortOrder values may get too close.
    // Re-index if needed (when the gap between neighbors < 2)
    if (effectiveIdx > 0 && effectiveIdx < colTasks.length) {
      const prev = colTasks[effectiveIdx - 1]!
      const gap = newSortOrder - (prev.sortOrder ?? 0)
      if (Math.abs(gap) < 2) {
        // Re-index all tasks in this column
        const allColTasks = [...colTasks]
        allColTasks.splice(effectiveIdx, 0, updatedCard)
        const reindexed = allColTasks.map((t, i) => ({ id: t.id, sortOrder: i * 100 }))
        const result = await ipcBatchUpdateSortOrders(reindexed)
        if (result.length > 0) {
          setTasks(prev => {
            const map = new Map(result.map(t => [t.id, t]))
            return prev.map(t => map.get(t.id) ?? t)
          })
        }
      }
    }
  }, [columnTasks, dragOverCardId, dragOverPosition])

  const handleContextMenu = useCallback((e: React.MouseEvent, card: TaskCard) => {
    e.preventDefault()
    setCtxMenu({ x: Math.min(e.clientX, window.innerWidth - 180), y: Math.min(e.clientY, window.innerHeight - 160), card })
  }, [])

  useEffect(() => {
    if (!ctxMenu) return
    const handler = () => setCtxMenu(null)
    window.addEventListener('click', handler)
    return () => window.removeEventListener('click', handler)
  }, [ctxMenu])

  const totalActive = activeTasks.length
  const totalDeleted = deletedTasks.length

  // Form page — create or edit
  if (page.view === 'create') {
    return (
      <div className="board-view">
        <TaskFormPage
          mode="create"
          agents={agents}
          teamDefs={teamDefs}
          onBack={() => setPage({ view: 'kanban' })}
          onSubmit={handleCreate}
        />
      </div>
    )
  }

  if (page.view === 'edit') {
    const card = page.card
    // refresh card data from tasks state
    const freshCard = tasks.find(t => t.id === card.id) ?? card
    return (
      <div className="board-view">
        <TaskFormPage
          mode="edit"
          card={freshCard}
          agents={agents}
          teamDefs={teamDefs}
          onBack={() => setPage({ view: 'kanban' })}
          onSubmit={handleSave}
        />
        {/* Delete button for edit mode */}
        <div className="tfp-delete-bar">
          <Button
            danger
            type="text"
            size="middle"
            icon={<Icons.Trash size={13} />}
            onClick={() => handleSoftDelete(freshCard.id)}
          >
            删除任务
          </Button>
        </div>
      </div>
    )
  }

  // Default: kanban view
  return (
    <div className="board-view">
      {/* Header */}
      <div className="board-header">
        <div className="board-header-left">
          <h1 className="board-title">任务看板</h1>
          <span className="board-count">{totalActive} 个任务</span>
        </div>
        <div className="board-header-right" aria-label="任务筛选和操作">
          <div className="board-toolbar">
            <Tooltip
              title={
                autoExecute
                  ? `自动执行已开启：最多并行 ${AUTO_MAX_CONCURRENCY} 个待办任务，完成一个就继续取下一个；执行中被中断或卡死的任务会自动重新开发，直到全部完成或关闭开关`
                  : '开启自动执行：并行执行待办任务，完成一个继续取下一个；执行中中断/卡死的任务会自动重启，直到全部完成或关闭开关（不会干扰手动启动的任务）'
              }
            >
              <div className="board-auto-execute-toggle">
                <Switch
                  size="middle"
                  checked={autoExecute}
                  onChange={handleAutoExecuteToggle}
                />
                <span className={`board-auto-execute-label ${autoExecute ? 'active' : ''}`}>
                  {autoExecute && autoActiveCount > 0 ? `执行中（${autoActiveCount}）…` : '自动执行'}
                </span>
              </div>
            </Tooltip>
            <Button
              size='middle'
              type='text'
              onClick={triggerRefresh}
              title="刷新 (Ctrl+R)"
            >
              <Icons.Refresh size={14} />
            </Button>
            <div className="board-search">
              <LobeInput
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索任务…"
                className="board-search-input"
                prefix={<Icons.Search size={14} />}
                allowClear
              />
            </div>
            <Dropdown
              menu={{ items: [] }}
              open={filterOpen}
              onOpenChange={setFilterOpen}
              trigger={['click']}
              placement="bottom"
              popupRender={() => (
                <div className="board-filter-popover-content">
                  <div className="board-filter-popover-row">
                    <LobeSelect value={filterPriority} onChange={(value) => setFilterPriority(value as Priority | 'all')} className="board-filter-select" size="middle" style={{ width: 130 }} options={[
                      { label: '全部优先级', value: 'all' },
                      { label: '🔴 紧急', value: 'urgent' },
                      { label: '🟡 高', value: 'high' },
                      { label: '🔵 中', value: 'medium' },
                      { label: '⚪ 低', value: 'low' },
                    ]} />
                    <LobeSelect value={filterStatus} onChange={(value) => setFilterStatus(value as TaskStatus | 'all')} className="board-filter-select" size="middle" style={{ width: 130 }} options={[
                      { label: '全部状态', value: 'all' },
                      { label: '📋 待办', value: 'todo' },
                      { label: '🔄 进行中', value: 'in-progress' },
                      { label: '🐛 Bug 修复', value: 'bug-fix' },
                      { label: '✅ 已完成', value: 'done' },
                      { label: '🎯 已验收', value: 'accepted' },
                      { label: '📦 已关闭', value: 'closed' },
                    ]} />
                    {projectOptions.length > 0 && (
                      <LobeSelect value={filterProject} onChange={(value) => setFilterProject(value as string)} className="board-filter-select" size="middle" style={{ width: 130 }} options={[
                        { label: '全部项目', value: 'all' },
                        ...projectOptions.map(p => ({ label: p.label, value: p.value })),
                      ]} />
                    )}
                  </div>
                </div>
              )}
            >
              <Button type='text' title="筛选条件">
                <Icons.Filter size={14} />
                <span>筛选</span>
                {(filterPriority !== 'all' || filterStatus !== 'all' || filterProject !== 'all') && (
                  <span className="board-filter-active-dot" />
                )}
              </Button>
            </Dropdown>
            <Space size={6} className="board-action-group">
              
              <Dropdown
                menu={{ items: [] }}
                open={columnOpen}
                onOpenChange={setColumnOpen}
                trigger={['click']}
                placement="bottom"
                popupRender={() => columnSelectorContent}
              >
                <Button type='text' title="选择显示的状态面板">
                  <Icons.Board size={14} />
                  <span>面板</span>
                  <Icons.ChevronDown size={12} />
                </Button>
              </Dropdown>
              <Button type='text' size="middle" icon={<Icons.Archive size={15} />} onClick={() => setShowRecycle(true)} title="回收站" />
              {/* Import/Export dropdown button */}
              {!selectionMode && (
                <Dropdown
                  menu={{ items: [] }}
                  popupRender={() => (
                    <div className="board-import-export-dropdown">
                      <button className="board-dropdown-item" onClick={handleImport}>
                        <Icons.Download size={14} />
                        <span>导入任务</span>
                      </button>
                      <button className="board-dropdown-item" onClick={() => { handleExport(false); }}>
                        <Icons.Layers size={14} />
                        <span>导出全部任务</span>
                      </button>
                      <button className="board-dropdown-item" onClick={() => { setSelectionMode(true); setSelectedTaskIds(new Set()); }}>
                        <Icons.CheckSquare size={14} />
                        <span>选择导出…</span>
                      </button>
                    </div>
                  )}
                  trigger={['click']}
                  placement="bottom"
                >
                  <Button size="middle" type="text">
                    <span className="board-btn-inner">
                      <Icons.File size={14} />
                      <span>导入导出</span>
                      <Icons.ChevronDown size={12} />
                    </span>
                  </Button>
                </Dropdown>
              )}
              <Button type="primary" size="middle" icon={<Icons.Plus size={14} />} onClick={() => setPage({ view: 'create', defaultStatus: 'todo' })}>
                新建任务
              </Button>
            </Space>
          </div>
        </div>
      </div>

      {/* Selection Mode Toolbar (Second Row) */}
      {selectionMode && (
        <div className="board-selection-toolbar">
          <span className="board-selection-count">
            已选 {selectedTaskIds.size} 项
          </span>
          <div className="board-selection-actions">
            <Button size="middle" type="text" onClick={handleSelectAll} title="全选当前筛选结果">
              全选
            </Button>
            <Button size="middle" type="text" onClick={handleClearSelection} disabled={selectedTaskIds.size === 0}>
              取消选择
            </Button>
            <Button
              size="middle"
              danger
              onClick={handleBatchDelete}
              disabled={selectedTaskIds.size === 0}
              title="将所选任务移至回收站"
            >
              删除选中
            </Button>
            <Button size="middle" type="primary" onClick={() => handleExport(true)} disabled={selectedTaskIds.size === 0}>
              导出选中
            </Button>
            <Button size="middle" type="text" onClick={handleExitSelectionMode}>
              退出选择
            </Button>
          </div>
        </div>
      )}

      {/* Kanban Columns */}
      <div className="board-columns">
        {COLUMNS.filter(col => visibleColumns.includes(col.key)).map(col => (
          <div
            className={`board-col ${col.colClass}`}
            key={col.key}
            style={{ background: col.colBg } as React.CSSProperties}
          >
            <div className="board-col-header" style={{ background: col.headerBg }}>
              <div className="board-col-title">
                <span className="board-col-badge" style={{ background: col.color, color: '#fff' }}>
                  {col.label}
                </span>
              </div>
              <span className="board-col-count">{columnTasks[col.key].length}</span>
              {selectionMode && columnTasks[col.key].length > 0 && (
                <label
                  className="board-col-select-all"
                  title={(() => {
                    const colIds = columnTasks[col.key].map(t => t.id)
                    const allSelected = colIds.length > 0 && colIds.every(id => selectedTaskIds.has(id))
                    return allSelected ? '取消全选本面板' : '全选本面板'
                  })()}
                  onClick={(e) => e.stopPropagation()}
                >
                  <input
                    type="checkbox"
                    checked={(() => {
                      const colIds = columnTasks[col.key].map(t => t.id)
                      if (colIds.length === 0) return false
                      return colIds.every(id => selectedTaskIds.has(id))
                    })()}
                    ref={(el) => {
                      if (!el) return
                      const colIds = columnTasks[col.key].map(t => t.id)
                      if (colIds.length === 0) { el.indeterminate = false; return }
                      const selectedCount = colIds.filter(id => selectedTaskIds.has(id)).length
                      el.indeterminate = selectedCount > 0 && selectedCount < colIds.length
                    }}
                    onChange={() => handleToggleColumnSelection(col.key)}
                  />
                </label>
              )}
              <button className="board-icon-btn board-icon-btn-xs" title={`在"${col.label}"中新建`} onClick={() => setPage({ view: 'create', defaultStatus: col.key })}>
                <Icons.Plus size={13} />
              </button>
            </div>
            <div
              className="board-col-body"
              onDragOver={(e) => handleColumnDragOver(e, col.key)}
              onDragLeave={handleColumnDragLeave}
              onDrop={(e) => handleDrop(e, col.key)}
            >
              {columnTasks[col.key].length === 0 ? (
                <div className="board-col-empty">
                  <span>拖拽或创建任务到此处</span>
                </div>
              ) : (
                columnTasks[col.key].map(card => (
                  <KanbanCard
                    key={card.id}
                    card={card}
                    onOpen={(c) => setPage({ view: 'edit', card: c })}
                    onContextMenu={handleContextMenu}
                    onDragStart={handleDragStart}
                    onDragOver={(e, c) => handleCardDragOver(e, c, col.key)}
                    onDragEnd={handleDragEnd}
                    onAccept={handleAccept}
                    isDragOverBefore={dragOverCardId === card.id && dragOverPosition === 'before' && dragOverColumn === col.key}
                    isDragOverAfter={dragOverCardId === card.id && dragOverPosition === 'after' && dragOverColumn === col.key}
                    isDragging={dragCardRef.current?.id === card.id}
                    selectionMode={selectionMode}
                    isSelected={selectedTaskIds.has(card.id)}
                    onToggleSelection={handleToggleSelection}
                  />
                ))
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Context Menu */}
      <CardContextMenu menu={ctxMenu} onOpenDetail={(c) => setPage({ view: 'edit', card: c })} onRunNow={handleRunNow} onCopy={handleCopy} onDelete={handleSoftDelete} onClose={() => setCtxMenu(null)} />

      {/* Recycle Bin */}
      {showRecycle && (
        <RecycleBinPanel cards={deletedTasks} onRestore={handleRestore} onPermanentDelete={handlePermanentDelete} onClose={() => setShowRecycle(false)} />
      )}
    </div>
  )
}
