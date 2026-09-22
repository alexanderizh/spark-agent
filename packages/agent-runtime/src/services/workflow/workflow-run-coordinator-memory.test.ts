/**
 * M4 coordinator 内存治理集成测试（真实内存 SQLite）：
 * - 落库 state/executions 截断 + truncated 标记（快照节流下的最终落库态）；
 * - working 快照落库节流（间隔内合并）且终态快照必达；
 * - workflow_run 结果超限改逐 key 摘要 + 全量归档 artifact（可经
 *   readToolResultArtifact / spark_tool_results 同链读回）；
 * - 未超限时结果保持现状全量形态。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  EventRepository,
  SessionRepository,
  SparkDatabase,
  WorkflowRunRepository,
  type AgentItem,
} from '@spark/storage'
import type { TeamA2AReply } from '@spark/protocol'
import { WorkflowRunCoordinator } from './workflow-run-coordinator.js'
import { normalizeWorkflowGraph } from '../workflow-executor.js'
import { readToolResultArtifact } from '../../tools/tool-result-artifact-store.mjs'

const MIGRATIONS_DIR = fileURLToPath(new URL('../../../../storage/migrations', import.meta.url))

function makeAgent(id: string, name: string): AgentItem {
  return { id, name, enabled: true } as unknown as AgentItem
}

function sequentialAgentGraph(
  nodeCount: number,
  outputKeyPrefix = 'out',
): ReturnType<typeof normalizeWorkflowGraph> {
  return normalizeWorkflowGraph({
    nodes: Array.from({ length: nodeCount }, (_, index) => ({
      id: `n${index}`,
      kind: 'agent' as const,
      title: `Node ${index}`,
      config: { agentId: 'worker-1', outputKey: `${outputKeyPrefix}${index}` },
    })),
    edges: Array.from({ length: nodeCount - 1 }, (_, index) => ({
      from: `n${index}`,
      to: `n${index + 1}`,
    })),
  })
}

interface Harness {
  db: SparkDatabase
  coordinator: WorkflowRunCoordinator
  runRepo: WorkflowRunRepository
  dispatched: string[]
  workspaceRoot: string
}

function seedSessionRow(db: SparkDatabase, sessionId: string): void {
  // workflow_runs.session_id 有 FK → sessions；协调器建档前先种一行会话。
  new SessionRepository(db).create({
    id: sessionId,
    kind: 'chat',
    title: 'M4 memory governance',
    status: 'active',
    projectId: 'project-m4',
  })
}

function latestRunRow(db: SparkDatabase): {
  id: string
  status: string
  state_json: string
  executions_json: string
  ended_at: string | null
} {
  return db.raw
    .prepare(
      'SELECT id, status, state_json, executions_json, ended_at FROM workflow_runs ORDER BY updated_at DESC LIMIT 1',
    )
    .get() as {
    id: string
    status: string
    state_json: string
    executions_json: string
    ended_at: string | null
  }
}

function buildHarness(options: {
  nodeContent: (nodeId: string) => string
  nodeCount?: number
}): Harness {
  const db = new SparkDatabase(':memory:')
  db.runMigrations(MIGRATIONS_DIR)
  seedSessionRow(db, 'session-m4')
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'spark-wf-coordinator-mem-'))
  const ctx = {
    sessionId: 'session-m4',
    turnId: 'turn-m4',
    hostAgent: makeAgent('host-1', 'Host'),
    members: [makeAgent('worker-1', 'Worker One')],
    workspaceRootPath: workspaceRoot,
    eventRepo: {} as unknown as EventRepository,
    workflowGraph: sequentialAgentGraph(options.nodeCount ?? 3),
    workflowId: 'wf-m4',
  }
  const dispatched: string[] = []
  const coordinator = new WorkflowRunCoordinator({
    db,
    ctx,
    runSingleDispatch: async (args): Promise<TeamA2AReply> => {
      dispatched.push(String(args.targetAgentId))
      return {
        state: 'completed',
        content: options.nodeContent(String(args.targetAgentId)),
      } as TeamA2AReply
    },
    hooks: {
      emitAndPersist: () => undefined,
      executeApprovalNode: async () => ({ content: '' }),
      executeToolInvocationNode: async () => ({ content: '' }),
      finalizeArtifactContent: async (_request, content) => ({ content }),
    },
  })
  return { db, coordinator, runRepo: new WorkflowRunRepository(db), dispatched, workspaceRoot }
}

describe('WorkflowRunCoordinator M4 内存治理（默认阈值）', () => {
  let harness: Harness

  afterEach(() => {
    harness?.db.close()
    if (harness?.workspaceRoot) {
      rmSync(harness.workspaceRoot, { recursive: true, force: true })
    }
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('落库 state/executions 被截断并带 truncated 标记；运行结果摘要化 + 全量归档可读回', async () => {
    vi.useFakeTimers()
    // 同时超 stateValueMaxChars(200K)、executionsContentMaxChars(20K)、resultInlineStateMaxChars(2K)
    const bigContent = `HEAD${'B'.repeat(210_000)}TAIL`
    harness = buildHarness({ nodeContent: () => bigContent, nodeCount: 2 })

    const updateSpy = vi.spyOn(WorkflowRunRepository.prototype, 'updateSnapshot')
    const toolDef = harness.coordinator.buildToolDefinition()
    expect(toolDef).not.toBeNull()
    const handler = toolDef!.handler

    const reply = (await handler({ objective: 'objective' })) as {
      content: Array<{ type: string; text: string }>
      structuredContent: Record<string, unknown>
    }

    // ── 结果侧：inline state 超限（2K）→ 摘要 + artifact 引用 ──
    const text = reply.content[0]?.text ?? ''
    expect(text).toContain('per-key summary')
    expect(text).toContain('out0: string(')
    expect(text).not.toContain(bigContent.slice(0, 2_500))
    expect(text.length).toBeLessThan(10_000)
    const structured = reply.structuredContent
    expect(Array.isArray(structured.stateSummary)).toBe(true)
    const artifactRef = structured.artifact as { artifactId: string } | undefined
    expect(artifactRef?.artifactId).toMatch(/^[a-f0-9]{64}$/)
    // 全量结果归档读回（spark_tool_results 同一读回链，单页 40K 分页读全）：state 值完整未截断
    let archived = ''
    let readOffset = 0
    for (let guard = 0; guard < 100; guard += 1) {
      const page = readToolResultArtifact(harness.workspaceRoot, artifactRef!.artifactId, {
        offset: readOffset,
        limit: 40_000,
      })
      archived += page.content
      if (page.eof || page.nextOffset == null) break
      readOffset = page.nextOffset
    }
    const restored = JSON.parse(archived) as {
      state: Record<string, unknown>
      executions: Array<{ content: string }>
    }
    expect(restored.state.out0).toBe(bigContent)
    expect(restored.state.out1).toBe(bigContent)
    expect(restored.executions.every((record) => record.content === bigContent)).toBe(true)

    // ── 落库侧：state_json 截断 + truncated 标记，executions content 同理 ──
    const run = latestRunRow(harness.db)
    const persistedState = JSON.parse(run.state_json) as Record<string, unknown>
    const truncatedOut = persistedState.out1 as { truncated?: boolean; originalChars?: number }
    expect(truncatedOut.truncated).toBe(true)
    expect(truncatedOut.originalChars).toBe(bigContent.length)
    const persistedExecutions = JSON.parse(run.executions_json) as Array<{
      content: string
      truncated?: boolean
    }>
    expect(persistedExecutions.length).toBe(2)
    for (const record of persistedExecutions) {
      expect(record.truncated).toBe(true)
      expect(record.content.length).toBeLessThan(bigContent.length)
    }
    // 终态快照必达：run 状态为 completed 且带 endedAt
    expect(run.status).toBe('completed')
    expect(run.ended_at).not.toBeNull()
  })

  it('working 快照落库被节流（间隔内合并），终态快照必达', async () => {
    vi.useFakeTimers()
    harness = buildHarness({ nodeContent: () => 'small', nodeCount: 3 })
    const updateSpy = vi.spyOn(WorkflowRunRepository.prototype, 'updateSnapshot')

    const toolDef = harness.coordinator.buildToolDefinition()
    await toolDef!.handler({ objective: 'objective' })

    // fake timers 冻结时间：全部快照落在同一时刻。首份 working 立即写，
    // 后续 working（节点开始/完成 × 多次）合并进 trailing，终态立即写。
    // 3 节点串行链正常会产生 ~8 份快照；节流后仅 2 次（首 working + 终态）。
    const calls = updateSpy.mock.calls.length
    expect(calls).toBe(2)
    const statuses = updateSpy.mock.calls.map((call) => call[1]?.status)
    expect(statuses[0]).toBe('working')
    expect(statuses.at(-1)).toBe('completed')
    // 终态已落库后，trailing timer 到期不再产生额外写
    vi.advanceTimersByTime(10_000)
    expect(updateSpy.mock.calls.length).toBe(2)
  })

  it('未超限：结果为现状全量形态（Final state: {...}），落库不截断', async () => {
    vi.useFakeTimers()
    harness = buildHarness({ nodeContent: (nodeId) => `content-of-${nodeId}`, nodeCount: 1 })
    const updateSpy = vi.spyOn(WorkflowRunRepository.prototype, 'updateSnapshot')

    const toolDef = harness.coordinator.buildToolDefinition()
    const reply = (await toolDef!.handler({ objective: 'objective' })) as {
      content: Array<{ type: string; text: string }>
      structuredContent: Record<string, unknown>
    }

    const text = reply.content[0]?.text ?? ''
    expect(text).toContain('Workflow completed 1 agent node attempt(s). Final state: ')
    expect(text).toContain('content-of-')
    expect(reply.structuredContent.state).toEqual({ out0: 'content-of-worker-1' })

    const run = latestRunRow(harness.db)
    const persistedState = JSON.parse(run.state_json) as Record<string, unknown>
    expect(persistedState.out0).toBe('content-of-worker-1')
    const persistedExecutions = JSON.parse(run.executions_json) as Array<{ content: string }>
    expect(persistedExecutions[0]?.content).toBe('content-of-worker-1')
    expect(updateSpy.mock.calls.length).toBeGreaterThanOrEqual(1)
  })

  it('memoryGovernance 可覆盖：调大阈值回退截断行为', async () => {
    vi.useFakeTimers()
    const bigContent = 'B'.repeat(30_000)
    harness = buildHarness({ nodeContent: () => bigContent, nodeCount: 1 })
    // 直接构造带自定义 memoryGovernance 的 coordinator（模拟 settings 热更新注入）
    const db = harness.db
    seedSessionRow(db, 'session-m4b')
    const ctx = {
      sessionId: 'session-m4b',
      turnId: 'turn-m4b',
      hostAgent: makeAgent('host-1', 'Host'),
      members: [makeAgent('worker-1', 'Worker One')],
      workspaceRootPath: harness.workspaceRoot,
      eventRepo: {} as unknown as EventRepository,
      workflowGraph: sequentialAgentGraph(1),
      workflowId: 'wf-m4b',
    }
    const custom = new WorkflowRunCoordinator({
      db,
      ctx,
      runSingleDispatch: async (): Promise<TeamA2AReply> =>
        ({ state: 'completed', content: bigContent }) as TeamA2AReply,
      hooks: {
        emitAndPersist: () => undefined,
        executeApprovalNode: async () => ({ content: '' }),
        executeToolInvocationNode: async () => ({ content: '' }),
        finalizeArtifactContent: async (_request, content) => ({ content }),
      },
      memoryGovernance: {
        stateValueMaxChars: 2_000_000,
        executionsContentMaxChars: 2_000_000,
        snapshotMinIntervalMs: 0,
        resultInlineStateMaxChars: 2_000_000,
      },
    })
    const reply = (await custom.buildToolDefinition()!.handler({ objective: 'o' })) as {
      content: Array<{ type: string; text: string }>
    }
    // 阈值调大后回到现状全量形态
    expect(reply.content[0]?.text).toContain('Final state: ')
    const run = latestRunRow(db)
    const persistedState = JSON.parse(run.state_json) as Record<string, unknown>
    expect(persistedState.out0).toBe(bigContent)
  })
})
