// 模型定时禁用时段（峰谷定价规避）——纯函数评估器。
// 三端共用：agent-runtime（listProviders 读取过滤 + turn 硬校验）、desktop main（边界 watcher）、
// renderer（编辑抽屉徽标）。除 IPC 边界的 zod schema 外零依赖，便于单测。

import { z } from 'zod'

/** IPC 边界校验；服务端入库前还会再走一遍 sanitizeModelSchedules。 */
export const ProviderModelScheduleSchema = z.object({
  modelId: z.string().min(1).max(200),
  enabled: z.boolean(),
  days: z.array(z.number().int().min(0).max(6)).max(7),
  startMinute: z.number().int().min(0).max(1439),
  endMinute: z.number().int().min(1).max(1440),
})

/** 单个模型的定时禁用窗口配置，持久化在 provider config_json.modelSchedules。 */
export interface ProviderModelSchedule {
  modelId: string
  /** 定时开关；false 时时段不生效。 */
  enabled: boolean
  /** 生效的星期，0-6 对齐 Date.getDay()（0=周日）；空数组视为未生效。 */
  days: number[]
  /** 起始分钟（含端），0-1439。 */
  startMinute: number
  /** 结束分钟（排他），1-1440；end < start 表示跨零点窗口（归属起始日）。 */
  endMinute: number
}

const DAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const

function isValidDay(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 6
}

function isValidMinute(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
}

/** 判定某个时刻是否落在窗口内；enabled=false / days 空 / start===end 视为不生效。 */
export function isScheduleActiveNow(schedule: ProviderModelSchedule, now?: Date): boolean {
  if (schedule == null || schedule.enabled === false) return false
  const days = schedule.days
  if (!Array.isArray(days) || days.length === 0) return false
  const { startMinute, endMinute } = schedule
  if (!isValidMinute(startMinute, 0, 1439) || !isValidMinute(endMinute, 1, 1440)) return false
  if (startMinute === endMinute) return false

  const at = now ?? new Date()
  const day = at.getDay()
  const minuteOfDay = at.getHours() * 60 + at.getMinutes()

  if (endMinute > startMinute) {
    return days.includes(day) && minuteOfDay >= startMinute && minuteOfDay < endMinute
  }
  // 跨零点窗口（end < start）：晚段属起始日当天，凌晨段继承前一日命中。
  if (days.includes(day) && minuteOfDay >= startMinute) return true
  const prevDay = (day + 6) % 7
  return days.includes(prevDay) && minuteOfDay < endMinute
}

/** 聚合当前时刻被禁用的模型 ID 集合；脏数据条目直接跳过。 */
export function scheduledBlockedModelIds(
  schedules: ProviderModelSchedule[] | undefined | null,
  now?: Date,
): Set<string> {
  const blocked = new Set<string>()
  if (!Array.isArray(schedules)) return blocked
  for (const schedule of schedules) {
    if (schedule == null || typeof schedule.modelId !== 'string') continue
    const modelId = schedule.modelId.trim()
    if (modelId.length === 0) continue
    if (isScheduleActiveNow(schedule, now)) blocked.add(modelId)
  }
  return blocked
}

/** 从模型列表中剔除当前处于禁用时段的模型，保持原有顺序。 */
export function filterBlockedModelIds(
  modelIds: readonly string[],
  schedules: ProviderModelSchedule[] | undefined | null,
  now?: Date,
): string[] {
  const blocked = scheduledBlockedModelIds(schedules, now)
  if (blocked.size === 0) return [...modelIds]
  return modelIds.filter((modelId) => !blocked.has(modelId))
}

/** 清洗未知来源（IPC payload / config_json / provider 导入）的时段数组：过滤非法条目、去重、补默认值。 */
export function sanitizeModelSchedules(raw: unknown): ProviderModelSchedule[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: ProviderModelSchedule[] = []
  for (const entry of raw) {
    if (entry == null || typeof entry !== 'object') continue
    const candidate = entry as Partial<ProviderModelSchedule> & { modelId?: unknown }
    if (typeof candidate.modelId !== 'string') continue
    const modelId = candidate.modelId.trim()
    if (modelId.length === 0 || modelId.length > 200 || seen.has(modelId)) continue

    const days = Array.isArray(candidate.days)
      ? [...new Set(candidate.days.filter(isValidDay))].sort((a, b) => a - b)
      : []
    const startMinute = isValidMinute(candidate.startMinute, 0, 1439) ? candidate.startMinute : -1
    const endMinute = isValidMinute(candidate.endMinute, 1, 1440) ? candidate.endMinute : -1
    if (startMinute < 0 || endMinute < 0) continue
    if (startMinute === endMinute) continue

    seen.add(modelId)
    out.push({
      modelId,
      enabled: candidate.enabled !== false,
      days,
      startMinute,
      endMinute,
    })
  }
  return out
}

/** 防御式解析 config_json 原文中的 modelSchedules；坏 JSON / 坏形状一律返回 []。 */
export function parseModelSchedules(
  configJson: string | null | undefined,
): ProviderModelSchedule[] {
  if (typeof configJson !== 'string' || configJson.length === 0) return []
  try {
    const parsed: unknown = JSON.parse(configJson)
    if (parsed == null || typeof parsed !== 'object') return []
    return sanitizeModelSchedules((parsed as { modelSchedules?: unknown }).modelSchedules)
  } catch {
    return []
  }
}

function formatMinute(minute: number): string {
  const h = Math.floor(minute / 60)
  const m = minute % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function dayLabel(day: number): string {
  return DAY_LABELS[day] ?? `周${day}`
}

function formatDays(days: readonly number[]): string {
  const sorted = [...new Set(days.filter(isValidDay))].sort((a, b) => a - b)
  if (sorted.length === 7) return '每天'
  const parts: string[] = []
  let i = 0
  while (i < sorted.length) {
    const startDay = sorted[i]
    if (startDay === undefined) break
    let j = i
    let prev = startDay
    let next = sorted[j + 1]
    while (next !== undefined && next === prev + 1) {
      j += 1
      prev = next
      next = sorted[j + 1]
    }
    parts.push(j > i ? `${dayLabel(startDay)}至${dayLabel(prev)}` : dayLabel(startDay))
    i = j + 1
  }
  return parts.join('、')
}

/** 窗口摘要文案，如「周一至周五 14:00-18:00」；供徽标与错误消息复用。 */
export function formatScheduleWindow(schedule: ProviderModelSchedule): string {
  return `${formatDays(schedule.days)} ${formatMinute(schedule.startMinute)}-${formatMinute(schedule.endMinute)}`
}

/** turn/画布任务发起时的完整中文报错文案。 */
export function scheduleBlockMessage(schedule: ProviderModelSchedule, modelId: string): string {
  return `模型 ${modelId} 当前处于定时禁用时段（${formatScheduleWindow(schedule)}，本机时区），请在模型选择器中切换其他模型后重试`
}
