/**
 * BoardView — 全局任务看板（类飞书看板）
 *
 * 功能：
 *  - 多列看板（待办 / 进行中 / 已完成 / 已关闭）
 *  - 快捷创建任务卡片（弹窗式，使用 Arco Design 组件）
 *  - 点击卡片侧拉详情面板（支持编辑保存）
 *  - 右键菜单：打开详情、复制、删除
 *  - 拖拽改变状态
 *  - 回收站（软删除 → 永久删除）
 *  - localStorage 持久化
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { DragEvent } from 'react'
import { Badge, Button, DatePicker, Input, Select, Space } from '@arco-design/web-react'
import { Icons } from '../Icons'
import { useApp } from '../AppContext'
import { SparkInput, SparkSelect, SparkTextarea } from '../components/FormControls'

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type Priority = 'low' | 'medium' | 'high' | 'urgent'

export type TaskStatus = 'todo' | 'in-progress' | 'done' | 'closed'

export type TaskCard = {
  id: string
  title: string
  description: string
  status: TaskStatus
  priority: Priority
  assignee: string
  tags: string[]
  dueDate: string
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const STORAGE_KEY = 'spark-agent:board-tasks'

const COLUMNS: { key: TaskStatus; label: string; color: string; icon: string; headerBg: string; headerFg: string; colBg: string; colClass: string }[] = [
  { key: 'todo', label: '待办', color: '#6b7280', icon: '📋', headerBg: 'rgba(107,114,128,0.12)', headerFg: '#6b7280', colBg: 'rgba(107,114,128,0.04)', colClass: 'col-todo' },
  { key: 'in-progress', label: '进行中', color: '#3b82f6', icon: '🔄', headerBg: 'rgba(59,130,246,0.12)', headerFg: '#3b82f6', colBg: 'rgba(59,130,246,0.04)', colClass: 'col-in-progress' },
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
/*  Persistence                                                        */
/* ------------------------------------------------------------------ */

function loadTasks(): TaskCard[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    return JSON.parse(raw) as TaskCard[]
  } catch { return [] }
}

function saveTasks(tasks: TaskCard[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks))
}

/* ------------------------------------------------------------------ */
/*  Context Menu State                                                 */
/* ------------------------------------------------------------------ */

type CtxMenuState = {
  x: number
  y: number
  card: TaskCard
} | null

/* ------------------------------------------------------------------ */
/*  Quick Create Modal                                                 */
/* ------------------------------------------------------------------ */

