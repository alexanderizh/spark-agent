/**
 * @module wiki-context-budget.test
 *
 * 服务端强制裁剪单测（S0 契约 + S1 扩展）：
 * 摘要截断 / 正文分页与续读 / top-K 钳制 / 硬上限兜底 / 单轮总闸，
 * 常驻 token 断言（S0 三件套基线、S1 全量、工具瘦身档位），
 * 以及 S1 的挂载计划（核心 / 低频二级入口）与工具集契约。
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
  measureS1ResidentTokens,
  measureSlimResidentTokens,
  measureFullResidentTokens,
  resolveWikiMountPlan,
  WIKI_READ_TOOL_NAMES,
  WIKI_ALL_READ_TOOL_NAMES,
  WIKI_WRITE_TOOL_NAMES,
  WIKI_S3_TOOL_NAMES,
  WIKI_CORE_TOOL_NAMES,
  WIKI_DEFERRED_TOOL_NAMES,
  WIKI_ADMIN_TOOL_NAME,
  WIKI_S0_TOOL_NAMES,
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

  it('工具瘦身把常驻 token 压回 ≤800 软目标（默认全量则放宽到 1200）', () => {
    const full = measureS1ResidentTokens()
    const slim = measureSlimResidentTokens()
    // eslint-disable-next-line no-console
    console.log(`[wiki-budget] S1 full=${full} slim=${slim}`)
    // 瘦身必须真的省 token（否则这个开关就是装饰）
    expect(slim).toBeLessThan(full)
    // 瘦身档位（首屏四件套 + 空间列表 + 二级入口）必须落在 §8.3 的 800 软目标内
    expect(slim).toBeLessThanOrEqual(800)
    // 默认全量档位超出软目标是有意的取舍：能力优先，超限由设置里的瘦身开关兜底。
    // 上限 1200 是「两倍警戒线」前的硬线，超过说明必须再精简描述而不是继续加工具。
    expect(full).toBeLessThanOrEqual(1200)
  })

  it('契约完整性：工具定义齐备、命名规范、读写集互斥', () => {
    const names = WIKI_TOOL_DEFINITIONS.map((d) => d.name)
    // 10 个 S1 工具 + S3 的技能提议 + 二级入口
    expect(names).toHaveLength(12)
    expect(names).toContain('wiki_propose_skill')
    expect(names).toContain(WIKI_ADMIN_TOOL_NAME)
    expect(WIKI_S0_TOOL_NAMES).toHaveLength(3)
    expect(WIKI_ALL_READ_TOOL_NAMES).toHaveLength(5)
    expect(WIKI_WRITE_TOOL_NAMES).toHaveLength(5)
    expect(WIKI_S3_TOOL_NAMES).toHaveLength(1)
    expect(WIKI_READ_TOOL_NAMES).toEqual(WIKI_ALL_READ_TOOL_NAMES)
    for (const n of [
      ...WIKI_ALL_READ_TOOL_NAMES,
      ...WIKI_WRITE_TOOL_NAMES,
      ...WIKI_S3_TOOL_NAMES,
    ]) {
      expect(names).toContain(n)
    }
    // 读写集互斥（同一个工具不可能既是免审批读、又是需审批写）
    const overlap = WIKI_ALL_READ_TOOL_NAMES.filter((n) =>
      (WIKI_WRITE_TOOL_NAMES as readonly string[]).includes(n),
    )
    expect(overlap).toEqual([])
    // L0 提示词含递进规则关键词（行为契约写入）
    expect(WIKI_L0_PROMPT).toContain('wiki_search')
    expect(WIKI_L0_PROMPT).toContain('不要一次读多页')
  })

  it('挂载计划：默认全量；工具瘦身只留核心 + 二级入口（能力不丢失）', () => {
    const full = resolveWikiMountPlan(false)
    expect(full.admin).toBe(false)
    // 5 只读 + 5 写 + S3 技能提议（低频但首屏可见，默认能力优先）
    expect(full.toolNames).toHaveLength(11)
    expect(full.toolNames).toContain('wiki_delete')
    expect(full.toolNames).toContain('wiki_propose_skill')
    expect(full.toolNames).not.toContain(WIKI_ADMIN_TOOL_NAME)
    expect(full.toolNames).toEqual(
      expect.arrayContaining([...WIKI_CORE_TOOL_NAMES, ...WIKI_DEFERRED_TOOL_NAMES]),
    )

    const slim = resolveWikiMountPlan(true)
    expect(slim.admin).toBe(true)
    expect(slim.toolNames).toEqual([...WIKI_CORE_TOOL_NAMES])
    // 低频工具从首屏 schema 消失，但仍在二级入口的可达集合里（能力不丢）
    for (const n of WIKI_DEFERRED_TOOL_NAMES) {
      expect(slim.toolNames).not.toContain(n)
    }
    const union = [...slim.toolNames, ...WIKI_DEFERRED_TOOL_NAMES].sort()
    expect(union).toEqual([...full.toolNames].sort())
  })

  it('常驻 token 账本：S0 基线 < S1 全量（S1 增量来自新增 4 个只读/写工具）', () => {
    // measureFullResidentTokens 含全部已冻结契约工具（S1 集 + S3 技能提议），
    // 作为预算上界参照：必须 < 1600（超过即强制启用工具瘦身）
    const total = measureFullResidentTokens()
    // eslint-disable-next-line no-console
    console.log(`[wiki-budget] all-contract resident tokens = ${total}`)
    expect(total).toBeLessThan(1600)
    expect(measureS0ResidentTokens()).toBeLessThan(measureS1ResidentTokens())
  })
})
