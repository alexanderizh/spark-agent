import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '@spark/protocol'
import type { SDKQueryOptions } from '../../sdk/types.js'

const queryMock = vi.hoisted(() => vi.fn())

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: queryMock,
}))

const { ClaudeSDKExecutor, resetSDKLoadState, getResumeCircuitBreaker } = await import(
  '../../sdk/claude-sdk-executor.js'
)

function baseConfig(overrides: Record<string, unknown> = {}) {
  return {
    apiKey: 'sk-test',
    model: 'claude-sonnet-4-5',
    workspaceRootPath: '/tmp',
    permissionMode: 'claude-ask' as const,
    ...overrides,
  }
}

async function* messages(items: unknown[]) {
  for (const item of items) yield item
}

const successResult = {
  type: 'result',
  subtype: 'success',
  uuid: 'result-1',
  session_id: 'sdk-session',
  duration_ms: 10,
  duration_api_ms: 10,
  is_error: false,
  num_turns: 1,
  result: 'done',
  total_cost_usd: 0,
  usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
}

describe('Plan mode E2E', () => {
  beforeEach(() => {
    queryMock.mockReset()
    resetSDKLoadState()
    getResumeCircuitBreaker().reset()
  })

  it('plan turn: emits plan_proposed and completes, no SDK_ERROR', async () => {
    // Simulate SDK producing an ExitPlanMode tool call + result
    queryMock.mockReturnValue(
      messages([
        {
          type: 'assistant',
          uuid: 'assistant-1',
          session_id: 'sdk-session',
          parent_tool_use_id: null,
          message: {
            role: 'assistant',
            content: [
              { type: 'text', text: 'Let me analyze the task...' },
              {
                type: 'tool_use',
                id: 'tool-plan-1',
                name: 'ExitPlanMode',
                input: { plan: '# Refactor Plan\n\n1. Extract helper\n2. Add tests\n3. Update docs' },
              },
            ],
          },
        },
        successResult,
      ]),
    )

    const events: AgentEvent[] = []
    const executor = new ClaudeSDKExecutor()
    executor.onEvent((event) => events.push(event))

    const approvalCallback = vi.fn(async () => true)

    await executor.executeTurn('sess-plan', 'turn-1', 'refactor the module', {
      ...baseConfig({ permissionMode: 'claude-plan' }),
      approvalCallback,
    })

    // Should emit a plan_proposed event with the plan text
    const planEvents = events.filter((e) => e.type === 'plan_proposed')
    expect(planEvents.length).toBeGreaterThanOrEqual(1)
    expect(planEvents[0]).toEqual(
      expect.objectContaining({
        type: 'plan_proposed',
        plan: '# Refactor Plan\n\n1. Extract helper\n2. Add tests\n3. Update docs',
      }),
    )

    // Turn should complete successfully
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'agent_status', status: 'completed' }),
    )

    // No SDK_ERROR should be emitted
    const errors = events.filter(
      (e) => e.type === 'agent_error' && (e as any).code === 'SDK_ERROR',
    )
    expect(errors).toHaveLength(0)

    // SDK should be called with plan permission mode
    const options = queryMock.mock.calls[0]?.[0]?.options as SDKQueryOptions
    expect(options.permissionMode).toBe('plan')
  })

  it('plan approval then execute: permission mode switches and turn succeeds', async () => {
    // ── Turn 1: Plan mode generates a plan ──
    queryMock.mockReturnValueOnce(
      messages([
        {
          type: 'assistant',
          uuid: 'assistant-plan',
          session_id: 'sdk-session',
          parent_tool_use_id: null,
          message: {
            role: 'assistant',
            content: [
              {
                type: 'tool_use',
                id: 'tool-plan-1',
                name: 'ExitPlanMode',
                input: { plan: '# Plan\n\n1. Add validation' },
              },
            ],
          },
        },
        successResult,
      ]),
    )

    const planEvents: AgentEvent[] = []
    const executor1 = new ClaudeSDKExecutor()
    executor1.onEvent((event) => planEvents.push(event))

    await executor1.executeTurn('sess-plan', 'turn-1', 'fix the bug', {
      ...baseConfig({ permissionMode: 'claude-plan' }),
      approvalCallback: vi.fn(async () => true),
    })

    // Plan was produced
    expect(planEvents.some((e) => e.type === 'plan_proposed')).toBe(true)

    // ── User approves plan: switch to claude-auto-edits ──
    // This simulates what the UI does via session:update

    // ── Turn 2: Execute with claude-auto-edits mode ──
    queryMock.mockReturnValueOnce(
      messages([
        {
          type: 'assistant',
          uuid: 'assistant-exec',
          session_id: 'sdk-session',
          parent_tool_use_id: null,
          message: {
            role: 'assistant',
            content: [
              { type: 'text', text: 'I will now implement the plan.' },
              {
                type: 'tool_use',
                id: 'tool-edit-1',
                name: 'Edit',
                input: { file_path: 'src/index.ts', old_string: 'a', new_string: 'b' },
              },
            ],
          },
        },
        successResult,
      ]),
    )

    const execEvents: AgentEvent[] = []
    const executor2 = new ClaudeSDKExecutor()
    executor2.onEvent((event) => execEvents.push(event))

    await executor2.executeTurn('sess-plan', 'turn-2', '批准上述计划。请按如下计划继续执行：\n\n# Plan\n\n1. Add validation', {
      ...baseConfig({ permissionMode: 'claude-auto-edits' }),
      approvalCallback: vi.fn(async () => true),
    })

    // Should be called with acceptEdits mode (mapped from claude-auto-edits)
    const execOptions = queryMock.mock.calls[1]?.[0]?.options as SDKQueryOptions
    expect(execOptions.permissionMode).toBe('acceptEdits')

    // Should complete successfully with no SDK_ERROR
    expect(execEvents).toContainEqual(
      expect.objectContaining({ type: 'agent_status', status: 'completed' }),
    )
    const execErrors = execEvents.filter(
      (e) => e.type === 'agent_error' && (e as any).code === 'SDK_ERROR',
    )
    expect(execErrors).toHaveLength(0)
  })

  it('plan mode auto-allows ExitPlanMode without approval callback', async () => {
    queryMock.mockReturnValue(messages([successResult]))

    const approvalCallback = vi.fn(async () => false) // Would deny everything

    await new ClaudeSDKExecutor().executeTurn('sess-plan', 'turn-1', 'plan this', {
      ...baseConfig({ permissionMode: 'claude-plan' }),
      approvalCallback,
    })

    const options = queryMock.mock.calls[0]?.[0]?.options as SDKQueryOptions
    const result = await options.canUseTool?.(
      'ExitPlanMode',
      { plan: '# My Plan' },
      { signal: new AbortController().signal, toolUseID: 'tool-1' },
    )

    expect(result).toEqual({
      behavior: 'allow',
      updatedInput: { plan: '# My Plan' },
      toolUseID: 'tool-1',
      decisionClassification: 'user_temporary',
    })
    // Approval callback should NOT be called for plan tools
    expect(approvalCallback).not.toHaveBeenCalled()
  })

  it('plan mode denies edit tools outright without routing to inline approval', async () => {
    queryMock.mockReturnValue(messages([successResult]))

    // Even if the inline approval callback would say "allow", plan mode must
    // never let an edit through before the plan itself is approved.
    const approvalCallback = vi.fn(async () => true)

    await new ClaudeSDKExecutor().executeTurn('sess-plan', 'turn-1', 'plan this', {
      ...baseConfig({ permissionMode: 'claude-plan' }),
      approvalCallback,
    })

    const options = queryMock.mock.calls[0]?.[0]?.options as SDKQueryOptions
    const result = await options.canUseTool?.(
      'Edit',
      { file_path: 'src/index.ts', old_string: 'a', new_string: 'b' },
      { signal: new AbortController().signal, toolUseID: 'tool-1' },
    )

    // Plan mode is read-only: edits are denied without ever consulting the
    // inline approval callback.
    expect(result).toEqual(
      expect.objectContaining({
        behavior: 'deny',
      }),
    )
    expect(approvalCallback).not.toHaveBeenCalled()
  })

  it('second turn after plan rejection does not error', async () => {
    // Turn 1: Plan is generated (same as above)
    queryMock.mockReturnValueOnce(
      messages([
        {
          type: 'assistant',
          uuid: 'assistant-1',
          session_id: 'sdk-session',
          parent_tool_use_id: null,
          message: {
            role: 'assistant',
            content: [
              {
                type: 'tool_use',
                id: 'tool-plan-1',
                name: 'ExitPlanMode',
                input: { plan: '# Initial plan' },
              },
            ],
          },
        },
        successResult,
      ]),
    )

    const events1: AgentEvent[] = []
    const executor1 = new ClaudeSDKExecutor()
    executor1.onEvent((event) => events1.push(event))
    await executor1.executeTurn('sess-plan', 'turn-1', 'help me', {
      ...baseConfig({ permissionMode: 'claude-plan' }),
      approvalCallback: vi.fn(async () => true),
    })

    expect(events1.some((e) => e.type === 'plan_proposed')).toBe(true)
    expect(events1.some((e) => e.type === 'agent_error')).toBe(false)

    // Turn 2: User sends a follow-up without changing mode (rejecting plan implicitly)
    queryMock.mockReturnValueOnce(messages([
      {
        type: 'assistant',
        uuid: 'assistant-2',
        session_id: 'sdk-session',
        parent_tool_use_id: null,
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'I understand. Let me create a new plan.' },
            {
              type: 'tool_use',
              id: 'tool-plan-2',
              name: 'ExitPlanMode',
              input: { plan: '# Revised plan\n\n1. Different approach' },
            },
          ],
        },
      },
      successResult,
    ]))

    const events2: AgentEvent[] = []
    const executor2 = new ClaudeSDKExecutor()
    executor2.onEvent((event) => events2.push(event))
    await executor2.executeTurn('sess-plan', 'turn-2', 'I want a different approach', {
      ...baseConfig({ permissionMode: 'claude-plan' }),
      approvalCallback: vi.fn(async () => true),
    })

    // Second plan turn should also complete without SDK_ERROR
    expect(events2).toContainEqual(
      expect.objectContaining({ type: 'agent_status', status: 'completed' }),
    )
    const errors = events2.filter(
      (e) => e.type === 'agent_error' && (e as any).code === 'SDK_ERROR',
    )
    expect(errors).toHaveLength(0)

    // Should have produced a new plan
    expect(events2.some((e) => e.type === 'plan_proposed')).toBe(true)
  })
})
