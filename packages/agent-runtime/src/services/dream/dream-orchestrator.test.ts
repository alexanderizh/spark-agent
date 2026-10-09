/**
 * @module dream-orchestrator.test
 *
 * AutoDream S1 聚焦测试：提案解析（dream-proposals 块）、终态判定、分流
 * 统计、轨级互斥与状态存储。覆盖计划 §11 的单测验收项（分流规则 / 互斥锁 /
 * 提案 schema 校验——schema 部分在 protocol dream.test.ts）。
 */

import { describe, it, expect, vi } from 'vitest'
import type { AgentEvent, DreamProposal } from '@spark/protocol'
import { validateDreamProposal } from '@spark/protocol'
import { parseDreamProposals, dispatchDreamProposals } from './dream-proposals.js'
import { resolveDreamTurnResult } from './dream-orchestrator.service.js'
import { DreamOrchestrationService } from './dream-orchestrator.service.js'
import { DreamRunStateStore } from './dream-state.js'
import type { DreamOrchestratorDeps, DreamSessionControl } from './dream-orchestrator.service.js'

function memoryProposal(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: 'memory',
    op: 'create',
    confidence: 0.9,
    rationale: '多次出现',
    sourceRefs: [{ kind: 'session', id: 's1' }],
    payload: { type: 'user', name: '偏好A', description: 'd', body: 'b' },
    ...overrides,
  }
}

describe('parseDreamProposals', () => {
  it('提取单个 dream-proposals 块并通过校验', () => {
    const text = `整理总结：发现了主题 X。

\`\`\`dream-proposals
${JSON.stringify([memoryProposal()])}
\`\`\``
    const r = parseDreamProposals(text)
    expect(r.missing).toBe(false)
    expect(r.proposals).toHaveLength(1)
    expect(r.proposals[0]?.kind).toBe('memory')
    expect(r.invalid).toHaveLength(0)
  })

  it('多块合并；坏 JSON 块计入 invalid 不影响其他块', () => {
    const text = [
      '```dream-proposals',
      JSON.stringify([memoryProposal({ op: 'update', targetId: 'm-1' })]),
      '```',
      '```dream-proposals',
      '{not json',
      '```',
    ].join('\n')
    const r = parseDreamProposals(text)
    expect(r.proposals).toHaveLength(1)
    expect(r.invalid).toHaveLength(1)
    expect(r.invalid[0]?.reason).toContain('JSON')
  })

  it('没有块时 missing=true', () => {
    const r = parseDreamProposals('普通总结，没有提案块')
    expect(r.missing).toBe(true)
    expect(r.proposals).toHaveLength(0)
  })

  it('schema 非法（缺 rationale）进 invalid', () => {
    const text = `\`\`\`dream-proposals\n${JSON.stringify([memoryProposal({ rationale: '' })])}\n\`\`\``
    const r = parseDreamProposals(text)
    expect(r.proposals).toHaveLength(0)
    expect(r.invalid).toHaveLength(1)
  })

  it('内容内嵌 ``` 不截断块（闭合围栏锚定行首）', () => {
    const p = memoryProposal({ rationale: '引用示例 ```json {"a":1}``` 见上文' })
    // JSON.stringify 单行输出；内嵌 ``` 都在同一行，只有结尾闭合围栏在行首
    const text = `\`\`\`dream-proposals\n${JSON.stringify([p])}\n\`\`\``
    const r = parseDreamProposals(text)
    expect(r.missing).toBe(false)
    expect(r.proposals).toHaveLength(1)
    expect(r.proposals[0]?.rationale).toContain('```json')
  })

  it('闭合围栏缺失（输出被截断）仍能救回提案', () => {
    const p = memoryProposal()
    const text = `\`\`\`dream-proposals\n${JSON.stringify([p])}` // 无闭合 ```
    const r = parseDreamProposals(text)
    expect(r.missing).toBe(false)
    expect(r.proposals).toHaveLength(1)
  })
})

