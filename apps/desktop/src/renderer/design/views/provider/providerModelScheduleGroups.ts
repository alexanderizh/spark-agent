// 定时禁用时段编辑行的分组/展开纯函数。
// 存储层一条 schedule 绑定一个模型（@spark/protocol 契约，向后兼容）；
// 编辑 UI 允许一行绑定多个模型：配置（开关/周几/起止时间）完全相同的条目合并为一行，
// 保存时再按模型展开回逐条 schedule。

import type { ProviderModelSchedule } from '@spark/protocol'

/** 编辑行：一组共享相同窗口配置的模型。 */
export interface ModelScheduleGroupRow {
  modelIds: string[]
  enabled: boolean
  days: number[]
  startMinute: number
  endMinute: number
}

function scheduleWindowKey(schedule: ProviderModelSchedule): string {
  return `${schedule.enabled ? 1 : 0}|${[...schedule.days].sort((a, b) => a - b).join(',')}|${schedule.startMinute}|${schedule.endMinute}`
}

/**
 * 把逐条 schedule 按窗口配置分组为编辑行；保持原有出现顺序，
 * 同组内模型按首次出现顺序排列。
 */
export function groupModelSchedules(schedules: readonly ProviderModelSchedule[]): ModelScheduleGroupRow[] {
  const rows: ModelScheduleGroupRow[] = []
  const keyToRow = new Map<string, ModelScheduleGroupRow>()
  for (const schedule of schedules) {
    const key = scheduleWindowKey(schedule)
    const existing = keyToRow.get(key)
    if (existing && !existing.modelIds.includes(schedule.modelId)) {
      existing.modelIds.push(schedule.modelId)
      continue
    }
    if (existing) continue
    const row: ModelScheduleGroupRow = {
      modelIds: [schedule.modelId],
      enabled: schedule.enabled,
      days: [...schedule.days],
      startMinute: schedule.startMinute,
      endMinute: schedule.endMinute,
    }
    rows.push(row)
    keyToRow.set(key, row)
  }
  return rows
}

/** 把编辑行展开回逐条 schedule（行序 × 行内模型序）。 */
export function ungroupModelSchedules(rows: readonly ModelScheduleGroupRow[]): ProviderModelSchedule[] {
  const out: ProviderModelSchedule[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    for (const modelId of row.modelIds) {
      if (seen.has(modelId)) continue
      seen.add(modelId)
      out.push({
        modelId,
        enabled: row.enabled,
        days: [...row.days],
        startMinute: row.startMinute,
        endMinute: row.endMinute,
      })
    }
  }
  return out
}

/** 行内可绑定的候选模型：未被任何行占用 + 当前行已选。 */
export function candidateModelIdsForRow(
  row: ModelScheduleGroupRow,
  allModelIds: readonly string[],
  rows: readonly ModelScheduleGroupRow[],
): string[] {
  const occupied = new Set(rows.flatMap((r) => (r === row ? [] : r.modelIds)))
  return [
    ...row.modelIds,
    ...allModelIds.filter((id) => !occupied.has(id) && !row.modelIds.includes(id)),
  ]
}

/** 第一个未被任何行占用的模型；全部已占用时返回 undefined。 */
export function firstUnusedModelId(
  allModelIds: readonly string[],
  rows: readonly ModelScheduleGroupRow[],
): string | undefined {
  const occupied = new Set(rows.flatMap((row) => row.modelIds))
  return allModelIds.find((id) => !occupied.has(id))
}
