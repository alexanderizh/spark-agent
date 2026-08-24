import { describe, expect, it } from 'vitest'
import {
  filterBlockedModelIds,
  formatScheduleWindow,
  isScheduleActiveNow,
  parseModelSchedules,
  sanitizeModelSchedules,
  scheduleBlockMessage,
  scheduledBlockedModelIds,
  type ProviderModelSchedule,
} from './provider-model-schedule.js'

// 锚点：2026-08-24 是周一（getDay()=1）。无 Z 后缀的 ISO 串按本机时区解析，与评估器的本地时间语义一致。
const MON_1430 = new Date('2026-08-24T14:30:00')
const MON_1359 = new Date('2026-08-24T13:59:59')
const MON_1400 = new Date('2026-08-24T14:00:00')
const MON_1800 = new Date('2026-08-24T18:00:00')
const MON_2300 = new Date('2026-08-24T23:00:00')
const TUE_0100 = new Date('2026-08-25T01:00:00')
const TUE_0200 = new Date('2026-08-25T02:00:00')
const TUE_0300 = new Date('2026-08-25T03:00:00')
const TUE_1430 = new Date('2026-08-25T14:30:00')
const SAT_1430 = new Date('2026-08-29T14:30:00')

const WEEKDAYS = [1, 2, 3, 4, 5]

function makeSchedule(patch: Partial<ProviderModelSchedule> = {}): ProviderModelSchedule {
  return {
    modelId: 'glm-5.3',
    enabled: true,
    days: WEEKDAYS,
    startMinute: 14 * 60,
    endMinute: 18 * 60,
    ...patch,
  }
}

describe('isScheduleActiveNow', () => {
  it('hits inside a weekday window', () => {
    expect(isScheduleActiveNow(makeSchedule(), MON_1430)).toBe(true)
  })

  it('misses before the window and on non-matching days', () => {
    expect(isScheduleActiveNow(makeSchedule(), MON_1359)).toBe(false)
    expect(isScheduleActiveNow(makeSchedule(), SAT_1430)).toBe(false)
  })

  it('treats start as inclusive and end as exclusive', () => {
    expect(isScheduleActiveNow(makeSchedule(), MON_1400)).toBe(true)
    expect(isScheduleActiveNow(makeSchedule(), MON_1800)).toBe(false)
  })

  it('ignores disabled or degenerate windows', () => {
    expect(isScheduleActiveNow(makeSchedule({ enabled: false }), MON_1430)).toBe(false)
    expect(isScheduleActiveNow(makeSchedule({ days: [] }), MON_1430)).toBe(false)
    expect(isScheduleActiveNow(makeSchedule({ endMinute: 14 * 60 }), MON_1430)).toBe(false)
    expect(isScheduleActiveNow(null as unknown as ProviderModelSchedule, MON_1430)).toBe(false)
  })

  it('handles an overnight window: evening on start day and early morning inherited from the previous day', () => {
    // 周一 22:00-次日 02:00
    const overnight = makeSchedule({ days: [1], startMinute: 22 * 60, endMinute: 2 * 60 })
    expect(isScheduleActiveNow(overnight, MON_2300)).toBe(true)
    expect(isScheduleActiveNow(overnight, TUE_0100)).toBe(true)
    expect(isScheduleActiveNow(overnight, TUE_0200)).toBe(false)
    expect(isScheduleActiveNow(overnight, TUE_0300)).toBe(false)
  })

  it('does not inherit the early-morning segment when the previous day is not selected', () => {
    // 仅周二 22:00-次日 02:00：周一深夜与周二凌晨都不属于窗口
    const overnightTue = makeSchedule({ days: [2], startMinute: 22 * 60, endMinute: 2 * 60 })
    expect(isScheduleActiveNow(overnightTue, MON_2300)).toBe(false)
    expect(isScheduleActiveNow(overnightTue, TUE_0100)).toBe(false)
  })
})

describe('scheduledBlockedModelIds / filterBlockedModelIds', () => {
  it('aggregates active schedules and keeps order when filtering', () => {
    const schedules = [
      makeSchedule({ modelId: 'glm-5.3' }),
      makeSchedule({ modelId: 'kimi-k2', enabled: false }),
      makeSchedule({ modelId: '  deepseek-v4  ' }),
    ]
    expect(scheduledBlockedModelIds(schedules, MON_1430)).toEqual(
      new Set(['glm-5.3', 'deepseek-v4']),
    )
    expect(
      filterBlockedModelIds(
        ['glm-5.3', 'claude-sonnet-5', 'kimi-k2', 'deepseek-v4'],
        schedules,
        MON_1430,
      ),
    ).toEqual(['claude-sonnet-5', 'kimi-k2'])
  })

  it('tolerates dirty input', () => {
    expect(scheduledBlockedModelIds(undefined, MON_1430).size).toBe(0)
    expect(scheduledBlockedModelIds(null, MON_1430).size).toBe(0)
    expect(
      scheduledBlockedModelIds(
        [null, {}, { modelId: '   ' }] as unknown as ProviderModelSchedule[],
        MON_1430,
      ).size,
    ).toBe(0)
    // filter 无阻塞时返回原顺序副本
    const source = ['a', 'b']
    const filtered = filterBlockedModelIds(source, [], MON_1430)
    expect(filtered).toEqual(source)
    expect(filtered).not.toBe(source)
  })
})

