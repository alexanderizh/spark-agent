/**
 * ScheduledTasksView — 定时任务管理主视图
 *
 * 布局：左侧任务列表 + 右侧详情面板
 * 支持：筛选、搜索、新建/编辑/删除/启用/禁用/立即执行
 * 支持：多选批量删除 / 多选批量导出 / 全量导入导出
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { Button, Empty, Input, Modal, Select, Tag, TextArea, Tooltip } from '@lobehub/ui'
import { Badge, InputNumber, Popconfirm, Radio, Spin, Switch, message as antdMessage } from 'antd'
import { Icons } from '../Icons'
import { translate, useI18n } from '../i18n'
import type {
  ManagedAgent,
  ManagedTeam,
  ProviderProfile,
  WorkspaceInfo,
  ScheduledTaskExportPayload,
  ScheduledTaskImportMode,
} from '@spark/protocol'
import { useIpcInvoke } from '../hooks/useIpc'
import { useRefreshable } from '../hooks/useRefreshable'
import { useSaveShortcut } from '../hooks/useSaveShortcut'
import { useToast } from '../components/Toast'
import { useApp } from '../AppContext'
import { useSessionSidebar } from '../SessionSidebarContext'
import { filterConversationalProviders } from '../utils/provider-model-kind'
import { buildScheduledTaskModelOptions } from './scheduled-task-model-options'
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
  if (diff <= 0) return translate('scheduledTasks.t1')
  if (diff < 60000) return translate('scheduledTasks.tpl23Desc', { value: Math.ceil(diff / 1000) })
  if (diff < 3600000)
    return translate('scheduledTasks.tpl1Desc', { value: Math.ceil(diff / 60000) })
  if (diff < 86400000)
    return translate('scheduledTasks.tpl2Desc', { value: Math.ceil(diff / 3600000) })
  return translate('scheduledTasks.tpl3Desc', { value: Math.ceil(diff / 86400000) })
}

function formatTriggerType(task: ScheduledTaskItem): string {
  switch (task.triggerType) {
    case 'interval':
      if (!task.intervalSeconds) return 'Interval'
      if (task.intervalSeconds < 60)
        return translate('scheduledTasks.tpl4Desc', { value: task.intervalSeconds })
      if (task.intervalSeconds < 3600)
        return translate('scheduledTasks.tpl5Desc', {
          value: Math.round(task.intervalSeconds / 60),
        })
      if (task.intervalSeconds < 86400)
        return translate('scheduledTasks.tpl6Desc', {
          value: Math.round(task.intervalSeconds / 3600),
        })
      return translate('scheduledTasks.tpl7Desc', {
        value: Math.round(task.intervalSeconds / 86400),
      })
    case 'cron':
      return task.cronExpression ?? 'Cron'
    case 'once':
      return task.runAt ? new Date(task.runAt).toLocaleString() : translate('scheduledTasks.t2')
    default:
      return task.triggerType
  }
}

function statusColor(status: string): 'processing' | 'success' | 'default' | 'error' {
  switch (status) {
    case 'running':
      return 'processing'
    case 'idle':
      return 'success'
    case 'disabled':
      return 'default'
    case 'error':
      return 'error'
    default:
      return 'default'
  }
}

function executionStatusIcon(status: string): React.ReactNode {
  switch (status) {
    case 'completed':
      return <Icons.CheckCircle style={{ color: 'var(--color-success-6)' }} />
    case 'failed':
    case 'timeout':
      return <Icons.XCircle style={{ color: 'var(--color-danger-6)' }} />
    case 'running':
      return <Icons.Spinner style={{ color: 'var(--color-primary-6)' }} />
    case 'cancelled':
      return <Icons.AlertTriangle style={{ color: 'var(--color-warning-6)' }} />
    default:
      return null
  }
}

async function ipcInvoke(channel: string, params?: Record<string, unknown>): Promise<any> {
  return (window.spark as any)?.invoke?.(channel, params ?? {})
}

// ─── Main Component ─────────────────────────────────────────────────────────

export function ScheduledTasksView() {
  // 本文件使用非响应式 translate()：顶层订阅语言变化，保证切换语言后整树重渲染。
  useI18n()
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
        scope: 'global',
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

  const triggerRefresh = useRefreshable(() => setRefreshKey((k) => k + 1))

  useEffect(() => {
    void loadTasks()
  }, [loadTasks, refreshKey])

  // Auto-refresh every 10s for countdown updates
  useEffect(() => {
    const timer = setInterval(() => setRefreshKey((k) => k + 1), 10000)
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
    if (!selectedId) {
      setExecutions([])
      return
    }
    ipcInvoke('task-execution:list', { taskId: selectedId, pageSize: 20 })
      .then((res) => setExecutions(res?.executions ?? []))
      .catch(() => setExecutions([]))
  }, [selectedId, refreshKey])

  const selectedTask = useMemo(
    () => tasks.find((t) => t.id === selectedId) ?? null,
    [tasks, selectedId],
  )

  // 筛选/搜索命中为空 ≠ 从未创建过任务：两者空状态文案与提示需要区分，
  // 否则「一个任务都没有」时才该出现的会话计划任务引导会误伤筛选无结果场景。
  const hasActiveFilter = filter !== 'all' || searchQuery.trim().length > 0

  // ─── Actions ──────────────────────────────────────────────────────────────

  const handleToggle = useCallback(async (id: string, enabled: boolean) => {
    try {
      await ipcInvoke('scheduled-task:toggle', { id, enabled })
      setRefreshKey((k) => k + 1)
      antdMessage.success(enabled ? translate('scheduledTasks.t3') : translate('scheduledTasks.t4'))
    } catch (err) {
      antdMessage.error(
        translate('scheduledTasks.tpl8Desc', {
          err: err instanceof Error ? err.message : String(err),
        }),
      )
    }
  }, [])

  const handleRunNow = useCallback(
    async (id: string) => {
      try {
        const res = await ipcInvoke('scheduled-task:run-now', { id })
        const sessionId: string | null = res?.execution?.sessionId ?? null
        setRefreshKey((k) => k + 1)
        if (sessionId) {
          antdMessage.success(translate('scheduledTasks.t5Desc'))
          sidebar.setActiveSession(sessionId as any)
          setTweak('view', 'chat')
        } else {
          antdMessage.success(translate('scheduledTasks.t6Desc'))
        }
      } catch (err) {
        antdMessage.error(
          translate('scheduledTasks.tpl9Desc', {
            err: err instanceof Error ? err.message : String(err),
          }),
        )
      }
    },
    [sidebar, setTweak],
  )

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        await ipcInvoke('scheduled-task:delete', { id })
        if (selectedId === id) setSelectedId(null)
        setRefreshKey((k) => k + 1)
        antdMessage.success(translate('scheduledTasks.t7'))
      } catch (err) {
        antdMessage.error(
          translate('scheduledTasks.tpl10Desc', {
            err: err instanceof Error ? err.message : String(err),
          }),
        )
      }
    },
    [selectedId],
  )

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
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const selectAll = useCallback(() => {
    setSelectedIds(new Set(tasks.map((t) => t.id)))
  }, [tasks])

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set())
  }, [])

  const invertSelection = useCallback(() => {
    setSelectedIds((prev) => {
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
      title: translate('scheduledTasks.tpl11Desc', { count: selectedIds.size }),
      description: translate('scheduledTasks.t8Desc'),
      confirmText: translate('scheduledTasks.t9'),
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
        const name = tasks.find((t) => t.id === id)?.name ?? id
        errs.push(`${name}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
    if (ok > 0) toast.success(translate('scheduledTasks.tpl12Desc', { count: ok }))
    if (errs.length > 0)
      toast.error(
        translate('scheduledTasks.tpl13Desc', {
          count: errs.length,
          detail: errs.slice(0, 2).join('; '),
        }),
      )
    // 如果详情面板中选中的任务被删了，清空选中
    if (selectedId && selectedIds.has(selectedId)) setSelectedId(null)
    clearSelection()
    exitMultiSelect()
    setRefreshKey((k) => k + 1)
  }, [
    selectedIds,
    selectedId,
    requestConfirm,
    deleteTask,
    tasks,
    toast,
    clearSelection,
    exitMultiSelect,
  ])

  // ─── 导出 ────────────────────────────────────────────────────────────────

  /**
   * 弹保存对话框写文件。空 ids 表示导出全部。
   */
  const handleExportToFile = useCallback(
    async (ids: string[]) => {
      try {
        const result = await exportTasksToFile({ ids })
        if (!result.filePath) {
          // 用户取消
          return
        }
        toast.success(translate('scheduledTasks.tpl14Desc', { count: result.count }))
      } catch (err) {
        toast.error(err instanceof Error ? err.message : translate('scheduledTasks.t10'))
      }
    },
    [exportTasksToFile, toast],
  )

  const handleExportAll = useCallback(() => {
    void handleExportToFile([])
  }, [handleExportToFile])

  const handleExportSelected = useCallback(() => {
    void handleExportToFile(Array.from(selectedIds))
  }, [handleExportToFile, selectedIds])

  /**
   * translate('scheduledTasks.tpl22Desc')（次要入口）。
   */
  const handleCopyToClipboard = useCallback(async () => {
    try {
      const { payload } = await exportTasks({ ids: [] })
      const json = JSON.stringify(payload, null, 2)
      await navigator.clipboard.writeText(json)
      toast.success(translate('scheduledTasks.tpl15Desc', { count: payload.tasks.length }))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : translate('scheduledTasks.t11'))
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
      toast.error(err instanceof Error ? err.message : translate('scheduledTasks.t12'))
    }
  }, [importTasksFromFile, toast])

  /**
   * 从剪贴板读取 JSON 字符串并解析为 payload。
   */
  const handleImportFromClipboard = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (!text.trim()) {
        toast.warning(translate('scheduledTasks.t13'))
        return
      }
      let json: unknown
      try {
        json = JSON.parse(text)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        toast.error(translate('scheduledTasks.tpl16Desc', { message }))
        return
      }
      const { ScheduledTaskExportPayloadSchema } = await import('@spark/protocol')
      const parsed = ScheduledTaskExportPayloadSchema.parse(json)
      setImportPreview({ payload: parsed, filePath: translate('scheduledTasks.t14') })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : translate('scheduledTasks.t15Desc'))
    }
  }, [toast])

  /**
   * 预览确认后的写入操作。
   */
  const handleImportConfirm = useCallback(
    async (payload: ScheduledTaskExportPayload, mode: ScheduledTaskImportMode) => {
      setImporting(true)
      try {
        const result = await importTasks({ payload, mode })
        const parts: string[] = []
        if (result.imported > 0)
          parts.push(translate('scheduledTasks.tpl17Desc', { count: result.imported }))
        if (result.skipped > 0)
          parts.push(translate('scheduledTasks.tpl18Desc', { count: result.skipped }))
        if (parts.length > 0) {
          toast.success(parts.join('，'))
        } else if (result.errors.length === 0) {
          toast.info(translate('scheduledTasks.t16'))
        }
        if (result.errors.length > 0) {
          toast.error(
            translate('scheduledTasks.tpl19Desc', {
              count: result.errors.length,
              detail: result.errors.slice(0, 2).join('; '),
            }),
          )
        }
        setImportPreview(null)
        // 关闭预览后刷新列表
        setRefreshKey((k) => k + 1)
      } catch (err) {
        toast.error(err instanceof Error ? err.message : translate('scheduledTasks.t12'))
      } finally {
        setImporting(false)
      }
    },
    [importTasks, toast],
  )

  /** 已有 name 集合：用于预览时标记冲突 */
  const existingNamesForPreview = useMemo(() => new Set(tasks.map((t) => t.name)), [tasks])

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
      setRefreshKey((k) => k + 1)
      antdMessage.success(
        wasEdit ? translate('scheduledTasks.t17') : translate('scheduledTasks.t18'),
      )
    }
  }, [])

  // ─── Render ───────────────────────────────────────────────────────────────

  // Show form page when creating/editing
  if (showForm) {
    return (
      <div className="scheduled-tasks-view">
        <TaskFormPage task={editingTask} onClose={handleFormClose} />
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
            title={translate('scheduledTasks.t59')}
            aria-label={translate('scheduledTasks.t60')}
          />
          {!multiSelect && (
            <>
              <Button
                size="middle"
                type="text"
                icon={<Icons.Upload />}
                onClick={() => void handleImportFromFile()}
                disabled={importing}
                title={translate('scheduledTasks.t61Desc')}
              >
                {translate('scheduledTasks.t88')}
              </Button>
              {/* <Button
                size="middle"
                type="text"
                icon={<Icons.Copy />}
                onClick={() => void handleImportFromClipboard()}
                disabled={importing}
                title={translate('scheduledTasks.tpl24Desc')}
              >
                {translate('scheduledTasks.tpl25Desc')}
              </Button> */}
              <Button
                size="middle"
                type="text"
                icon={<Icons.Download />}
                onClick={() => void handleExportAll()}
                disabled={tasks.length === 0}
                title={translate('scheduledTasks.t62Desc')}
              >
                {translate('scheduledTasks.t89')}
              </Button>
              {/* <Button
                size="middle"
                type="text"
                icon={<Icons.Copy />}
                onClick={() => void handleCopyToClipboard()}
                disabled={tasks.length === 0}
                title={translate('scheduledTasks.tpl22Desc')}
              >
                {translate('scheduledTasks.tpl26Desc')}
              </Button> */}
              <Button
                size="middle"
                type="text"
                icon={<Icons.Check />}
                onClick={enterMultiSelect}
                disabled={tasks.length === 0}
                title={translate('scheduledTasks.t63Desc')}
              >
                {translate('scheduledTasks.t90')}
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
            title={translate('scheduledTasks.t64')}
          />
          <span className="st-multi-count">
            {translate('scheduledTasks.t91')} <strong>{selectedIds.size}</strong> / {tasks.length}
          </span>
          <Button
            size="middle"
            type="text"
            onClick={selectAll}
            disabled={selectedIds.size === tasks.length}
          >
            {translate('scheduledTasks.t92')}
          </Button>
          <Button size="middle" type="text" onClick={invertSelection} disabled={tasks.length === 0}>
            {translate('scheduledTasks.t93')}
          </Button>
          <Button
            size="middle"
            type="text"
            onClick={clearSelection}
            disabled={selectedIds.size === 0}
          >
            {translate('scheduledTasks.t94')}
          </Button>
          <span style={{ flex: 1 }} />
          <Button
            size="middle"
            type="text"
            icon={<Icons.Download />}
            onClick={handleExportSelected}
            disabled={selectedIds.size === 0}
            title={translate('scheduledTasks.t65')}
          >
            {translate('scheduledTasks.t95')}
          </Button>
          <Button
            size="middle"
            type="text"
            danger
            icon={<Icons.Trash />}
            onClick={() => void handleDeleteSelected()}
            disabled={selectedIds.size === 0 || importing}
            title={translate('scheduledTasks.t66')}
          >
            {translate('scheduledTasks.t96')}
          </Button>
        </div>
      )}

      {/* Filter Bar */}
      <div className="st-filter-bar">
        <div className="st-filter-tabs">
          {(['all', 'enabled', 'disabled', 'error'] as const).map((f) => (
            <button
              key={f}
              className={`st-filter-tab ${filter === f ? 'active' : ''}`}
              onClick={() => setFilter(f)}
            >
              {f === 'all'
                ? translate('scheduledTasks.t19')
                : f === 'enabled'
                  ? translate('scheduledTasks.t20')
                  : f === 'disabled'
                    ? translate('scheduledTasks.t21')
                    : translate('scheduledTasks.t22')}
            </button>
          ))}
        </div>
        <Input
          prefix={<Icons.Search />}
          placeholder={translate('scheduledTasks.t67')}
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
          <div className="st-loading">
            <Spin />
          </div>
        ) : tasks.length === 0 ? (
          <div className="st-empty">
            <Empty
              description={
                hasActiveFilter
                  ? translate('scheduledTasks.t23')
                  : translate('scheduledTasks.t24Desc')
              }
            />
            <Button type="primary" onClick={handleCreate} style={{ marginTop: 16 }}>
              {translate('scheduledTasks.t97')}
            </Button>
          </div>
        ) : (
          <>
            {/* Left: Task List */}
            <div className="st-list">
              {tasks.map((task) => {
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
                        <Badge status={statusColor(task.status)} style={{ marginRight: 8 }} />
                        <span className="st-task-name">{task.name}</span>
                      </div>
                      {!multiSelect && (
                        <div onClick={(e: React.MouseEvent) => e.stopPropagation()}>
                          <Switch
                            size="middle"
                            checked={task.enabled}
                            onChange={(checked: boolean) => {
                              handleToggle(task.id, checked)
                            }}
                          />
                        </div>
                      )}
                    </div>
                    <div className="st-task-meta">
                      <Tag size="middle" color="orangered">
                        {formatTriggerType(task)}
                      </Tag>
                      {task.status === 'running' && (
                        <Tag size="middle" color="blue" icon={<Icons.Spinner />}>
                          {translate('scheduledTasks.t98')}
                        </Tag>
                      )}
                    </div>
                    <div className="st-task-footer">
                      <span className="st-task-countdown">
                        {task.enabled
                          ? translate('scheduledTasks.tpl27Desc', {
                              value: formatCountdown(task.nextRunAt),
                            })
                          : translate('scheduledTasks.t21')}
                      </span>
                      <span className="st-task-stats">
                        {task.executionCount > 0 && (
                          <>
                            <span style={{ color: 'var(--color-success-6)' }}>
                              ✓{task.successCount}
                            </span>
                            {task.failureCount > 0 && (
                              <span style={{ color: 'var(--color-danger-6)', marginLeft: 4 }}>
                                ✗{task.failureCount}
                              </span>
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
                  <Empty description={translate('scheduledTasks.t68')} />
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

function TaskDetailPanel({
  task,
  executions,
  onEdit,
  onRunNow,
  onToggle,
  onDelete,
}: {
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
            <Tooltip title={translate('scheduledTasks.t69')}>
              <Button
                size="small"
                type="primary"
                shape="circle"
                icon={<Icons.Play />}
                onClick={onRunNow}
              />
            </Tooltip>
            <Tooltip title={translate('scheduledTasks.t70')}>
              <Button
                size="small"
                type="text"
                shape="circle"
                icon={<Icons.Edit />}
                onClick={onEdit}
              />
            </Tooltip>
            <Popconfirm title={translate('scheduledTasks.t71')} onConfirm={onDelete}>
              <Tooltip title={translate('scheduledTasks.t72')}>
                <Button size="small" type="text" danger shape="circle" icon={<Icons.Trash />} />
              </Tooltip>
            </Popconfirm>
          </div>
        </div>
        {task.description && <p className="st-detail-desc">{task.description}</p>}
        <div className="st-detail-tags">
          <Switch size="middle" checked={task.enabled} onChange={onToggle} />
          <span style={{ marginLeft: 8, fontSize: 12, color: 'var(--color-text-3)' }}>
            {task.enabled ? translate('scheduledTasks.t20') : translate('scheduledTasks.t21')}
          </span>
        </div>
      </div>

      {/* Stats */}
      <div className="st-detail-stats">
        <div className="st-stat-item">
          <span className="st-stat-value">{task.executionCount}</span>
          <span className="st-stat-label">{translate('scheduledTasks.t99')}</span>
        </div>
        <div className="st-stat-item">
          <span className="st-stat-value" style={{ color: 'var(--color-success-6)' }}>
            {task.successCount}
          </span>
          <span className="st-stat-label">{translate('scheduledTasks.t100')}</span>
        </div>
        <div className="st-stat-item">
          <span className="st-stat-value" style={{ color: 'var(--color-danger-6)' }}>
            {task.failureCount}
          </span>
          <span className="st-stat-label">{translate('scheduledTasks.t101')}</span>
        </div>
        <div className="st-stat-item">
          <span className="st-stat-value">{formatCountdown(task.nextRunAt)}</span>
          <span className="st-stat-label">{translate('scheduledTasks.t102')}</span>
        </div>
      </div>

      {/* Config Summary */}
      <div className="st-detail-config">
        <h4>{translate('scheduledTasks.t103')}</h4>
        <div className="st-config-grid">
          <span className="st-config-label">{translate('scheduledTasks.t104')}</span>
          <span className="st-config-value">{formatTriggerType(task)}</span>
          <span className="st-config-label">{translate('scheduledTasks.t105')}</span>
          <span className="st-config-value">
            <Tag size="middle" color={task.permissionMode === 'bypass' ? 'orangered' : 'green'}>
              {task.permissionMode === 'bypass' ? 'Bypass' : 'Auto'}
            </Tag>
          </span>
          <span className="st-config-label">{translate('scheduledTasks.t106')}</span>
          <span className="st-config-value">{task.timeoutSeconds}s</span>
          <span className="st-config-label">{translate('scheduledTasks.t107')}</span>
          <span className="st-config-value">
            {translate('scheduledTasks.tpl28Desc', { count: task.maxRetries })}
          </span>
          <span className="st-config-label">{translate('scheduledTasks.t108')}</span>
          <span className="st-config-value">
            {task.lastRunAt ? new Date(task.lastRunAt).toLocaleString() : '-'}
          </span>
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
        <h4>{translate('scheduledTasks.t109')}</h4>
        {executions.length === 0 ? (
          <div style={{ color: 'var(--color-text-3)', fontSize: 12, padding: '8px 0' }}>
            {translate('scheduledTasks.t110')}
          </div>
        ) : (
          <div className="st-execution-list">
            {executions.map((ex) => (
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
                      <Tag size="middle" color="default">
                        {translate('scheduledTasks.t111')}
                      </Tag>
                    </Tooltip>
                  )}
                  {ex.error && (
                    <Tooltip title={ex.error}>
                      <Tag size="middle" color="red">
                        {translate('scheduledTasks.t112')}
                      </Tag>
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

function TaskFormPage({
  task,
  onClose,
}: {
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
  const [triggerType, setTriggerType] = useState<'interval' | 'cron' | 'once'>(
    task?.triggerType ?? 'interval',
  )
  const [intervalSeconds, setIntervalSeconds] = useState(task?.intervalSeconds ?? 3600)
  const [cronExpression, setCronExpression] = useState(task?.cronExpression ?? '0 */1 * * *')
  const [runAt, setRunAt] = useState(task?.runAt ?? '')
  // 执行主体只能有一个。旧表单允许 Agent / Team 双选，历史数据可能同时存了两者；
  // 执行器实际只消费 agentId（resolveScheduledTaskRuntime），因此这里按同一优先级只保留 Agent。
  const [agentId, setAgentId] = useState(task?.agentId ?? '')
  const [teamId, setTeamId] = useState(task?.agentId ? '' : (task?.teamId ?? ''))
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
    ])
      .then(([agentRes, teamRes, providerRes, workspaceRes]) => {
        setAgents(agentRes.agents ?? [])
        setTeams(teamRes.teams ?? [])
        // 定时任务执行的是文本 turn，多媒体渠道（图像/语音/视频）的模型不能进入候选：
        // 主进程会按 modelId 反查渠道，选中多媒体模型会把 turn 落到图像/视频渠道上。
        setProviders(filterConversationalProviders(providerRes.profiles ?? []))
        setWorkspaces(workspaceRes.workspaces ?? [])
      })
      .catch(console.error)
  }, [listAgents, listTeams, listProviders, listWorkspaces])

  // 模型候选 = AutoRouter 元渠道（选项值即 router 的 provider id）+ 普通渠道的模型 id
  const modelOptions = useMemo(() => buildScheduledTaskModelOptions(providers), [providers])

  const agentOptions = useMemo(() => agents.map((a) => ({ label: a.name, value: a.id })), [agents])

  const teamOptions = useMemo(() => teams.map((t) => ({ label: t.name, value: t.id })), [teams])

  const workspaceOptions = useMemo(
    () => workspaces.map((w) => ({ label: w.name, value: w.id })),
    [workspaces],
  )

  // Agent / Team 互斥：执行主体只能有一个，选中一个就清空另一个。
  const handleAgentChange = (value?: string) => {
    setAgentId(value ?? '')
    if (value) setTeamId('')
  }

  const handleTeamChange = (value?: string) => {
    setTeamId(value ?? '')
    if (value) setAgentId('')
  }

  const subjectHint = agentId
    ? translate('scheduledTasks.t25Desc')
    : teamId
      ? translate('scheduledTasks.t26Desc')
      : translate('scheduledTasks.t27Desc')

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
            antdMessage.success(translate('scheduledTasks.t28Desc'))
            sidebar.setActiveSession(sessionId as any)
            setTweak('view', 'chat')
            onClose(true)
            return
          }
          // 兜底：没拿到 sessionId（10s 内未建会话），仅提示用户后续可在会话栏查看
          antdMessage.success(translate('scheduledTasks.t29Desc'))
        } catch (runErr) {
          antdMessage.warning(
            translate('scheduledTasks.tpl29Desc', {
              err: runErr instanceof Error ? runErr.message : String(runErr),
            }),
          )
        }
      }
      onClose(true)
    } catch (err) {
      antdMessage.error(
        translate('scheduledTasks.tpl20Desc', {
          err: err instanceof Error ? err.message : String(err),
        }),
      )
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
            <h2>{isEdit ? translate('scheduledTasks.t30') : translate('scheduledTasks.t31')}</h2>
          </div>
        </div>
        <div className="st-form-page-actions">
          <Button type="text" onClick={() => onClose(false)}>
            {translate('scheduledTasks.t113')}
          </Button>
          <Button
            type="text"
            loading={saving}
            disabled={!canSave}
            onClick={() => handleSave(true)}
            icon={<Icons.Play />}
            title={translate('scheduledTasks.t73')}
          >
            {translate('scheduledTasks.t114')}
          </Button>
          <Button
            type="primary"
            loading={saving}
            disabled={!canSave}
            onClick={() => handleSave(false)}
          >
            {isEdit ? translate('scheduledTasks.t32') : translate('scheduledTasks.t33')}
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
              <h3>{translate('scheduledTasks.t115')}</h3>
              <p>{translate('scheduledTasks.t116Desc')}</p>
            </div>
          </div>
          <div className="st-form-section-body">
            <div className="st-form-field-group">
              <div className="st-form-field">
                <label className="st-field-label">
                  {translate('scheduledTasks.t117')} <span className="st-required">*</span>
                </label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={translate('scheduledTasks.t74')}
                  size="middle"
                />
              </div>

              <div className="st-form-field">
                <label className="st-field-label">{translate('scheduledTasks.t118')}</label>
                <TextArea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={translate('scheduledTasks.t75Desc')}
                  rows={3}
                  autoSize={{ minRows: 2, maxRows: 5 }}
                />
              </div>

              <div className="st-form-field-row">
                <div className="st-form-field st-form-field--half">
                  <label className="st-field-label">{translate('scheduledTasks.t119')}</label>
                  <Select
                    mode="tags"
                    value={tags}
                    onChange={(v) => setTags(v as string[])}
                    placeholder={translate('scheduledTasks.t76')}
                    size="middle"
                  />
                </div>
                <div className="st-form-field st-form-field--half">
                  <label className="st-field-label">{translate('scheduledTasks.t120')}</label>
                  <div className="st-form-switch-row">
                    <Switch checked={enabledOnCreate} onChange={setEnabledOnCreate} />
                    <span className="st-form-switch-hint">
                      {enabledOnCreate
                        ? translate('scheduledTasks.t34')
                        : translate('scheduledTasks.t35')}
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
              <h3>{translate('scheduledTasks.t121')}</h3>
              <p>{translate('scheduledTasks.t122')}</p>
            </div>
          </div>
          <div className="st-form-section-body">
            <div className="st-trigger-cards">
              {[
                {
                  value: 'interval' as const,
                  icon: <Icons.Refresh />,
                  title: translate('scheduledTasks.t36'),
                  desc: translate('scheduledTasks.t37'),
                },
                {
                  value: 'cron' as const,
                  icon: <Icons.Calendar />,
                  title: translate('scheduledTasks.t38'),
                  desc: translate('scheduledTasks.t39Desc'),
                },
                {
                  value: 'once' as const,
                  icon: <Icons.Zap />,
                  title: translate('scheduledTasks.t40'),
                  desc: translate('scheduledTasks.t41'),
                },
              ].map((opt) => (
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
                <label className="st-field-label">{translate('scheduledTasks.t123')}</label>
                <div className="st-interval-input-row">
                  <InputNumber
                    value={intervalSeconds}
                    onChange={(v) => setIntervalSeconds(typeof v === 'number' ? v : 3600)}
                    min={10}
                    max={86400}
                    suffix={translate('scheduledTasks.t77')}
                    style={{ flex: 1 }}
                    size="middle"
                  />
                  <span className="st-interval-hint">
                    {intervalSeconds < 60
                      ? translate('scheduledTasks.tpl4Desc', { value: intervalSeconds })
                      : intervalSeconds < 3600
                        ? translate('scheduledTasks.tpl5Desc', {
                            value: Math.round(intervalSeconds / 60),
                          })
                        : translate('scheduledTasks.tpl6Desc', {
                            value: Math.round(intervalSeconds / 3600),
                          })}
                  </span>
                </div>
                <div className="st-quick-intervals">
                  {[
                    { label: translate('scheduledTasks.t42'), val: 30 },
                    { label: translate('scheduledTasks.t43'), val: 60 },
                    { label: translate('scheduledTasks.t44'), val: 300 },
                    { label: translate('scheduledTasks.t45'), val: 900 },
                    { label: translate('scheduledTasks.t46'), val: 3600 },
                    { label: translate('scheduledTasks.t47'), val: 21600 },
                    { label: translate('scheduledTasks.t48'), val: 86400 },
                  ].map((qi) => (
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
                <label className="st-field-label">{translate('scheduledTasks.t38')}</label>
                <Input
                  value={cronExpression}
                  onChange={(e) => setCronExpression(e.target.value)}
                  placeholder="0 */2 * * *"
                  size="middle"
                />
                <div className="st-quick-intervals">
                  {[
                    { label: translate('scheduledTasks.t49'), expr: '*/5 * * * *' },
                    { label: translate('scheduledTasks.t50'), expr: '0 */1 * * *' },
                    { label: translate('scheduledTasks.t51'), expr: '0 9 * * MON-FRI' },
                    { label: translate('scheduledTasks.t52'), expr: '0 0 1 * *' },
                  ].map((qc) => (
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
                <label className="st-field-label">{translate('scheduledTasks.t124')}</label>
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
              <h3>{translate('scheduledTasks.t125')}</h3>
              <p>{translate('scheduledTasks.t126Desc')}</p>
            </div>
          </div>
          <div className="st-form-section-body">
            <div className="st-form-subject-row">
              <div className="st-form-field-row">
                <div className="st-form-field st-form-field--half">
                  <label className="st-field-label">
                    <Icons.User style={{ marginRight: 4, fontSize: 13, verticalAlign: -1 }} />
                    Agent
                  </label>
                  <Select
                    {...(agentId ? { value: agentId } : {})}
                    onChange={handleAgentChange}
                    placeholder={translate('scheduledTasks.t78')}
                    allowClear
                    showSearch
                    disabled={teamId !== ''}
                    filterOption={(input: string, option: any) =>
                      (option?.props?.children ?? '').toLowerCase().includes(input.toLowerCase())
                    }
                    options={agentOptions}
                    size="middle"
                    notFoundContent={translate('scheduledTasks.t79')}
                  />
                </div>
                <div className="st-form-field st-form-field--half">
                  <label className="st-field-label">
                    <Icons.Users style={{ marginRight: 4, fontSize: 13, verticalAlign: -1 }} />
                    Team
                  </label>
                  <Select
                    {...(teamId ? { value: teamId } : {})}
                    onChange={handleTeamChange}
                    placeholder={translate('scheduledTasks.t80')}
                    allowClear
                    showSearch
                    disabled={agentId !== ''}
                    filterOption={(input: string, option: any) =>
                      (option?.props?.children ?? '').toLowerCase().includes(input.toLowerCase())
                    }
                    options={teamOptions}
                    size="middle"
                    notFoundContent={translate('scheduledTasks.t81')}
                  />
                </div>
              </div>
              <div className="st-form-hint">{subjectHint}</div>
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
                  placeholder={translate('scheduledTasks.t82')}
                  allowClear
                  showSearch
                  filterOption={(input: string, option: any) =>
                    (option?.props?.children ?? '').toLowerCase().includes(input.toLowerCase())
                  }
                  options={modelOptions}
                  size="middle"
                  notFoundContent={translate('scheduledTasks.t83')}
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
                  placeholder={translate('scheduledTasks.t84')}
                  allowClear
                  showSearch
                  filterOption={(input: string, option: any) =>
                    (option?.props?.children ?? '').toLowerCase().includes(input.toLowerCase())
                  }
                  options={workspaceOptions}
                  size="middle"
                  notFoundContent={translate('scheduledTasks.t85')}
                />
              </div>
            </div>

            <div className="st-form-field">
              <label className="st-field-label">
                {translate('scheduledTasks.t127')} <span className="st-required">*</span>
              </label>
              <TextArea
                value={promptTemplate}
                onChange={(e) => setPromptTemplate(e.target.value)}
                placeholder={translate('scheduledTasks.t86Desc')}
                rows={6}
                autoSize={{ minRows: 4, maxRows: 12 }}
              />
              <div className="st-form-hint">
                {translate('scheduledTasks.tpl30Desc')} {'{{interval}}'}
              </div>
            </div>
          </div>
        </div>

        {/* ── Section 4: Advanced Settings ─────────────────────────────── */}
        <div className="st-form-section">
          <div className="st-form-section-header">
            <div className="st-section-badge">04</div>
            <div className="st-section-header-text">
              <h3>{translate('scheduledTasks.t128')}</h3>
              <p>{translate('scheduledTasks.t129')}</p>
            </div>
          </div>
          <div className="st-form-section-body">
            <div className="st-form-field-row">
              <div className="st-form-field st-form-field--third">
                <label className="st-field-label">
                  <Icons.Settings style={{ marginRight: 4, fontSize: 13, verticalAlign: -1 }} />
                  {translate('scheduledTasks.t130')}
                </label>
                <InputNumber
                  value={timeoutSeconds}
                  onChange={(v) => setTimeoutSeconds(typeof v === 'number' ? v : 300)}
                  min={10}
                  max={7200}
                  suffix={translate('scheduledTasks.t77')}
                  style={{ width: '100%' }}
                  size="middle"
                />
              </div>
              <div className="st-form-field st-form-field--third">
                <label className="st-field-label">{translate('scheduledTasks.t131')}</label>
                <InputNumber
                  value={maxRetries}
                  onChange={(v) => setMaxRetries(typeof v === 'number' ? v : 0)}
                  min={0}
                  max={10}
                  suffix={translate('scheduledTasks.t87')}
                  style={{ width: '100%' }}
                  size="middle"
                />
              </div>
              <div className="st-form-field st-form-field--third">
                <label className="st-field-label">
                  <Icons.Zap style={{ marginRight: 4, fontSize: 13, verticalAlign: -1 }} />
                  {translate('scheduledTasks.t105')}
                </label>
                <Select
                  value={permissionMode}
                  onChange={(v) => setPermissionMode(v as string)}
                  options={[
                    { label: translate('scheduledTasks.t53'), value: 'auto' },
                    { label: translate('scheduledTasks.t54'), value: 'bypass' },
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
        : t.intervalSeconds < 60
          ? translate('scheduledTasks.tpl4Desc', { value: t.intervalSeconds })
          : t.intervalSeconds < 3600
            ? translate('scheduledTasks.tpl5Desc', { value: Math.round(t.intervalSeconds / 60) })
            : t.intervalSeconds < 86400
              ? translate('scheduledTasks.tpl6Desc', {
                  value: Math.round(t.intervalSeconds / 3600),
                })
              : translate('scheduledTasks.tpl7Desc', {
                  value: Math.round(t.intervalSeconds / 86400),
                })
    case 'cron':
      return t.cronExpression ?? 'Cron'
    case 'once':
      return t.runAt ?? translate('scheduledTasks.t55')
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
    () => payload.tasks.filter((t) => existingNames.has(t.name)).length,
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
          <span>{translate('scheduledTasks.t132')}</span>
        </div>
      }
      visible
      onCancel={onClose}
      maskClosable={!submitting}
      closable={!submitting}
      style={{ width: 680 }}
      footer={
        <div className="st-import-modal-footer">
          <Button type="text" onClick={onClose} disabled={submitting}>
            {translate('scheduledTasks.t113')}
          </Button>
          <Button
            type="primary"
            onClick={() => void handleConfirm()}
            disabled={submitting || payload.tasks.length === 0}
            loading={submitting}
          >
            {submitting
              ? translate('scheduledTasks.t56')
              : translate('scheduledTasks.tpl21Desc', { count: payload.tasks.length })}
          </Button>
        </div>
      }
    >
      <div className="st-import-modal-body">
        {/* 文件元信息 */}
        <div className="st-import-meta">
          <div>
            <span className="muted">{translate('scheduledTasks.t133')}</span>
            <span className="mono-sm" title={filePath}>
              {filePath}
            </span>
          </div>
          <div>
            <span className="muted">{translate('scheduledTasks.t134')}</span>
            <span className="mono-sm">v{payload.version}</span>
          </div>
          <div>
            <span className="muted">{translate('scheduledTasks.t135')}</span>
            <span className="mono-sm">{exportedAt}</span>
          </div>
          <div>
            <span className="muted">{translate('scheduledTasks.t136')}</span>
            <span className="mono-sm">{payload.exportedBy}</span>
          </div>
          <div>
            <span className="muted">{translate('scheduledTasks.t137')}</span>
            <span className="mono-sm">
              <strong>{payload.tasks.length}</strong>
            </span>
          </div>
          {conflictCount > 0 && (
            <div className="st-import-conflict-warn">
              <Icons.AlertTriangle style={{ fontSize: 12, color: 'var(--color-warning-6)' }} />
              {translate('scheduledTasks.tpl31Desc', { count: conflictCount })}
            </div>
          )}
        </div>

        {/* 冲突模式选择 */}
        <div className="st-import-mode-row">
          <span className="muted">{translate('scheduledTasks.t138')}</span>
          <Radio.Group
            value={mode}
            onChange={(e) => setMode(e.target.value as 'replace' | 'merge')}
            disabled={submitting}
            size="middle"
          >
            <Radio value="merge">
              <strong>{translate('scheduledTasks.t139')}</strong>
              <span className="muted"> {translate('scheduledTasks.t140Desc')}</span>
            </Radio>
            <Radio value="replace">
              <strong>{translate('scheduledTasks.t141')}</strong>
              <span className="muted"> {translate('scheduledTasks.t142Desc')}</span>
            </Radio>
          </Radio.Group>
        </div>

        {/* 任务列表 */}
        <div className="st-import-list-header">
          <span>{translate('scheduledTasks.t143')}</span>
          <span>{translate('scheduledTasks.t144')}</span>
          <span>Agent / Team</span>
          <span>{translate('scheduledTasks.t145')}</span>
        </div>
        <div className="st-import-list">
          {payload.tasks.length === 0 && (
            <div className="st-import-empty">{translate('scheduledTasks.t146')}</div>
          )}
          {payload.tasks.map((t, idx) => {
            const conflict = existingNames.has(t.name)
            return (
              <div
                key={`${t.name}-${idx}`}
                className={`st-import-list-row${conflict ? ' conflict' : ''}`}
              >
                <span className="cell-name" title={t.name}>
                  {t.name}
                </span>
                <span className="cell-trigger" title={triggerLabel(t)}>
                  {triggerLabel(t)}
                </span>
                <span className="cell-agent" title={t.agentId ?? t.teamId ?? '-'}>
                  {t.agentId
                    ? `Agent · ${t.agentId.slice(0, 6)}`
                    : t.teamId
                      ? `Team · ${t.teamId.slice(0, 6)}`
                      : '-'}
                </span>
                <span className="cell-status">
                  {conflict ? (
                    <Tag size="middle" color="orange">
                      {mode === 'replace'
                        ? translate('scheduledTasks.t57')
                        : translate('scheduledTasks.t58')}
                    </Tag>
                  ) : (
                    <Tag size="middle" color="green">
                      {translate('scheduledTasks.t147')}
                    </Tag>
                  )}
                </span>
              </div>
            )
          })}
        </div>

        <div className="st-import-tip">
          <Icons.AlertTriangle style={{ fontSize: 12 }} />
          <span>
            {translate('scheduledTasks.t148')} <strong>disabled = true</strong>
            {translate('scheduledTasks.tpl32LongDesc')}
          </span>
        </div>
      </div>
    </Modal>
  )
}
