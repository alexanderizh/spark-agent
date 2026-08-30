import { describe, expect, it } from 'vitest'
import { estimateTokens } from '@spark/shared'
import type { AgentEvent } from '@spark/protocol'
import {
  buildDialogueEntries,
  computeHistoryEntryTokenBudget,
  computeHistoryTokenBudget,
  formatDialogueEntriesWithinTokenBudget,
  resolveProviderContextWindowFromProviderRow,
  type DialogueEntry,
} from './session-history-helpers.js'

describe('session-history-helpers', () => {
  it('derives history budgets from the actual context window', () => {
    expect(computeHistoryTokenBudget(128_000)).toBe(38_400)
    expect(computeHistoryTokenBudget(200_000)).toBe(60_000)
    expect(computeHistoryTokenBudget(1_000_000)).toBe(100_000)
    expect(computeHistoryTokenBudget(Number.NaN)).toBe(8_000)

    expect(computeHistoryEntryTokenBudget(200_000)).toBe(1_500)
    expect(computeHistoryEntryTokenBudget(1_000_000)).toBe(4_000)
    expect(computeHistoryEntryTokenBudget(32_000)).toBe(1_000)
  })

  it('resolves a model-specific context window from a provider row', () => {
    expect(
      resolveProviderContextWindowFromProviderRow(
        {
          config_json: JSON.stringify({
            supportsMillionContext: false,
            contextWindow: 400_000,
            modelContextWindows: { 'glm-5': 1_000_000 },
          }),
        },
        'glm-5',
      ),
    ).toBe(1_000_000)
    expect(
      resolveProviderContextWindowFromProviderRow(
        {
          config_json: JSON.stringify({
            supportsMillionContext: false,
            contextWindow: 400_000,
            modelContextWindows: { 'glm-5': 1_000_000 },
          }),
        },
        'deepseek-v4',
      ),
    ).toBe(400_000)
  })

  it('clips each entry before applying the total history budget', () => {
    const transcript = formatDialogueEntriesWithinTokenBudget(
      [{ role: 'User', content: `START-${'x'.repeat(100_000)}-END` }],
      { historyTokenBudget: 1_000, entryTokenBudget: 200 },
    )

    expect(transcript).toContain('START-')
    expect(transcript).toContain('-END')
    expect(estimateTokens(transcript)).toBeLessThanOrEqual(1_000)
  }, 15_000)

  it('keeps a contiguous latest window inside the strict total budget', () => {
    const entries = Array.from({ length: 20 }, (_, index) => ({
      role: (index % 2 === 0 ? 'User' : 'Assistant') as 'User' | 'Assistant',
      content: `entry-${index} ${'detail '.repeat(80)}`,
    }))
    const transcript = formatDialogueEntriesWithinTokenBudget(entries, {
      historyTokenBudget: 300,
      entryTokenBudget: 100,
    })

    expect(transcript).toContain('entry-19')
    expect(transcript).not.toContain('entry-0')
    expect(estimateTokens(transcript)).toBeLessThanOrEqual(300)
  })

  // ── 整轮块裁剪 + 滞回批量驱逐（缓存命中优化 P1-3）──────────────────

  const makeTurn = (id: string, words: number): DialogueEntry[] => [
    { role: 'User', content: `${id}-u ${'word '.repeat(words)}`, turnId: id },
    { role: 'Assistant', content: `${id}-a ${'word '.repeat(words)}`, turnId: id },
  ]

  it('trims at whole-turn boundaries: a turn is kept or dropped as a unit', () => {
    const turns = Array.from({ length: 6 }, (_, index) => makeTurn(`turn${index + 1}`, 60))
    const transcript = formatDialogueEntriesWithinTokenBudget(turns.flat(), {
      historyTokenBudget: 800,
      entryTokenBudget: 400,
      entryLimit: 40,
    })

    for (let index = 0; index < turns.length; index += 1) {
      const hasUser = transcript.includes(`turn${index + 1}-u`)
      const hasAssistant = transcript.includes(`turn${index + 1}-a`)
      // 整轮进/整轮出：不允许出现「丢了问题、留着回答」的半轮头部。
      expect(hasUser).toBe(hasAssistant)
    }
    // 头部必须落在整轮块的 User 行上。
    expect(transcript.startsWith('User: turn')).toBe(true)
    expect(estimateTokens(transcript)).toBeLessThanOrEqual(800)
  })

  it('anchors the trim head at a prefix-watermark quantum so appends hold it for multiple turns', () => {
    const budget = 2_000
    const options = { historyTokenBudget: budget, entryTokenBudget: 400, entryLimit: 200 }
    const allTurns = Array.from({ length: 32 }, (_, index) => makeTurn(`t${index + 1}`, 50))
    const headTurnOf = (turnCount: number): number => {
      const transcript = formatDialogueEntriesWithinTokenBudget(
        allTurns.slice(0, turnCount).flat(),
        options,
      )
      expect(estimateTokens(transcript)).toBeLessThanOrEqual(budget)
      const firstLine = transcript.split('\n\n')[0] ?? ''
      const match = /^User: t(\d+)-u /.exec(firstLine)
      expect(match).not.toBeNull()
      return Number(match?.[1])
    }

    // 无压力时全部保留（append-only 阶段头部 = 首轮，天然稳定）。
    expect(headTurnOf(8)).toBe(1)
    // 压力出现后头部锚定在被丢弃侧水位的量子边界（预算 2000 → 量子 500）：
    // 水位在量子区间内增长时头部不动；越过边界时一次跳多个整轮块。
    const heads = Array.from({ length: 10 }, (_, offset) => headTurnOf(21 + offset))
    const jumps: number[] = []
    for (let index = 1; index < heads.length; index += 1) {
      const previous = heads[index - 1]
      const current = heads[index]
      if (previous != null && current != null && current !== previous) {
        jumps.push(current - previous)
      }
    }
    // 确实发生了锚点收缩，但不是每轮都动（存在稳定段）。
    expect(jumps.length).toBeGreaterThan(0)
    expect(jumps.length).toBeLessThan(heads.length - 1)
    // 常规块尺寸（<< 量子）下一次跳 >= 2 个整轮块，而非逐条目滑动。
    for (const jump of jumps) expect(jump).toBeGreaterThanOrEqual(2)
  })

  it('does not collapse to the newest turn when only entry-limit pressure applies (A-1 regression)', () => {
    // memory 抽取路径参数：budget 6000 / entryLimit 30；16 轮超短对话（总量 336
    // token 远小于量子 1500）仅受条目数压力。总量不足一个量子时无锚点可用，应退化为
    // 最小可行头——整轮驱逐 1 轮保留 30 条，而不是坍缩到只剩最后一轮。
    const turns = Array.from({ length: 16 }, (_, index) => makeTurn(`t${index + 1}`, 2))
    const transcript = formatDialogueEntriesWithinTokenBudget(turns.flat(), {
      historyTokenBudget: 6_000,
      entryTokenBudget: 200,
      entryLimit: 30,
    })
    // 保留 30/32 条 entry（15/16 轮），最新轮完整。
    expect(transcript).toContain('t2-u')
    for (const id of ['t15', 't16']) {
      expect(transcript).toContain(`${id}-u`)
      expect(transcript).toContain(`${id}-a`)
    }
    expect(transcript).not.toContain('t1-u')
    expect(transcript.startsWith('User: t2-u')).toBe(true)
  })

  it('never exceeds the hard budget including inter-block separators (A-2 regression)', () => {
    // 近似后缀和未计块间 '\n\n' 分隔符；用一组贴近预算的块扫描各种总量，
    // 断言真实拼接串的精确测量始终 <= 预算。
    const options = { historyTokenBudget: 800, entryTokenBudget: 100, entryLimit: 240 }
    const entries = Array.from({ length: 40 }, (_, index) => ({
      role: (index % 2 === 0 ? 'User' : 'Assistant') as 'User' | 'Assistant',
      content: `entry-${index} ${'pad '.repeat(20)}`,
      turnId: `turn-${Math.floor(index / 2) + 1}`,
    }))
    for (let count = 1; count <= entries.length; count += 1) {
      const transcript = formatDialogueEntriesWithinTokenBudget(entries.slice(0, count), options)
      expect(estimateTokens(transcript)).toBeLessThanOrEqual(800)
    }
  })

  it('buildDialogueEntries tags entries with their turn id for block-aware trimming', () => {
    const baseEvent = (turnId: string, seq: number) => ({
      id: `evt-${seq}`,
      sessionId: 'session-1',
      turnId,
      timestamp: '2026-01-01T00:00:00.000Z',
      seq,
    })
    const events: AgentEvent[] = [
      { ...baseEvent('turn-a', 0), type: 'user_message', content: 'hello' },
      {
        ...baseEvent('turn-a', 1),
        type: 'assistant_message',
        mode: 'complete',
        content: 'hi',
        provider: 'claude',
        isFinal: true,
      },
      { ...baseEvent('turn-b', 2), type: 'user_message', content: 'next' },
      {
        ...baseEvent('turn-b', 3),
        type: 'assistant_message',
        mode: 'complete',
        content: 'reply',
        provider: 'claude',
        isFinal: true,
      },
    ]
    const entries = buildDialogueEntries(events)
    expect(entries.map((entry) => entry.turnId)).toEqual(['turn-a', 'turn-a', 'turn-b', 'turn-b'])
  })
})
