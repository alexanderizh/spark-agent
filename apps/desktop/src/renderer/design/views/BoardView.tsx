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
import type { DragEvent } from 'react'
import { Badge, Button, DatePicker, Select, Space } from '@arco-design/web-react'
import { Icons } from '../Icons'
import { useApp } from '../AppContext'
import { useSessionSidebar } from '../SessionSidebarContext'
import { useIpcInvoke } from '../hooks/useIpc'
import { SparkInput, SparkSearchInput, SparkSelect, SparkTextarea } from '../components/FormControls'
import './BoardView.less'

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type Priority = 'low' | 'medium' | 'high' | 'urgent'

export type TaskStatus = 'todo' | 'in-progress' | 'done' | 'closed' | 'bug-fix'

export type TaskComment = {
  id: string
  taskId: string
  author: string
  content: string
  createdAt: string
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
  comments: TaskComment[]
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

type BoardPage =
  | { view: 'kanban' }
  | { view: 'create'; defaultStatus: TaskStatus }
  | { view: 'edit'; card: TaskCard }

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const COLUMNS: { key: TaskStatus; label: string; color: string; icon: string; headerBg: string; headerFg: string; colBg: string; colClass: string }[] = [
  { key: 'todo', label: '待办', color: '#6b7280', icon: '📋', headerBg: 'rgba(107,114,128,0.12)', headerFg: '#6b7280', colBg: 'rgba(107,114,128,0.04)', colClass: 'col-todo' },
  { key: 'in-progress', label: '进行中', color: '#3b82f6', icon: '🔄', headerBg: 'rgba(59,130,246,0.12)', headerFg: '#3b82f6', colBg: 'rgba(59,130,246,0.04)', colClass: 'col-in-progress' },
  { key: 'bug-fix', label: 'Bug 修复', color: '#ef4444', icon: '🐛', headerBg: 'rgba(239,68,68,0.12)', headerFg: '#ef4444', colBg: 'rgba(239,68,68,0.04)', colClass: 'col-bug-fix' },
  { key: 'done', label: '已完成', color: '#10b981', icon: '✅', headerBg: 'rgba(16,185,129,0.12)', headerFg: '#10b981', colBg: 'rgba(16,185,129,0.04)', colClass: 'col-done' },
  { key: 'closed', label: '已关闭', color: '#9ca3af', icon: '📦', headerBg: 'rgba(156,163,175,0.12)', headerFg: '#9ca3af', colBg: 'rgba(156,163,175,0.04)', colClass: 'col-closed' },
]

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
    comments,
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
  })
  return res.task as TaskCard
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
/*  Context Menu State                                                 */
/* ------------------------------------------------------------------ */

type CtxMenuState = {
  x: number
  y: number
  card: TaskCard
} | null

type AgentOption = { id: string; name: string }

/* ------------------------------------------------------------------ */
/*  Task Form Page (inline create / edit)                              */
/* ------------------------------------------------------------------ */

