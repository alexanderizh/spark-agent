import { describe, expect, it } from 'vitest'
import type { TeamToolDefinition } from '../team-mcp-http-bridge.js'
import {
  FORCED_TAKEOVER_SUMMARY_MAX_CHARS,
  buildForcedWorkflowTakeoverResultPrompt,
  buildWorkflowRecentRunPrompt,
  runForcedWorkflowTakeover,
  shouldForceWorkflowTakeover,
} from './session-forced-workflow-runner.js'

function makeTool(handler: TeamToolDefinition['handler']): TeamToolDefinition {
  return {
    name: 'workflow_run',
    description: 'test tool',
    schema: {},
    handler,
  }
}

describe('shouldForceWorkflowTakeover', () => {
  it('forces takeover only for session-override bindings with an executable graph', () => {
    expect(
      shouldForceWorkflowTakeover({
        isMentionTurn: false,
        workflowCanUseManagedExecutor: true,
        bindingSource: 'session-override',
      }),
    ).toBe(true)
  })

  it('skips the forced run when the binding already has a terminal (completed/canceled) run', () => {
    expect(
      shouldForceWorkflowTakeover({
        isMentionTurn: false,
        workflowCanUseManagedExecutor: true,
        bindingSource: 'session-override',
        hasTerminalRun: true,
      }),
    ).toBe(false)
    // 无终态记录（首条消息 / failed 续跑重试）保持强制接管。
    expect(
      shouldForceWorkflowTakeover({
        isMentionTurn: false,
        workflowCanUseManagedExecutor: true,
        bindingSource: 'session-override',
        hasTerminalRun: false,
      }),
    ).toBe(true)
  })

  it('keeps agent-mounted and inherited bindings agent-driven', () => {
    expect(
      shouldForceWorkflowTakeover({
        isMentionTurn: false,
        workflowCanUseManagedExecutor: true,
        bindingSource: 'legacy-agent',
      }),
    ).toBe(false)
    expect(
      shouldForceWorkflowTakeover({
        isMentionTurn: false,
        workflowCanUseManagedExecutor: true,
        bindingSource: 'session-inherit',
      }),
    ).toBe(false)
  })

  it('never forces on mention turns or non-executable graphs', () => {
    expect(
      shouldForceWorkflowTakeover({
        isMentionTurn: true,
        workflowCanUseManagedExecutor: true,
        bindingSource: 'session-override',
      }),
    ).toBe(false)
    expect(
      shouldForceWorkflowTakeover({
        isMentionTurn: false,
        workflowCanUseManagedExecutor: false,
        bindingSource: 'session-override',
      }),
    ).toBe(false)
    expect(
      shouldForceWorkflowTakeover({
        isMentionTurn: false,
        workflowCanUseManagedExecutor: true,
      }),
    ).toBe(false)
  })
})

