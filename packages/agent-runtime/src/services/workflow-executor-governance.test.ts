/**
 * executeWorkflowAgentPlan 治理参数测试（M0）。
 *
 * 覆盖：波宽分块（块间串行 + 前块失败背压）、subagent 扇出钳制、循环×扇出
 * 乘积上限（workflow_loop_budget_exceeded）、单 run 派发总量上限
 * （workflow_dispatch_budget_exceeded，含 loop 迭代共享计数）、不传 governance
 * 时同波全量并行（现状行为对照）。
 */
import { describe, expect, it } from 'vitest'
import {
  estimateWorkflowLoopDispatchBudget,
  executeWorkflowAgentPlan,
  normalizeWorkflowGraph,
} from './workflow-executor.js'

function readyNodesGraph(count: number) {
  return normalizeWorkflowGraph({
    nodes: Array.from({ length: count }, (_, index) => ({
      id: `n${index}`,
      kind: 'agent' as const,
      title: `Node ${index}`,
      config: { agentId: `worker-${index}`, outputKey: `out${index}` },
    })),
    edges: [],
  })
}

function drainMicrotasks(times = 60): Promise<void> {
  let chain = Promise.resolve()
  for (let i = 0; i < times; i += 1) chain = chain.then(() => undefined)
  return chain
}

describe('workflow-executor governance（波宽分块）', () => {
  it('waveWidth 限制同时派发的 ready 节点数，块间串行', async () => {
    const graph = readyNodesGraph(6)
    const started: string[] = []
    const releases = new Map<string, (content: string) => void>()
    const resultPromise = executeWorkflowAgentPlan({
      graph,
      objective: 'objective',
      governance: {
        waveWidth: 2,
        fanoutClamp: 4,
        loopFanoutProductCap: 32,
        maxDispatchesPerRun: 80,
      },
      dispatch: (request) => {
        started.push(request.nodeId)
        return new Promise((resolve) => {
          releases.set(request.nodeId, (content) => resolve({ content }))
        })
      },
    })
    await drainMicrotasks()
    // 第一块（n0、n1）已派发，其余块等待
    expect(started).toEqual(['n0', 'n1'])
    releases.get('n0')?.('a0')
    releases.get('n1')?.('a1')
    await drainMicrotasks()
    expect(started).toEqual(['n0', 'n1', 'n2', 'n3'])
    releases.get('n2')?.('a2')
    releases.get('n3')?.('a3')
    await drainMicrotasks()
    expect(started).toEqual(['n0', 'n1', 'n2', 'n3', 'n4', 'n5'])
    for (let i = 4; i < 6; i++) releases.get(`n${i}`)?.(`a${i}`)
    const result = await resultPromise
    expect(result.status).toBe('completed')
    expect(result.state).toEqual({
      out0: 'a0',
      out1: 'a1',
      out2: 'a2',
      out3: 'a3',
      out4: 'a4',
      out5: 'a5',
    })
  })

  it('前块终态失败后，后续块不再派发（背压）', async () => {
    const graph = readyNodesGraph(6)
    const started: string[] = []
    const releases = new Map<string, (content: string) => void>()
    const resultPromise = executeWorkflowAgentPlan({
      graph,
      objective: 'objective',
      governance: {
        waveWidth: 2,
        fanoutClamp: 4,
        loopFanoutProductCap: 32,
        maxDispatchesPerRun: 80,
      },
      dispatch: (request) => {
        started.push(request.nodeId)
        if (request.nodeId === 'n0') {
          return Promise.resolve({
            state: 'failed',
            content: '',
            error: { code: 'x', message: 'boom' },
          })
        }
        return new Promise((resolve) => {
          releases.set(request.nodeId, (content) => resolve({ content }))
        })
      },
    })
    await drainMicrotasks()
    // 第一块中 n0 失败，但 n1 已在飞（同块语义），等 n1 落定后整 run 失败，
    // 第二、三块（n2-n5）不再派发。
    releases.get('n1')?.('a1')
    const result = await resultPromise
    expect(result.status).toBe('failed')
    expect(result.failedNode?.nodeId).toBe('n0')
    expect(started.filter((id) => ['n2', 'n3', 'n4', 'n5'].includes(id))).toEqual([])
  })

  it('不传 governance：同波全量并行（现状行为对照）', async () => {
    const graph = readyNodesGraph(6)
    const started: string[] = []
    const resultPromise = executeWorkflowAgentPlan({
      graph,
      objective: 'objective',
      dispatch: (request) => {
        started.push(request.nodeId)
        return Promise.resolve({ content: 'ok' })
      },
    })
    const result = await resultPromise
    expect(result.status).toBe('completed')
    expect(started).toEqual(['n0', 'n1', 'n2', 'n3', 'n4', 'n5'])
  })
})