function QuickCreateModal({
  defaultStatus,
  onClose,
  onSubmit,
}: {
  defaultStatus: TaskStatus
  onClose: () => void
  onSubmit: (card: Omit<TaskCard, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>) => void
}) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState<Priority>('medium')
  const [assignee, setAssignee] = useState('')
  const [tags, setTags] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [status, setStatus] = useState<TaskStatus>(defaultStatus)
  const titleRef = useRef<any>(null)

  useEffect(() => {
    // Focus the title input after Arco mounts
    const t = setTimeout(() => {
      const el = titleRef.current?.input ?? titleRef.current
      el?.focus?.()
    }, 50)
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
      tags: tags.split(',').map(t => t.trim()).filter(Boolean),
      dueDate,
    })
    onClose()
  }, [title, description, status, priority, assignee, tags, dueDate, onSubmit, onClose])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleSubmit()
    if (e.key === 'Escape') onClose()
  }, [handleSubmit, onClose])

  return (
    <div className="board-modal-backdrop" onClick={onClose}>
      <div className="board-quick-create" onClick={(e) => e.stopPropagation()} onKeyDown={handleKeyDown}>
        <div className="bqc-header">
          <div className="bqc-title">快捷创建任务</div>
          <button className="board-icon-btn" onClick={onClose}><Icons.X size={16} /></button>
        </div>
        <div className="bqc-body">
          <div className="bqc-field">
            <label>标题</label>
            <SparkInput
              ref={titleRef}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="输入任务标题…"
              className="bqc-input"
            />
          </div>
          <div className="bqc-field">
            <label>描述</label>
            <SparkTextarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="输入任务描述（可选）…"
              rows={3}
              className="bqc-textarea"
            />
          </div>
          <div className="bqc-row">
            <div className="bqc-field bqc-field-sm">
              <label>状态</label>
              <SparkSelect value={status} onChange={(e) => setStatus(e.target.value as TaskStatus)} className="bqc-select">
                {COLUMNS.map(c => <option key={c.key} value={c.key}>{c.icon} {c.label}</option>)}
              </SparkSelect>
            </div>
            <div className="bqc-field bqc-field-sm">
              <label>优先级</label>
              <SparkSelect value={priority} onChange={(e) => setPriority(e.target.value as Priority)} className="bqc-select">
                {(Object.keys(PRIORITY_CONFIG) as Priority[]).map((p) => {
                  const cfg = PRIORITY_CONFIG[p]
                  return (
                    <option key={p} value={p}>
                      <span className="bqc-priority-tag" style={{ background: cfg.bg, color: cfg.color }}>{cfg.label}</span>
                    </option>
                  )
                })}
              </SparkSelect>
            </div>
          </div>
          <div className="bqc-row">
            <div className="bqc-field bqc-field-sm">
              <label>负责人</label>
              <SparkInput value={assignee} onChange={(e) => setAssignee(e.target.value)} placeholder="指定负责人" className="bqc-input" />
            </div>
            <div className="bqc-field bqc-field-sm">
              <label>截止日期</label>
              <DatePicker
                {...(dueDate ? { value: dueDate } : {})}
                onChange={(dateString) => setDueDate(dateString ?? '')}
                placeholder="年/月/日"
                style={{ width: '100%' }}
                allowClear
              />
            </div>
          </div>
          <div className="bqc-field">
            <label>标签</label>
            <SparkInput value={tags} onChange={(e) => setTags(e.target.value)} placeholder="用逗号分隔多个标签" className="bqc-input" />
          </div>
        </div>
        <div className="bqc-footer">
          <span className="bqc-hint">Ctrl+Enter 提交</span>
          <div className="bqc-actions">
            <button className="board-btn board-btn-ghost" onClick={onClose}>取消</button>
            <button className="board-btn board-btn-primary" onClick={handleSubmit} disabled={!title.trim()}>创建任务</button>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Detail Side Panel                                                  */
/* ------------------------------------------------------------------ */

function DetailPanel({
  card,
  onClose,
  onSave,
  onDelete,
}: {
  card: TaskCard
  onClose: () => void
  onSave: (updated: TaskCard) => void
  onDelete: (id: string) => void
}) {
  const [title, setTitle] = useState(card.title)
  const [description, setDescription] = useState(card.description)
  const [priority, setPriority] = useState<Priority>(card.priority)
  const [status, setStatus] = useState<TaskStatus>(card.status)
  const [assignee, setAssignee] = useState(card.assignee)
  const [tags, setTags] = useState(card.tags.join(', '))
  const [dueDate, setDueDate] = useState(card.dueDate)
  const [isDirty, setIsDirty] = useState(false)

  const markDirty = useCallback(<T,>(val: T, setter: (v: T) => void) => {
    setter(val)
    setIsDirty(true)
  }, [])

  const handleSave = useCallback(() => {
    onSave({
      ...card,
      title,
      description,
      priority,
      status,
      assignee,
      tags: tags.split(',').map(t => t.trim()).filter(Boolean),
      dueDate,
      updatedAt: now(),
    })
    setIsDirty(false)
  }, [card, title, description, priority, status, assignee, tags, dueDate, onSave])

  const handleDelete = useCallback(() => {
    onDelete(card.id)
    onClose()
  }, [card.id, onDelete, onClose])

  const pCfg = PRIORITY_CONFIG[priority]
  const colCfg = COLUMNS.find(c => c.key === status)

  return (
    <div className="board-detail-overlay" onClick={onClose}>
      <div className="board-detail-panel" onClick={(e) => e.stopPropagation()}>
        <div className="bdp-header">
          <div className="bdp-header-left">
            <span className="bdp-priority-dot" style={{ background: pCfg.color }} />
            <span className="bdp-status-tag" style={{ color: pCfg.color, background: pCfg.bg }}>
              {colCfg?.icon} {colCfg?.label}
            </span>
          </div>
          <div className="bdp-header-right">
            {isDirty && (
              <button className="board-btn board-btn-primary board-btn-sm" onClick={handleSave}>保存</button>
            )}
            <button className="board-icon-btn" onClick={onClose}><Icons.X size={16} /></button>
          </div>
        </div>

        <div className="bdp-body">
          <div className="bdp-field">
            <label className="bdp-label">标题</label>
            <SparkInput value={title} onChange={(e) => markDirty(e.target.value, setTitle)} className="bdp-title-input" />
          </div>

          <div className="bdp-field">
            <label className="bdp-label">描述</label>
            <SparkTextarea value={description} onChange={(e) => markDirty(e.target.value, setDescription)} placeholder="添加详细描述…" rows={5} className="bdp-desc-input" />
          </div>

          <div className="bdp-field-row">
            <div className="bdp-field">
              <label className="bdp-label">状态</label>
              <SparkSelect value={status} onChange={(e) => markDirty(e.target.value as TaskStatus, setStatus)} className="bdp-select">
                {COLUMNS.map(c => <option key={c.key} value={c.key}>{c.icon} {c.label}</option>)}
              </SparkSelect>
            </div>
            <div className="bdp-field">
              <label className="bdp-label">优先级</label>
              <SparkSelect value={priority} onChange={(e) => markDirty(e.target.value as Priority, setPriority)} className="bdp-select">
                {(Object.keys(PRIORITY_CONFIG) as Priority[]).map((p) => {
                  const cfg = PRIORITY_CONFIG[p]
                  return (
                    <option key={p} value={p}>
                      <span className="bdp-priority-tag" style={{ background: cfg.bg, color: cfg.color }}>{cfg.label}</span>
                    </option>
                  )
                })}
              </SparkSelect>
            </div>
          </div>

          <div className="bdp-field-row">
            <div className="bdp-field">
              <label className="bdp-label">负责人</label>
              <SparkInput value={assignee} onChange={(e) => markDirty(e.target.value, setAssignee)} placeholder="未指定" className="bdp-input" />
            </div>
            <div className="bdp-field">
              <label className="bdp-label">截止日期</label>
              <DatePicker
                {...(dueDate ? { value: dueDate } : {})}
                onChange={(dateString) => markDirty(dateString ?? '', setDueDate)}
                placeholder="年/月/日"
                style={{ width: '100%' }}
                allowClear
              />
            </div>
          </div>

          <div className="bdp-field">
            <label className="bdp-label">标签</label>
            <SparkInput value={tags} onChange={(e) => markDirty(e.target.value, setTags)} placeholder="用逗号分隔" className="bdp-input" />
            {tags.length > 0 && (
              <div className="bdp-tags-preview">
                {tags.split(',').map(t => t.trim()).filter(Boolean).map((tag, i) => (
                  <span key={i} className="bdp-tag">{tag}</span>
                ))}
              </div>
            )}
          </div>

          <div className="bdp-meta">
            <span>创建于 {formatDate(card.createdAt)}</span>
            <span>更新于 {formatDate(card.updatedAt)}</span>
          </div>
        </div>

        <div className="bdp-footer">
          <button className="board-btn board-btn-danger-outline board-btn-sm" onClick={handleDelete}>
            <Icons.Trash size={13} /> 删除任务
          </button>
        </div>
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
      {/* Priority & status indicators */}
      <div className="bc-indicator">
        <span className="bc-priority-badge" style={{ background: pCfg.bg, color: pCfg.color }}>
          {pCfg.icon} {pCfg.label}
        </span>
        {card.tags.length > 0 && (
          <span className="bc-tag-count">{card.tags.length} 标签</span>
        )}
      </div>

      {/* Title */}
      <div className="bc-title">{card.title}</div>

      {/* Description preview */}
      {card.description && (
        <div className="bc-desc">{card.description}</div>
      )}

      {/* Tags row */}
      {card.tags.length > 0 && (
        <div className="bc-tags">
          {card.tags.slice(0, 3).map((tag, i) => (
            <span key={i} className="bc-tag">{tag}</span>
          ))}
          {card.tags.length > 3 && <span className="bc-tag bc-tag-more">+{card.tags.length - 3}</span>}
        </div>
      )}

      {/* Footer: assignee + due date + column indicator */}
      <div className="bc-footer">
        <div className="bc-meta-left">
          {card.assignee && (
            <span className="bc-assignee">
              <span className="bc-avatar">{card.assignee[0]?.toUpperCase()}</span>
              {card.assignee}
            </span>
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
  const [tasks, setTasks] = useState<TaskCard[]>(() => loadTasks())
  const [showCreate, setShowCreate] = useState(false)
  const [createDefaultStatus, setCreateDefaultStatus] = useState<TaskStatus>('todo')
  const [detailCard, setDetailCard] = useState<TaskCard | null>(null)
  const [ctxMenu, setCtxMenu] = useState<CtxMenuState>(null)
  const [showRecycle, setShowRecycle] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [filterPriority, setFilterPriority] = useState<Priority | 'all'>('all')
  const [filterStatus, setFilterStatus] = useState<TaskStatus | 'all'>('all')
  const dragCardRef = useRef<TaskCard | null>(null)

  // Persist
  useEffect(() => { saveTasks(tasks) }, [tasks])

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
        t.tags.some(tag => tag.toLowerCase().includes(q))
      )
    }
    if (filterPriority !== 'all') result = result.filter(t => t.priority === filterPriority)
    if (filterStatus !== 'all') result = result.filter(t => t.status === filterStatus)
    return result
  }, [activeTasks, searchQuery, filterPriority, filterStatus])

  const columnTasks = useMemo(() => {
    const map: Record<TaskStatus, TaskCard[]> = { 'todo': [], 'in-progress': [], 'done': [], 'closed': [] }
    for (const t of filteredTasks) map[t.status].push(t)
    return map
  }, [filteredTasks])

  // Handlers
  const handleCreate = useCallback((partial: Omit<TaskCard, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>) => {
    setTasks(prev => [...prev, { ...partial, id: uid(), createdAt: now(), updatedAt: now(), deletedAt: null }])
  }, [])

  const handleSave = useCallback((updated: TaskCard) => {
    setTasks(prev => prev.map(t => t.id === updated.id ? updated : t))
    setDetailCard(updated)
  }, [])

  const handleSoftDelete = useCallback(async (id: string) => {
    const ok = await requestConfirm({ title: '删除任务', description: '任务将移至回收站，可以恢复。', confirmText: '删除', danger: true })
    if (!ok) return
    setTasks(prev => prev.map(t => t.id === id ? { ...t, deletedAt: now(), updatedAt: now() } : t))
    setDetailCard(null)
  }, [requestConfirm])

  const handleRestore = useCallback((id: string) => {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, deletedAt: null, updatedAt: now() } : t))
  }, [])

  const handlePermanentDelete = useCallback(async (id: string) => {
    const ok = await requestConfirm({ title: '彻底删除', description: '此操作不可撤销，任务将被永久删除。', confirmText: '彻底删除', danger: true })
    if (!ok) return
    setTasks(prev => prev.filter(t => t.id !== id))
  }, [requestConfirm])

  const handleCopy = useCallback((card: TaskCard) => {
    setTasks(prev => [...prev, { ...card, id: uid(), title: `${card.title} (副本)`, createdAt: now(), updatedAt: now(), deletedAt: null }])
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

  const handleDrop = useCallback((e: DragEvent, targetStatus: TaskStatus) => {
    e.preventDefault()
    const col = (e.currentTarget as HTMLElement).closest('.board-col')
    col?.classList.remove('board-col-drag-over')
    const card = dragCardRef.current
    if (!card || card.status === targetStatus) return
    setTasks(prev => prev.map(t => t.id === card.id ? { ...t, status: targetStatus, updatedAt: now() } : t))
    dragCardRef.current = null
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
              <Input
                value={searchQuery}
                onChange={setSearchQuery}
                placeholder="搜索任务…"
                className="board-search-input"
                prefix={<Icons.Search size={15} />}
                allowClear
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
                <Select.Option value="done">✅ 已完成</Select.Option>
                <Select.Option value="closed">📦 已关闭</Select.Option>
              </Select>
            </Space>
            <Space size={6} className="board-action-group">
              <Badge count={totalDeleted} className="board-recycle-badge-arco">
                <Button className="board-recycle-arco-btn" size="small" icon={<Icons.Archive size={15} />} onClick={() => setShowRecycle(true)} title="回收站" />
              </Badge>
              <Button className="board-create-arco-btn" type="primary" size="small" icon={<Icons.Plus size={14} />} onClick={() => { setCreateDefaultStatus('todo'); setShowCreate(true) }}>
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
              <button className="board-icon-btn board-icon-btn-xs" title={`在"${col.label}"中新建`} onClick={() => { setCreateDefaultStatus(col.key); setShowCreate(true) }}>
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
                    onOpen={setDetailCard}
                    onContextMenu={handleContextMenu}
                    onDragStart={handleDragStart}
                  />
                ))
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Quick Create */}
      {showCreate && (
        <QuickCreateModal defaultStatus={createDefaultStatus} onClose={() => setShowCreate(false)} onSubmit={handleCreate} />
      )}

      {/* Detail Panel */}
      {detailCard && (
        <DetailPanel card={detailCard} onClose={() => setDetailCard(null)} onSave={handleSave} onDelete={handleSoftDelete} />
      )}

      {/* Context Menu */}
      <CardContextMenu menu={ctxMenu} onOpenDetail={setDetailCard} onCopy={handleCopy} onDelete={handleSoftDelete} onClose={() => setCtxMenu(null)} />

      {/* Recycle Bin */}
      {showRecycle && (
        <RecycleBinPanel cards={deletedTasks} onRestore={handleRestore} onPermanentDelete={handlePermanentDelete} onClose={() => setShowRecycle(false)} />
      )}
    </div>
  )
}
