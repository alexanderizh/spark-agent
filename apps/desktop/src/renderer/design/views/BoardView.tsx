/**
 * BoardView — 全局任务看板（类飞书看板）
 *
 * 功能：
 *  - 多列看板（待办 / 进行中 / 已完成 / 已关闭）
 *  - 快捷创建任务卡片（弹窗式）
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
import type { CSSProperties, DragEvent, ReactNode } from 'react'
import { Icons } from '../Icons'
import { useApp } from '../AppContext'

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
  deletedAt: string | null // null = active, string = in recycle bin
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const STORAGE_KEY = 'spark-agent:board-tasks'

const COLUMNS: { key: TaskStatus; label: string; color: string }[] = [
  { key: 'todo', label: '待办', color: 'var(--text-muted)' },
  { key: 'in-progress', label: '进行中', color: 'var(--info)' },
  { key: 'done', label: '已完成', color: 'var(--success)' },
  { key: 'closed', label: '已关闭', color: 'var(--text-faint)' },
]

const PRIORITY_CONFIG: Record<Priority, { label: string; color: string; bg: string }> = {
  low: { label: '低', color: 'var(--text-muted)', bg: 'var(--hover)' },
  medium: { label: '中', color: 'var(--info)', bg: 'var(--info-bg)' },
  high: { label: '高', color: 'var(--warning)', bg: 'var(--warning-bg)' },
  urgent: { label: '紧急', color: 'var(--danger)', bg: 'var(--danger-bg)' },
}

function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

function now(): string {
  return new Date().toISOString()
}

/* ------------------------------------------------------------------ */
/*  Persistence helpers                                                */
/* ------------------------------------------------------------------ */

function loadTasks(): TaskCard[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    return JSON.parse(raw) as TaskCard[]
  } catch {
    return []
  }
}

function saveTasks(tasks: TaskCard[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks))
}

