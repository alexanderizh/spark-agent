/**
 * M4 工作流内存治理测试：state 值 / executions content 截断（头 60% + 尾 30% +
 * truncated 标记）、未超限逐字节不变、executor 快照治理集成、配置归一化。
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_WORKFLOW_MEMORY_GOVERNANCE,
  WORKFLOW_MEMORY_GOVERNANCE_RANGES,
  applyWorkflowSnapshotMemoryGovernance,
  clipWorkflowTextHeadTail,
  isWorkflowTruncatedStateValue,
  normalizeWorkflowMemoryGovernance,
  summarizeWorkflowStateKeys,
  truncateWorkflowExecutionRecord,
  truncateWorkflowStateValue,
} from './workflow-memory-governance.js'
import {
  executeWorkflowAgentPlan,
  normalizeWorkflowGraph,
  type WorkflowAgentExecutionRecord,
  type WorkflowAtomicNodeExecutionRecord,
  type WorkflowRunSnapshot,
} from '../workflow-executor.js'

describe('normalizeWorkflowMemoryGovernance', () => {
  it('空输入回落方案默认值（§六 配置表）', () => {
    expect(normalizeWorkflowMemoryGovernance(undefined)).toEqual(DEFAULT_WORKFLOW_MEMORY_GOVERNANCE)
    expect(DEFAULT_WORKFLOW_MEMORY_GOVERNANCE).toEqual({
      stateValueMaxChars: 200_000,
      executionsContentMaxChars: 20_000,
      snapshotMinIntervalMs: 2_000,
      resultInlineStateMaxChars: 2_000,
    })
  })

  it('越界值被钳制到范围（stateValueMaxChars 可调至 2MB 回退空间）', () => {
    const governed = normalizeWorkflowMemoryGovernance({
      stateValueMaxChars: 99_999_999,
      executionsContentMaxChars: 1,
      snapshotMinIntervalMs: -5,
      resultInlineStateMaxChars: 'bad',
    })
    expect(governed.stateValueMaxChars).toBe(
      WORKFLOW_MEMORY_GOVERNANCE_RANGES.stateValueMaxChars.max,
    )
    expect(governed.executionsContentMaxChars).toBe(
      WORKFLOW_MEMORY_GOVERNANCE_RANGES.executionsContentMaxChars.min,
    )
    expect(governed.snapshotMinIntervalMs).toBe(0)
    expect(governed.resultInlineStateMaxChars).toBe(
      DEFAULT_WORKFLOW_MEMORY_GOVERNANCE.resultInlineStateMaxChars,
    )
  })
})

describe('clipWorkflowTextHeadTail', () => {
  it('未超限原样返回', () => {
    expect(clipWorkflowTextHeadTail('abc', 10)).toBe('abc')
    expect(clipWorkflowTextHeadTail('abc', 3)).toBe('abc')
  })

  it('超限保留头 60% + 尾 30% 并带省略标记', () => {
    const text = Array.from({ length: 1000 }, (_, i) => String.fromCharCode(97 + (i % 26))).join('')
    const clipped = clipWorkflowTextHeadTail(text, 1000 / 10) // maxChars = 100
    const head = text.slice(0, 60)
    const tail = text.slice(-30)
    expect(clipped.startsWith(head)).toBe(true)
    expect(clipped.endsWith(tail)).toBe(true)
    expect(clipped).toContain('workflow truncated')
    // 中段确实被省略
    expect(clipped).not.toContain(text.slice(60, 970))
  })
})

describe('truncateWorkflowStateValue', () => {
  it('string 超限 → truncated 标记对象，头尾保留', () => {
    const text = 'HEAD-MARKER' + 'x'.repeat(5_000) + 'TAIL-MARKER'
    const value = truncateWorkflowStateValue(text, 2_000)
    expect(isWorkflowTruncatedStateValue(value)).toBe(true)
    if (!isWorkflowTruncatedStateValue(value)) return
    expect(value.originalChars).toBe(text.length)
    // 头 60%（1200 字符）覆盖 HEAD-MARKER，尾 30%（600）覆盖 TAIL-MARKER
    expect(value.value.startsWith('HEAD-MARKER')).toBe(true)
    expect(value.value.endsWith('TAIL-MARKER')).toBe(true)
    expect(value.value).toContain('workflow truncated')
    expect(value.value.length).toBeLessThan(text.length)
  })

  it('恰好等于阈值不截断（边界值原引用返回）', () => {
    const text = 'a'.repeat(1_000)
    expect(truncateWorkflowStateValue(text, 1_000)).toBe(text)
  })

  it('number / boolean / null / 未超限对象原样返回', () => {
    expect(truncateWorkflowStateValue(42, 100)).toBe(42)
    expect(truncateWorkflowStateValue(true, 100)).toBe(true)
    expect(truncateWorkflowStateValue(null, 100)).toBe(null)
    const small = { a: 'b' }
    expect(truncateWorkflowStateValue(small, 100)).toBe(small)
  })

  it('超限对象按序列化长度截断为标记对象', () => {
    const big = { rows: Array.from({ length: 5_000 }, (_, i) => `row-${i}`) }
    const value = truncateWorkflowStateValue(big, 1_000)
    expect(isWorkflowTruncatedStateValue(value)).toBe(true)
    expect(isWorkflowTruncatedStateValue(value) && value.originalChars).toBeGreaterThan(1_000)
  })

  it('已截断值（续跑读回）再次治理不嵌套包裹', () => {
    const text = 'z'.repeat(10_000)
    const once = truncateWorkflowStateValue(text, 1_000)
    expect(isWorkflowTruncatedStateValue(once)).toBe(true)
    if (!isWorkflowTruncatedStateValue(once)) return
    const twice = truncateWorkflowStateValue(once, 1_000)
    // 幂等：再次治理仍是单层标记对象（value 是字符串，不是嵌套 truncated 对象）
    expect(isWorkflowTruncatedStateValue(twice)).toBe(true)
    if (isWorkflowTruncatedStateValue(twice)) {
      expect(typeof twice.value).toBe('string')
      expect(isWorkflowTruncatedStateValue(twice.value)).toBe(false)
    }
  })
})

describe('truncateWorkflowExecutionRecord', () => {
  const baseRecord: WorkflowAgentExecutionRecord = {
    nodeId: 'n1',
    agentId: 'worker-1',
    instruction: 'do work',
    inputs: { upstream: 'value' },
    attempt: 2,
    state: 'completed',
    content: 'ok',
    startedAt: '2026-01-01T00:00:00.000Z',
    endedAt: '2026-01-01T00:01:00.000Z',
  }

  it('未超限原引用返回且不携带 truncated 字段', () => {
    expect(truncateWorkflowExecutionRecord(baseRecord, 100)).toBe(baseRecord)
    expect('truncated' in baseRecord).toBe(false)
  })

  it('超限 content 截断 + truncated: true，结构字段完整保留', () => {
    const long: WorkflowAgentExecutionRecord = { ...baseRecord, content: 'c'.repeat(50_000) }
    const truncated = truncateWorkflowExecutionRecord(long, 20_000)
    expect(truncated).not.toBe(long)
    expect(truncated.truncated).toBe(true)
    expect(truncated.content.length).toBeLessThan(long.content.length)
    expect(truncated.content.startsWith('c'.repeat(20_000 * 0.6 - 1))).toBe(true)
    // 结构字段逐项一致
    expect(truncated.nodeId).toBe('n1')
    expect(truncated.agentId).toBe('worker-1')
    expect(truncated.instruction).toBe('do work')
    expect(truncated.inputs).toEqual({ upstream: 'value' })
    expect(truncated.attempt).toBe(2)
    expect(truncated.state).toBe('completed')
    expect(truncated.startedAt).toBe('2026-01-01T00:00:00.000Z')
    expect(truncated.endedAt).toBe('2026-01-01T00:01:00.000Z')
  })

  it('失败记录 error 完整保留（只截 content 正文）', () => {
    const failed: WorkflowAgentExecutionRecord = {
      ...baseRecord,
      state: 'failed',
      error: { code: 'boom', message: 'x'.repeat(300) },
      content: 'f'.repeat(30_000),
    }
    const truncated = truncateWorkflowExecutionRecord(failed, 20_000)
    expect(truncated.error).toEqual({ code: 'boom', message: 'x'.repeat(300) })
    expect(truncated.truncated).toBe(true)
  })

  it('恰好等于阈值不截断', () => {
    const edge: WorkflowAgentExecutionRecord = { ...baseRecord, content: 'e'.repeat(1_000) }
    expect(truncateWorkflowExecutionRecord(edge, 1_000)).toBe(edge)
  })
})

describe('applyWorkflowSnapshotMemoryGovernance', () => {
  const smallSnapshot: WorkflowRunSnapshot = {
    status: 'working',
    state: { out1: 'small' },
    executions: [
      {
        nodeId: 'n1',
        agentId: 'w',
        instruction: '',
        inputs: {},
        attempt: 1,
        state: 'completed',
        content: 'small content',
      },
    ],
    atomicExecutions: [
      { nodeId: 'a1', kind: 'verify', state: 'completed', outputKey: 'v', content: 'ok' },
    ],
    completedNodeIds: ['n1'],
    skippedNodeIds: [],
    runningNodeIds: [],
  }

  it('未传 governance 原快照引用返回（现状语义）', () => {
    expect(applyWorkflowSnapshotMemoryGovernance(smallSnapshot, undefined)).toBe(smallSnapshot)
  })

  it('全部未超限时原快照引用返回（逐字节不变）', () => {
    expect(
      applyWorkflowSnapshotMemoryGovernance(smallSnapshot, DEFAULT_WORKFLOW_MEMORY_GOVERNANCE),
    ).toBe(smallSnapshot)
  })

  it('超限项被截断、未超限项原样、结构字段（节点集合/状态）完整', () => {
    const snapshot: WorkflowRunSnapshot = {
      ...smallSnapshot,
      state: {
        small: 'keep',
        big: 'b'.repeat(DEFAULT_WORKFLOW_MEMORY_GOVERNANCE.stateValueMaxChars + 10),
      },
      executions: [
        ...smallSnapshot.executions,
        {
          nodeId: 'n2',
          agentId: 'w2',
          instruction: '',
          inputs: {},
          attempt: 1,
          state: 'completed',
          content: 'x'.repeat(DEFAULT_WORKFLOW_MEMORY_GOVERNANCE.executionsContentMaxChars + 10),
        },
      ],
      atomicExecutions: [
        ...smallSnapshot.atomicExecutions,
        {
          nodeId: 'a2',
          kind: 'artifact',
          state: 'completed',
          outputKey: 'k',
          content: 'y'.repeat(DEFAULT_WORKFLOW_MEMORY_GOVERNANCE.executionsContentMaxChars + 10),
        },
      ],
    }
    const governed = applyWorkflowSnapshotMemoryGovernance(
      snapshot,
      DEFAULT_WORKFLOW_MEMORY_GOVERNANCE,
    )
    expect(governed).not.toBe(snapshot)
    expect(governed.status).toBe('working')
    expect(governed.completedNodeIds).toEqual(['n1'])
    expect(governed.state.small).toBe('keep')
    expect(isWorkflowTruncatedStateValue(governed.state.big)).toBe(true)
    expect(governed.executions[0]).toBe(snapshot.executions[0])
    expect(governed.executions[1]?.truncated).toBe(true)
    expect(governed.executions[1]?.nodeId).toBe('n2')
    expect(governed.atomicExecutions[0]?.truncated).toBeUndefined()
    expect(governed.atomicExecutions[1]?.truncated).toBe(true)
    expect(governed.atomicExecutions[1]?.kind).toBe('artifact')
  })
})

describe('executor 快照治理集成', () => {
  it('传 memoryGovernance：onSnapshot 收到截断快照，result.state 内存保持完整', async () => {
    const graph = normalizeWorkflowGraph({
      nodes: [
        {
          id: 'big',
          kind: 'agent',
          title: 'Big',
          config: { agentId: 'worker', outputKey: 'bigOut' },
        },
      ],
      edges: [],
    })
    const bigContent = 'L'.repeat(5_000)
    const snapshots: WorkflowRunSnapshot[] = []
    const result = await executeWorkflowAgentPlan({
      graph,
      objective: 'objective',
      memoryGovernance: {
        stateValueMaxChars: 1_000,
        executionsContentMaxChars: 1_000,
        snapshotMinIntervalMs: 0,
        resultInlineStateMaxChars: 2_000,
      },
      onSnapshot: (snap) => {
        snapshots.push(snap)
      },
      dispatch: async () => ({ content: bigContent }),
    })
    // 内存结果完整（摘要/续跑语义不被截断破坏）
    expect(result.state.bigOut).toBe(bigContent)
    expect(result.executions[0]?.content).toBe(bigContent)
    // 快照被治理
    const terminal = snapshots.at(-1)!
    expect(terminal.status).toBe('completed')
    expect(isWorkflowTruncatedStateValue(terminal.state.bigOut)).toBe(true)
    expect(terminal.executions[0]?.truncated).toBe(true)
    expect(terminal.executions[0]?.content.length).toBeLessThan(bigContent.length)
  })

  it('不传 memoryGovernance：快照与内存一致（现状对照）', async () => {
    const graph = normalizeWorkflowGraph({
      nodes: [
        { id: 'n', kind: 'agent', title: 'N', config: { agentId: 'worker', outputKey: 'out' } },
      ],
      edges: [],
    })
    const bigContent = 'L'.repeat(5_000)
    const snapshots: WorkflowRunSnapshot[] = []
    const result = await executeWorkflowAgentPlan({
      graph,
      objective: 'objective',
      onSnapshot: (snap) => {
        snapshots.push(snap)
      },
      dispatch: async () => ({ content: bigContent }),
    })
    const terminal = snapshots.at(-1)!
    expect(terminal.state.out).toBe(bigContent)
    expect(terminal.executions[0]?.content).toBe(bigContent)
    expect(terminal.executions[0]?.truncated).toBeUndefined()
    expect(result.state.out).toBe(bigContent)
  })
})

describe('summarizeWorkflowStateKeys', () => {
  it('逐 key 输出 类型(长度) + 200 字符预览', () => {
    const longText = 'A'.repeat(500)
    const lines = summarizeWorkflowStateKeys({ short: 'hi', long: longText, count: 3 })
    expect(lines[0]).toBe('short: string(2 chars) "hi"')
    expect(lines[1]).toContain('long: string(500 chars)')
    expect(lines[1]).toContain('…')
    expect(lines[1]?.slice('"A"'.length).indexOf('A'.repeat(200))).toBeGreaterThanOrEqual(0)
    expect(lines[1]?.length).toBeLessThan(longText.length)
    expect(lines[2]).toBe('count: number(1 chars) "3"')
  })
})