describe('runForcedWorkflowTakeover', () => {
  it('reports completion from the structured status', async () => {
    const tool = makeTool(async () => ({
      content: [
        {
          type: 'text' as const,
          text: 'Workflow completed 2 agent node attempt(s). Final state: {"a":"ok"}',
        },
      ],
      structuredContent: { status: 'completed', executions: 2 },
    }))

    const outcome = await runForcedWorkflowTakeover({
      tool,
      objective: 'do the thing',
      sessionId: 's1',
      turnId: 't1',
    })

    expect(outcome).toEqual({
      kind: 'completed',
      summaryText: 'Workflow completed 2 agent node attempt(s). Final state: {"a":"ok"}',
    })
  })

  it('reports a run failure with the failed node context', async () => {
    const tool = makeTool(async () => ({
      content: [
        {
          type: 'text' as const,
          text: 'Workflow failed at node n1 after 1 attempt(s). Error: boom. Final state: {}',
        },
      ],
      structuredContent: {
        status: 'failed',
        failedNode: { nodeId: 'n1', error: { code: 'member_timeout', message: 'boom' } },
      },
    }))

    const outcome = await runForcedWorkflowTakeover({
      tool,
      objective: 'do the thing',
      sessionId: 's1',
      turnId: 't1',
    })

    expect(outcome).toEqual({
      kind: 'failed',
      stage: 'run',
      reason: 'Workflow failed at node n1 after 1 attempt(s). Error: boom. Final state: {}',
      failedNodeId: 'n1',
      progressSummary: 'No nodes completed before the failure.\nFailed at node n1 — boom',
    })
  })

  it('extracts completed nodes and state summary into the failure progress', async () => {
    const tool = makeTool(async () => ({
      content: [{ type: 'text' as const, text: 'Workflow failed at node r after 2 attempt(s).' }],
      structuredContent: {
        status: 'failed',
        completedNodeIds: ['input-requirement', 'plan-implementation', 'approval-plan'],
        failedNode: { nodeId: 'route-scope', error: { message: 'invalid route output' } },
        stateSummary: ['audit_scope: {objective…}', 'audit_plan: 1200 chars'],
      },
    }))

    const outcome = await runForcedWorkflowTakeover({
      tool,
      objective: 'o',
      sessionId: 's1',
      turnId: 't1',
    })

    expect(outcome.kind).toBe('failed')
    if (outcome.kind !== 'failed') return
    expect(outcome.progressSummary).toContain(
      'Completed nodes (3): input-requirement, plan-implementation, approval-plan',
    )
    expect(outcome.progressSummary).toContain('Failed at node route-scope — invalid route output')
    expect(outcome.progressSummary).toContain('audit_scope')
  })

  it('falls back to the inline text when structuredContent is missing', async () => {
    const tool = makeTool(async () => ({
      content: [{ type: 'text' as const, text: 'Workflow completed 1 agent node attempt(s).' }],
    }))

    const outcome = await runForcedWorkflowTakeover({
      tool,
      objective: 'objective',
      sessionId: 's1',
      turnId: 't1',
    })

    expect(outcome.kind).toBe('completed')
  })

  it('reports an invoke failure when the handler throws', async () => {
    const tool = makeTool(async () => {
      throw new Error('preflight validation failed')
    })

    const outcome = await runForcedWorkflowTakeover({
      tool,
      objective: 'objective',
      sessionId: 's1',
      turnId: 't1',
    })

    expect(outcome).toEqual({
      kind: 'failed',
      stage: 'invoke',
      reason: 'preflight validation failed',
    })
  })

  it('truncates oversized objectives before invoking the handler', async () => {
    let received: unknown
    const tool = makeTool(async (args) => {
      received = args.objective
      return {
        content: [{ type: 'text' as const, text: 'Workflow completed 1 agent node attempt(s).' }],
        structuredContent: { status: 'completed' },
      }
    })

    await runForcedWorkflowTakeover({
      tool,
      objective: 'x'.repeat(9000),
      sessionId: 's1',
      turnId: 't1',
    })

    expect(typeof received).toBe('string')
    expect((received as string).length).toBe(8000)
  })
})

describe('buildForcedWorkflowTakeoverResultPrompt', () => {
  it('renders an authoritative synthesis directive on success', () => {
    const prompt = buildForcedWorkflowTakeoverResultPrompt({
      kind: 'completed',
      summaryText: 'Workflow completed 1 agent node attempt(s). Final state: {"a":"ok"}',
    })

    expect(prompt).toContain('[Forced Workflow Run — Authoritative]')
    expect(prompt).toContain('workflow_run tool is not exposed this turn')
    expect(prompt).toContain('Final state: {"a":"ok"}')
    expect(prompt).toContain('supersedes any earlier instruction to call workflow_run')
  })

  it('truncates oversized summaries with a persistence note', () => {
    const prompt = buildForcedWorkflowTakeoverResultPrompt({
      kind: 'completed',
      summaryText: 'y'.repeat(FORCED_TAKEOVER_SUMMARY_MAX_CHARS + 500),
    })

    expect(prompt.length).toBeLessThan(FORCED_TAKEOVER_SUMMARY_MAX_CHARS + 2000)
    expect(prompt).toContain('summary truncated')
  })

  it('renders the fallback notice with the failure reason on failure', () => {
    const prompt = buildForcedWorkflowTakeoverResultPrompt({
      kind: 'failed',
      stage: 'run',
      reason: 'member timeout',
      failedNodeId: 'n2',
    })

    expect(prompt).toContain('[Forced Workflow Run — Fallback]')
    expect(prompt).toContain('failed at node n2')
    expect(prompt).toContain('member timeout')
  })

  it('directs run failures to report progress first and not auto re-run the workflow', () => {
    const prompt = buildForcedWorkflowTakeoverResultPrompt({
      kind: 'failed',
      stage: 'run',
      reason: 'Workflow failed at node route-scope after 2 attempt(s).',
      failedNodeId: 'route-scope',
      progressSummary:
        'Completed nodes (3): input, plan, approval\nFailed at node route-scope — invalid route output',
    })

    expect(prompt).toContain('report honestly to the user')
    expect(prompt).toContain('Do NOT automatically re-run the workflow this turn')
    expect(prompt).toContain('Completed nodes (3): input, plan, approval')
    expect(prompt).toContain('supersedes any earlier instruction to call workflow_run')
    // run 失败不再提供「可自行调用 workflow_run」的自主决策指引（invoke 失败专属）。
    expect(prompt).not.toContain('you may call workflow_run yourself')
  })

  it('keeps autonomous decision guidance for invoke-stage failures', () => {
    const prompt = buildForcedWorkflowTakeoverResultPrompt({
      kind: 'failed',
      stage: 'invoke',
      reason: 'handler threw before the graph started',
    })

    expect(prompt).toContain('call workflow_run yourself')
    expect(prompt).not.toContain('Do NOT automatically re-run')
  })
})

