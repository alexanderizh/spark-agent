import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CalendarClock,
  ChevronLeft,
  CircleAlert,
  Clock3,
  Pencil,
  Play,
  Plus,
  Repeat2,
  Trash2,
  X,
} from 'lucide-react'
import type { ScheduledTaskItem, ScheduledTaskTriggerType } from '@spark/protocol'

import './SessionSchedulePanel.less'

type SessionScheduleTarget = {
  id: string
  title?: string | null
}

interface SessionSchedulePanelProps {
  open: boolean
  session: SessionScheduleTarget
  onClose: () => void
  onEnabledCountChange?: (count: number) => void
  onTasksChange?: () => void
}

type FormState = {
  name: string
  prompt: string
  triggerType: ScheduledTaskTriggerType
  intervalMinutes: number
  runAt: string
  cronExpression: string
  enabled: boolean
}

const EMPTY_FORM: FormState = {
  name: '',
  prompt: '',
  triggerType: 'interval',
  intervalMinutes: 30,
  runAt: '',
  cronExpression: '0 */1 * * *',
  enabled: true,
}

function parseScheduleDate(value: string | null): Date | null {
  if (value == null || value.trim() === '') return null
  const normalized = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`
  const parsed = new Date(normalized)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function formatNextRun(value: string | null): string {
  const date = parseScheduleDate(value)
  if (date == null) return '暂无下次运行'
  return `下次 ${date.toLocaleString([], {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })}`
}

function toDateTimeLocalValue(value: string | null): string {
  const date = parseScheduleDate(value)
  if (date == null) return ''
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function formatSchedule(task: ScheduledTaskItem): string {
  if (task.triggerType === 'once') {
    const date = parseScheduleDate(task.runAt)
    return date == null ? '单次任务' : `单次 · ${date.toLocaleString()}`
  }
  if (task.triggerType === 'cron') return `Cron · ${task.cronExpression ?? ''}`
  const seconds = task.intervalSeconds ?? 60
  if (seconds < 60) return `每 ${seconds} 秒`
  if (seconds < 3600) return `每 ${Math.round(seconds / 60)} 分钟`
  if (seconds < 86400) return `每 ${Math.round(seconds / 3600)} 小时`
  return `每 ${Math.round(seconds / 86400)} 天`
}

async function invoke<T>(channel: string, payload: Record<string, unknown>): Promise<T> {
  const bridge = window.spark as unknown as {
    invoke: (name: string, input: Record<string, unknown>) => Promise<unknown>
  }
  return bridge.invoke(channel, payload) as Promise<T>
}

export function SessionSchedulePanel({
  open,
  session,
  onClose,
  onEnabledCountChange,
  onTasksChange,
}: SessionSchedulePanelProps) {
  const [tasks, setTasks] = useState<ScheduledTaskItem[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editingTask, setEditingTask] = useState<ScheduledTaskItem | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)

  const loadTasks = useCallback(async () => {
    if (!open) return
    setLoading(true)
    setError(null)
    try {
      const result = await invoke<{ tasks?: ScheduledTaskItem[] }>('scheduled-task:list', {
        scope: 'session',
        sessionId: session.id,
      })
      const nextTasks = Array.isArray(result?.tasks) ? (result.tasks as ScheduledTaskItem[]) : []
      setTasks(nextTasks)
      onEnabledCountChange?.(nextTasks.filter((task) => task.enabled).length)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '计划任务加载失败')
    } finally {
      setLoading(false)
    }
  }, [onEnabledCountChange, open, session.id])

  useEffect(() => {
    queueMicrotask(() => void loadTasks())
  }, [loadTasks])

  useEffect(() => {
    if (!open) return
    const timer = window.setInterval(() => void loadTasks(), 10_000)
    return () => window.clearInterval(timer)
  }, [loadTasks, open])

  useEffect(() => {
    if (!open || window.spark?.on == null) return
    return window.spark.on('stream:scheduled-task:execution', () => void loadTasks())
  }, [loadTasks, open])

  const enabledCount = useMemo(() => tasks.filter((task) => task.enabled).length, [tasks])

  const beginCreate = () => {
    setEditingTask(null)
    setForm(EMPTY_FORM)
    setError(null)
    setShowForm(true)
  }

  const beginEdit = (task: ScheduledTaskItem) => {
    setEditingTask(task)
    setForm({
      name: task.name,
      prompt: task.promptTemplate,
      triggerType: task.triggerType,
      intervalMinutes: Math.max(1, Math.round((task.intervalSeconds ?? 1800) / 60)),
      runAt: toDateTimeLocalValue(task.runAt),
      cronExpression: task.cronExpression ?? '0 */1 * * *',
      enabled: task.enabled,
    })
    setError(null)
    setShowForm(true)
  }

  const saveTask = async () => {
    if (form.name.trim() === '' || form.prompt.trim() === '') return
    if (form.triggerType === 'once' && parseScheduleDate(form.runAt) == null) {
      setError('请选择有效的单次执行时间')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const payload = {
        name: form.name.trim(),
        promptTemplate: form.prompt.trim(),
        enabled: form.enabled,
        triggerType: form.triggerType,
        intervalSeconds:
          form.triggerType === 'interval'
            ? Math.max(10, Math.round(form.intervalMinutes * 60))
            : null,
        runAt: form.triggerType === 'once' ? new Date(form.runAt).toISOString() : null,
        cronExpression: form.triggerType === 'cron' ? form.cronExpression.trim() : null,
        scope: 'session',
        sessionId: session.id,
        concurrencyPolicy: 'queue',
      }
      if (editingTask == null) {
        await invoke<unknown>('scheduled-task:create', payload)
      } else {
        await invoke<unknown>('scheduled-task:update', { id: editingTask.id, ...payload })
      }
      setShowForm(false)
      setEditingTask(null)
      await loadTasks()
      onTasksChange?.()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '计划任务保存失败')
    } finally {
      setSaving(false)
    }
  }

  const toggleTask = async (task: ScheduledTaskItem) => {
    setError(null)
    try {
      await invoke<unknown>('scheduled-task:toggle', { id: task.id, enabled: !task.enabled })
      await loadTasks()
      onTasksChange?.()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法更新任务状态')
    }
  }

  const runTask = async (task: ScheduledTaskItem) => {
    setError(null)
    try {
      await invoke<unknown>('scheduled-task:run-now', { id: task.id })
      await loadTasks()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '立即运行失败')
    }
  }

  const deleteTask = async (task: ScheduledTaskItem) => {
    const confirmed = window.confirm(`删除计划任务“${task.name}”？`)
    if (!confirmed) return
    setError(null)
    try {
      await invoke<unknown>('scheduled-task:delete', { id: task.id })
      await loadTasks()
      onTasksChange?.()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '删除任务失败')
    }
  }

  if (!open) return null

  return (
    <div className="session-schedule-layer" role="presentation">
      <button
        type="button"
        className="session-schedule-scrim"
        aria-label="关闭计划任务面板"
        onClick={onClose}
      />
      <aside className="session-schedule-panel" aria-label="会话计划任务">
        <header className="session-schedule-head">
          <div className="session-schedule-heading">
            {showForm ? (
              <button
                type="button"
                className="session-schedule-icon-button"
                aria-label="返回任务列表"
                onClick={() => setShowForm(false)}
              >
                <ChevronLeft size={17} />
              </button>
            ) : (
              <span className="session-schedule-symbol">
                <Clock3 size={17} />
              </span>
            )}
            <div>
              <span className="session-schedule-kicker">SESSION AUTOMATION</span>
              <h2>
                {showForm ? (editingTask == null ? '新增计划任务' : '编辑计划任务') : '计划任务'}
              </h2>
            </div>
          </div>
          <button
            type="button"
            className="session-schedule-icon-button"
            aria-label="关闭"
            onClick={onClose}
          >
            <X size={17} />
          </button>
        </header>

        <div className="session-schedule-session-card">
          <span className="session-schedule-session-name">{session.title || '未命名会话'}</span>
          <span className="session-schedule-session-note">
            仅在此会话运行 · 使用当前 Agent 与模型
          </span>
        </div>

        {error != null && (
          <div className="session-schedule-error" role="alert">
            <CircleAlert size={15} />
            <span>{error}</span>
          </div>
        )}

        {showForm ? (
          <div className="session-schedule-form">
            <label>
              <span>任务名称</span>
              <input
                name="schedule-name"
                value={form.name}
                onChange={(event) =>
                  setForm((current) => ({ ...current, name: event.target.value }))
                }
                placeholder="例如：每半小时检查代理状态"
                autoFocus
              />
            </label>
            <label>
              <span>任务内容</span>
              <textarea
                name="schedule-prompt"
                value={form.prompt}
                onChange={(event) =>
                  setForm((current) => ({ ...current, prompt: event.target.value }))
                }
                placeholder="描述 Agent 到点后应该做什么、检查什么以及如何汇报。"
                rows={6}
              />
            </label>

            <fieldset>
              <legend>运行频率</legend>
              <div className="session-schedule-trigger-tabs">
                <button
                  type="button"
                  className={form.triggerType === 'interval' ? 'is-active' : ''}
                  onClick={() => setForm((current) => ({ ...current, triggerType: 'interval' }))}
                >
                  <Repeat2 size={14} /> 固定间隔
                </button>
                <button
                  type="button"
                  className={form.triggerType === 'once' ? 'is-active' : ''}
                  onClick={() => setForm((current) => ({ ...current, triggerType: 'once' }))}
                >
                  <CalendarClock size={14} /> 单次
                </button>
                <button
                  type="button"
                  className={form.triggerType === 'cron' ? 'is-active' : ''}
                  onClick={() => setForm((current) => ({ ...current, triggerType: 'cron' }))}
                >
                  Cron
                </button>
              </div>
            </fieldset>

            {form.triggerType === 'interval' && (
              <label>
                <span>每隔多少分钟</span>
                <input
                  type="number"
                  min={1}
                  max={10080}
                  value={form.intervalMinutes}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      intervalMinutes: Number(event.target.value) || 1,
                    }))
                  }
                />
              </label>
            )}
            {form.triggerType === 'once' && (
              <label>
                <span>执行时间</span>
                <input
                  type="datetime-local"
                  value={form.runAt}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, runAt: event.target.value }))
                  }
                />
              </label>
            )}
            {form.triggerType === 'cron' && (
              <label>
                <span>Cron 表达式</span>
                <input
                  value={form.cronExpression}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      cronExpression: event.target.value,
                    }))
                  }
                  placeholder="0 */1 * * *"
                />
              </label>
            )}

            <label className="session-schedule-enable-row">
              <span>
                <strong>创建后启用</strong>
                <small>会话归档时会自动暂停</small>
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={form.enabled}
                className={`session-schedule-switch${form.enabled ? ' is-on' : ''}`}
                onClick={() => setForm((current) => ({ ...current, enabled: !current.enabled }))}
              >
                <span />
              </button>
            </label>

            <div className="session-schedule-form-actions">
              <button type="button" className="is-ghost" onClick={() => setShowForm(false)}>
                取消
              </button>
              <button
                type="button"
                className="is-primary"
                disabled={saving || form.name.trim() === '' || form.prompt.trim() === ''}
                onClick={() => void saveTask()}
              >
                {saving ? '保存中…' : editingTask == null ? '创建任务' : '保存修改'}
              </button>
            </div>
          </div>
        ) : (
          <div className="session-schedule-list-view">
            <div className="session-schedule-summary">
              <span>{tasks.length} 个任务</span>
              <span>{enabledCount} 个运行中</span>
            </div>

            <div className="session-schedule-list">
              {loading ? (
                <div className="session-schedule-empty">正在加载计划任务…</div>
              ) : tasks.length === 0 ? (
                <div className="session-schedule-empty">
                  <Clock3 size={25} />
                  <strong>还没有计划任务</strong>
                  <span>设置一个时间，让 Agent 回到此会话继续工作。</span>
                </div>
              ) : (
                tasks.map((task) => (
                  <article
                    key={task.id}
                    className={`session-schedule-item${task.enabled ? '' : ' is-paused'}`}
                  >
                    <div className="session-schedule-item-main">
                      <div className="session-schedule-item-title-row">
                        <strong>{task.name}</strong>
                        <button
                          type="button"
                          role="switch"
                          aria-label={task.enabled ? '暂停任务' : '启用任务'}
                          aria-checked={task.enabled}
                          className={`session-schedule-switch${task.enabled ? ' is-on' : ''}`}
                          onClick={() => void toggleTask(task)}
                        >
                          <span />
                        </button>
                      </div>
                      <p>{task.promptTemplate}</p>
                      <div className="session-schedule-item-meta">
                        <span>{formatSchedule(task)}</span>
                        <span>{formatNextRun(task.nextRunAt)}</span>
                      </div>
                    </div>
                    <div className="session-schedule-item-actions">
                      <button type="button" title="立即运行" onClick={() => void runTask(task)}>
                        <Play size={14} />
                      </button>
                      <button type="button" title="编辑" onClick={() => beginEdit(task)}>
                        <Pencil size={14} />
                      </button>
                      <button type="button" title="删除" onClick={() => void deleteTask(task)}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </article>
                ))
              )}
            </div>

            <button type="button" className="session-schedule-add" onClick={beginCreate}>
              <Plus size={16} />
              新增任务
            </button>
          </div>
        )}
      </aside>
    </div>
  )
}