describe('sanitizeModelSchedules', () => {
  it('returns empty for non-array input', () => {
    expect(sanitizeModelSchedules(undefined)).toEqual([])
    expect(sanitizeModelSchedules('nope')).toEqual([])
    expect(sanitizeModelSchedules({})).toEqual([])
  })

  it('drops invalid entries and dedupes by modelId', () => {
    const result = sanitizeModelSchedules([
      null,
      'x',
      {},
      { modelId: '' },
      { modelId: 'a'.repeat(201) },
      { modelId: 'glm-5.3', days: [1, 1, 2, 9, -1], startMinute: 840, endMinute: 1080 },
      { modelId: 'glm-5.3', days: [3], startMinute: 0, endMinute: 60 },
      { modelId: 'bad-range', days: [1], startMinute: 840, endMinute: 9999 },
      { modelId: 'zero-window', days: [1], startMinute: 840, endMinute: 840 },
    ])
    expect(result).toEqual([
      { modelId: 'glm-5.3', enabled: true, days: [1, 2], startMinute: 840, endMinute: 1080 },
    ])
  })

  it('keeps explicit enabled=false and fills defaults for optional fields', () => {
    expect(
      sanitizeModelSchedules([
        { modelId: 'glm-5.3', enabled: false, startMinute: 0, endMinute: 1440 },
      ]),
    ).toEqual([{ modelId: 'glm-5.3', enabled: false, days: [], startMinute: 0, endMinute: 1440 }])
  })
})

describe('parseModelSchedules', () => {
  it('parses valid config_json', () => {
    const configJson = JSON.stringify({
      modelIds: ['glm-5.3'],
      modelSchedules: [{ modelId: 'glm-5.3', days: WEEKDAYS, startMinute: 840, endMinute: 1080 }],
    })
    expect(parseModelSchedules(configJson)).toEqual([
      { modelId: 'glm-5.3', enabled: true, days: WEEKDAYS, startMinute: 840, endMinute: 1080 },
    ])
  })

  it('returns empty for missing, malformed, or schedule-free config', () => {
    expect(parseModelSchedules(undefined)).toEqual([])
    expect(parseModelSchedules('')).toEqual([])
    expect(parseModelSchedules('{oops')).toEqual([])
    expect(parseModelSchedules('null')).toEqual([])
    expect(parseModelSchedules(JSON.stringify({ modelIds: ['glm-5.3'] }))).toEqual([])
  })
})

describe('formatScheduleWindow / scheduleBlockMessage', () => {
  it('formats contiguous days, full week, and scattered days', () => {
    expect(formatScheduleWindow(makeSchedule())).toBe('周一至周五 14:00-18:00')
    expect(formatScheduleWindow(makeSchedule({ days: [0, 1, 2, 3, 4, 5, 6] }))).toBe(
      '每天 14:00-18:00',
    )
    expect(formatScheduleWindow(makeSchedule({ days: [0, 2, 4] }))).toBe(
      '周日、周二、周四 14:00-18:00',
    )
    expect(formatScheduleWindow(makeSchedule({ days: [1, 2, 4, 5, 6] }))).toBe(
      '周一至周二、周四至周六 14:00-18:00',
    )
  })

  it('pads minutes and mentions local timezone in the block message', () => {
    expect(
      formatScheduleWindow(makeSchedule({ startMinute: 5 * 60 + 9, endMinute: 6 * 60 + 5 })),
    ).toBe('周一至周五 05:09-06:05')
    const message = scheduleBlockMessage(makeSchedule(), 'glm-5.3')
    expect(message).toContain('glm-5.3')
    expect(message).toContain('周一至周五 14:00-18:00')
    expect(message).toContain('本机时区')
  })
})

describe('boundary sanity against anchors', () => {
  it('weekday window blocks Monday afternoon but not Tuesday with weekdays-only config', () => {
    const schedule = makeSchedule()
    expect(isScheduleActiveNow(schedule, MON_1430)).toBe(true)
    expect(isScheduleActiveNow(schedule, TUE_1430)).toBe(true) // 周二同样在周一至周五内
    expect(isScheduleActiveNow(makeSchedule({ days: [1] }), TUE_1430)).toBe(false)
  })
})