function TaskFormPage({
  mode,
  card,
  agents,
  projectOptions,
  onBack,
  onSubmit,
}: {
  mode: 'create' | 'edit'
  card?: TaskCard
  agents: AgentOption[]
  projectOptions: { value: string; label: string }[]
  onBack: () => void
  onSubmit: (data: Omit<TaskCard, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>) => void
}) {
  const [title, setTitle] = useState(card?.title ?? '')
  const [description, setDescription] = useState(card?.description ?? '')
  const [priority, setPriority] = useState<Priority>(card?.priority ?? 'medium')
  const [status, setStatus] = useState<TaskStatus>(card?.status ?? 'todo')
  const [assignee, setAssignee] = useState(card?.assignee ?? '')
  const [project, setProject] = useState(card?.project ?? '')
  const [tags, setTags] = useState(card?.tags.join(', ') ?? '')
  const [dueDate, setDueDate] = useState(card?.dueDate ?? '')
  const titleRef = useRef<any>(null)

  useEffect(() => {
    const t = setTimeout(() => {
      const el = titleRef.current?.input ?? titleRef.current
      el?.focus?.()
    }, 100)
    return () => clearTimeout(t)
  }, [])

  const handleSubmit = useCallback(() => {
    if (!title.trim()) return
    onSubmit({
      title: title.trim(),
      description: description.trim(),
      status,
      priority,
      assignee: assignee.trim(),
      project: project.trim(),
      tags: tags.split(',').map(t => t.trim()).filter(Boolean),
      dueDate,
      comments: card?.comments ?? [],
    })
  }, [title, description, status, priority, assignee, project, tags, dueDate, card?.comments, onSubmit])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmit()
    if (e.key === 'Escape') onBack()
  }, [handleSubmit, onBack])

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
          <Button size="small" onClick={onBack}>取消</Button>
          <Button
            type="primary"
            size="small"
            onClick={handleSubmit}
            disabled={!title.trim()}
          >
            {isEdit ? '保存修改' : '创建任务'}
          </Button>
        </div>
      </div>

      {/* Form body */}
      <div className="tfp-body">
        <div className="tfp-main">
          {/* Title */}
          <div className="tfp-field">
            <label className="tfp-label">标题</label>
            <SparkInput
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
            <SparkTextarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="输入任务描述（可选）…"
              rows={6}
              className="tfp-textarea"
            />
          </div>

          {/* Status + Priority row */}
          <div className="tfp-row">
            <div className="tfp-field tfp-field-half">
              <label className="tfp-label">状态</label>
              <SparkSelect value={status} onChange={(e) => setStatus(e.target.value as TaskStatus)} className="tfp-select">
                {COLUMNS.map(c => <option key={c.key} value={c.key}>{c.icon} {c.label}</option>)}
              </SparkSelect>
            </div>
            <div className="tfp-field tfp-field-half">
              <label className="tfp-label">优先级</label>
              <SparkSelect value={priority} onChange={(e) => setPriority(e.target.value as Priority)} className="tfp-select">
                {(Object.keys(PRIORITY_CONFIG) as Priority[]).map((p) => {
                  const cfg = PRIORITY_CONFIG[p]
                  return <option key={p} value={p}>{cfg.icon} {cfg.label}</option>
                })}
              </SparkSelect>
            </div>
          </div>

          {/* Assignee + Due date row */}
          <div className="tfp-row">
            <div className="tfp-field tfp-field-half">
              <label className="tfp-label">负责人</label>
              <SparkSelect value={assignee} onChange={(e) => setAssignee(e.target.value)} placeholder="选择负责人" className="tfp-select" allowClear showSearch>
                {agents.map(a => <option key={a.id} value={a.name}>{a.name}</option>)}
              </SparkSelect>
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

          {/* Project */}
          <div className="tfp-row">
            <div className="tfp-field tfp-field-half">
              <label className="tfp-label">项目</label>
              <SparkSelect value={project} onChange={(e) => setProject(e.target.value)} placeholder="选择项目" className="tfp-select" allowClear showSearch>
                {projectOptions.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
              </SparkSelect>
            </div>
            <div className="tfp-field tfp-field-half">
              <label className="tfp-label">标签</label>
              <SparkInput value={tags} onChange={(e) => setTags(e.target.value)} placeholder="用逗号分隔多个标签" className="tfp-input" />
            </div>
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
                <SparkTextarea value={editContent} onChange={(e) => setEditContent(e.target.value)} rows={2} className="tfp-comment-edit-input" />
                <div className="tfp-comment-edit-actions">
                  <Button size="mini" type="primary" onClick={() => handleSaveEdit(c.id)} disabled={!editContent.trim()}>保存</Button>
                  <Button size="mini" onClick={() => { setEditingId(null); setEditContent('') }}>取消</Button>
                </div>
              </div>
            ) : (
              <div className="tfp-comment-body">{c.content}</div>
            )}
            {editingId !== c.id && (
              <div className="tfp-comment-actions">
                <button className="tfp-comment-action-btn" onClick={() => { setEditingId(c.id); setEditContent(c.content) }}>编辑</button>
                <button className="tfp-comment-action-btn tfp-comment-action-danger" onClick={async () => {
                  if (!window.confirm('确定删除该评论？')) return
                  await deleteComment(card.id, c.id)
                }}>删除</button>
              </div>
            )}
          </div>
        ))}
        {(card.comments == null || card.comments.length === 0) && (
          <div className="tfp-comment-empty">暂无评论</div>
        )}
      </div>
      <div className="tfp-comment-input-row">
        <SparkTextarea
          placeholder="输入评论…（Ctrl+Enter 发送）"
          className="tfp-comment-input"
          rows={2}
          value={newComment}
          onChange={(e) => setNewComment(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && newComment.trim()) handleAdd()
          }}
        />
        <Button size="small" type="primary" disabled={!newComment.trim()} onClick={handleAdd}>发送</Button>
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
                    <button className="board-btn board-btn-ghost board-btn-xs" onClick={() => onRestore(card.id)}>恢复</button>
                    <button className="board-btn board-btn-danger-outline board-btn-xs" onClick={() => onPermanentDelete(card.id)}>彻底删除</button>
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
  onCopy,
  onDelete,
  onClose,
}: {
  menu: CtxMenuState
  onOpenDetail: (card: TaskCard) => void
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
}: {
  card: TaskCard
  onOpen: (card: TaskCard) => void
  onContextMenu: (e: React.MouseEvent, card: TaskCard) => void
  onDragStart: (e: DragEvent, card: TaskCard) => void
}) {
  const pCfg = PRIORITY_CONFIG[card.priority]
  const colCfg = COLUMNS.find(c => c.key === card.status)
  const isOverdue = card.dueDate && new Date(card.dueDate) < new Date() && card.status !== 'done' && card.status !== 'closed'

  return (
    <div
      className={`board-card board-card-${card.priority}`}
      draggable
      onDragStart={(e) => onDragStart(e, card)}
      onClick={() => onOpen(card)}
      onContextMenu={(e) => onContextMenu(e, card)}
    >
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
        </div>
        <div className="bc-meta-right">
          {card.dueDate && (
            <span className={`bc-due ${isOverdue ? 'bc-due-overdue' : ''}`}>
              <Icons.Clock size={11} /> {formatShortDate(card.dueDate)}
            </span>
          )}
          <span className="bc-status-dot" style={{ background: colCfg?.color }} title={colCfg?.label} />
        </div>
      </div>
    </div>
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
  const { requestConfirm } = useApp()
  const sessionCtx = useSessionSidebar()
  const { invoke: listAgents } = useIpcInvoke('agent:list')
  const [tasks, setTasks] = useState<TaskCard[]>([])
  const [agents, setAgents] = useState<AgentOption[]>([])
  const [page, setPage] = useState<BoardPage>({ view: 'kanban' })
  const [ctxMenu, setCtxMenu] = useState<CtxMenuState>(null)
  const [showRecycle, setShowRecycle] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [filterPriority, setFilterPriority] = useState<Priority | 'all'>('all')
  const [filterStatus, setFilterStatus] = useState<TaskStatus | 'all'>('all')
  const [filterProject, setFilterProject] = useState<string>('all')
  const dragCardRef = useRef<TaskCard | null>(null)

  // Load tasks and agents from IPC on mount
  useEffect(() => {
    ipcLoadTasks().then(setTasks)
    listAgents({ includeDisabled: false }).then((res: any) => {
      const agentList: AgentOption[] = (res.agents ?? [])
        .filter((a: any) => a.enabled)
        .map((a: any) => ({ id: a.id, name: a.name }))
      setAgents(agentList)
    }).catch(() => {})
  }, [])

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
      .filter(w => w.name && w.name !== '不使用项目')
      .map(w => ({ value: w.name, label: w.name }))
  }, [sessionCtx.projectGroups])

  const columnTasks = useMemo(() => {
    const map: Record<TaskStatus, TaskCard[]> = { 'todo': [], 'in-progress': [], 'bug-fix': [], 'done': [], 'closed': [] }
    for (const t of filteredTasks) map[t.status].push(t)
    return map
  }, [filteredTasks])

  // Handlers
  const handleCreate = useCallback(async (partial: Omit<TaskCard, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>) => {
    const created = await ipcCreateTask(partial)
    setTasks(prev => [...prev, created])
    setPage({ view: 'kanban' })
  }, [])

  const handleSave = useCallback(async (partial: Omit<TaskCard, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>) => {
    if (page.view !== 'edit') return
    const card = page.card
    const updated = await ipcUpdateTask({
      ...card,
      ...partial,
      updatedAt: now(),
    })
    setTasks(prev => prev.map(t => t.id === updated.id ? updated : t))
    setPage({ view: 'kanban' })
  }, [page])

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

  // Drag & Drop
  const handleDragStart = useCallback((e: DragEvent, card: TaskCard) => {
    dragCardRef.current = card
    e.dataTransfer.effectAllowed = 'move'
    const el = e.currentTarget as HTMLElement
    e.dataTransfer.setDragImage(el, el.offsetWidth / 2, 20)
  }, [])

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const col = (e.currentTarget as HTMLElement).closest('.board-col')
    col?.classList.add('board-col-drag-over')
  }, [])

  const handleDragLeave = useCallback((e: DragEvent) => {
    const col = (e.currentTarget as HTMLElement).closest('.board-col')
    col?.classList.remove('board-col-drag-over')
  }, [])

  const handleDrop = useCallback(async (e: DragEvent, targetStatus: TaskStatus) => {
    e.preventDefault()
    const col = (e.currentTarget as HTMLElement).closest('.board-col')
    col?.classList.remove('board-col-drag-over')
    const card = dragCardRef.current
    if (!card || card.status === targetStatus) return
    dragCardRef.current = null
    const updated = await ipcUpdateTask({ ...card, status: targetStatus })
    setTasks(prev => prev.map(t => t.id === updated.id ? updated : t))
  }, [])

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
          projectOptions={projectOptions}
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
          projectOptions={projectOptions}
          onBack={() => setPage({ view: 'kanban' })}
          onSubmit={handleSave}
        />
        {/* Delete button for edit mode */}
        <div className="tfp-delete-bar">
          <Button
            status="danger"
            size="small"
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
            <div className="board-search">
              <SparkSearchInput
                value={searchQuery}
                onChange={setSearchQuery}
                placeholder="搜索任务…"
                className="board-search-input"
              />
            </div>
            <Space size={6} className="board-filter-group" aria-label="筛选条件">
              <Select value={filterPriority} onChange={(value) => setFilterPriority(value as Priority | 'all')} className="board-filter-select board-filter-priority" size="small">
                <Select.Option value="all">全部优先级</Select.Option>
                <Select.Option value="urgent">🔴 紧急</Select.Option>
                <Select.Option value="high">🟡 高</Select.Option>
                <Select.Option value="medium">🔵 中</Select.Option>
                <Select.Option value="low">⚪ 低</Select.Option>
              </Select>
              <Select value={filterStatus} onChange={(value) => setFilterStatus(value as TaskStatus | 'all')} className="board-filter-select board-filter-status" size="small">
                <Select.Option value="all">全部状态</Select.Option>
                <Select.Option value="todo">📋 待办</Select.Option>
                <Select.Option value="in-progress">🔄 进行中</Select.Option>
                <Select.Option value="bug-fix">🐛 Bug 修复</Select.Option>
                <Select.Option value="done">✅ 已完成</Select.Option>
                <Select.Option value="closed">📦 已关闭</Select.Option>
              </Select>
              {projectOptions.length > 0 && (
                <Select value={filterProject} onChange={(value) => setFilterProject(value)} className="board-filter-select board-filter-project" size="small">
                  <Select.Option value="all">全部项目</Select.Option>
                  {projectOptions.map(p => <Select.Option key={p.value} value={p.value}>{p.label}</Select.Option>)}
                </Select>
              )}
            </Space>
            <Space size={6} className="board-action-group">
              <Badge count={totalDeleted} className="board-recycle-badge-arco">
                <Button className="board-recycle-arco-btn" size="small" icon={<Icons.Archive size={15} />} onClick={() => setShowRecycle(true)} title="回收站" />
              </Badge>
              <Button className="board-create-arco-btn" type="primary" size="small" icon={<Icons.Plus size={14} />} onClick={() => setPage({ view: 'create', defaultStatus: 'todo' })}>
                新建任务
              </Button>
            </Space>
          </div>
        </div>
      </div>

      {/* Kanban Columns */}
      <div className="board-columns">
        {COLUMNS.map(col => (
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
              <button className="board-icon-btn board-icon-btn-xs" title={`在"${col.label}"中新建`} onClick={() => setPage({ view: 'create', defaultStatus: col.key })}>
                <Icons.Plus size={13} />
              </button>
            </div>
            <div
              className="board-col-body"
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
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
                  />
                ))
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Context Menu */}
      <CardContextMenu menu={ctxMenu} onOpenDetail={(c) => setPage({ view: 'edit', card: c })} onCopy={handleCopy} onDelete={handleSoftDelete} onClose={() => setCtxMenu(null)} />

      {/* Recycle Bin */}
      {showRecycle && (
        <RecycleBinPanel cards={deletedTasks} onRestore={handleRestore} onPermanentDelete={handlePermanentDelete} onClose={() => setShowRecycle(false)} />
      )}
    </div>
  )
}
