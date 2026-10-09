import { describe, expect, it } from 'vitest'
import type { TeamToolDefinition } from '../team-mcp-http-bridge.js'
import {
  FORCED_TAKEOVER_SUMMARY_MAX_CHARS,
  buildForcedWorkflowTakeoverResultPrompt,
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
    })
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
    expect(prompt).toContain('workflow_run yourself')
  })
})