describe('resolveDreamTurnResult（终态判定，画布同口径）', () => {
  it('isFinal assistant_message 优先且给出正文', () => {
    const events: AgentEvent[] = [
      {
        type: 'assistant_message',
        mode: 'complete',
        content: '中间消息',
        isFinal: false,
      } as AgentEvent,
      {
        type: 'assistant_message',
        mode: 'complete',
        content: '最终输出',
        isFinal: true,
      } as AgentEvent,
    ]
    const r = resolveDreamTurnResult(events)
    expect(r.terminal).toBe(true)
    expect(r.text).toBe('最终输出')
  })

  it('agent_error 直接终态报错', () => {
    const events: AgentEvent[] = [{ type: 'agent_error', message: '模型调用失败' } as AgentEvent]
    const r = resolveDreamTurnResult(events)
    expect(r.terminal).toBe(true)
    expect(r.error).toContain('模型调用失败')
  })

  it('agent_status completed 无 final 时回落最后一条 complete 消息', () => {
    const events: AgentEvent[] = [
      {
        type: 'assistant_message',
        mode: 'complete',
        content: '无标记消息',
        isFinal: false,
      } as AgentEvent,
      { type: 'agent_status', status: 'completed' } as AgentEvent,
    ]
    const r = resolveDreamTurnResult(events)
    expect(r.terminal).toBe(true)
    expect(r.text).toBe('无标记消息')
  })

  it('运行中（无终态事件）不判终', () => {
    const events: AgentEvent[] = [
      {
        type: 'assistant_message',
        mode: 'complete',
        content: '流式中间',
        isFinal: false,
      } as AgentEvent,
    ]
    expect(resolveDreamTurnResult(events).terminal).toBe(false)
  })

  it('cancelled / error 状态为终态错误', () => {
    for (const status of ['cancelled', 'error'] as const) {
      const r = resolveDreamTurnResult([{ type: 'agent_status', status } as AgentEvent])
      expect(r.terminal).toBe(true)
      expect(r.error != null).toBe(true)
    }
  })
})

/** raw → 校验后的 DreamProposal（不过校验的直接断言失败，保证测试输入合法） */
function valid(raw: Record<string, unknown>): DreamProposal {
  const check = validateDreamProposal(raw)
  if (!check.ok || check.proposal == null) {
    throw new Error(`测试输入不合法：${check.message ?? 'unknown'}`)
  }
  return check.proposal
}

describe('dispatchDreamProposals（分流统计）', () => {
  const base = {
    batchLimit: 50,
    autoApplyThresholdPct: 85,
    autoDeleteEnabled: false,
    applyProposal: vi.fn(async () => ({ outcome: 'auto-applied' as const })),
    audit: vi.fn(),
    runId: 'run-1',
  }

  it('超限丢弃计入 droppedByLimit，且不调用 sink', async () => {
    const proposals = Array.from({ length: 5 }, () => valid(memoryProposal()))
    const r = await dispatchDreamProposals({ ...base, proposals, batchLimit: 2 })
    expect(r.stats.proposals).toBe(5)
    expect(r.stats.droppedByLimit).toBe(3)
    expect(base.applyProposal).toHaveBeenCalledTimes(2)
  })

  it('sink 抛异常按 rejected-invalid 计且不中断批次', async () => {
    const applyProposal = vi.fn(async (p: DreamProposal) => {
      if (p.op === 'update') throw new Error('boom')
      return { outcome: 'pending-review' as const }
    })
    const r = await dispatchDreamProposals({
      ...base,
      applyProposal,
      proposals: [
        valid(memoryProposal()),
        valid(memoryProposal({ op: 'update', targetId: 'm-1' })),
      ],
    })
    expect(r.stats.pendingReview).toBe(1)
    expect(r.stats.rejectedInvalid).toBe(1)
  })

  it('delete 提案在未开 autoDelete 时即便高置信也走人审（sink 收到 pending-review）', async () => {
    const applyProposal = vi.fn(async () => ({ outcome: 'pending-review' as const }))
    await dispatchDreamProposals({
      ...base,
      applyProposal,
      proposals: [valid(memoryProposal({ op: 'delete', targetId: 'm-1', confidence: 1 }))],
    })
    expect(applyProposal).toHaveBeenCalledWith(
      expect.objectContaining({ op: 'delete' }),
      'pending-review',
    )
  })
})

