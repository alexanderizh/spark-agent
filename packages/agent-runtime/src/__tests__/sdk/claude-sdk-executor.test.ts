import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '@spark/protocol'
import type { SDKQueryOptions, SDKUserMessage } from '../../sdk/types.js'

const queryMock = vi.hoisted(() => vi.fn())

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: queryMock,
}))

const { ClaudeSDKExecutor, resetSDKLoadState, getResumeCircuitBreaker } = await import('../../sdk/claude-sdk-executor.js')

function baseConfig() {
  return {
    apiKey: 'sk-test',
    model: 'claude-sonnet-4-5',
    workspaceRootPath: '/tmp',
    permissionMode: 'claude-ask' as const,
  }
}

async function* messages(items: unknown[]) {
  for (const item of items) yield item
}

async function readPromptText(prompt: string | AsyncIterable<SDKUserMessage>): Promise<string> {
  if (typeof prompt === 'string') return prompt
  const first = await prompt[Symbol.asyncIterator]().next()
  const content = first.value?.message.content
  return typeof content === 'string' ? content : JSON.stringify(content)
}

describe('ClaudeSDKExecutor', () => {
  beforeEach(() => {
    queryMock.mockReset()
    resetSDKLoadState()
    getResumeCircuitBreaker().reset()
  })

  it('keeps streaming input open so a late AskUserQuestion control request can complete', async () => {
    const questionCallback = vi.fn(async () => ({
      answers: [{ question: 'Proceed?', answer: 'Yes' }],
    }))
    let inputClosed = false

    queryMock.mockImplementation(({ prompt, options }) => (async function* () {
      expect(typeof prompt).not.toBe('string')
      const iterator = (prompt as AsyncIterable<SDKUserMessage>)[Symbol.asyncIterator]()
      const first = await iterator.next()
      expect(first.value).toMatchObject({
        type: 'user',
        parent_tool_use_id: null,
        message: { role: 'user', content: 'hello' },
      })
      const waitingForClose = iterator.next().then((result) => {
        inputClosed = result.done === true
      })
      await Promise.resolve()
      expect(inputClosed).toBe(false)

      await options.canUseTool?.('AskUserQuestion', {
        questions: [{ question: 'Proceed?', header: 'Confirm', options: [{ label: 'Yes' }] }],
      }, {
        signal: new AbortController().signal,
        toolUseID: 'late-question',
        requestId: 'late-request',
      })

      yield {
        type: 'result',
        subtype: 'success',
        result: 'ok',
        usage: { input_tokens: 1, output_tokens: 1 },
        total_cost_usd: 0,
      }
      await waitingForClose
    })())

    await new ClaudeSDKExecutor().executeTurn('sess-1', 'turn-1', 'hello', {
      ...baseConfig(),
      questionCallback,
    })

    expect(inputClosed).toBe(true)
    expect(questionCallback).toHaveBeenCalledWith(
      'sess-1',
      expect.any(Array),
      expect.objectContaining({ questionId: 'late-question', requestId: 'late-request' }),
    )
  })

  it('keeps streaming input open so a late ExitPlanMode control request can complete', async () => {
    let inputClosed = false
    let exitResult: unknown

    queryMock.mockImplementation(({ prompt, options }) => (async function* () {
      expect(typeof prompt).not.toBe('string')
      const iterator = (prompt as AsyncIterable<SDKUserMessage>)[Symbol.asyncIterator]()
      await iterator.next()
      const waitingForClose = iterator.next().then((result) => {
        inputClosed = result.done === true
      })
      await Promise.resolve()
      expect(inputClosed).toBe(false)

      exitResult = await options.canUseTool?.('ExitPlanMode', { plan: '# Plan' }, {
        signal: new AbortController().signal,
        toolUseID: 'late-exit-plan',
        requestId: 'late-exit-request',
      })

      yield {
        type: 'result',
        subtype: 'success',
        result: 'ok',
        usage: { input_tokens: 1, output_tokens: 1 },
        total_cost_usd: 0,
      }
      await waitingForClose
    })())

    await new ClaudeSDKExecutor().executeTurn('sess-1', 'turn-1', 'plan this', {
      ...baseConfig(),
      permissionMode: 'claude-plan',
      approvalCallback: vi.fn(async () => false),
    })

    expect(inputClosed).toBe(true)
    expect(exitResult).toEqual(expect.objectContaining({
      behavior: 'deny',
      toolUseID: 'late-exit-plan',
    }))
  })

  it('uses a fixed session id for the first turn and resume for later turns', async () => {
    queryMock.mockReturnValue(messages([
      { type: 'result', subtype: 'success', result: 'ok', usage: { input_tokens: 1, output_tokens: 1 }, total_cost_usd: 0 },
    ]))

    await new ClaudeSDKExecutor().executeTurn('sess-1', 'turn-1', 'hello', baseConfig())
    await new ClaudeSDKExecutor().executeTurn('sess-1', 'turn-2', 'again', {
      ...baseConfig(),
      continueSession: true,
    })

    const firstOptions = queryMock.mock.calls[0]?.[0]?.options as SDKQueryOptions
    const secondOptions = queryMock.mock.calls[1]?.[0]?.options as SDKQueryOptions

    expect(firstOptions).toMatchObject({ sessionId: 'sess-1' })
    expect(firstOptions.resume).toBeUndefined()
    expect(firstOptions.continue).toBeUndefined()
    expect(firstOptions.skills).toBeUndefined()
    expect(secondOptions).toMatchObject({ resume: 'sess-1' })
    expect(secondOptions.sessionId).toBeUndefined()
    expect(secondOptions.continue).toBeUndefined()
    expect(secondOptions.skills).toBeUndefined()
  })

  it('uses the configured SDK session id for fresh and resumed turns', async () => {
    queryMock.mockReturnValue(messages([
      { type: 'result', subtype: 'success', result: 'ok', usage: { input_tokens: 1, output_tokens: 1 }, total_cost_usd: 0 },
    ]))

    await new ClaudeSDKExecutor().executeTurn('spark-session', 'turn-1', 'hello', {
      ...baseConfig(),
      sdkSessionId: 'sdk-runtime-session',
    })
    await new ClaudeSDKExecutor().executeTurn('spark-session', 'turn-2', 'again', {
      ...baseConfig(),
      sdkSessionId: 'sdk-runtime-session',
      continueSession: true,
    })

    const firstOptions = queryMock.mock.calls[0]?.[0]?.options as SDKQueryOptions
    const secondOptions = queryMock.mock.calls[1]?.[0]?.options as SDKQueryOptions

    expect(firstOptions.sessionId).toBe('sdk-runtime-session')
    expect(firstOptions.resume).toBeUndefined()
    expect(secondOptions.resume).toBe('sdk-runtime-session')
    expect(secondOptions.sessionId).toBeUndefined()
  })

  it('writes model and runtime env into the SDK settings layer', async () => {
    queryMock.mockReturnValue(messages([
      { type: 'result', subtype: 'success', result: 'ok', usage: { input_tokens: 1, output_tokens: 1 }, total_cost_usd: 0 },
    ]))

    const previousOauthToken = process.env.CLAUDE_CODE_OAUTH_TOKEN
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'stale-token'

    try {
      await new ClaudeSDKExecutor().executeTurn('spark-session', 'turn-1', 'hello', {
        ...baseConfig(),
        model: 'glm-5',
        apiKey: 'sk-runtime',
        apiEndpoint: 'https://api.lkeap.cloud.tencent.com/coding/anthropic',
        permissionMode: 'claude-auto',
      })
    } finally {
      if (previousOauthToken == null) delete process.env.CLAUDE_CODE_OAUTH_TOKEN
      else process.env.CLAUDE_CODE_OAUTH_TOKEN = previousOauthToken
    }

    const options = queryMock.mock.calls[0]?.[0]?.options as SDKQueryOptions

    expect(options.model).toBe('glm-5')
    expect(options.settingSources).toEqual(['project'])
    expect(options.env?.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined()
    expect(options.settings).toMatchObject({
      model: 'glm-5',
      env: expect.objectContaining({
        ANTHROPIC_API_KEY: 'sk-runtime',
        ANTHROPIC_BASE_URL: 'https://api.lkeap.cloud.tencent.com/coding/anthropic',
      }),
      permissions: {
        defaultMode: 'auto',
      },
    })
  })

  it('preserves Spark xhigh reasoning as Claude xhigh effort', async () => {
    queryMock.mockReturnValue(messages([
      { type: 'result', subtype: 'success', result: 'ok', usage: { input_tokens: 1, output_tokens: 1 }, total_cost_usd: 0 },
    ]))

    await new ClaudeSDKExecutor().executeTurn('sess-1', 'turn-1', 'hello', {
      ...baseConfig(),
      reasoningEffort: 'xhigh',
    })

    const options = queryMock.mock.calls[0]?.[0]?.options as SDKQueryOptions
    expect(options.effort).toBe('xhigh')
  })

  it('emits completed when the SDK stream ends without a result status', async () => {
    queryMock.mockReturnValue(messages([]))
    const events: AgentEvent[] = []
    const executor = new ClaudeSDKExecutor()
    executor.onEvent((event) => events.push(event))

    await executor.executeTurn('sess-1', 'turn-1', 'hello', baseConfig())

    expect(events).toContainEqual(expect.objectContaining({
      type: 'agent_status',
      status: 'completed',
    }))
  })

  it('emits an error status and rejects when the SDK throws', async () => {
    queryMock.mockImplementation(() => {
      throw new Error('write EPIPE')
    })
    const events: AgentEvent[] = []
    const executor = new ClaudeSDKExecutor()
    executor.onEvent((event) => events.push(event))

    await expect(executor.executeTurn('sess-1', 'turn-1', 'hello', baseConfig()))
      .rejects.toThrow('write EPIPE')

    expect(events).toContainEqual(expect.objectContaining({
      type: 'agent_error',
      code: 'SDK_ERROR',
      message: 'write EPIPE',
    }))
    expect(events).toContainEqual(expect.objectContaining({
      type: 'agent_status',
      status: 'error',
    }))
  })

  it('finalizes streamed text before emitting cancellation events', async () => {
    queryMock.mockReturnValue(messages([
      {
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'partial answer' },
        },
      },
      { type: 'result', subtype: 'success', result: 'ignored', usage: { input_tokens: 1, output_tokens: 1 }, total_cost_usd: 0 },
    ]))
    const events: AgentEvent[] = []
    const executor = new ClaudeSDKExecutor()
    executor.onEvent((event) => {
      events.push(event)
      if (event.type === 'assistant_message' && event.mode === 'delta') executor.cancel()
    })

    await executor.executeTurn('sess-1', 'turn-1', 'hello', baseConfig())

    const completedIndex = events.findIndex((event) =>
      event.type === 'assistant_message' && event.mode === 'complete',
    )
    const abortedIndex = events.findIndex((event) =>
      event.type === 'agent_error' && event.code === 'ABORTED',
    )
    const cancelledIndex = events.findIndex((event) =>
      event.type === 'agent_status' && event.status === 'cancelled',
    )
    expect(events[completedIndex]).toEqual(expect.objectContaining({
      content: 'partial answer',
      segmentId: expect.any(String),
    }))
    expect(completedIndex).toBeGreaterThan(-1)
    expect(completedIndex).toBeLessThan(abortedIndex)
    expect(abortedIndex).toBeLessThan(cancelledIndex)
  })

  it('force-closes the active SDK query when cancelled', async () => {
    let releaseQuery: (() => void) | undefined
    const released = new Promise<void>((resolve) => {
      releaseQuery = resolve
    })
    const close = vi.fn()
    const query = (async function* () {
      await released
      yield {
        type: 'result',
        subtype: 'success',
        result: 'ignored',
        usage: { input_tokens: 1, output_tokens: 1 },
        total_cost_usd: 0,
      }
    })()
    Object.assign(query, { close })
    queryMock.mockReturnValue(query)
    const executor = new ClaudeSDKExecutor()

    const execution = executor.executeTurn('sess-1', 'turn-1', 'hello', baseConfig())
    await vi.waitFor(() => expect(queryMock).toHaveBeenCalledOnce())
    executor.cancel()
    releaseQuery?.()
    await execution

    expect(close).toHaveBeenCalledOnce()
  })

  it('does not start a query when cancelled during SDK initialization', async () => {
    queryMock.mockReturnValue(messages([]))
    const executor = new ClaudeSDKExecutor()

    const execution = executor.executeTurn('sess-1', 'turn-1', 'hello', baseConfig())
    executor.cancel()
    await execution

    expect(queryMock).not.toHaveBeenCalled()
  })

  it('finalizes streamed text before an SDK error result', async () => {
    queryMock.mockReturnValue(messages([
      {
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'partial before failure' },
        },
      },
      {
        type: 'result',
        subtype: 'error_during_execution',
        usage: { input_tokens: 1, output_tokens: 1 },
        total_cost_usd: 0,
        errors: ['provider failed'],
      },
    ]))
    const events: AgentEvent[] = []
    const executor = new ClaudeSDKExecutor()
    executor.onEvent((event) => events.push(event))

    await executor.executeTurn('sess-1', 'turn-1', 'hello', baseConfig())

    const completedIndex = events.findIndex((event) =>
      event.type === 'assistant_message' && event.mode === 'complete',
    )
    const errorIndex = events.findIndex((event) =>
      event.type === 'agent_error' && event.code === 'ERROR_DURING_EXECUTION',
    )
    expect(events[completedIndex]).toEqual(expect.objectContaining({
      content: 'partial before failure',
    }))
    expect(completedIndex).toBeGreaterThan(-1)
    expect(completedIndex).toBeLessThan(errorIndex)
  })

  it('automatically extends max turns and resumes once when the SDK reports max turns', async () => {
    queryMock
      .mockReturnValueOnce(messages([
        {
          type: 'result',
          subtype: 'error_max_turns',
          uuid: 'result-1',
          session_id: 'sess-1',
          duration_ms: 10,
          duration_api_ms: 10,
          is_error: true,
          num_turns: 25,
          total_cost_usd: 0,
          usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
          errors: ['Reached maximum number of turns (25)'],
        },
      ]))
      .mockReturnValueOnce(messages([
        {
          type: 'result',
          subtype: 'success',
          uuid: 'result-2',
          session_id: 'sess-1',
          duration_ms: 10,
          duration_api_ms: 10,
          is_error: false,
          num_turns: 1,
          result: 'done',
          total_cost_usd: 0,
          usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        },
      ]))
    const events: AgentEvent[] = []
    const executor = new ClaudeSDKExecutor()
    executor.onEvent((event) => events.push(event))

    await executor.executeTurn('sess-1', 'turn-1', 'hello', {
      ...baseConfig(),
      maxTurnCount: 25,
      maxTurnExtensionRetries: 1,
    })

    const firstOptions = queryMock.mock.calls[0]?.[0]?.options as SDKQueryOptions
    const secondOptions = queryMock.mock.calls[1]?.[0]?.options as SDKQueryOptions

    expect(queryMock).toHaveBeenCalledTimes(2)
    expect(firstOptions).toMatchObject({ sessionId: 'sess-1', maxTurns: 25 })
    expect(secondOptions).toMatchObject({ resume: 'sess-1', maxTurns: 50 })
    await expect(readPromptText(queryMock.mock.calls[1]?.[0]?.prompt)).resolves.toContain(
      'Continue the previous task',
    )
    expect(events).toContainEqual(expect.objectContaining({
      type: 'agent_status',
      status: 'thinking',
      message: 'Reached maximum turns (25); automatically extending to 50 (retry 1/1).',
    }))
    expect(events).not.toContainEqual(expect.objectContaining({ type: 'agent_error' }))
    expect(events).toContainEqual(expect.objectContaining({ type: 'assistant_message', content: 'done' }))
    expect(events).toContainEqual(expect.objectContaining({ type: 'agent_status', status: 'completed' }))
  })

  it('stops after the max-turn extension retry threshold and asks the user to decide', async () => {
    const maxTurnsResult = (uuid: string, limit: number) => ({
      type: 'result',
      subtype: 'error_max_turns',
      uuid,
      session_id: 'sess-1',
      duration_ms: 10,
      duration_api_ms: 10,
      is_error: true,
      num_turns: limit,
      total_cost_usd: 0,
      usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      errors: [`Reached maximum number of turns (${limit})`],
    })
    queryMock
      .mockReturnValueOnce(messages([maxTurnsResult('result-1', 25)]))
      .mockReturnValueOnce(messages([maxTurnsResult('result-2', 50)]))
    const events: AgentEvent[] = []
    const executor = new ClaudeSDKExecutor()
    executor.onEvent((event) => events.push(event))

    await executor.executeTurn('sess-1', 'turn-1', 'hello', {
      ...baseConfig(),
      maxTurnCount: 25,
      maxTurnExtensionRetries: 1,
    })

    expect(queryMock).toHaveBeenCalledTimes(2)
    expect(events).toContainEqual(expect.objectContaining({
      type: 'agent_error',
      code: 'MAX_ITERATIONS',
      message: 'Reached maximum number of turns (50) after 1 automatic extension. Review progress and choose whether to continue.',
      retryable: false,
    }))
    expect(events).toContainEqual(expect.objectContaining({ type: 'agent_status', status: 'error' }))
  })

  it('auto-extends when the SDK throws a max-turns exception instead of emitting a result message', async () => {
    queryMock
      .mockImplementationOnce(() => {
        throw new Error('Claude Code returned an error result: Reached maximum number of turns (25)')
      })
      .mockReturnValueOnce(messages([
        {
          type: 'result',
          subtype: 'success',
          uuid: 'result-success',
          session_id: 'sess-1',
          duration_ms: 10,
          duration_api_ms: 10,
          is_error: false,
          num_turns: 1,
          result: 'done',
          total_cost_usd: 0,
          usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        },
      ]))
    const events: AgentEvent[] = []
    const executor = new ClaudeSDKExecutor()
    executor.onEvent((event) => events.push(event))

    await executor.executeTurn('sess-1', 'turn-1', 'hello', {
      ...baseConfig(),
      maxTurnCount: 25,
      maxTurnExtensionRetries: 1,
    })

    const firstOptions = queryMock.mock.calls[0]?.[0]?.options as SDKQueryOptions
    const secondOptions = queryMock.mock.calls[1]?.[0]?.options as SDKQueryOptions

    expect(queryMock).toHaveBeenCalledTimes(2)
    expect(firstOptions).toMatchObject({ sessionId: 'sess-1', maxTurns: 25 })
    expect(secondOptions).toMatchObject({ resume: 'sess-1', maxTurns: 50 })
    expect(events).toContainEqual(expect.objectContaining({
      type: 'agent_status',
      status: 'thinking',
      message: 'Reached maximum turns (25); automatically extending to 50 (retry 1/1).',
    }))
    expect(events).not.toContainEqual(expect.objectContaining({ code: 'SDK_ERROR' }))
    expect(events).toContainEqual(expect.objectContaining({ type: 'agent_status', status: 'completed' }))
  })

  it('returns SDK-compatible permission results with the original input', async () => {
    queryMock.mockReturnValue(messages([
      { type: 'result', subtype: 'success', result: 'ok', usage: { input_tokens: 1, output_tokens: 1 }, total_cost_usd: 0 },
    ]))
    const approvalCallback = vi.fn(async () => true)
    const input = { command: 'git status' }

    await new ClaudeSDKExecutor().executeTurn('sess-1', 'turn-1', 'hello', {
      ...baseConfig(),
      approvalCallback,
    })

    const options = queryMock.mock.calls[0]?.[0]?.options as SDKQueryOptions
    const result = await options.canUseTool?.('Bash', input, {
      signal: new AbortController().signal,
      toolUseID: 'tool-1',
      requestId: 'request-tool-1',
    })

    expect(result).toEqual({
      behavior: 'allow',
      updatedInput: input,
      toolUseID: 'tool-1',
      decisionClassification: 'user_temporary',
    })
  })

  it('passes SDK request metadata through and returns scoped permission updates', async () => {
    queryMock.mockReturnValue(messages([
      { type: 'result', subtype: 'success', result: 'ok', usage: { input_tokens: 1, output_tokens: 1 }, total_cost_usd: 0 },
    ]))
    const approvalCallback = vi.fn(async () => ({ allowed: true, scope: 'project' as const }))
    const suggestion = {
      type: 'addRules' as const,
      rules: [{ toolName: 'Bash', ruleContent: 'git status' }],
      behavior: 'allow' as const,
      destination: 'session' as const,
    }

    await new ClaudeSDKExecutor().executeTurn('sess-1', 'turn-1', 'hello', {
      ...baseConfig(),
      approvalCallback,
    })

    const options = queryMock.mock.calls[0]?.[0]?.options as SDKQueryOptions
    const result = await options.canUseTool?.('Bash', { command: 'git status' }, {
      signal: new AbortController().signal,
      toolUseID: 'tool-1',
      requestId: 'control-request-1',
      suggestions: [suggestion],
    })

    expect(approvalCallback).toHaveBeenCalledWith(
      'sess-1',
      'Bash',
      { command: 'git status' },
      expect.objectContaining({
        requestId: 'control-request-1',
        toolUseID: 'tool-1',
        suggestions: [suggestion],
      }),
    )
    expect(result).toEqual({
      behavior: 'allow',
      updatedInput: { command: 'git status' },
      updatedPermissions: [{ ...suggestion, destination: 'projectSettings' }],
      toolUseID: 'tool-1',
      decisionClassification: 'user_permanent',
    })
  })

  it('maps permission update destinations only for explicitly persistent approvals', async () => {
    queryMock.mockReturnValue(messages([
      { type: 'result', subtype: 'success', result: 'ok', usage: { input_tokens: 1, output_tokens: 1 }, total_cost_usd: 0 },
    ]))
    let scope: 'once' | 'session' | 'project' | 'global' = 'once'
    const approvalCallback = vi.fn(async () => ({ allowed: true, scope }))
    await new ClaudeSDKExecutor().executeTurn('sess-1', 'turn-1', 'hello', {
      ...baseConfig(),
      approvalCallback,
    })
    const options = queryMock.mock.calls[0]?.[0]?.options as SDKQueryOptions
    const suggestion = {
      type: 'setMode' as const,
      mode: 'acceptEdits' as const,
      destination: 'session' as const,
    }

    for (const testCase of [
      { scope: 'once' as const, destination: undefined, classification: 'user_temporary' },
      { scope: 'session' as const, destination: 'session', classification: 'user_permanent' },
      { scope: 'project' as const, destination: 'projectSettings', classification: 'user_permanent' },
      { scope: 'global' as const, destination: 'userSettings', classification: 'user_permanent' },
    ]) {
      scope = testCase.scope
      const result = await options.canUseTool?.('Edit', { file_path: 'README.md' }, {
        signal: new AbortController().signal,
        toolUseID: `tool-${scope}`,
        requestId: `request-${scope}`,
        suggestions: [suggestion],
      })
      expect(result).toEqual(
        expect.objectContaining({ decisionClassification: testCase.classification }),
      )
      if (testCase.destination == null) {
        expect(result).not.toHaveProperty('updatedPermissions')
      } else {
        expect(result).toHaveProperty('updatedPermissions.0.destination', testCase.destination)
      }
    }
  })

  it('updates the active SDK Query permission mode while retaining the local fallback', async () => {
    let releaseQuery!: () => void
    const queryGate = new Promise<void>((resolve) => {
      releaseQuery = resolve
    })
    async function* controlledMessages() {
      await queryGate
      yield {
        type: 'result',
        subtype: 'success',
        result: 'ok',
        usage: { input_tokens: 1, output_tokens: 1 },
        total_cost_usd: 0,
      }
    }
    const setPermissionMode = vi.fn(async () => undefined)
    queryMock.mockReturnValue(Object.assign(controlledMessages(), { setPermissionMode }))
    const executor = new ClaudeSDKExecutor()
    const turn = executor.executeTurn('sess-1', 'turn-1', 'hello', baseConfig())

    try {
      await vi.waitFor(() => expect(queryMock).toHaveBeenCalledTimes(1))
      await executor.setPermissionMode('claude-auto-edits')
      expect(setPermissionMode).toHaveBeenCalledWith('acceptEdits')
    } finally {
      releaseQuery()
      await turn
    }
  })

  it('enables strict MCP configuration validation', async () => {
    queryMock.mockReturnValue(messages([
      { type: 'result', subtype: 'success', result: 'ok', usage: { input_tokens: 1, output_tokens: 1 }, total_cost_usd: 0 },
    ]))

    await new ClaudeSDKExecutor().executeTurn('sess-1', 'turn-1', 'hello', {
      ...baseConfig(),
      mcpServers: { docs: { type: 'stdio', command: 'docs-server' } },
    })

    const options = queryMock.mock.calls[0]?.[0]?.options as SDKQueryOptions
    expect(options.strictMcpConfig).toBe(true)
  })

  it('enables bounded subagent visibility and disables conflicting native workflows', async () => {
    queryMock.mockReturnValue(messages([
      { type: 'result', subtype: 'success', result: 'ok', usage: { input_tokens: 1, output_tokens: 1 }, total_cost_usd: 0 },
    ]))

    await new ClaudeSDKExecutor().executeTurn('sess-1', 'turn-1', 'hello', baseConfig())

    const options = queryMock.mock.calls[0]?.[0]?.options as SDKQueryOptions
    expect(options).toMatchObject({
      forwardSubagentText: true,
      agentProgressSummaries: true,
      disableWorkflows: true,
      workflowKeywordTriggerEnabled: false,
    })
  })

  it('bridges only SDK permission-request hooks into Spark application hooks', async () => {
    queryMock.mockReturnValue(messages([
      { type: 'result', subtype: 'success', result: 'ok', usage: { input_tokens: 1, output_tokens: 1 }, total_cost_usd: 0 },
    ]))
    const applicationHookCallback = vi.fn(async () => undefined)

    await new ClaudeSDKExecutor().executeTurn('sess-1', 'turn-1', 'hello', {
      ...baseConfig(),
      applicationHookCallback,
    })

    const options = queryMock.mock.calls[0]?.[0]?.options as SDKQueryOptions
    expect(Object.keys(options.hooks ?? {})).toEqual(['PermissionRequest'])
    const hook = options.hooks?.PermissionRequest?.[0]?.hooks[0]
    await expect(hook?.({
      hook_event_name: 'PermissionRequest',
      session_id: 'sdk-session-1',
      transcript_path: '/private/transcript.jsonl',
      cwd: '/tmp',
      tool_name: 'Bash',
      tool_input: { command: 'pnpm test' },
    }, 'tool-1', { signal: new AbortController().signal })).resolves.toEqual({ continue: true })
    expect(applicationHookCallback).toHaveBeenCalledWith('sess-1', 'permission_request', {
      title: 'Spark Agent - 权限请求',
      body: 'Claude 请求使用 Bash',
    })
  })

  it('bridges form MCP elicitations through the existing structured question UI', async () => {
    queryMock.mockReturnValue(messages([
      { type: 'result', subtype: 'success', result: 'ok', usage: { input_tokens: 1, output_tokens: 1 }, total_cost_usd: 0 },
    ]))
    const questionCallback = vi.fn(async () => ({
      answers: [
        { id: 'environment', answer: 'staging' },
        { id: 'notes', answer: 'Run a dry check first' },
      ],
    }))

    await new ClaudeSDKExecutor().executeTurn('sess-1', 'turn-1', 'hello', {
      ...baseConfig(),
      questionCallback,
    })

    const options = queryMock.mock.calls[0]?.[0]?.options as SDKQueryOptions
    await expect(options.onElicitation?.({
      serverName: 'deploy',
      message: 'Deployment parameters',
      mode: 'form',
      requestedSchema: {
        type: 'object',
        required: ['environment'],
        properties: {
          environment: {
            type: 'string',
            title: 'Environment',
            description: 'Choose a target',
            enum: ['staging', 'production'],
          },
          notes: { type: 'string', title: 'Notes', description: 'Optional details' },
        },
      },
    }, { signal: new AbortController().signal })).resolves.toEqual({
      action: 'accept',
      content: { environment: 'staging', notes: 'Run a dry check first' },
    })
    expect(questionCallback).toHaveBeenCalledWith('sess-1', [
      expect.objectContaining({
        id: 'environment',
        question: 'Environment',
        type: 'single_choice',
        required: true,
        options: [
          { label: 'staging', description: 'Choose a target' },
          { label: 'production', description: 'Choose a target' },
        ],
      }),
      expect.objectContaining({
        id: 'notes',
        question: 'Notes',
        type: 'text',
        required: false,
      }),
    ], expect.objectContaining({ signal: expect.anything() }))
  })

  it('declines form MCP elicitations when a required field has no usable answer', async () => {
    queryMock.mockReturnValue(messages([
      { type: 'result', subtype: 'success', result: 'ok', usage: { input_tokens: 1, output_tokens: 1 }, total_cost_usd: 0 },
    ]))
    const questionCallback = vi.fn(async () => ({ answers: [] }))

    await new ClaudeSDKExecutor().executeTurn('sess-1', 'turn-1', 'hello', {
      ...baseConfig(),
      questionCallback,
    })

    const options = queryMock.mock.calls[0]?.[0]?.options as SDKQueryOptions
    await expect(options.onElicitation?.({
      serverName: 'deploy',
      message: 'Deployment parameters',
      mode: 'form',
      requestedSchema: {
        type: 'object',
        required: ['environment'],
        properties: {
          environment: { type: 'string', title: 'Environment' },
          notes: { type: 'string', title: 'Notes' },
        },
      },
    }, { signal: new AbortController().signal })).resolves.toEqual({ action: 'decline' })
  })

  it('declines unsupported URL elicitations instead of silently accepting authorization', async () => {
    queryMock.mockReturnValue(messages([
      { type: 'result', subtype: 'success', result: 'ok', usage: { input_tokens: 1, output_tokens: 1 }, total_cost_usd: 0 },
    ]))
    const questionCallback = vi.fn(async () => ({ answers: [] }))

    await new ClaudeSDKExecutor().executeTurn('sess-1', 'turn-1', 'hello', {
      ...baseConfig(),
      questionCallback,
    })

    const options = queryMock.mock.calls[0]?.[0]?.options as SDKQueryOptions
    await expect(options.onElicitation?.({
      serverName: 'oauth-server',
      message: 'Authorize access',
      mode: 'url',
      url: 'https://example.com/oauth',
    }, { signal: new AbortController().signal })).resolves.toEqual({ action: 'decline' })
    expect(questionCallback).not.toHaveBeenCalled()
  })

  it('routes bare allowed tools through canUseTool when Spark installs a permission callback', async () => {
    queryMock.mockReturnValue(messages([
      { type: 'result', subtype: 'success', result: 'ok', usage: { input_tokens: 1, output_tokens: 1 }, total_cost_usd: 0 },
    ]))
    const approvalCallback = vi.fn(async () => false)
    const mcpInput = { query: 'skills' }

    await new ClaudeSDKExecutor().executeTurn('sess-1', 'turn-1', 'hello', {
      ...baseConfig(),
      allowedTools: ['mcp__spark_platform__skills_list', 'Bash(git status:*)'],
      approvalCallback,
    })

    const options = queryMock.mock.calls[0]?.[0]?.options as SDKQueryOptions

    expect(options.allowedTools).toEqual(['Bash(git status:*)'])
    expect(options.settings).toMatchObject({
      permissions: {
        allow: ['Bash(git status:*)'],
      },
    })
    await expect(options.canUseTool?.('mcp__spark_platform__skills_list', mcpInput, {
      signal: new AbortController().signal,
      toolUseID: 'tool-mcp',
      requestId: 'request-tool-mcp',
    })).resolves.toEqual({
      behavior: 'allow',
      updatedInput: mcpInput,
      toolUseID: 'tool-mcp',
      decisionClassification: 'user_temporary',
    })
    expect(approvalCallback).not.toHaveBeenCalled()
  })

  it('auto-allows SDK plan and user-question control tool aliases', async () => {
    queryMock.mockReturnValue(messages([
      { type: 'result', subtype: 'success', result: 'ok', usage: { input_tokens: 1, output_tokens: 1 }, total_cost_usd: 0 },
    ]))
    const approvalCallback = vi.fn(async () => false)
    const input = { plan: '# Plan' }
    const questionCallback = vi.fn(async () => ({ answers: {} }))

    await new ClaudeSDKExecutor().executeTurn('sess-1', 'turn-1', 'hello', {
      ...baseConfig(),
      approvalCallback,
      questionCallback,
    })

    const options = queryMock.mock.calls[0]?.[0]?.options as SDKQueryOptions
    await expect(options.canUseTool?.('exit_plan_mode', input, {
      signal: new AbortController().signal,
      toolUseID: 'tool-plan',
      requestId: 'request-tool-plan',
    })).resolves.toEqual({
      behavior: 'allow',
      updatedInput: input,
      toolUseID: 'tool-plan',
      decisionClassification: 'user_temporary',
    })
    await expect(options.canUseTool?.('AskUserQuestion', { question: 'Proceed?', questions: [{ question: 'Proceed?', header: 'Confirm', options: [{ label: 'Yes', description: 'Proceed' }] }] }, {
      signal: new AbortController().signal,
      toolUseID: 'tool-question',
      requestId: 'request-tool-question',
    })).resolves.toEqual(expect.objectContaining({ behavior: 'allow' }))
    expect(approvalCallback).not.toHaveBeenCalled()
    expect(questionCallback).toHaveBeenCalledWith('sess-1', [
      {
        question: 'Proceed?',
        header: 'Confirm',
        type: 'single_choice',
        required: true,
        options: [{ label: 'Yes', description: 'Proceed' }],
      },
    ], expect.objectContaining({
      questionId: 'tool-question',
      requestId: 'request-tool-question',
      signal: expect.anything(),
    }))
  })

  it('registers AskUserQuestion callback even without Spark approval callback', async () => {
    queryMock.mockReturnValue(messages([
      { type: 'result', subtype: 'success', result: 'ok', usage: { input_tokens: 1, output_tokens: 1 }, total_cost_usd: 0 },
    ]))
    const questionCallback = vi.fn(async () => ({ answers: [{ question: 'Proceed?', answer: 'Yes' }] }))

    await new ClaudeSDKExecutor().executeTurn('sess-1', 'turn-1', 'hello', {
      ...baseConfig(),
      questionCallback,
    })

    const options = queryMock.mock.calls[0]?.[0]?.options as SDKQueryOptions
    const result = await options.canUseTool?.('AskUserQuestion', {
      questions: [{ question: 'Proceed?', header: 'Confirm', options: [{ label: 'Yes' }] }],
    }, {
      signal: new AbortController().signal,
      toolUseID: 'tool-question',
      requestId: 'request-tool-question',
    })

    expect(result).toEqual(expect.objectContaining({
      behavior: 'allow',
      updatedInput: {
        questions: [{ question: 'Proceed?', header: 'Confirm', options: [{ label: 'Yes' }] }],
        answers: { 'Proceed?': 'Yes' },
      },
    }))
    expect(questionCallback).toHaveBeenCalledOnce()
  })

  it('keeps the structured question callback installed in every interactive Claude mode', async () => {
    queryMock.mockReturnValue(messages([
      { type: 'result', subtype: 'success', result: 'ok', usage: { input_tokens: 1, output_tokens: 1 }, total_cost_usd: 0 },
    ]))
    const questionCallback = vi.fn(async () => ({ answers: [] }))
    const modes = [
      'claude-ask',
      'claude-auto-edits',
      'claude-plan',
      'claude-auto',
      'claude-bypass',
    ] as const

    for (const [index, permissionMode] of modes.entries()) {
      await new ClaudeSDKExecutor().executeTurn(`sess-${index}`, 'turn-1', 'hello', {
        ...baseConfig(),
        permissionMode,
        questionCallback,
      })
      const options = queryMock.mock.calls[index]?.[0]?.options as SDKQueryOptions
      expect(typeof options.canUseTool, permissionMode).toBe('function')
    }
  })

  it('denies AskUserQuestion during unattended automation turns', async () => {
    queryMock.mockReturnValue(messages([
      { type: 'result', subtype: 'success', result: 'ok', usage: { input_tokens: 1, output_tokens: 1 }, total_cost_usd: 0 },
    ]))

    await new ClaudeSDKExecutor().executeTurn('sess-1', 'turn-1', 'hello', {
      ...baseConfig(),
      permissionMode: 'claude-auto',
      unattended: true,
    })

    const options = queryMock.mock.calls[0]?.[0]?.options as SDKQueryOptions
    const result = await options.canUseTool?.('AskUserQuestion', {
      questions: [{ question: 'Proceed?', header: 'Confirm', options: [{ label: 'Yes' }] }],
    }, {
      signal: new AbortController().signal,
      toolUseID: 'tool-question',
      requestId: 'request-tool-question',
    })

    expect(typeof options.canUseTool).toBe('function')
    expect(result).toEqual(expect.objectContaining({
      behavior: 'deny',
      message: expect.stringContaining('unattended automation'),
    }))
  })

  it('maps cancelled AskUserQuestion answers to SDK-native refusal text', async () => {
    queryMock.mockReturnValue(messages([
      { type: 'result', subtype: 'success', result: 'ok', usage: { input_tokens: 1, output_tokens: 1 }, total_cost_usd: 0 },
    ]))
    const questionCallback = vi.fn(async () => ({
      cancelled: true,
      declined: true,
      reason: '用户取消了问答弹窗，拒绝回答这些问题。',
      answers: [{ question: 'Proceed?', answer: '用户拒绝回答', skipped: true, declined: true }],
    }))

    await new ClaudeSDKExecutor().executeTurn('sess-1', 'turn-1', 'hello', {
      ...baseConfig(),
      questionCallback,
    })

    const options = queryMock.mock.calls[0]?.[0]?.options as SDKQueryOptions
    const result = await options.canUseTool?.('AskUserQuestion', {
      questions: [{ question: 'Proceed?', header: 'Confirm', options: [{ label: 'Yes' }] }],
    }, {
      signal: new AbortController().signal,
      toolUseID: 'tool-question',
      requestId: 'request-tool-question',
    })

    expect(result).toEqual(expect.objectContaining({
      behavior: 'allow',
      updatedInput: expect.objectContaining({
        cancelled: true,
        declined: true,
        answers: { 'Proceed?': '用户拒绝回答' },
        reason: '用户取消了问答弹窗，拒绝回答这些问题。',
      }),
    }))
  })

  it('normalizes text and custom-choice AskUserQuestion prompts before invoking the callback', async () => {
    queryMock.mockReturnValue(messages([
      { type: 'result', subtype: 'success', result: 'ok', usage: { input_tokens: 1, output_tokens: 1 }, total_cost_usd: 0 },
    ]))
    const approvalCallback = vi.fn(async () => false)
    const questionCallback = vi.fn(async () => ({ answers: [] }))

    await new ClaudeSDKExecutor().executeTurn('sess-1', 'turn-1', 'hello', {
      ...baseConfig(),
      approvalCallback,
      questionCallback,
    })

    const options = queryMock.mock.calls[0]?.[0]?.options as SDKQueryOptions
    await options.canUseTool?.('AskUserQuestion', {
      questions: [
        {
          id: 'role',
          question: '你的角色是什么？',
          header: '角色',
          type: 'single_choice',
          allowOther: true,
          options: [{ label: '开发者', description: '偏实现' }],
        },
        {
          id: 'context',
          question: '补充一下当前上下文',
          header: '补充信息',
          type: 'text',
          multiline: true,
          placeholder: '例如：报错、预期行为、复现步骤',
        },
      ],
    }, {
      signal: new AbortController().signal,
      toolUseID: 'tool-question-2',
      requestId: 'request-tool-question-2',
    })

    expect(questionCallback).toHaveBeenLastCalledWith('sess-1', [
      {
        id: 'role',
        question: '你的角色是什么？',
        header: '角色',
        type: 'single_choice',
        required: true,
        allowOther: true,
        options: [{ label: '开发者', description: '偏实现' }],
      },
      {
        id: 'context',
        question: '补充一下当前上下文',
        header: '补充信息',
        type: 'text',
        required: true,
        multiline: true,
        placeholder: '例如：报错、预期行为、复现步骤',
      },
    ], expect.objectContaining({
      questionId: 'tool-question-2',
      requestId: 'request-tool-question-2',
      signal: expect.anything(),
    }))
  })

  it('normalizes multiSelect AskUserQuestion prompts to multi_choice', async () => {
    queryMock.mockReturnValue(messages([
      { type: 'result', subtype: 'success', result: 'ok', usage: { input_tokens: 1, output_tokens: 1 }, total_cost_usd: 0 },
    ]))
    const approvalCallback = vi.fn(async () => false)
    const questionCallback = vi.fn(async () => ({ answers: [] }))

    await new ClaudeSDKExecutor().executeTurn('sess-1', 'turn-1', 'hello', {
      ...baseConfig(),
      approvalCallback,
      questionCallback,
    })

    const options = queryMock.mock.calls[0]?.[0]?.options as SDKQueryOptions
    await options.canUseTool?.('AskUserQuestion', {
      questions: [
        {
          id: 'stacks',
          question: '你想用哪些技术栈？',
          header: '技术栈',
          multiSelect: true,
          options: [
            { label: 'React' },
            { label: 'Vue' },
            { label: 'Svelte' },
          ],
        },
      ],
    }, {
      signal: new AbortController().signal,
      toolUseID: 'tool-question-multi',
      requestId: 'request-tool-question-multi',
    })

    expect(questionCallback).toHaveBeenLastCalledWith('sess-1', [
      {
        id: 'stacks',
        question: '你想用哪些技术栈？',
        header: '技术栈',
        type: 'multi_choice',
        required: true,
        multiSelect: true,
        options: [
          { label: 'React' },
          { label: 'Vue' },
          { label: 'Svelte' },
        ],
      },
    ], expect.objectContaining({
      questionId: 'tool-question-multi',
      requestId: 'request-tool-question-multi',
      signal: expect.anything(),
    }))
  })

  it('lets SDK-native auto and bypass modes own tool permissions without Spark canUseTool', async () => {
    queryMock.mockReturnValue(messages([
      { type: 'result', subtype: 'success', result: 'ok', usage: { input_tokens: 1, output_tokens: 1 }, total_cost_usd: 0 },
    ]))
    const approvalCallback = vi.fn(async () => false)

    await new ClaudeSDKExecutor().executeTurn('sess-1', 'turn-1', 'hello', {
      ...baseConfig(),
      permissionMode: 'claude-auto',
      approvalCallback,
    })
    await new ClaudeSDKExecutor().executeTurn('sess-2', 'turn-1', 'hello', {
      ...baseConfig(),
      permissionMode: 'claude-bypass',
      approvalCallback,
    })

    const autoOptions = queryMock.mock.calls[0]?.[0]?.options as SDKQueryOptions
    const bypassOptions = queryMock.mock.calls[1]?.[0]?.options as SDKQueryOptions
    expect(autoOptions.permissionMode).toBe('auto')
    expect(autoOptions.canUseTool).toBeUndefined()
    expect(bypassOptions.permissionMode).toBe('bypassPermissions')
    expect(bypassOptions.canUseTool).toBeUndefined()
  })

  it('auto-allows edit tools in acceptEdits mode and still asks for Bash', async () => {
    queryMock.mockReturnValue(messages([
      { type: 'result', subtype: 'success', result: 'ok', usage: { input_tokens: 1, output_tokens: 1 }, total_cost_usd: 0 },
    ]))
    const approvalCallback = vi.fn(async () => true)

    await new ClaudeSDKExecutor().executeTurn('sess-1', 'turn-1', 'hello', {
      ...baseConfig(),
      permissionMode: 'claude-auto-edits',
      approvalCallback,
    })

    const options = queryMock.mock.calls[0]?.[0]?.options as SDKQueryOptions
    const input = { file_path: 'README.md' }
    const editResult = await options.canUseTool?.('Edit', input, {
      signal: new AbortController().signal,
      toolUseID: 'tool-edit',
      requestId: 'request-tool-edit',
    })
    const bashResult = await options.canUseTool?.('Bash', { command: 'npm test' }, {
      signal: new AbortController().signal,
      toolUseID: 'tool-bash',
      requestId: 'request-tool-bash',
    })

    expect(editResult).toEqual({
      behavior: 'allow',
      updatedInput: input,
      toolUseID: 'tool-edit',
      decisionClassification: 'user_temporary',
    })
    expect(approvalCallback).toHaveBeenCalledTimes(1)
    expect(approvalCallback).toHaveBeenCalledWith(
      'sess-1',
      'Bash',
      { command: 'npm test' },
      expect.objectContaining({ requestId: 'request-tool-bash' }),
    )
    expect(bashResult).toEqual(expect.objectContaining({ behavior: 'allow' }))
  })

  it('configures AskUserQuestion previews and reminds the model to provide options', async () => {
    queryMock.mockReturnValue(messages([
      { type: 'result', subtype: 'success', result: 'ok', usage: { input_tokens: 1, output_tokens: 1 }, total_cost_usd: 0 },
    ]))

    await new ClaudeSDKExecutor().executeTurn('sess-1', 'turn-1', 'hello', baseConfig())

    const options = queryMock.mock.calls[0]?.[0]?.options as SDKQueryOptions
    expect(options.toolConfig).toEqual({
      askUserQuestion: { previewFormat: 'html' },
    })
    expect(JSON.stringify(options.systemPrompt)).toContain('AskUserQuestion')
    expect(JSON.stringify(options.systemPrompt)).toContain('options')
  })

  // ── Resume Recovery Tests ──────────────────────────────────────────────────

  describe('resume recovery', () => {
    it('falls back to a fresh session when resume throws a session-not-found error', async () => {
      queryMock
        .mockImplementationOnce(() => { throw new Error('Session not found: sdk-session-1') })
        .mockReturnValueOnce(messages([
          { type: 'result', subtype: 'success', result: 'recovered', usage: { input_tokens: 1, output_tokens: 1 }, total_cost_usd: 0 },
        ]))

      const events: AgentEvent[] = []
      const executor = new ClaudeSDKExecutor()
      executor.onEvent((event) => events.push(event))

      await executor.executeTurn('sess-1', 'turn-1', 'hello', {
        ...baseConfig(),
        sdkSessionId: 'sdk-session-1',
        continueSession: true,
      })

      expect(queryMock).toHaveBeenCalledTimes(2)

      // First call should have used resume
      const firstOptions = queryMock.mock.calls[0]?.[0]?.options as SDKQueryOptions
      expect(firstOptions.resume).toBe('sdk-session-1')

      // Second call should use sessionId (fresh mode, no resume)
      const secondOptions = queryMock.mock.calls[1]?.[0]?.options as SDKQueryOptions
      expect(secondOptions.resume).toBeUndefined()
      expect(secondOptions.sessionId).toBeDefined()
      expect(typeof secondOptions.sessionId).toBe('string')
      // Fresh session id should differ from the original resume id
      expect(secondOptions.sessionId).not.toBe('sdk-session-1')

      // Should emit a telemetry status about the recovery
      expect(events).toContainEqual(expect.objectContaining({
        type: 'agent_status',
        status: 'thinking',
        message: expect.stringContaining('Session resume failed'),
      }))

      // Should complete successfully
      expect(events).toContainEqual(expect.objectContaining({
        type: 'agent_status',
        status: 'completed',
      }))
    })

    it('falls back when resume throws a session-already-in-use error', async () => {
      queryMock
        .mockImplementationOnce(() => { throw new Error('session id already in use') })
        .mockReturnValueOnce(messages([
          { type: 'result', subtype: 'success', result: 'ok', usage: { input_tokens: 1, output_tokens: 1 }, total_cost_usd: 0 },
        ]))

      const events: AgentEvent[] = []
      const executor = new ClaudeSDKExecutor()
      executor.onEvent((event) => events.push(event))

      await executor.executeTurn('sess-1', 'turn-1', 'hello', {
        ...baseConfig(),
        sdkSessionId: 'sdk-session-1',
        continueSession: true,
      })

      expect(queryMock).toHaveBeenCalledTimes(2)
      const secondOptions = queryMock.mock.calls[1]?.[0]?.options as SDKQueryOptions
      expect(secondOptions.resume).toBeUndefined()
      expect(secondOptions.sessionId).toBeDefined()
      expect(secondOptions.sessionId).not.toBe('sdk-session-1')
      expect(events).toContainEqual(expect.objectContaining({ type: 'agent_status', status: 'completed' }))
    })

    it('does not fall back on non-resume errors', async () => {
      queryMock.mockImplementation(() => { throw new Error('write EPIPE') })

      const events: AgentEvent[] = []
      const executor = new ClaudeSDKExecutor()
      executor.onEvent((event) => events.push(event))

      await expect(executor.executeTurn('sess-1', 'turn-1', 'hello', {
        ...baseConfig(),
        sdkSessionId: 'sdk-session-1',
        continueSession: true,
      })).rejects.toThrow('write EPIPE')

      // Should not retry - only one call
      expect(queryMock).toHaveBeenCalledTimes(1)
      expect(events).toContainEqual(expect.objectContaining({
        type: 'agent_error',
        code: 'SDK_ERROR',
      }))
    })

    it('does not fall back on fresh (non-resume) sessions', async () => {
      queryMock.mockImplementation(() => { throw new Error('Session not found: xyz') })

      const events: AgentEvent[] = []
      const executor = new ClaudeSDKExecutor()
      executor.onEvent((event) => events.push(event))

      await expect(executor.executeTurn('sess-1', 'turn-1', 'hello', {
        ...baseConfig(),
        sdkSessionId: 'sdk-session-1',
        continueSession: false,
      })).rejects.toThrow('Session not found: xyz')

      // Should not retry since this wasn't a resume attempt
      expect(queryMock).toHaveBeenCalledTimes(1)
    })

    it('opens the circuit breaker after consecutive resume failures', async () => {
      const breaker = getResumeCircuitBreaker()
      breaker.reset('sess-circuit')

      // Simulate 3 consecutive resume failures to open the circuit
      for (let i = 0; i < 3; i++) {
        queryMock.mockReset()
        queryMock
          .mockImplementationOnce(() => { throw new Error('Session not found') })
          .mockReturnValueOnce(messages([
            { type: 'result', subtype: 'success', result: 'ok', usage: { input_tokens: 1, output_tokens: 1 }, total_cost_usd: 0 },
          ]))

        const executor = new ClaudeSDKExecutor()
        await executor.executeTurn('sess-circuit', `turn-${i}`, 'hello', {
          ...baseConfig(),
          sdkSessionId: 'sdk-circuit',
          continueSession: true,
        })
      }

      // Now the circuit should be open - next resume failure should NOT fall back
      queryMock.mockReset()
      queryMock.mockImplementation(() => { throw new Error('Session not found') })

      const events: AgentEvent[] = []
      const executor = new ClaudeSDKExecutor()
      executor.onEvent((event) => events.push(event))

      await expect(executor.executeTurn('sess-circuit', 'turn-final', 'hello', {
        ...baseConfig(),
        sdkSessionId: 'sdk-circuit',
        continueSession: true,
      })).rejects.toThrow('Session not found')

      // Should only have called once (no fallback retry)
      expect(queryMock).toHaveBeenCalledTimes(1)
      expect(events).toContainEqual(expect.objectContaining({
        type: 'agent_error',
        code: 'SDK_RESUME_CIRCUIT_OPEN',
      }))
    })

    it('resets the circuit breaker on a successful turn', async () => {
      const breaker = getResumeCircuitBreaker()

      // Record 2 failures
      breaker.recordFailure('sess-recover')
      expect(breaker.isResumeAllowed('sess-recover')).toBe(true)
      expect(breaker.getFailureCount('sess-recover')).toBe(1)

      // Now a successful resume turn
      queryMock.mockReturnValue(messages([
        { type: 'result', subtype: 'success', result: 'ok', usage: { input_tokens: 1, output_tokens: 1 }, total_cost_usd: 0 },
      ]))

      const executor = new ClaudeSDKExecutor()
      await executor.executeTurn('sess-recover', 'turn-1', 'hello', {
        ...baseConfig(),
        sdkSessionId: 'sdk-recover',
        continueSession: true,
      })

      // Circuit breaker should be reset
      expect(breaker.getFailureCount('sess-recover')).toBe(0)
      expect(breaker.isResumeAllowed('sess-recover')).toBe(true)
    })
  })
})
