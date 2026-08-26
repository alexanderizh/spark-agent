import { describe, expect, it } from 'vitest'

import type { ProviderModelSchedule } from '@spark/protocol'

import {
  candidateModelIdsForRow,
  firstUnusedModelId,
  groupModelSchedules,
  ungroupModelSchedules,
  type ModelScheduleGroupRow,
} from './providerModelScheduleGroups'

const base = {
  enabled: true,
  days: [1, 2, 3],
  startMinute: 600,
  endMinute: 720,
}

describe('groupModelSchedules', () => {
  it('把窗口配置完全相同的条目合并为一行', () => {
    const schedules: ProviderModelSchedule[] = [
      { modelId: 'm1', ...base },
      { modelId: 'm2', ...base },
    ]
    const rows = groupModelSchedules(schedules)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toEqual({ modelIds: ['m1', 'm2'], ...base })
  })

  it('days 顺序不同但集合相同仍合并；开关不同不合并', () => {
    const schedules: ProviderModelSchedule[] = [
      { modelId: 'm1', ...base },
      { modelId: 'm2', ...base, days: [3, 1, 2] },
      { modelId: 'm3', ...base, enabled: false },
    ]
    const rows = groupModelSchedules(schedules)
    expect(rows).toHaveLength(2)
    expect(rows[0].modelIds).toEqual(['m1', 'm2'])
    expect(rows[1].modelIds).toEqual(['m3'])
  })

  it('ungroup 后逐模型展开且同模型去重', () => {
    const rows = [
      { modelIds: ['m1', 'm2', 'm1'], ...base },
      { modelIds: ['m3'], ...base, enabled: false },
    ]
    expect(ungroupModelSchedules(rows)).toEqual([
      { modelId: 'm1', ...base },
      { modelId: 'm2', ...base },
      { modelId: 'm3', ...base, enabled: false },
    ])
  })

  it('group → ungroup 往返保持数据（同配置模型合并）', () => {
    const schedules: ProviderModelSchedule[] = [
      { modelId: 'a', ...base },
      { modelId: 'b', ...base },
      { modelId: 'c', ...base, endMinute: 800 },
    ]
    expect(ungroupModelSchedules(groupModelSchedules(schedules))).toEqual(schedules)
  })
})

describe('candidateModelIdsForRow / firstUnusedModelId', () => {
  const rows: ModelScheduleGroupRow[] = [
    { modelIds: ['m1', 'm2'], ...base },
    { modelIds: ['m3'], ...base, enabled: false },
  ]

  it('行候选 = 本行已选 + 未被其他行占用的模型', () => {
    expect(candidateModelIdsForRow(rows[0], ['m1', 'm2', 'm3', 'm4', 'm5'], rows)).toEqual([
      'm1',
      'm2',
      'm4',
      'm5',
    ])
  })

  it('firstUnusedModelId 返回第一个未占用模型；全占用返回 undefined', () => {
    expect(firstUnusedModelId(['m1', 'm3', 'm9'], rows)).toBe('m9')
    expect(firstUnusedModelId(['m1', 'm2', 'm3'], rows)).toBeUndefined()
  })
})
