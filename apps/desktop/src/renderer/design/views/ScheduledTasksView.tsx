/**
 * ScheduledTasksView — 定时任务管理主视图
 *
 * 布局：左侧任务列表 + 右侧详情面板
 * 支持：筛选、搜索、新建/编辑/删除/启用/禁用/立即执行
 * 支持：多选批量删除 / 多选批量导出 / 全量导入导出
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Button,
  Empty,
  Input,
  Modal,
  Select,
  Tag,
  TextArea,
  Tooltip,
} from '@lobehub/ui'
import {
  Badge,
  InputNumber,
  Popconfirm,
  Radio,
  Spin,
  Switch,
  message as antdMessage,
} from 'antd'
import { Icons } from '../Icons'
import type {
  ManagedAgent, ManagedTeam, ProviderProfile, WorkspaceInfo,
  ScheduledTaskExportPayload, ScheduledTaskImportMode,
} from '@spark/protocol'
import { useIpcInvoke } from '../hooks/useIpc'
import { useRefreshable } from '../hooks/useRefreshable'
import { useSaveShortcut } from '../hooks/useSaveShortcut'
import { useToast } from '../components/Toast'
import { useApp } from '../AppContext'
import { useSessionSidebar } from '../SessionSidebarContext'
import './ScheduledTasksView.less'

// ─── Types ──────────────────────────────────────────────────────────────────

interface ScheduledTaskItem {
  id: string
  name: string
  description: string
  enabled: boolean
  triggerType: 'interval' | 'cron' | 'once'
  intervalSeconds: number | null
  cronExpression: string | null
  runAt: string | null
  nextRunAt: string | null
  lastRunAt: string | null
  status: string
  executionCount: number
  successCount: number
  failureCount: number
  lastError: string | null
  agentId: string | null
  teamId: string | null
  modelId: string | null
  workspaceId: string | null
  promptTemplate: string
  tags: string[]
  createdAt: string
  updatedAt: string
  maxExecutions: number
  permissionMode: string
  timeoutSeconds: number
  maxRetries: number
}

interface TaskExecutionItem {
  id: string
  taskId: string
  sessionId: string | null
  startedAt: string
  completedAt: string | null
  durationMs: number | null
  status: string
  error: string | null
  triggerType: string | null
  retryAttempt: number
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatDuration(ms: number | null): string {
  if (ms == null) return '-'
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`
}

function formatCountdown(isoString: string | null): string {
  if (!isoString) return '-'
  const diff = new Date(isoString).getTime() - Date.now()
  if (diff <= 0) return '即将执行'
  if (diff < 60000) return `${Math.ceil(diff / 1000)}s 后`
  if (diff < 3600000) return `${Math.ceil(diff / 60000)}m 后`
  if (diff < 86400000) return `${Math.ceil(diff / 3600000)}h 后`
  return `${Math.ceil(diff / 86400000)}d 后`
}

function formatTriggerType(task: ScheduledTaskItem): string {
  switch (task.triggerType) {
    case 'interval':
      if (!task.intervalSeconds) return 'Interval'
      if (task.intervalSeconds < 60) return `每 ${task.intervalSeconds} 秒`
      if (task.intervalSeconds < 3600) return `每 ${Math.round(task.intervalSeconds / 60)} 分钟`
      if (task.intervalSeconds < 86400) return `每 ${Math.round(task.intervalSeconds / 3600)} 小时`
      return `每 ${Math.round(task.intervalSeconds / 86400)} 天`
    case 'cron':
      return task.cronExpression ?? 'Cron'
    case 'once':
      return task.runAt ? new Date(task.runAt).toLocaleString() : '一次'
    default:
      return task.triggerType
  }
}

function statusColor(status: string): 'processing' | 'success' | 'default' | 'error' {
  switch (status) {
    case 'running': return 'processing'
    case 'idle': return 'success'
    case 'disabled': return 'default'
    case 'error': return 'error'
    default: return 'default'
  }
}

function executionStatusIcon(status: string): React.ReactNode {
  switch (status) {
    case 'completed': return <Icons.CheckCircle style={{ color: 'var(--color-success-6)' }} />
    case 'failed':
    case 'timeout': return <Icons.XCircle style={{ color: 'var(--color-danger-6)' }} />
    case 'running': return <Icons.Spinner style={{ color: 'var(--color-primary-6)' }} />
    case 'cancelled': return <Icons.AlertTriangle style={{ color: 'var(--color-warning-6)' }} />
    default: return null
  }
}

async function ipcInvoke(channel: string, params?: Record<string, unknown>): Promise<any> {
  return (window.spark as any)?.invoke?.(channel, params ?? {})
}

// ─── Main Component ─────────────────────────────────────────────────────────

export function ScheduledTasksView() {
  const { toast } = useToast()
  const { requestConfirm, setTweak } = useApp()
  const sidebar = useSessionSidebar()
  const [tasks, setTasks] = useState<ScheduledTaskItem[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'enabled' | 'disabled' | 'error'>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editingTask, setEditingTask] = useState<ScheduledTaskItem | null>(null)
  const [executions, setExecutions] = useState<TaskExecutionItem[]>([])
  const [refreshKey, setRefreshKey] = useState(0)

  // ─── 多选 / 批量 / 导入导出 状态 ────────────────────────────────────────
  const [multiSelect, setMultiSelect] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [importPreview, setImportPreview] = useState<{
    payload: ScheduledTaskExportPayload
    filePath: string
  } | null>(null)
  const [importing, setImporting] = useState(false)

  // 导入导出 IPC
  const { invoke: exportTasks } = useIpcInvoke('scheduled-task:export')
  const { invoke: importTasks } = useIpcInvoke('scheduled-task:import')
  const { invoke: exportTasksToFile } = useIpcInvoke('scheduled-task:export-to-file')
  const { invoke: importTasksFromFile } = useIpcInvoke('scheduled-task:import-from-file')
  const { invoke: deleteTask } = useIpcInvoke('scheduled-task:delete')

  // Load tasks
  const loadTasks = useCallback(async () => {
    try {
      const res = await ipcInvoke('scheduled-task:list', {
        ...(filter !== 'all' ? { enabled: filter === 'enabled' } : {}),
        ...(filter === 'error' ? { status: 'error' } : {}),
        ...(searchQuery ? { query: searchQuery } : {}),
      })
      setTasks(res?.tasks ?? [])
    } catch (err) {
      console.error('Failed to load scheduled tasks:', err)
    } finally {
      setLoading(false)
    }
  }, [filter, searchQuery])

  const triggerRefresh = useRefreshable(() => setRefreshKey(k => k + 1))

  useEffect(() => {
    void loadTasks()
  }, [loadTasks, refreshKey])

  // Auto-refresh every 10s for countdown updates
  useEffect(() => {
    const timer = setInterval(() => setRefreshKey(k => k + 1), 10000)
    return () => clearInterval(timer)
  }, [])

  // 进入页面时默认选中第一个任务（任务列表加载完成且当前未选中时）
  useEffect(() => {
    const firstTask = tasks[0]
    if (!selectedId && firstTask) {
      setSelectedId(firstTask.id)
    }
  }, [selectedId, tasks])

  // Load executions for selected task
  useEffect(() => {
    if (!selectedId) { setExecutions([]); return }
    ipcInvoke('task-execution:list', { taskId: selectedId, pageSize: 20 })
      .then(res => setExecutions(res?.executions ?? []))
      .catch(() => setExecutions([]))
  }, [selectedId, refreshKey])

  const selectedTask = useMemo(
    () => tasks.find(t => t.id === selectedId) ?? null,
    [tasks, selectedId]
  )

  // ─── Actions ──────────────────────────────────────────────────────────────

  const handleToggle = useCallback(async (id: string, enabled: boolean) => {
    try {
      await ipcInvoke('scheduled-task:toggle', { id, enabled })
      setRefreshKey(k => k + 1)
      antdMessage.success(enabled ? '任务已启用' : '任务已禁用')
    } catch (err) {
      antdMessage.error(`操作失败: ${err}`)
    }
  }, [])

  const handleRunNow = useCallback(async (id: string) => {
    try {
      const res = await ipcInvoke('scheduled-task:run-now', { id })
      const sessionId: string | null = res?.execution?.sessionId ?? null
      setRefreshKey(k => k + 1)
      if (sessionId) {
        antdMessage.success('任务已触发执行，正在打开会话')
        sidebar.setActiveSession(sessionId as any)
        setTweak('view', 'chat')
      } else {
        antdMessage.success('任务已触发执行，会话稍后会出现在会话栏「无项目对话」分组')
      }
    } catch (err) {
      antdMessage.error(`执行失败: ${err}`)
    }
  }, [sidebar, setTweak])

  const handleDelete = useCallback(async (id: string) => {
    try {
      await ipcInvoke('scheduled-task:delete', { id })
      if (selectedId === id) setSelectedId(null)
      setRefreshKey(k => k + 1)
      antdMessage.success('任务已删除')
    } catch (err) {
      antdMessage.error(`删除失败: ${err}`)
    }
  }, [selectedId])

  // ─── 多选 helpers ────────────────────────────────────────────────────────

  const enterMultiSelect = useCallback(() => {
    setMultiSelect(true)
    setSelectedIds(new Set())
  }, [])

  const exitMultiSelect = useCallback(() => {
    setMultiSelect(false)
    setSelectedIds(new Set())
  }, [])

  const toggleSelected = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(tasks.map(t => t.id)))
  }, [tasks])

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set())
  }, [])

  const invertSelection = useCallback(() => {
    setSelectedIds(prev => {
      const next = new Set<string>()
      for (const t of tasks) {
        if (!prev.has(t.id)) next.add(t.id)
      }
      return next
    })
  }, [tasks])

  // ─── 批量删除 ────────────────────────────────────────────────────────────

  const handleDeleteSelected = useCallback(async () => {
    if (selectedIds.size === 0) return
    const confirmed = await requestConfirm({
      title: `删除 ${selectedIds.size} 个定时任务？`,
      description: '此操作不可撤销，选中任务及其历史执行记录会从本地移除。',
      confirmText: '批量删除',
      danger: true,
    })
    if (!confirmed) return
    let ok = 0
    const errs: string[] = []
    for (const id of selectedIds) {
      try {
        await deleteTask({ id })
        ok += 1
      } catch (err) {
        const name = tasks.find(t => t.id === id)?.name ?? id
        errs.push(`${name}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    if (ok > 0) toast.success(`已删除 ${ok} 个任务`)
    if (errs.length > 0) toast.error(`${errs.length} 个删除失败：${errs.slice(0, 2).join('；')}`)
    // 如果详情面板中选中的任务被删了，清空选中
    if (selectedId && selectedIds.has(selectedId)) setSelectedId(null)
    clearSelection()
    exitMultiSelect()
    setRefreshKey(k => k + 1)
  }, [selectedIds, selectedId, requestConfirm, deleteTask, tasks, toast, clearSelection, exitMultiSelect])

  // ─── 导出 ────────────────────────────────────────────────────────────────

  /**
   * 弹保存对话框写文件。空 ids 表示导出全部。
   */
  const handleExportToFile = useCallback(async (ids: string[]) => {
    try {
      const result = await exportTasksToFile({ ids })
      if (!result.filePath) {
        // 用户取消
        return
      }
      toast.success(`已导出 ${result.count} 个任务`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '导出失败')
    }
  }, [exportTasksToFile, toast])

  const handleExportAll = useCallback(() => {
    void handleExportToFile([])
  }, [handleExportToFile])

  const handleExportSelected = useCallback(() => {
    void handleExportToFile(Array.from(selectedIds))
  }, [handleExportToFile, selectedIds])

  /**
   * 复制全部任务 JSON 到剪贴板（次要入口）。
   */
  const handleCopyToClipboard = useCallback(async () => {
    try {
      const { payload } = await exportTasks({ ids: [] })
      const json = JSON.stringify(payload, null, 2)
      await navigator.clipboard.writeText(json)
      toast.success(`已复制 ${payload.tasks.length} 个任务到剪贴板`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '复制失败')
    }
  }, [exportTasks, toast])

  // ─── 导入 ────────────────────────────────────────────────────────────────

  /**
   * 弹打开对话框读文件 → 解析 → 弹预览 Modal 让用户确认。
   */
  const handleImportFromFile = useCallback(async () => {
    try {
      const { payload, filePath } = await importTasksFromFile({})
      if (payload == null) {
        // 用户取消
        return
      }
      setImportPreview({ payload, filePath })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '导入失败')
    }
  }, [importTasksFromFile, toast])

  /**
   * 从剪贴板读取 JSON 字符串并解析为 payload。
   */
  const handleImportFromClipboard = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (!text.trim()) {
        toast.warning('剪贴板为空')
        return
      }
      let json: unknown
      try {
        json = JSON.parse(text)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        toast.error(`剪贴板 JSON 解析失败：${message}`)
        return
      }
      const { ScheduledTaskExportPayloadSchema } = await import('@spark/protocol')
      const parsed = ScheduledTaskExportPayloadSchema.parse(json)
      setImportPreview({ payload: parsed, filePath: '从剪贴板' })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '剪贴板内容不是有效的导出文件')
    }
  }, [toast])

  /**
   * 预览确认后的写入操作。
   */
  const handleImportConfirm = useCallback(async (
    payload: ScheduledTaskExportPayload,
    mode: ScheduledTaskImportMode,
  ) => {
    setImporting(true)
    try {
      const result = await importTasks({ payload, mode })
      const parts: string[] = []
      if (result.imported > 0) parts.push(`导入 ${result.imported}`)
      if (result.skipped > 0) parts.push(`跳过 ${result.skipped}`)
      if (parts.length > 0) {
        toast.success(parts.join('，'))
      } else if (result.errors.length === 0) {
        toast.info('无任务被导入')
      }
      if (result.errors.length > 0) {
        toast.error(`${result.errors.length} 个失败：${result.errors.slice(0, 2).join('；')}`)
      }
      setImportPreview(null)
      // 关闭预览后刷新列表
      setRefreshKey(k => k + 1)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '导入失败')
    } finally {
      setImporting(false)
    }
  }, [importTasks, toast])

  /** 已有 name 集合：用于预览时标记冲突 */
  const existingNamesForPreview = useMemo(
    () => new Set(tasks.map(t => t.name)),
    [tasks],
  )

  const handleEdit = useCallback((task: ScheduledTaskItem) => {
    setEditingTask(task)
    setShowForm(true)
  }, [])

  const handleCreate = useCallback(() => {
    setEditingTask(null)
    setShowForm(true)
  }, [])

  const handleFormClose = useCallback((success: boolean) => {
    setShowForm(false)
    const wasEdit = editingTask != null
    setEditingTask(null)
    if (success) {
      setRefreshKey(k => k + 1)
      antdMessage.success(wasEdit ? '任务已更新' : '任务已创建')
    }
  }, [])

  // ─── Render ───────────────────────────────────────────────────────────────

  // Show form page when creating/editing
  if (showForm) {
    return (
      <div className="scheduled-tasks-view">
        <TaskFormPage
          task={editingTask}
          onClose={handleFormClose}
        />
      </div>
    )
  }

  return (
    <div className="scheduled-tasks-view">
      {/* Header */}
      <div className="st-header">
        <div className="st-header-left">
          <Icons.Clock style={{ fontSize: 20, color: 'var(--primary)' }} />
          <h2>Scheduled Tasks</h2>
        </div>
        <div className="st-header-right">
          <Button
            size="middle"
            type="text"
            shape="circle"
            icon={<Icons.Refresh />}
            onClick={triggerRefresh}
            title="刷新 (Ctrl+R)"
            aria-label="刷新"
          />
          {!multiSelect && (
            <>
              <Button
                size="middle"
                type="text"
                icon={<Icons.Upload />}
                onClick={() => void handleImportFromFile()}
                disabled={importing}
                title="从 .json 导入定时任务"
              >
                导入
              </Button>
              {/* <Button
                size="middle"
                type="text"
                icon={<Icons.Copy />}
                onClick={() => void handleImportFromClipboard()}
                disabled={importing}
                title="从剪贴板 JSON 字符串导入"
              >
                粘贴导入
              </Button> */}
              <Button
                size="middle"
                type="text"
                icon={<Icons.Download />}
                onClick={() => void handleExportAll()}
                disabled={tasks.length === 0}
                title="导出全部任务到 .json"
              >
                导出全部
              </Button>
              {/* <Button
                size="middle"
                type="text"
                icon={<Icons.Copy />}
                onClick={() => void handleCopyToClipboard()}
                disabled={tasks.length === 0}
                title="复制全部任务 JSON 到剪贴板"
              >
                复制全部
              </Button> */}
              <Button
                size="middle"
                type="text"
                icon={<Icons.Check />}
                onClick={enterMultiSelect}
                disabled={tasks.length === 0}
                title="进入多选模式（可批量删除 / 批量导出）"
              >
                批量
              </Button>
            </>
          )}
          <Button type="primary" size="middle" icon={<Icons.Plus />} onClick={handleCreate}>
            New Task
          </Button>
        </div>
      </div>

      {/* 多选模式工具栏 */}
      {multiSelect && (
        <div className="st-multi-toolbar">
          <Button
            size="middle"
            type="text"
            shape="circle"
            icon={<Icons.XCircle />}
            onClick={exitMultiSelect}
            title="退出多选模式"
          />
          <span className="st-multi-count">
            已选 <strong>{selectedIds.size}</strong> / {tasks.length}
          </span>
          <Button size="middle" type="text" onClick={selectAll} disabled={selectedIds.size === tasks.length}>
            全选
          </Button>
          <Button size="middle" type="text" onClick={invertSelection} disabled={tasks.length === 0}>
            反选
          </Button>
          <Button size="middle" type="text" onClick={clearSelection} disabled={selectedIds.size === 0}>
            取消选择
          </Button>
          <span style={{ flex: 1 }} />
          <Button
            size="middle"
            type="text"
            icon={<Icons.Download />}
            onClick={handleExportSelected}
            disabled={selectedIds.size === 0}
            title="导出选中的任务"
          >
            导出选中
          </Button>
          <Button
            size="middle"
            danger
            icon={<Icons.Trash />}
            onClick={() => void handleDeleteSelected()}
            disabled={selectedIds.size === 0 || importing}
            title="删除选中的任务"
          >
            删除选中
          </Button>
        </div>
      )}

      {/* Filter Bar */}
      <div className="st-filter-bar">
        <div className="st-filter-tabs">
          {(['all', 'enabled', 'disabled', 'error'] as const).map(f => (
            <button
              key={f}
              className={`st-filter-tab ${filter === f ? 'active' : ''}`}
              onClick={() => setFilter(f)}
            >
              {f === 'all' ? '全部' : f === 'enabled' ? '已启用' : f === 'disabled' ? '已禁用' : '异常'}
            </button>
          ))}
        </div>
        <Input
          prefix={<Icons.Search />}
          placeholder="搜索任务..."
          size="middle"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{ width: 200 }}
          allowClear
        />
      </div>

      {/* Main Content: List + Detail */}
      <div className="st-content">
        {loading ? (
          <div className="st-loading"><Spin /></div>
        ) : tasks.length === 0 ? (
          <div className="st-empty">
            <Empty description="暂无定时任务" />
            <Button type="primary" onClick={handleCreate} style={{ marginTop: 16 }}>
              创建第一个任务
            </Button>
          </div>
        ) : (
          <>
            {/* Left: Task List */}
            <div className="st-list">
              {tasks.map(task => {
                const isSelected = selectedIds.has(task.id)
                return (
                <div
                  key={task.id}
                  className={`st-task-card ${selectedId === task.id ? 'selected' : ''} ${multiSelect && isSelected ? 'multi-selected' : ''} ${multiSelect ? 'multi-mode' : ''}`}
                  onClick={() => {
                    if (multiSelect) toggleSelected(task.id)
                    else setSelectedId(task.id)
                  }}
                >
                  <div className="st-task-card-header">
                    <div className="st-task-name-row">
                      {multiSelect && (
                        <span className={`st-checkbox ${isSelected ? 'checked' : ''}`}>
                          {isSelected && <Icons.Check style={{ fontSize: 12 }} />}
                        </span>
                      )}
                      <Badge
                        status={statusColor(task.status)}
                        style={{ marginRight: 8 }}
                      />
                      <span className="st-task-name">{task.name}</span>
                    </div>
                    {!multiSelect && (
                      <div onClick={(e: React.MouseEvent) => e.stopPropagation()}>
                        <Switch
                          size="middle"
                          checked={task.enabled}
                          onChange={(checked: boolean) => { handleToggle(task.id, checked) }}
                        />
                      </div>
                    )}
                  </div>
                  <div className="st-task-meta">
                    <Tag size="middle" color="orangered">{formatTriggerType(task)}</Tag>
                    {task.status === 'running' && (
                      <Tag size="middle" color="blue" icon={<Icons.Spinner />}>运行中</Tag>
                    )}
                  </div>
                  <div className="st-task-footer">
                    <span className="st-task-countdown">
                      {task.enabled
                        ? `下次: ${formatCountdown(task.nextRunAt)}`
                        : '已禁用'
                      }
                    </span>
                    <span className="st-task-stats">
                      {task.executionCount > 0 && (
                        <>
                          <span style={{ color: 'var(--color-success-6)' }}>✓{task.successCount}</span>
                          {task.failureCount > 0 && (
                            <span style={{ color: 'var(--color-danger-6)', marginLeft: 4 }}>✗{task.failureCount}</span>
                          )}
                        </>
                      )}
                    </span>
                  </div>
                </div>
                )
              })}
            </div>

            {/* Right: Detail Panel */}
            <div className="st-detail">
              {selectedTask ? (
                <TaskDetailPanel
                  task={selectedTask}
                  executions={executions}
                  onEdit={() => handleEdit(selectedTask)}
                  onRunNow={() => handleRunNow(selectedTask.id)}
                  onToggle={(enabled) => handleToggle(selectedTask.id, enabled)}
                  onDelete={() => handleDelete(selectedTask.id)}
                />
              ) : (
                <div className="st-detail-empty">
                  <Empty description="选择一个任务查看详情" />
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* 导入预览 Modal */}
      {importPreview && (
        <TaskImportPreviewModal
          payload={importPreview.payload}
          filePath={importPreview.filePath}
          existingNames={existingNamesForPreview}
          submitting={importing}
          onConfirm={(payload, mode) => void handleImportConfirm(payload, mode)}
          onClose={() => setImportPreview(null)}
        />
      )}
    </div>
  )
}

// ─── Task Detail Panel ──────────────────────────────────────────────────────

function TaskDetailPanel({ task, executions, onEdit, onRunNow, onToggle, onDelete }: {
  task: ScheduledTaskItem
  executions: TaskExecutionItem[]
  onEdit: () => void
  onRunNow: () => void
  onToggle: (enabled: boolean) => void
  onDelete: () => void
}) {
  return (
    <div className="st-detail-content">
      {/* Header */}
      <div className="st-detail-header">
        <div className="st-detail-title-row">
          <h3 className="st-detail-title">{task.name}</h3>
          <div className="st-detail-actions">
            <Tooltip title="立即执行">
              <Button size="middle" type="primary" shape="circle" icon={<Icons.Play />} onClick={onRunNow} />
            </Tooltip>
            <Tooltip title="编辑">
              <Button size="middle" type="text" shape="circle" icon={<Icons.Edit />} onClick={onEdit} />
            </Tooltip>
            <Popconfirm title="确定删除此任务？" onConfirm={onDelete}>
              <Tooltip title="删除">
                <Button size="middle" type="text" danger shape="circle" icon={<Icons.Trash />} />
              </Tooltip>
            </Popconfirm>
          </div>
        </div>
        {task.description && <p className="st-detail-desc">{task.description}</p>}
        <div className="st-detail-tags">
          <Switch size="middle" checked={task.enabled} onChange={onToggle} />
          <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--color-text-3)' }}>
            {task.enabled ? '已启用' : '已禁用'}
          </span>
        </div>
      </div>

      {/* Stats */}
      <div className="st-detail-stats">
        <div className="st-stat-item">
          <span className="st-stat-value">{task.executionCount}</span>
          <span className="st-stat-label">总执行</span>
        </div>
        <div className="st-stat-item">
          <span className="st-stat-value" style={{ color: 'var(--color-success-6)' }}>{task.successCount}</span>
          <span className="st-stat-label">成功</span>
        </div>
        <div className="st-stat-item">
          <span className="st-stat-value" style={{ color: 'var(--color-danger-6)' }}>{task.failureCount}</span>
          <span className="st-stat-label">失败</span>
        </div>
        <div className="st-stat-item">
          <span className="st-stat-value">{formatCountdown(task.nextRunAt)}</span>
          <span className="st-stat-label">下次执行</span>
        </div>
      </div>

      {/* Config Summary */}
      <div className="st-detail-config">
        <h4>配置</h4>
        <div className="st-config-grid">
          <span className="st-config-label">触发方式</span>
          <span className="st-config-value">{formatTriggerType(task)}</span>
          <span className="st-config-label">权限策略</span>
          <span className="st-config-value">
            <Tag size="middle" color={task.permissionMode === 'bypass' ? 'orangered' : 'green'}>
              {task.permissionMode === 'bypass' ? 'Bypass' : 'Auto'}
            </Tag>
          </span>
          <span className="st-config-label">超时</span>
          <span className="st-config-value">{task.timeoutSeconds}s</span>
          <span className="st-config-label">重试</span>
          <span className="st-config-value">{task.maxRetries} 次</span>
          <span className="st-config-label">上次运行</span>
          <span className="st-config-value">{task.lastRunAt ? new Date(task.lastRunAt).toLocaleString() : '-'}</span>
        </div>
        {task.lastError && (
          <div className="st-detail-error">
            <Icons.AlertTriangle style={{ color: 'var(--color-danger-6)' }} />
            <span>{task.lastError}</span>
          </div>
        )}
      </div>

      {/* Recent Executions */}
      <div className="st-detail-executions">
        <h4>最近执行</h4>
        {executions.length === 0 ? (
          <div style={{ color: 'var(--color-text-3)', fontSize: 12, padding: '8px 0' }}>暂无执行记录</div>
        ) : (
          <div className="st-execution-list">
            {executions.map(ex => (
              <div key={ex.id} className="st-execution-item">
                <div className="st-execution-left">
                  {executionStatusIcon(ex.status)}
                  <span className="st-execution-time">
                    {new Date(ex.startedAt).toLocaleString()}
                  </span>
                </div>
                <div className="st-execution-right">
                  <span className="st-execution-duration">{formatDuration(ex.durationMs)}</span>
                  {ex.sessionId && (
                    <Tooltip title={`Session: ${ex.sessionId.slice(0, 8)}...`}>
                      <Tag size="middle" color="default">会话</Tag>
                    </Tooltip>
                  )}
                  {ex.error && (
                    <Tooltip title={ex.error}>
                      <Tag size="middle" color="red">错误</Tag>
                    </Tooltip>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Task Form Page (inline create/edit) ─────────────────────────────────────

function TaskFormPage({ task, onClose }: {
  task: ScheduledTaskItem | null
  onClose: (success: boolean) => void
}) {
  const { setTweak } = useApp()
  const sidebar = useSessionSidebar()
  const [saving, setSaving] = useState(false)
  const isEdit = task != null

  // Form state
  const [name, setName] = useState(task?.name ?? '')
  const [description, setDescription] = useState(task?.description ?? '')
  const [triggerType, setTriggerType] = useState<'interval' | 'cron' | 'once'>(task?.triggerType ?? 'interval')
  const [intervalSeconds, setIntervalSeconds] = useState(task?.intervalSeconds ?? 3600)
  const [cronExpression, setCronExpression] = useState(task?.cronExpression ?? '0 */1 * * *')
  const [runAt, setRunAt] = useState(task?.runAt ?? '')
  const [agentId, setAgentId] = useState(task?.agentId ?? '')
  const [teamId, setTeamId] = useState(task?.teamId ?? '')
  const [modelId, setModelId] = useState(task?.modelId ?? '')
  const [workspaceId, setWorkspaceId] = useState(task?.workspaceId ?? '')
  const [promptTemplate, setPromptTemplate] = useState(task?.promptTemplate ?? '')
  const [timeoutSeconds, setTimeoutSeconds] = useState(task?.timeoutSeconds ?? 300)
  const [maxRetries, setMaxRetries] = useState(task?.maxRetries ?? 0)
  const [permissionMode, setPermissionMode] = useState(task?.permissionMode ?? 'auto')
  const [tags, setTags] = useState<string[]>(task?.tags ?? [])
  const [enabledOnCreate, setEnabledOnCreate] = useState(true)

  // ─── Load selectable data ───────────────────────────────────────────────
  const { invoke: listAgents } = useIpcInvoke('agent:list')
  const { invoke: listTeams } = useIpcInvoke('team:list-defs')
  const { invoke: listProviders } = useIpcInvoke('provider:list')
  const { invoke: listWorkspaces } = useIpcInvoke('workspace:list')

  const [agents, setAgents] = useState<ManagedAgent[]>([])
  const [teams, setTeams] = useState<ManagedTeam[]>([])
  const [providers, setProviders] = useState<ProviderProfile[]>([])
  const [workspaces, setWorkspaces] = useState<WorkspaceInfo[]>([])

  useEffect(() => {
    Promise.all([
      listAgents({ includeDisabled: false }).catch(() => ({ agents: [] })),
      listTeams({ includeDisabled: false }).catch(() => ({ teams: [] })),
      listProviders({}).catch(() => ({ profiles: [] })),
      listWorkspaces({ limit: 100 }).catch(() => ({ workspaces: [] })),
    ]).then(([agentRes, teamRes, providerRes, workspaceRes]) => {
      setAgents(agentRes.agents ?? [])
      setTeams(teamRes.teams ?? [])
      setProviders(providerRes.profiles ?? [])
      setWorkspaces(workspaceRes.workspaces ?? [])
    }).catch(console.error)
  }, [listAgents, listTeams, listProviders, listWorkspaces])

  // Build model options from all providers' modelIds
  const modelOptions = useMemo(() => {
    const modelSet = new Set<string>()
    for (const p of providers) {
      if (p.defaultModel) modelSet.add(p.defaultModel)
      for (const m of p.modelIds) modelSet.add(m)
    }
    return Array.from(modelSet).map(m => ({ label: m, value: m }))
  }, [providers])

  const agentOptions = useMemo(
    () => agents.map(a => ({ label: a.name, value: a.id })),
    [agents]
  )

  const teamOptions = useMemo(
    () => teams.map(t => ({ label: t.name, value: t.id })),
    [teams]
  )

  const workspaceOptions = useMemo(
    () => workspaces.map(w => ({ label: w.name, value: w.id })),
    [workspaces]
  )

  const canSave = name.trim().length > 0 && promptTemplate.trim().length > 0

  const handleSave = async (runNow: boolean = false) => {
    if (!canSave) return
    setSaving(true)
    try {
      const payload = {
        name,
        description,
        triggerType,
        intervalSeconds: triggerType === 'interval' ? intervalSeconds : null,
        cronExpression: triggerType === 'cron' ? cronExpression : null,
        runAt: triggerType === 'once' ? runAt : null,
        agentId: agentId || null,
        teamId: teamId || null,
        modelId: modelId || null,
        workspaceId: workspaceId || null,
        promptTemplate,
        permissionMode,
        timeoutSeconds,
        maxRetries,
        tags,
        enabled: enabledOnCreate,
      }
      let taskId: string | null = null
      if (isEdit) {
        await ipcInvoke('scheduled-task:update', { id: task!.id, ...payload })
        taskId = task!.id
      } else {
        const res = await ipcInvoke('scheduled-task:create', payload)
        taskId = res?.task?.id ?? null
      }

      if (runNow && taskId) {
        try {
          const runRes = await ipcInvoke('scheduled-task:run-now', { id: taskId })
          const sessionId: string | null = runRes?.execution?.sessionId ?? null
          if (sessionId) {
            antdMessage.success('已保存并触发执行，正在打开会话')
            sidebar.setActiveSession(sessionId as any)
            setTweak('view', 'chat')
            onClose(true)
            return
          }
          // 兜底：没拿到 sessionId（10s 内未建会话），仅提示用户后续可在会话栏查看
          antdMessage.success('已保存并触发执行，会话稍后会出现在会话栏「无项目对话」分组')
        } catch (runErr) {
          antdMessage.warning(`已保存，但立即执行失败: ${runErr}`)
        }
      }
      onClose(true)
    } catch (err) {
      antdMessage.error(`保存失败: ${err}`)
    } finally {
      setSaving(false)
    }
  }

  useSaveShortcut(() => handleSave(false), !saving && canSave)

  return (
    <div className="st-form-page">
      {/* Page Header */}
      <div className="st-form-page-header">
        <div className="st-form-page-title">
          <Button
            type="text"
            size="middle"
            icon={<Icons.XCircle />}
            onClick={() => onClose(false)}
          />
          <div className="st-form-page-title-text">
            <span className="st-form-page-subtitle">CREATE AUTOMATION</span>
            <h2>{isEdit ? '编辑定时任务' : '新建定时任务'}</h2>
          </div>
        </div>
        <div className="st-form-page-actions">
          <Button type="text" onClick={() => onClose(false)}>取消</Button>
          <Button
            type="text"
            loading={saving}
            disabled={!canSave}
            onClick={() => handleSave(true)}
            icon={<Icons.Play />}
            title="保存后立即触发一次执行"
          >
            保存并执行
          </Button>
          <Button type="primary" loading={saving} disabled={!canSave} onClick={() => handleSave(false)}>
            {isEdit ? '保存修改' : '创建任务'}
          </Button>
        </div>
      </div>

      {/* Form Body */}
      <div className="st-form-page-body">
        {/* ── Section 1: Basic Info ────────────────────────────────────── */}
        <div className="st-form-section">
          <div className="st-form-section-header">
            <div className="st-section-badge">01</div>
            <div className="st-section-header-text">
              <h3>基础信息</h3>
              <p>任务名称、用途描述和分类标签</p>
            </div>
          </div>
          <div className="st-form-section-body">
            <div className="st-form-field-group">
              <div className="st-form-field">
                <label className="st-field-label">
                  任务名称 <span className="st-required">*</span>
                </label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="例如：每日代码审查"
                  size="middle"
                />
              </div>

              <div className="st-form-field">
                <label className="st-field-label">描述</label>
                <TextArea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="补充任务目标、产出格式和注意事项"
                  rows={3}
                  autoSize={{ minRows: 2, maxRows: 5 }}
                />
              </div>

              <div className="st-form-field-row">
                <div className="st-form-field st-form-field--half">
                  <label className="st-field-label">标签</label>
                  <Select
                    mode="tags"
                    value={tags}
                    onChange={(v) => setTags(v as string[])}
                    placeholder="输入后回车添加"
                    size="middle"
                  />
                </div>
                <div className="st-form-field st-form-field--half">
                  <label className="st-field-label">创建后立即启用</label>
                  <div className="st-form-switch-row">
                    <Switch checked={enabledOnCreate} onChange={setEnabledOnCreate} />
                    <span className="st-form-switch-hint">
                      {enabledOnCreate ? '任务创建后进入调度' : '创建后暂停，手动启用'}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── Section 2: Schedule ──────────────────────────────────────── */}
        <div className="st-form-section">
          <div className="st-form-section-header">
            <div className="st-section-badge">02</div>
            <div className="st-section-header-text">
              <h3>调度策略</h3>
              <p>决定任务何时运行</p>
            </div>
          </div>
          <div className="st-form-section-body">
            <div className="st-trigger-cards">
              {([
                {
                  value: 'interval' as const,
                  icon: <Icons.Refresh />,
                  title: '固定间隔',
                  desc: '每隔固定时间自动执行',
                },
                {
                  value: 'cron' as const,
                  icon: <Icons.Calendar />,
                  title: 'Cron 表达式',
                  desc: '用 cron 规则精确控制时间',
                },
                {
                  value: 'once' as const,
                  icon: <Icons.Zap />,
                  title: '单次执行',
                  desc: '在指定时间点执行一次',
                },
              ]).map(opt => (
                <div
                  key={opt.value}
                  className={`st-trigger-card ${triggerType === opt.value ? 'active' : ''}`}
                  onClick={() => setTriggerType(opt.value)}
                >
                  <div className="st-trigger-card-icon">{opt.icon}</div>
                  <div className="st-trigger-card-text">
                    <span className="st-trigger-card-title">{opt.title}</span>
                    <span className="st-trigger-card-desc">{opt.desc}</span>
                  </div>
                  <div className="st-trigger-card-check">
                    {triggerType === opt.value && <Icons.CheckCircle />}
                  </div>
                </div>
              ))}
            </div>

            {triggerType === 'interval' && (
              <div className="st-form-field" style={{ marginTop: 16 }}>
                <label className="st-field-label">执行间隔</label>
                <div className="st-interval-input-row">
                  <InputNumber
                    value={intervalSeconds}
                    onChange={(v) => setIntervalSeconds(typeof v === 'number' ? v : 3600)}
                    min={10}
                    max={86400}
                    suffix="秒"
                    style={{ flex: 1 }}
                    size="middle"
                  />
                  <span className="st-interval-hint">
                    {intervalSeconds < 60 ? `每 ${intervalSeconds} 秒`
                      : intervalSeconds < 3600 ? `每 ${Math.round(intervalSeconds / 60)} 分钟`
                      : `每 ${Math.round(intervalSeconds / 3600)} 小时`}
                  </span>
                </div>
                <div className="st-quick-intervals">
                  {[
                    { label: '30秒', val: 30 },
                    { label: '1分钟', val: 60 },
                    { label: '5分钟', val: 300 },
                    { label: '15分钟', val: 900 },
                    { label: '1小时', val: 3600 },
                    { label: '6小时', val: 21600 },
                    { label: '1天', val: 86400 },
                  ].map(qi => (
                    <Tag
                      key={qi.val}
                      size="middle"
                      color={intervalSeconds === qi.val ? 'blue' : 'default'}
                      style={{ cursor: 'pointer' }}
                      onClick={() => setIntervalSeconds(qi.val)}
                    >
                      {qi.label}
                    </Tag>
                  ))}
                </div>
              </div>
            )}

            {triggerType === 'cron' && (
              <div className="st-form-field" style={{ marginTop: 16 }}>
                <label className="st-field-label">Cron 表达式</label>
                <Input
                  value={cronExpression}
                  onChange={(e) => setCronExpression(e.target.value)}
                  placeholder="0 */2 * * *"
                  size="middle"
                />
                <div className="st-quick-intervals">
                  {[
                    { label: '每 5 分钟', expr: '*/5 * * * *' },
                    { label: '每小时', expr: '0 */1 * * *' },
                    { label: '工作日 9 点', expr: '0 9 * * MON-FRI' },
                    { label: '每月 1 号', expr: '0 0 1 * *' },
                  ].map(qc => (
                    <Tag
                      key={qc.expr}
                      size="middle"
                      color={cronExpression === qc.expr ? 'blue' : 'default'}
                      style={{ cursor: 'pointer' }}
                      onClick={() => setCronExpression(qc.expr)}
                    >
                      {qc.label}
                    </Tag>
                  ))}
                </div>
              </div>
            )}

            {triggerType === 'once' && (
              <div className="st-form-field" style={{ marginTop: 16 }}>
                <label className="st-field-label">执行时间</label>
                <Input
                  type="datetime-local"
                  value={runAt}
                  onChange={(e) => setRunAt(e.target.value)}
                  size="middle"
                />
              </div>
            )}
          </div>
        </div>

        {/* ── Section 3: Execution Config ──────────────────────────────── */}
        <div className="st-form-section">
          <div className="st-form-section-header">
            <div className="st-section-badge">03</div>
            <div className="st-section-header-text">
              <h3>执行配置</h3>
              <p>由谁执行、用哪个模型和工作区</p>
            </div>
          </div>
          <div className="st-form-section-body">
            <div className="st-form-field-row">
              <div className="st-form-field st-form-field--half">
                <label className="st-field-label">
                  <Icons.User style={{ marginRight: 4, fontSize: 13, verticalAlign: -1 }} />
                  Agent
                </label>
                <Select
                  {...(agentId ? { value: agentId } : {})}
                  onChange={(v) => setAgentId(v as string)}
                  placeholder="选择执行 Agent"
                  allowClear
                  showSearch
                  filterOption={(input: string, option: any) =>
                    (option?.props?.children ?? '').toLowerCase().includes(input.toLowerCase())
                  }
                  options={agentOptions}
                  size="middle"
                  notFoundContent="暂无可用 Agent"
                />
              </div>
              <div className="st-form-field st-form-field--half">
                <label className="st-field-label">
                  <Icons.Users style={{ marginRight: 4, fontSize: 13, verticalAlign: -1 }} />
                  Team
                </label>
                <Select
                  {...(teamId ? { value: teamId } : {})}
                  onChange={(v) => setTeamId(v as string)}
                  placeholder="选择团队"
                  allowClear
                  showSearch
                  filterOption={(input: string, option: any) =>
                    (option?.props?.children ?? '').toLowerCase().includes(input.toLowerCase())
                  }
                  options={teamOptions}
                  size="middle"
                  notFoundContent="暂无可用团队"
                />
              </div>
            </div>

            <div className="st-form-field-row">
              <div className="st-form-field st-form-field--half">
                <label className="st-field-label">
                  <Icons.Lightbulb style={{ marginRight: 4, fontSize: 13, verticalAlign: -1 }} />
                  Model
                </label>
                <Select
                  {...(modelId ? { value: modelId } : {})}
                  onChange={(v) => setModelId(v as string)}
                  placeholder="选择模型"
                  allowClear
                  showSearch
                  filterOption={(input: string, option: any) =>
                    (option?.props?.children ?? '').toLowerCase().includes(input.toLowerCase())
                  }
                  options={modelOptions}
                  size="middle"
                  notFoundContent="暂无可用模型"
                />
              </div>
              <div className="st-form-field st-form-field--half">
                <label className="st-field-label">
                  <Icons.Book style={{ marginRight: 4, fontSize: 13, verticalAlign: -1 }} />
                  Workspace
                </label>
                <Select
                  {...(workspaceId ? { value: workspaceId } : {})}
                  onChange={(v) => setWorkspaceId(v as string)}
                  placeholder="选择工作区"
                  allowClear
                  showSearch
                  filterOption={(input: string, option: any) =>
                    (option?.props?.children ?? '').toLowerCase().includes(input.toLowerCase())
                  }
                  options={workspaceOptions}
                  size="middle"
                  notFoundContent="暂无可用工作区"
                />
              </div>
            </div>

            <div className="st-form-field">
              <label className="st-field-label">
                Prompt 模板 <span className="st-required">*</span>
              </label>
              <TextArea
                value={promptTemplate}
                onChange={(e) => setPromptTemplate(e.target.value)}
                placeholder="写清任务执行时需要产出的内容、格式和约束"
                rows={6}
                autoSize={{ minRows: 4, maxRows: 12 }}
              />
              <div className="st-form-hint">
                可用变量: {'{{date}}'}, {'{{time}}'}, {'{{taskName}}'}, {'{{executionCount}}'}, {'{{interval}}'}
              </div>
            </div>
          </div>
        </div>

        {/* ── Section 4: Advanced Settings ─────────────────────────────── */}
        <div className="st-form-section">
          <div className="st-form-section-header">
            <div className="st-section-badge">04</div>
            <div className="st-section-header-text">
              <h3>高级设置</h3>
              <p>超时、重试等运行策略</p>
            </div>
          </div>
          <div className="st-form-section-body">
            <div className="st-form-field-row">
              <div className="st-form-field st-form-field--third">
                <label className="st-field-label">
                  <Icons.Settings style={{ marginRight: 4, fontSize: 13, verticalAlign: -1 }} />
                  超时时间
                </label>
                <InputNumber
                  value={timeoutSeconds}
                  onChange={(v) => setTimeoutSeconds(typeof v === 'number' ? v : 300)}
                  min={10}
                  max={7200}
                  suffix="秒"
                  style={{ width: '100%' }}
                  size="middle"
                />
              </div>
              <div className="st-form-field st-form-field--third">
                <label className="st-field-label">最大重试次数</label>
                <InputNumber
                  value={maxRetries}
                  onChange={(v) => setMaxRetries(typeof v === 'number' ? v : 0)}
                  min={0}
                  max={10}
                  suffix="次"
                  style={{ width: '100%' }}
                  size="middle"
                />
              </div>
              <div className="st-form-field st-form-field--third">
                <label className="st-field-label">
                  <Icons.Zap style={{ marginRight: 4, fontSize: 13, verticalAlign: -1 }} />
                  权限策略
                </label>
                <Select
                  value={permissionMode}
                  onChange={(v) => setPermissionMode(v as string)}
                  options={[
                    { label: 'Auto（自动批准）', value: 'auto' },
                    { label: 'Bypass（完全放行）', value: 'bypass' },
                  ]}
                  size="middle"
                  style={{ width: '100%' }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Import Preview Modal ─────────────────────────────────────────────────────

interface TaskImportPreviewModalProps {
  payload: ScheduledTaskExportPayload
  filePath: string
  /** 本地已有任务 name 集合，用于标记冲突 */
  existingNames: Set<string>
  submitting: boolean
  onConfirm: (
    payload: ScheduledTaskExportPayload,
    mode: ScheduledTaskImportMode,
  ) => void | Promise<void>
  onClose: () => void
}

function triggerLabel(t: ScheduledTaskExportPayload['tasks'][number]): string {
  switch (t.triggerType) {
    case 'interval':
      return t.intervalSeconds == null
        ? 'Interval'
        : t.intervalSeconds < 60 ? `每 ${t.intervalSeconds} 秒`
        : t.intervalSeconds < 3600 ? `每 ${Math.round(t.intervalSeconds / 60)} 分钟`
        : t.intervalSeconds < 86400 ? `每 ${Math.round(t.intervalSeconds / 3600)} 小时`
        : `每 ${Math.round(t.intervalSeconds / 86400)} 天`
    case 'cron':
      return t.cronExpression ?? 'Cron'
    case 'once':
      return t.runAt ?? '单次'
  }
}

function TaskImportPreviewModal({
  payload,
  filePath,
  existingNames,
  submitting,
  onConfirm,
  onClose,
}: TaskImportPreviewModalProps) {
  const [mode, setMode] = useState<ScheduledTaskImportMode>('merge')

  const conflictCount = useMemo(
    () => payload.tasks.filter(t => existingNames.has(t.name)).length,
    [payload, existingNames],
  )

  const exportedAt = useMemo(() => {
    try {
      return new Date(payload.exportedAt).toLocaleString()
    } catch {
      return payload.exportedAt
    }
  }, [payload.exportedAt])

  const handleConfirm = async () => {
    if (submitting) return
    await onConfirm(payload, mode)
  }

  return (
    <Modal
      title={
        <div className="st-import-modal-title">
          <Icons.Upload style={{ fontSize: 16, color: 'var(--primary)' }} />
          <span>导入定时任务</span>
        </div>
      }
      visible
      onCancel={onClose}
      maskClosable={!submitting}
      closable={!submitting}
      style={{ width: 680 }}
      footer={
        <div className="st-import-modal-footer">
          <Button type="text" onClick={onClose} disabled={submitting}>取消</Button>
          <Button
            type="primary"
            onClick={() => void handleConfirm()}
            disabled={submitting || payload.tasks.length === 0}
            loading={submitting}
          >
            {submitting
              ? '导入中…'
              : `确认导入 ${payload.tasks.length} 个`}
          </Button>
        </div>
      }
    >
      <div className="st-import-modal-body">
        {/* 文件元信息 */}
        <div className="st-import-meta">
          <div>
            <span className="muted">文件：</span>
            <span className="mono-sm" title={filePath}>{filePath}</span>
          </div>
          <div>
            <span className="muted">版本：</span>
            <span className="mono-sm">v{payload.version}</span>
          </div>
          <div>
            <span className="muted">导出时间：</span>
            <span className="mono-sm">{exportedAt}</span>
          </div>
          <div>
            <span className="muted">来源：</span>
            <span className="mono-sm">{payload.exportedBy}</span>
          </div>
          <div>
            <span className="muted">任务数：</span>
            <span className="mono-sm"><strong>{payload.tasks.length}</strong></span>
          </div>
          {conflictCount > 0 && (
            <div className="st-import-conflict-warn">
              <Icons.AlertTriangle style={{ fontSize: 12, color: 'var(--color-warning-6)' }} />
              {conflictCount} 个任务 name 与本地冲突
            </div>
          )}
        </div>

        {/* 冲突模式选择 */}
        <div className="st-import-mode-row">
          <span className="muted">冲突处理：</span>
          <Radio.Group
            value={mode}
            onChange={(e) => setMode(e.target.value as 'replace' | 'merge')}
            disabled={submitting}
            size="middle"
          >
            <Radio value="merge">
              <strong>合并</strong>
              <span className="muted"> · 跳过已存在的 name</span>
            </Radio>
            <Radio value="replace">
              <strong>覆盖</strong>
              <span className="muted"> · 用导入的字段更新已存在任务（运行时统计保留）</span>
            </Radio>
          </Radio.Group>
        </div>

        {/* 任务列表 */}
        <div className="st-import-list-header">
          <span>名称</span>
          <span>触发</span>
          <span>Agent / Team</span>
          <span>状态</span>
        </div>
        <div className="st-import-list">
          {payload.tasks.length === 0 && (
            <div className="st-import-empty">该文件不含任何任务</div>
          )}
          {payload.tasks.map((t, idx) => {
            const conflict = existingNames.has(t.name)
            return (
              <div
                key={`${t.name}-${idx}`}
                className={`st-import-list-row${conflict ? ' conflict' : ''}`}
              >
                <span className="cell-name" title={t.name}>{t.name}</span>
                <span className="cell-trigger" title={triggerLabel(t)}>
                  {triggerLabel(t)}
                </span>
                <span className="cell-agent" title={t.agentId ?? t.teamId ?? '-'}>
                  {t.agentId ? `Agent · ${t.agentId.slice(0, 6)}` : t.teamId ? `Team · ${t.teamId.slice(0, 6)}` : '-'}
                </span>
                <span className="cell-status">
                  {conflict ? (
                    <Tag size="middle" color="orange">{mode === 'replace' ? '将更新' : '将跳过'}</Tag>
                  ) : (
                    <Tag size="middle" color="green">将新增</Tag>
                  )}
                </span>
              </div>
            )
          })}
        </div>

        <div className="st-import-tip">
          <Icons.AlertTriangle style={{ fontSize: 12 }} />
          <span>
            导入的新任务默认 <strong>disabled = true</strong>(保留导入文件中的设置);merge 模式下不会覆盖本地同名任务,replace 模式会更新字段但保留运行时统计(status / 计数 / nextRunAt 等)。
          </span>
        </div>
      </div>
    </Modal>
  )
}