describe('buildWorkflowRecentRunPrompt', () => {
  it('describes a completed run with its completed nodes', () => {
    const prompt = buildWorkflowRecentRunPrompt({
      workflowName: '全栈开发标准流程',
      run: {
        status: 'completed',
        ended_at: '2026-10-10T02:56:55.778Z',
        completed_node_ids_json: '["n1","n2","n3","n4","n5","n6"]',
        failed_node_json: null,
      },
    })

    expect(prompt).toContain('[Bound Workflow — Recent Run State]')
    expect(prompt).toContain('already has a completed run')
    expect(prompt).toContain('Completed nodes (6): n1, n2, n3, n4, n5, n6')
    expect(prompt).toContain('does NOT auto-execute the workflow again')
    expect(prompt).toContain('only call workflow_run if the user explicitly asks')
  })

  it('describes a canceled run as user-stopped', () => {
    const prompt = buildWorkflowRecentRunPrompt({
      workflowName: '审计',
      run: {
        status: 'canceled',
        ended_at: '2026-10-10T02:59:38.360Z',
        completed_node_ids_json: '["n1","n2","n3"]',
        failed_node_json: null,
      },
    })

    expect(prompt).toContain('canceled run')
    expect(prompt).toContain('stopped by the user or rejected at an approval node')
    expect(prompt).toContain('Completed nodes (3): n1, n2, n3')
  })

  it('surfaces the denial reason of an approval-rejected canceled run', () => {
    // 审批拒绝 → run 终态 canceled + failed_node 带 denied 信息：下一轮注入的
    // 最近运行状态必须如实转述拒绝原因，宿主才能正确汇报「为什么停了」。
    const prompt = buildWorkflowRecentRunPrompt({
      workflowName: '标准计划/审批/执行/验证工作流',
      run: {
        status: 'canceled',
        ended_at: '2026-10-10T02:57:34.000Z',
        completed_node_ids_json: '["input-requirement","plan-implementation"]',
        failed_node_json:
          '{"nodeId":"approval-plan","agentId":"host","attempt":1,"error":{"code":"denied","message":"用户拒绝了审批节点「计划审批」。"}}',
      },
    })

    expect(prompt).toContain('rejected at an approval node')
    expect(prompt).toContain('Failure: 用户拒绝了审批节点「计划审批」。')
    expect(prompt).toContain('Completed nodes (2): input-requirement, plan-implementation')
  })

  it('tolerates malformed json fields without throwing', () => {
    const prompt = buildWorkflowRecentRunPrompt({
      workflowName: 'w',
      run: {
        status: 'completed',
        ended_at: null,
        completed_node_ids_json: 'not-json',
        failed_node_json: 'also-not-json',
      },
    })

    expect(prompt).toContain('No nodes were completed')
    expect(prompt).toContain('ended unknown time')
  })
})
