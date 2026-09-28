/**
 * @module wiki-context-budget.test
 *
 * S0 验收单测：服务端强制裁剪（摘要截断 / 正文分页与续读 / top-K 钳制 /
 * 硬上限兜底 / 单轮总闸）+ 常驻 token 断言（L0 + L0′ ≤ 800）。
 */

import { describe, it, expect } from 'vitest'
import {
  resolveWikiBudget,
  clampSummary,
  clipBody,
  chargeTurnWikiTokens,
  resetTurnWikiBudget,
  DEFAULT_WIKI_BUDGET,
  WIKI_BUDGET_HARD_LIMITS,
} from './wiki-context-budget.js'
import {
  measureS0ResidentTokens,
  measureFullResidentTokens,
  WIKI_READ_TOOL_NAMES,
  WIKI_ALL_READ_TOOL_NAMES,
  WIKI_WRITE_TOOL_NAMES,
  WIKI_TOOL_DEFINITIONS,
  WIKI_L0_PROMPT,
} from '../../tools/wiki-tool-contract.js'
import { estimateTokens } from '@spark/shared'

describe('WikiContextBudget（服务端强制裁剪）', () => {
  // ─── 预算档解析 ─────────────────────────────────────────────────────

  it('resolveWikiBudget：默认值 + 越界钳制到硬上限', () => {
    expect(resolveWikiBudget({})).toEqual(DEFAULT_WIKI_BUDGET)

    // 用户把 readMaxTokens 调到 100 万 → 硬上限 8000
    const bloated = resolveWikiBudget({ readMaxTokens: 1_000_000, turnTotal: 999_999 })
    expect(bloated.readMaxTokens).toBe(WIKI_BUDGET_HARD_LIMITS.readMaxTokens)
    expect(bloated.turnTotal).toBe(WIKI_BUDGET_HARD_LIMITS.turnTotal)

    // 字符串数字（settings 存储形态）容错
    const fromSettings = resolveWikiBudget({ readMaxTokens: '5000', searchLimit: '12' })
    expect(fromSettings.readMaxTokens).toBe(5000)
    expect(fromSettings.searchLimit).toBe(12)

    // 非法值回退默认
    expect(resolveWikiBudget({ searchLimit: 'abc' }).searchLimit).toBe(
      DEFAULT_WIKI_BUDGET.searchLimit,
    )
  })

  // ─── 摘要截断 ───────────────────────────────────────────────────────

  it('clampSummary：超长截断 + 省略号，短文原样', () => {
    expect(clampSummary('短摘要', 240)).toBe('短摘要')
    const long = '知'.repeat(500)
    const clamped = clampSummary(long, 240)
    expect(clamped.length).toBe(240)
    expect(clamped.endsWith('…')).toBe(true)
  })

  // ─── 正文分页 ───────────────────────────────────────────────────────

  it('clipBody：短正文一次读完（不截断）', () => {
    const body = '这是一段简短正文。'.repeat(10)
    const r = clipBody(body, DEFAULT_WIKI_BUDGET.readMaxTokens)
    expect(r.truncated).toBe(false)
    expect(r.nextOffset).toBeNull()
    expect(r.body).toBe(body)
  })

  it('clipBody：超预算分页 + nextOffset 续读无缝拼接', () => {
    // 构造显著超预算的中文正文（中文 token 密度高）
    const body = Array.from({ length: 4000 }, (_, i) => `第${i}行：知识库正文内容测试。`).join('\n')
    const page1 = clipBody(body, 300)
    expect(page1.truncated).toBe(true)
    expect(page1.nextOffset).toBeGreaterThan(0)
    expect(estimateTokens(page1.body)).toBeLessThanOrEqual(300)

    // 续读第二页，与第一页拼回后是正文前缀（不丢字、不重叠）
    const page2 = clipBody(body, 300, page1.nextOffset!)
    const rejoined = page1.body + page2.body
    expect(body.startsWith(rejoined)).toBe(true)
    expect(page2.body.length).toBeGreaterThan(0)
  })

  it('clipBody：offset 超出正文末尾返回空', () => {
    const body = '短正文'
    const r = clipBody(body, 300, 99999)
    expect(r.body).toBe('')
    expect(r.truncated).toBe(false)
  })

  // ─── 单轮总闸 ───────────────────────────────────────────────────────

  it('chargeTurnWikiTokens：预算内放行记账，超限拒绝并报已用量', () => {
    const sid = 'test-turn-gate'
    resetTurnWikiBudget(sid)
    expect(chargeTurnWikiTokens(sid, 100, 1000)).toEqual({ allowed: true })
    expect(chargeTurnWikiTokens(sid, 500, 1000)).toEqual({ allowed: true })
    // 已用 600，再注 500 超过 1000 → 拒绝
    const denied = chargeTurnWikiTokens(sid, 500, 1000)
    expect(denied.allowed).toBe(false)
    if (!denied.allowed) expect(denied.used).toBe(600)
    // 拒绝不记账（仍是 600）：450 可通过
    expect(chargeTurnWikiTokens(sid, 400, 1000)).toEqual({ allowed: true })
    resetTurnWikiBudget(sid)
    // 重置后满额可用
    expect(chargeTurnWikiTokens(sid, 1000, 1000)).toEqual({ allowed: true })
  })

  // ─── 常驻 token 断言（CI 基线） ──────────────────────────────────────

  it('S0 只读三件套常驻 token（L0 + L0′）≤ 800', () => {
    const total = measureS0ResidentTokens()
    // 输出实测值便于观测收紧（预算取值原则：先给足再按观测调整）
    // eslint-disable-next-line no-console
    console.log(`[wiki-budget] S0 resident tokens = ${total}`)
    expect(total).toBeLessThanOrEqual(800)
  })

  it('全量 11 工具常驻 token 对照（helpDisclosure 决策依据）', () => {
    const total = measureFullResidentTokens()
    // eslint-disable-next-line no-console
    console.log(`[wiki-budget] full 11-tool resident tokens = ${total}`)
    // 全量挂载允许小幅超出 800（软目标），但必须 < 1600（两倍警戒线，
    // 超过即强制启用 help 二级发现）
    expect(total).toBeLessThan(1600)
  })

  it('契约完整性：11 工具定义齐备、命名规范、读写集互斥', () => {
    const names = WIKI_TOOL_DEFINITIONS.map((d) => d.name)
    expect(names).toHaveLength(11)
    expect(WIKI_READ_TOOL_NAMES).toHaveLength(3)
    expect(WIKI_ALL_READ_TOOL_NAMES).toHaveLength(5)
    expect(WIKI_WRITE_TOOL_NAMES).toHaveLength(6)
    for (const n of [...WIKI_ALL_READ_TOOL_NAMES, ...WIKI_WRITE_TOOL_NAMES]) {
      expect(names).toContain(n)
    }
    // L0 提示词含递进规则关键词（行为契约写入）
    expect(WIKI_L0_PROMPT).toContain('wiki_search')
    expect(WIKI_L0_PROMPT).toContain('不要一次读多页')
  })
})