describe('workflow-executor governance（扇出钳制）', () => {
  it('subagent parallelism 超过 fanoutClamp 被静默钳制', async () => {
    const graph = normalizeWorkflowGraph({
      nodes: [
        {
          id: 'fan',
          kind: 'subagent',
          title: 'Fan',
          config: { agentId: 'worker', outputKey: 'fanout', parallelism: 16 },
        },
      ],
      edges: [],
    })
    let concurrent = 0
    let maxConcurrent = 0
    const started: number[] = []
    const result = await executeWorkflowAgentPlan({
      graph,
      objective: 'objective',
      governance: {
        waveWidth: 4,
        fanoutClamp: 4,
        loopFanoutProductCap: 32,
        maxDispatchesPerRun: 80,
      },
      dispatch: async (request) => {
        concurrent += 1
        started.push(concurrent)
        maxConcurrent = Math.max(maxConcurrent, concurrent)
        await Promise.resolve()
        concurrent -= 1
        return { content: `branch-${request.nodeId}` }
      },
    })
    expect(result.status).toBe('completed')
    expect(started.length).toBe(4)
    expect(maxConcurrent).toBeLessThanOrEqual(4)
    expect(result.state).toEqual({ fanout: expect.stringContaining('--- branch 1 ---') })
  })

  it('不传 governance 时 parallelism=16 原样 fan-out（现状对照）', async () => {
    const graph = normalizeWorkflowGraph({
      nodes: [
        {
          id: 'fan',
          kind: 'subagent',
          title: 'Fan',
          config: { agentId: 'worker', outputKey: 'fanout', parallelism: 6 },
        },
      ],
      edges: [],
    })
    const branches: string[] = []
    const result = await executeWorkflowAgentPlan({
      graph,
      objective: 'objective',
      dispatch: async (request) => {
        branches.push(request.nodeId)
        return { content: 'b' }
      },
    })
    expect(result.status).toBe('completed')
    expect(branches.length).toBe(6)
  })
})

describe('workflow-executor governance（循环×扇出乘积与总量上限）', () => {
  function loopGraph(maxIterations: number, bodyNodeCount: number, parallelism?: number) {
    return normalizeWorkflowGraph({
      nodes: [
        {
          id: 'loop',
          kind: 'loop' as const,
          title: 'Loop',
          config: {
            maxIterations,
            body: {
              nodes: Array.from({ length: bodyNodeCount }, (_, i) => ({
                id: `body-${i}`,
                kind: 'agent' as const,
                title: `Body ${i}`,
                config: {
                  agentId: `body-worker-${i}`,
                  outputKey: `body${i}`,
                  ...(parallelism != null && i === 0 ? { parallelism } : {}),
                },
              })),
              edges: [],
            },
          },
        },
      ],
      edges: [],
    })
  }

  it('maxIterations × 波宽超 cap 时 loop 节点失败（workflow_loop_budget_exceeded）', async () => {
    const graph = loopGraph(50, 2)
    let dispatchCount = 0
    const result = await executeWorkflowAgentPlan({
      graph,
      objective: 'objective',
      governance: {
        waveWidth: 4,
        fanoutClamp: 4,
        loopFanoutProductCap: 32,
        maxDispatchesPerRun: 80,
      },
      dispatch: async () => {
        dispatchCount += 1
        return { content: 'x' }
      },
    })
    expect(result.status).toBe('failed')
    expect(result.failedNode?.error.code).toBe('workflow_loop_budget_exceeded')
    expect(result.failedNode?.error.message).toMatch(/maxIterations\(50\)/)
    // 运行前静态拦截：一次派发都不发生
    expect(dispatchCount).toBe(0)
  })

  it('乘积在 cap 内正常执行，体內波宽也受 governance 约束', async () => {
    const graph = loopGraph(2, 2)
    const dispatchNodeIds: string[] = []
    const result = await executeWorkflowAgentPlan({
      graph,
      objective: 'objective',
      governance: {
        waveWidth: 1,
        fanoutClamp: 4,
        loopFanoutProductCap: 32,
        maxDispatchesPerRun: 80,
      },
      dispatch: async (request) => {
        dispatchNodeIds.push(request.nodeId)
        return { content: 'x' }
      },
    })
    expect(result.status).toBe('completed')
    // 每次迭代体內 2 节点按 waveWidth=1 串行派发（共 4 次）
    expect(dispatchNodeIds.length).toBe(4)
  })

  it('单 run 派发总量超限：后续派发被拒并传导为 run 失败（workflow_dispatch_budget_exceeded）', async () => {
    const graph = loopGraph(5, 1)
    let dispatchCount = 0
    const result = await executeWorkflowAgentPlan({
      graph,
      objective: 'objective',
      governance: {
        waveWidth: 4,
        fanoutClamp: 4,
        loopFanoutProductCap: 32,
        maxDispatchesPerRun: 3,
      },
      dispatch: async () => {
        dispatchCount += 1
        return { content: 'x' }
      },
    })
    expect(result.status).toBe('failed')
    expect(result.failedNode?.error.code).toBe('workflow_dispatch_budget_exceeded')
    // 预算 3：真派发 3 次，第 4 次被 wrapper 拒绝（不再调 dispatch）
    expect(dispatchCount).toBe(3)
  })

  it('estimateWorkflowLoopDispatchBudget：fanout 与 retry 计入估算', () => {
    const body = normalizeWorkflowGraph({
      nodes: [
        { id: 'a', kind: 'subagent', title: 'A', config: { agentId: 'w', parallelism: 16 } },
        { id: 'b', kind: 'agent', title: 'B', config: { agentId: 'w2', retryCount: 2 } },
        { id: 'c', kind: 'verify', title: 'C', config: {} },
      ],
      edges: [],
    })
    // a: clamp 16→4；b: (1+2)×1=3；c 非派发节点不计 → 每迭代 7，5 迭代 = 35
    expect(estimateWorkflowLoopDispatchBudget(body, 5, 4)).toBe(35)
    // 不钳制时按原始 parallelism 估算
    expect(estimateWorkflowLoopDispatchBudget(body, 1, undefined)).toBe(19)
  })
})
