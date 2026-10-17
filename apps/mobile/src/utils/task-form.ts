/**
 * 会话定时任务表单逻辑（页面无关，pages/session-tasks 专用）。
 *
 * 职责：表单态构造/校验/与桥接请求互转/触发器文案。
 * PATCH 语义：切换触发器类型时对其它触发器字段显式传 null（桌面端
 * updateSessionTask 装配按「undefined 不写、null 清除」处理）。
 */

import type { BridgeCreateTaskInput, BridgeScheduledTask } from '../api/bridge'

export type TaskTriggerType = 'once' | 'interval' | 'cron'

export const TRIGGER_TYPE_LABELS: Record<TaskTriggerType, string> = {
  once: '单次',
  interval: '间隔',
  cron: 'Cron',
}

export interface TaskForm {
  name: string
  prompt: string
  triggerType: TaskTriggerType
  /** once：日期（YYYY-MM-DD，picker） */
  runDate: string
  /** once：时间（HH:mm，picker） */
  runTime: string
  /** interval：间隔分钟（文本输入，提交时转秒） */
  intervalMinutes: string
  /** cron：表达式（手输，服务端校验） */
  cronExpression: string
  /** 高级：超时秒（缺省 300） */
  timeoutSeconds: string
  /** 高级：失败重试次数（缺省 0） */
  maxRetries: string
}

export function emptyForm(): TaskForm {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return {
    name: '',
    prompt: '',
    triggerType: 'once',
    runDate: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    runTime: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
    intervalMinutes: '60',
    cronExpression: '',
    timeoutSeconds: '300',
    maxRetries: '0',
  }
}

/** 任务详情 → 表单态（编辑回显；数值字段回填为可编辑文本） */
export function taskToForm(task: BridgeScheduledTask): TaskForm {
  const form = emptyForm()
  form.name = task.name
  form.prompt = task.prompt
  form.triggerType = task.triggerType
  if (task.runAt != null) {
    const d = new Date(task.runAt)
    if (!Number.isNaN(d.getTime())) {
      const pad = (n: number) => String(n).padStart(2, '0')
      form.runDate = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
      form.runTime = `${pad(d.getHours())}:${pad(d.getMinutes())}`
    }
  }
  if (task.intervalSeconds != null && task.intervalSeconds > 0) {
    // 整分间隔直接回显；非整分（桌面端直建任务）保留 1 位小数，避免编辑往返漂移
    const minutes = task.intervalSeconds / 60
    form.intervalMinutes = Number.isInteger(minutes) ? String(minutes) : minutes.toFixed(1)
  }
  form.cronExpression = task.cronExpression ?? ''
  return form
}

/** 校验；返回错误消息，null = 通过 */
export function validateForm(form: TaskForm): string | null {
  if (!form.name.trim()) return '请填写任务名称'
  if (!form.prompt.trim()) return '请填写执行提示词'
  if (form.triggerType === 'once') {
    if (!form.runDate) return '请选择执行日期'
    if (!/^\d{2}:\d{2}$/.test(form.runTime)) return '请选择执行时间'
    return null
  }
  if (form.triggerType === 'interval') {
    const minutes = Number(form.intervalMinutes)
    if (!Number.isFinite(minutes) || minutes <= 0) return '间隔分钟必须大于 0'
    return null
  }
  if (!form.cronExpression.trim()) return '请填写 Cron 表达式'
  return null
}

/** 表单 → 创建请求体（once 的本地时间转 ISO；校验通过后调用） */
export function formToCreateInput(form: TaskForm): BridgeCreateTaskInput {
  const input: BridgeCreateTaskInput = {
    name: form.name.trim(),
    prompt: form.prompt.trim(),
    triggerType: form.triggerType,
  }
  if (form.triggerType === 'once') {
    input.runAt = new Date(`${form.runDate}T${form.runTime}:00`).toISOString()
  } else if (form.triggerType === 'interval') {
    input.intervalSeconds = Math.round(Number(form.intervalMinutes) * 60)
  } else {
    input.cronExpression = form.cronExpression.trim()
  }
  const timeout = Number(form.timeoutSeconds)
  if (Number.isFinite(timeout) && timeout > 0) input.timeoutSeconds = Math.round(timeout)
  const retries = Number(form.maxRetries)
  if (Number.isFinite(retries) && retries > 0) input.maxRetries = Math.round(retries)
  return input
}

/**
 * 表单 → PATCH 补丁（编辑用）。
 * 与创建的差异：对非当前触发器的字段显式传 null 清除——把「interval 改 cron」
 * 这类切换落成一次幂等写，避免桌面端残留旧 interval 继续触发。
 */
export interface TaskUpdatePatch {
  name?: string
  prompt?: string
  triggerType?: TaskTriggerType
  intervalSeconds?: number | null
  cronExpression?: string | null
  runAt?: string | null
  timeoutSeconds?: number
  maxRetries?: number
}

export function formToUpdatePatch(form: TaskForm): TaskUpdatePatch {
  const patch: TaskUpdatePatch = {
    name: form.name.trim(),
    prompt: form.prompt.trim(),
    triggerType: form.triggerType,
    intervalSeconds: null,
    cronExpression: null,
    runAt: null,
  }
  if (form.triggerType === 'once') {
    patch.runAt = new Date(`${form.runDate}T${form.runTime}:00`).toISOString()
  } else if (form.triggerType === 'interval') {
    patch.intervalSeconds = Math.round(Number(form.intervalMinutes) * 60)
  } else {
    patch.cronExpression = form.cronExpression.trim()
  }
  // 高级字段编辑态同样可改（协议 MobileBridgeUpdateScheduledTaskRequest 支持）
  const timeout = Number(form.timeoutSeconds)
  if (Number.isFinite(timeout) && timeout > 0) patch.timeoutSeconds = Math.round(timeout)
  const retries = Number(form.maxRetries)
  if (Number.isFinite(retries) && retries > 0) patch.maxRetries = Math.round(retries)
  return patch
}

/** 列表卡片触发器摘要（如「每天 09:00」级别的可读文案按字段直接拼） */
export function describeTrigger(task: BridgeScheduledTask): string {
  if (task.triggerType === 'once') {
    const d = task.runAt != null ? new Date(task.runAt) : null
    if (d != null && !Number.isNaN(d.getTime())) {
      const pad = (n: number) => String(n).padStart(2, '0')
      return `单次 · ${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`
    }
    return '单次'
  }
  if (task.triggerType === 'interval') {
    const seconds = task.intervalSeconds ?? 0
    if (seconds % 3600 === 0 && seconds >= 3600) return `每 ${seconds / 3600} 小时`
    if (seconds % 60 === 0 && seconds >= 60) return `每 ${seconds / 60} 分钟`
    return `每 ${seconds} 秒`
  }
  return `Cron · ${task.cronExpression ?? ''}`
}
