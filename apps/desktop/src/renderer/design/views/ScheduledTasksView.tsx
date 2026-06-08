/**
 * ScheduledTasksView — 定时任务管理主视图
 *
 * 布局：左侧任务列表 + 右侧详情面板
 * 支持筛选、搜索、新建/编辑/删除/启用/禁用/立即执行
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Button, Input, Switch, Tag, Badge, Spin, Empty,
  Select, InputNumber, Form, Space, Popconfirm,
  Message, Tooltip,
} from '@arco-design/web-react'
import {
  IconPlus, IconSearch, IconPlayArrow, IconEdit,
  IconDelete, IconClockCircle, IconExclamationCircle, IconCheckCircle,
  IconCloseCircle, IconLoading, IconSync, IconSchedule, IconThunderbolt,
} from '@arco-design/web-react/icon'
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

function statusColor(status: string): string {
  switch (status) {
    case 'running': return 'arcoblue'
    case 'idle': return 'green'
    case 'disabled': return 'gray'
    case 'error': return 'red'
    default: return 'gray'
  }
}

function executionStatusIcon(status: string): React.ReactNode {
  switch (status) {
    case 'completed': return <IconCheckCircle style={{ color: 'var(--color-success-6)' }} />
    case 'failed':
    case 'timeout': return <IconCloseCircle style={{ color: 'var(--color-danger-6)' }} />
    case 'running': return <IconLoading style={{ color: 'var(--color-primary-6)' }} spin />
    case 'cancelled': return <IconExclamationCircle style={{ color: 'var(--color-warning-6)' }} />
    default: return null
  }
}

async function ipcInvoke(channel: string, params?: Record<string, unknown>): Promise<any> {
  return (window.spark as any)?.invoke?.(channel, params ?? {})
}

// ─── Main Component ─────────────────────────────────────────────────────────

export function ScheduledTasksView() {
  const [tasks, setTasks] = useState<ScheduledTaskItem[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [filter, setFilter] = useState<'all' | 'enabled' | 'disabled' | 'error'>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editingTask, setEditingTask] = useState<ScheduledTaskItem | null>(null)
  const [executions, setExecutions] = useState<TaskExecutionItem[]>([])
  const [refreshKey, setRefreshKey] = useState(0)

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

  useEffect(() => {
    void loadTasks()
  }, [loadTasks, refreshKey])

  // Auto-refresh every 10s for countdown updates
  useEffect(() => {
    const timer = setInterval(() => setRefreshKey(k => k + 1), 10000)
    return () => clearInterval(timer)
  }, [])

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
      Message.success(enabled ? '任务已启用' : '任务已禁用')
    } catch (err) {
      Message.error(`操作失败: ${err}`)
    }
  }, [])

  const handleRunNow = useCallback(async (id: string) => {
    try {
      await ipcInvoke('scheduled-task:run-now', { id })
      Message.success('任务已触发执行')
      setRefreshKey(k => k + 1)
    } catch (err) {
      Message.error(`执行失败: ${err}`)
    }
  }, [])

  const handleDelete = useCallback(async (id: string) => {
    try {
      await ipcInvoke('scheduled-task:delete', { id })
      if (selectedId === id) setSelectedId(null)
      setRefreshKey(k => k + 1)
      Message.success('任务已删除')
    } catch (err) {
      Message.error(`删除失败: ${err}`)
    }
  }, [selectedId])

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
      Message.success(wasEdit ? '任务已更新' : '任务已创建')
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
          <IconClockCircle style={{ fontSize: 20, color: 'var(--primary)' }} />
          <h2>Scheduled Tasks</h2>
        </div>
        <div className="st-header-right">
          <Button type="primary" size="small" icon={<IconPlus />} onClick={handleCreate}>
            New Task
          </Button>
        </div>
      </div>

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
          prefix={<IconSearch />}
          placeholder="搜索任务..."
          size="small"
          value={searchQuery}
          onChange={setSearchQuery}
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
              {tasks.map(task => (
                <div
                  key={task.id}
                  className={`st-task-card ${selectedId === task.id ? 'selected' : ''}`}
                  onClick={() => setSelectedId(task.id)}
                >
                  <div className="st-task-card-header">
                    <div className="st-task-name-row">
                      <Badge
                        color={statusColor(task.status)}
                        dot
                        style={{ marginRight: 8 }}
                      />
                      <span className="st-task-name">{task.name}</span>
                    </div>
                    <div onClick={(e: React.MouseEvent) => e.stopPropagation()}>
                      <Switch
                        size="small"
                        checked={task.enabled}
                        onChange={(checked: boolean) => { handleToggle(task.id, checked) }}
                      />
                    </div>
                  </div>
                  <div className="st-task-meta">
                    <Tag size="small" color="orangered">{formatTriggerType(task)}</Tag>
                    {task.status === 'running' && (
                      <Tag size="small" color="blue" icon={<IconLoading spin />}>运行中</Tag>
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
              ))}
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
          <h3>{task.name}</h3>
          <Space size={4}>
            <Tooltip content="立即执行">
              <Button size="mini" type="primary" icon={<IconPlayArrow />} onClick={onRunNow} />
            </Tooltip>
            <Tooltip content="编辑">
              <Button size="mini" icon={<IconEdit />} onClick={onEdit} />
            </Tooltip>
            <Popconfirm title="确定删除此任务？" onOk={onDelete}>
              <Tooltip content="删除">
                <Button size="mini" status="danger" icon={<IconDelete />} />
              </Tooltip>
            </Popconfirm>
          </Space>
        </div>
        {task.description && <p className="st-detail-desc">{task.description}</p>}
        <div className="st-detail-tags">
          <Switch size="small" checked={task.enabled} onChange={onToggle} />
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
          <span className="st-config-label">超时</span>
          <span className="st-config-value">{task.timeoutSeconds}s</span>
          <span className="st-config-label">重试</span>
          <span className="st-config-value">{task.maxRetries} 次</span>
          <span className="st-config-label">上次运行</span>
          <span className="st-config-value">{task.lastRunAt ? new Date(task.lastRunAt).toLocaleString() : '-'}</span>
        </div>
        {task.lastError && (
          <div className="st-detail-error">
            <IconExclamationCircle style={{ color: 'var(--color-danger-6)', marginRight: 4 }} />
            {task.lastError}
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
                    <Tooltip content={`Session: ${ex.sessionId.slice(0, 8)}...`}>
                      <Tag size="small" color="gray">会话</Tag>
                    </Tooltip>
                  )}
                  {ex.error && (
                    <Tooltip content={ex.error}>
                      <Tag size="small" color="red">错误</Tag>
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
  const [tags, setTags] = useState<string[]>(task?.tags ?? [])
  const [enabledOnCreate, setEnabledOnCreate] = useState(true)

  const canSave = name.trim().length > 0 && promptTemplate.trim().length > 0

  const handleSave = async () => {
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
        timeoutSeconds,
        maxRetries,
        tags,
        enabled: enabledOnCreate,
      }
      if (isEdit) {
        await ipcInvoke('scheduled-task:update', { id: task!.id, ...payload })
      } else {
        await ipcInvoke('scheduled-task:create', payload)
      }
      onClose(true)
    } catch (err) {
      Message.error(`保存失败: ${err}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="st-form-page">
      {/* Page Header */}
      <div className="st-form-page-header">
        <div className="st-form-page-title">
          <Button
            type="text"
            size="small"
            icon={<IconCloseCircle />}
            onClick={() => onClose(false)}
          />
          <div className="st-form-page-title-text">
            <span className="st-form-page-subtitle">CREATE AUTOMATION</span>
            <h2>{isEdit ? '编辑定时任务' : '新建定时任务'}</h2>
          </div>
        </div>
        <div className="st-form-page-actions">
          <Button onClick={() => onClose(false)}>取消</Button>
          <Button type="primary" loading={saving} disabled={!canSave} onClick={handleSave}>
            {isEdit ? '保存修改' : '创建任务'}
          </Button>
        </div>
      </div>

      {/* Form Body */}
      <div className="st-form-page-body">
        {/* Section 1: 基础信息 */}
        <div className="st-form-section">
          <div className="st-form-section-header">
            <h3>基础信息</h3>
            <p>先把任务的名字、用途和标签定清楚</p>
          </div>
          <Form layout="vertical" className="st-form-section-body">
            <Form.Item label={<><span style={{ color: 'var(--color-danger-6)' }}>* </span>任务名称</>}>
              <Input value={name} onChange={setName} placeholder="例如：每日代码审查" />
            </Form.Item>
            <Form.Item label="描述">
              <Input.TextArea value={description} onChange={setDescription} placeholder="补充任务目标、产出格式和注意事项" rows={3} />
            </Form.Item>
            <Form.Item label="标签">
              <Select
                mode="tags"
                value={tags}
                onChange={(v) => setTags(v as string[])}
                placeholder="选择标签"
              />
            </Form.Item>
            <Form.Item label="创建后立即启用">
              <div className="st-form-switch-row">
                <Switch checked={enabledOnCreate} onChange={setEnabledOnCreate} />
                <span className="st-form-switch-hint">任务创建后会进入调度</span>
              </div>
            </Form.Item>
          </Form>
        </div>

        {/* Section 2: 调度策略 */}
        <div className="st-form-section">
          <div className="st-form-section-header">
            <h3>调度策略</h3>
            <p>决定它何时运行，尽量让规则一眼就能读懂</p>
          </div>
          <Form layout="vertical" className="st-form-section-body">
            <div className="st-trigger-cards">
              {([
                {
                  value: 'interval' as const,
                  icon: <IconSync />,
                  title: '固定间隔',
                  desc: '每隔固定时间自动执行',
                },
                {
                  value: 'cron' as const,
                  icon: <IconSchedule />,
                  title: 'Cron 表达式',
                  desc: '用 cron 规则精确控制时间',
                },
                {
                  value: 'once' as const,
                  icon: <IconThunderbolt />,
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
                    {triggerType === opt.value && <IconCheckCircle />}
                  </div>
                </div>
              ))}
            </div>

            {triggerType === 'interval' && (
              <Form.Item label="执行间隔（秒）">
                <InputNumber
                  value={intervalSeconds}
                  onChange={(v) => setIntervalSeconds(v ?? 3600)}
                  min={10}
                  max={86400}
                  suffix="秒"
                  style={{ width: '100%' }}
                />
                <div className="st-form-hint">
                  {intervalSeconds < 60 ? `每 ${intervalSeconds} 秒`
                    : intervalSeconds < 3600 ? `每 ${Math.round(intervalSeconds / 60)} 分钟`
                    : `每 ${Math.round(intervalSeconds / 3600)} 小时`}
                </div>
              </Form.Item>
            )}

            {triggerType === 'cron' && (
              <Form.Item label="Cron 表达式">
                <Input value={cronExpression} onChange={setCronExpression} placeholder="0 */2 * * *" />
                <div style={{ marginTop: 8 }}>
                  <Space wrap size={4}>
                    {['*/5 * * * *', '0 */1 * * *', '0 9 * * MON-FRI', '0 0 1 * *'].map(expr => (
                      <Tag
                        key={expr}
                        size="small"
                        color={cronExpression === expr ? 'blue' : 'gray'}
                        style={{ cursor: 'pointer' }}
                        onClick={() => setCronExpression(expr)}
                      >
                        {expr}
                      </Tag>
                    ))}
                  </Space>
                </div>
              </Form.Item>
            )}

            {triggerType === 'once' && (
              <Form.Item label="执行时间">
                <Input
                  type="datetime-local"
                  value={runAt}
                  onChange={setRunAt}
                />
              </Form.Item>
            )}
          </Form>
        </div>

        {/* Section 3: 执行配置 */}
        <div className="st-form-section">
          <div className="st-form-section-header">
            <h3>执行配置</h3>
            <p>指定由谁执行、用哪个模型和哪个工作区上下文</p>
          </div>
          <Form layout="vertical" className="st-form-section-body">
            <div className="st-form-row-4">
              <Form.Item label="Agent">
                <Select
                  value={agentId || ''}
                  onChange={setAgentId}
                  placeholder="选择"
                  allowClear
                />
              </Form.Item>
              <Form.Item label="Team">
                <Select
                  value={teamId || ''}
                  onChange={setTeamId}
                  placeholder="选择"
                  allowClear
                />
              </Form.Item>
              <Form.Item label="Model">
                <Select
                  value={modelId || ''}
                  onChange={setModelId}
                  placeholder="选择"
                  allowClear
                />
              </Form.Item>
              <Form.Item label="Workspace">
                <Select
                  value={workspaceId || ''}
                  onChange={setWorkspaceId}
                  placeholder="选择"
                  allowClear
                />
              </Form.Item>
            </div>
            <Form.Item label={<><span style={{ color: 'var(--color-danger-6)' }}>* </span>Prompt 模板</>}>
              <Input.TextArea
                value={promptTemplate}
                onChange={setPromptTemplate}
                placeholder="写清任务执行时需要产出的内容、格式和约束"
                rows={6}
              />
              <div className="st-form-hint">
                可用变量: {'{{date}}'}, {'{{time}}'}, {'{{taskName}}'}, {'{{executionCount}}'}, {'{{interval}}'}
              </div>
            </Form.Item>
          </Form>
        </div>
      </div>
    </div>
  )
}