/* ------------------------------------------------------------------ */
/*  Context Menu                                                       */
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
  const titleRef = useRef<HTMLInputElement>(null)

  useEffect(() => { titleRef.current?.focus() }, [])

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
          <button className="icon-btn" onClick={onClose}><Icons.X size={16} /></button>
        </div>
        <div className="bqc-body">
          <div className="bqc-field">
            <label>标题</label>
            <input
              ref={titleRef}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="输入任务标题…"
              onKeyDown={(e) => { if (e.key === 'Enter' && title.trim()) handleSubmit() }}
            />
          </div>
          <div className="bqc-field">
            <label>描述</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="输入任务描述（可选）…"
              rows={3}
            />
          </div>
          <div className="bqc-row">
            <div className="bqc-field bqc-field-sm">
              <label>状态</label>
              <select value={status} onChange={(e) => setStatus(e.target.value as TaskStatus)}>
                {COLUMNS.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
            </div>
            <div className="bqc-field bqc-field-sm">
              <label>优先级</label>
              <select value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
                <option value="low">低</option>
                <option value="medium">中</option>
                <option value="high">高</option>
                <option value="urgent">紧急</option>
              </select>
            </div>
          </div>
          <div className="bqc-row">
            <div className="bqc-field bqc-field-sm">
              <label>负责人</label>
              <input value={assignee} onChange={(e) => setAssignee(e.target.value)} placeholder="指定负责人" />
            </div>
            <div className="bqc-field bqc-field-sm">
              <label>截止日期</label>
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
          </div>
          <div className="bqc-field">
            <label>标签</label>
            <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="用逗号分隔多个标签" />
          </div>
        </div>
        <div className="bqc-footer">
          <span className="bqc-hint">Ctrl+Enter 提交</span>
          <div className="bqc-actions">
            <button className="btn btn-ghost" onClick={onClose}>取消</button>
            <button className="btn btn-primary" onClick={handleSubmit} disabled={!title.trim()}>创建任务</button>
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
  const [editing, setEditing] = useState<CardEditState>({
    title: card.title,
    description: card.description,
    priority: card.priority,
    status: card.status,
    assignee: card.assignee,
    tags: card.tags.join(', '),
    dueDate: card.dueDate,
  })
  const [isDirty, setIsDirty] = useState(false)

  type CardEditState = {
    title: string
    description: string
    priority: Priority
    status: TaskStatus
    assignee: string
    tags: string
    dueDate: string
  }

  const handleFieldChange = useCallback(<K extends keyof CardEditState>(key: K, val: CardEditState[K]) => {
    setEditing(prev => ({ ...prev, [key]: val }))
    setIsDirty(true)
  }, [])

  const handleSave = useCallback(() => {
    onSave({
      ...card,
      ...editing,
      tags: editing.tags.split(',').map(t => t.trim()).filter(Boolean),
      updatedAt: now(),
    })
    setIsDirty(false)
  }, [card, editing, onSave])

  const handleDelete = useCallback(() => {
    onDelete(card.id)
    onClose()
  }, [card.id, onDelete, onClose])

  const pCfg = PRIORITY_CONFIG[editing.priority]

  return (
    <div className="board-detail-overlay" onClick={onClose}>
      <div className="board-detail-panel" onClick={(e) => e.stopPropagation()}>
        <div className="bdp-header">
          <div className="bdp-header-left">
            <span className="bdp-priority-dot" style={{ background: pCfg.color }} />
            <span className="bdp-status-tag" style={{ color: pCfg.color, background: pCfg.bg }}>
              {COLUMNS.find(c => c.key === editing.status)?.label}
            </span>
          </div>
          <div className="bdp-header-right">
            {isDirty && (
              <button className="btn btn-primary btn-sm" onClick={handleSave}>保存</button>
            )}
            <button className="icon-btn" onClick={onClose}><Icons.X size={16} /></button>
          </div>
        </div>

        <div className="bdp-body">
          <div className="bdp-field">
            <input
              className="bdp-title-input"
              value={editing.title}
              onChange={(e) => handleFieldChange('title', e.target.value)}
              placeholder="任务标题"
            />
          </div>

          <div className="bdp-field">
            <label className="bdp-label">描述</label>
            <textarea
              className="bdp-desc-input"
              value={editing.description}
              onChange={(e) => handleFieldChange('description', e.target.value)}
              placeholder="添加详细描述…"
              rows={5}
            />
          </div>

          <div className="bdp-field-row">
            <div className="bdp-field">
              <label className="bdp-label">状态</label>
              <select
                className="bdp-select"
                value={editing.status}
                onChange={(e) => handleFieldChange('status', e.target.value as TaskStatus)}
              >
                {COLUMNS.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
            </div>
            <div className="bdp-field">
              <label className="bdp-label">优先级</label>
              <select
                className="bdp-select"
                value={editing.priority}
                onChange={(e) => handleFieldChange('priority', e.target.value as Priority)}
              >
                <option value="low">低</option>
                <option value="medium">中</option>
                <option value="high">高</option>
                <option value="urgent">紧急</option>
              </select>
            </div>
          </div>

          <div className="bdp-field-row">
            <div className="bdp-field">
              <label className="bdp-label">负责人</label>
              <input
                className="bdp-input"
                value={editing.assignee}
                onChange={(e) => handleFieldChange('assignee', e.target.value)}
                placeholder="未指定"
              />
            </div>
            <div className="bdp-field">
              <label className="bdp-label">截止日期</label>
              <input
                className="bdp-input"
                type="date"
                value={editing.dueDate}
                onChange={(e) => handleFieldChange('dueDate', e.target.value)}
              />
            </div>
          </div>

          <div className="bdp-field">
            <label className="bdp-label">标签</label>
            <input
              className="bdp-input"
              value={editing.tags}
              onChange={(e) => handleFieldChange('tags', e.target.value)}
              placeholder="用逗号分隔"
            />
            {editing.tags.length > 0 && (
              <div className="bdp-tags-preview">
                {editing.tags.split(',').map(t => t.trim()).filter(Boolean).map((tag, i) => (
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
          <button className="btn btn-danger-outline btn-sm" onClick={handleDelete}>
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
          <button className="icon-btn" onClick={onClose}><Icons.X size={16} /></button>
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
                    <button className="btn btn-ghost btn-xs" onClick={() => onRestore(card.id)}>恢复</button>
                    <button className="btn btn-danger-outline btn-xs" onClick={() => onPermanentDelete(card.id)}>彻底删除</button>
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
      <div
        className="board-ctx-menu"
        style={{ top: menu.y, left: menu.x }}
      >
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
/*  Task Card Component                                                */
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

  return (
    <div
      className="board-card"
      draggable
      onDragStart={(e) => onDragStart(e, card)}
      onClick={() => onOpen(card)}
      onContextMenu={(e) => onContextMenu(e, card)}
    >
      <div className="bc-header">
        <span
          className="bc-priority"
          style={{ background: pCfg.bg, color: pCfg.color }}
        >
          {pCfg.label}
        </span>
        {colCfg && (
          <span className="bc-status-dot" style={{ background: colCfg.color }} />
        )}
      </div>
      <div className="bc-title">{card.title}</div>
      {card.description && (
        <div className="bc-desc">{card.description}</div>
      )}
      <div className="bc-footer">
        <div className="bc-tags">
          {card.tags.slice(0, 3).map((tag, i) => (
            <span key={i} className="bc-tag">{tag}</span>
          ))}
          {card.tags.length > 3 && <span className="bc-tag bc-tag-more">+{card.tags.length - 3}</span>}
        </div>
        <div className="bc-meta">
          {card.dueDate && (
            <span className="bc-due" title="截止日期">
              <Icons.Clock size={11} /> {formatShortDate(card.dueDate)}
            </span>
          )}
          {card.assignee && (
            <span className="bc-assignee" title={card.assignee}>
              <Icons.User size={11} /> {card.assignee}
            </span>
          )}
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
  const dragCardRef = useRef<TaskCard | null>(null)
  const dragOverColRef = useRef<TaskStatus | null>(null)

  // Persist tasks to localStorage
  useEffect(() => { saveTasks(tasks) }, [tasks])

  // Derived: active tasks (not deleted)
  const activeTasks = useMemo(
    () => tasks.filter(t => !t.deletedAt),
    [tasks],
  )

  // Derived: deleted tasks (recycle bin)
  const deletedTasks = useMemo(
    () => tasks.filter(t => !!t.deletedAt),
    [tasks],
  )

  // Derived: filtered tasks
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
    if (filterPriority !== 'all') {
      result = result.filter(t => t.priority === filterPriority)
    }
    return result
  }, [activeTasks, searchQuery, filterPriority])

  // Tasks grouped by column
  const columnTasks = useMemo(() => {
    const map: Record<TaskStatus, TaskCard[]> = {
      'todo': [],
      'in-progress': [],
      'done': [],
      'closed': [],
    }
    for (const t of filteredTasks) {
      map[t.status].push(t)
    }
    return map
  }, [filteredTasks])

  // ── Handlers ──

  const handleCreate = useCallback((partial: Omit<TaskCard, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt'>) => {
    const card: TaskCard = {
      ...partial,
      id: uid(),
      createdAt: now(),
      updatedAt: now(),
      deletedAt: null,
    }
    setTasks(prev => [...prev, card])
  }, [])

  const handleSave = useCallback((updated: TaskCard) => {
    setTasks(prev => prev.map(t => t.id === updated.id ? updated : t))
    setDetailCard(updated)
  }, [])

  const handleSoftDelete = useCallback(async (id: string) => {
    const ok = await requestConfirm({
      title: '删除任务',
      description: '任务将移至回收站，可以恢复。',
      confirmText: '删除',
      danger: true,
    })
    if (!ok) return
    setTasks(prev => prev.map(t =>
      t.id === id ? { ...t, deletedAt: now(), updatedAt: now() } : t
    ))
    setDetailCard(null)
  }, [requestConfirm])

  const handleRestore = useCallback((id: string) => {
    setTasks(prev => prev.map(t =>
      t.id === id ? { ...t, deletedAt: null, updatedAt: now() } : t
    ))
  }, [])

  const handlePermanentDelete = useCallback(async (id: string) => {
    const ok = await requestConfirm({
      title: '彻底删除',
      description: '此操作不可撤销，任务将被永久删除。',
      confirmText: '彻底删除',
      danger: true,
    })
    if (!ok) return
    setTasks(prev => prev.filter(t => t.id !== id))
  }, [requestConfirm])

  const handleCopy = useCallback((card: TaskCard) => {
    const copy: TaskCard = {
      ...card,
      id: uid(),
      title: `${card.title} (副本)`,
      createdAt: now(),
      updatedAt: now(),
      deletedAt: null,
    }
    setTasks(prev => [...prev, copy])
  }, [])

  // ── Drag & Drop ──

  const handleDragStart = useCallback((e: DragEvent, card: TaskCard) => {
    dragCardRef.current = card
    e.dataTransfer.effectAllowed = 'move'
    // set drag image
    const el = e.currentTarget as HTMLElement
    e.dataTransfer.setDragImage(el, el.offsetWidth / 2, 20)
  }, [])

  const handleDragOver = useCallback((e: DragEvent, status: TaskStatus) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    dragOverColRef.current = status
    // highlight column
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
    setTasks(prev => prev.map(t =>
      t.id === card.id ? { ...t, status: targetStatus, updatedAt: now() } : t
    ))
    dragCardRef.current = null
    dragOverColRef.current = null
  }, [])

  const handleContextMenu = useCallback((e: React.MouseEvent, card: TaskCard) => {
    e.preventDefault()
    // Clamp menu position to viewport
    const x = Math.min(e.clientX, window.innerWidth - 180)
    const y = Math.min(e.clientY, window.innerHeight - 160)
    setCtxMenu({ x, y, card })
  }, [])

  // Close context menu on any click
  useEffect(() => {
    if (!ctxMenu) return
    const handler = () => setCtxMenu(null)
    window.addEventListener('click', handler)
    return () => window.removeEventListener('click', handler)
  }, [ctxMenu])

  // ── Stats ──
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
        <div className="board-header-right">
          <div className="board-search">
            <Icons.Search size={14} />
            <input
              type="text"
              placeholder="搜索任务…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <select
            className="board-filter-select"
            value={filterPriority}
            onChange={(e) => setFilterPriority(e.target.value as Priority | 'all')}
          >
            <option value="all">全部优先级</option>
            <option value="urgent">紧急</option>
            <option value="high">高</option>
            <option value="medium">中</option>
            <option value="low">低</option>
          </select>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => setShowRecycle(true)}
            title="回收站"
          >
            <Icons.Archive size={15} />
            {totalDeleted > 0 && <span className="board-recycle-badge">{totalDeleted}</span>}
          </button>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => { setCreateDefaultStatus('todo'); setShowCreate(true) }}
          >
            <Icons.Plus size={14} /> 新建任务
          </button>
        </div>
      </div>

      {/* Kanban Columns */}
      <div className="board-columns">
        {COLUMNS.map(col => (
          <div className="board-col" key={col.key}>
            <div className="board-col-header">
              <div className="board-col-title">
                <span className="board-col-dot" style={{ background: col.color }} />
                {col.label}
              </div>
              <span className="board-col-count">{columnTasks[col.key].length}</span>
              <button
                className="icon-btn icon-btn-xs"
                title={`在"${col.label}"中新建`}
                onClick={() => { setCreateDefaultStatus(col.key); setShowCreate(true) }}
              >
                <Icons.Plus size={13} />
              </button>
            </div>
            <div
              className="board-col-body"
              onDragOver={(e) => handleDragOver(e, col.key)}
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

      {/* Quick Create Modal */}
      {showCreate && (
        <QuickCreateModal
          defaultStatus={createDefaultStatus}
          onClose={() => setShowCreate(false)}
          onSubmit={handleCreate}
        />
      )}

      {/* Detail Side Panel */}
      {detailCard && (
        <DetailPanel
          card={detailCard}
          onClose={() => setDetailCard(null)}
          onSave={handleSave}
          onDelete={handleSoftDelete}
        />
      )}

      {/* Context Menu */}
      <CardContextMenu
        menu={ctxMenu}
        onOpenDetail={setDetailCard}
        onCopy={handleCopy}
        onDelete={handleSoftDelete}
        onClose={() => setCtxMenu(null)}
      />

      {/* Recycle Bin */}
      {showRecycle && (
        <RecycleBinPanel
          cards={deletedTasks}
          onRestore={handleRestore}
          onPermanentDelete={handlePermanentDelete}
          onClose={() => setShowRecycle(false)}
        />
      )}
    </div>
  )
}