describe('DreamOrchestrationService 互斥与门控', () => {
  function makeDeps(overrides: Partial<DreamOrchestratorDeps> = {}): DreamOrchestratorDeps {
    const sessionControl: DreamSessionControl = {
      createSession: async () => ({ sessionId: 'sess-1' }),
      submitTurn: async () => ({ turnId: 'turn-1', started: true }),
      patchSessionMetadata: () => {},
      getHistory: async () => ({ events: [], hasMore: false }),
      cancelTurn: async () => ({ cancelled: true }),
      deleteSession: async () => ({ deleted: true }),
    }
    return {
      sessionControl,
      stateStore: new DreamRunStateStore({ settingsGet: () => null, settingsSet: () => {} }),
      settingsGet: () => null,
      resolveDefaultRuntime: async () => ({ providerProfileId: 'p1', modelId: 'm1' }),
      memorySink: {
        buildOrientDigest: () => '快照',
        apply: async () => ({ outcome: 'pending-review' }),
      },
      ...overrides,
    }
  }

  it('同轨第二次 runDream 返回 busy（互斥）；异轨不阻塞', async () => {
    const deps = makeDeps()
    // getHistory 永不返回终态 → execute 挂起（测试后用 cancel 收尾避免泄漏定时器）
    const svc = new DreamOrchestrationService(deps)
    const first = svc.runDream('memory', 'manual')
    expect(first.ok).toBe(true)
    const second = svc.runDream('memory', 'manual')
    expect(second.ok).toBe(false)
    if (!second.ok) expect(second.reason).toBe('busy')
    // 异轨不受影响
    const wikiRun = svc.runDream('wiki', 'manual')
    expect(wikiRun.ok).toBe(true)
    await svc.cancel('memory')
    await svc.cancel('wiki')
    await new Promise((r) => setTimeout(r, 50))
  })

  it('schedule 触发在未开启总开关时被拒绝', () => {
    const svc = new DreamOrchestrationService(makeDeps())
    const r = svc.runDream('memory', 'schedule')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('disabled')
  })

  it('手动触发不受总开关限制（/dream 无门控）', () => {
    const svc = new DreamOrchestrationService(makeDeps())
    const r = svc.runDream('memory', 'manual')
    expect(r.ok).toBe(true)
  })
})

describe('DreamRunStateStore', () => {
  it('setState 持久化并通知订阅者；订阅可取消', () => {
    const store = new Map<string, unknown>()
    const stateStore = new DreamRunStateStore({
      settingsGet: (_c, key) => store.get(key),
      settingsSet: (_c, key, value) => {
        store.set(key, value)
      },
    })
    const seen: string[] = []
    const off = stateStore.onChange((s) => seen.push(s.status))
    stateStore.setState({
      track: 'memory',
      runId: 'r1',
      trigger: 'manual',
      status: 'running',
      phase: 'orient',
      startedAt: 1,
      updatedAt: 1,
      sessionId: null,
      stats: {
        proposals: 0,
        autoApplied: 0,
        pendingReview: 0,
        rejectedInvalid: 0,
        droppedByLimit: 0,
      },
    })
    expect(seen).toEqual(['running'])
    const restored = stateStore.getState('memory')
    expect(restored?.runId).toBe('r1')
    off()
    stateStore.setState({
      track: 'memory',
      runId: 'r1',
      trigger: 'manual',
      status: 'succeeded',
      phase: 'settle',
      startedAt: 1,
      updatedAt: 2,
      sessionId: null,
      stats: {
        proposals: 0,
        autoApplied: 0,
        pendingReview: 0,
        rejectedInvalid: 0,
        droppedByLimit: 0,
      },
    })
    expect(seen).toEqual(['running'])
    expect(stateStore.getState('memory')?.status).toBe('succeeded')
  })
})
