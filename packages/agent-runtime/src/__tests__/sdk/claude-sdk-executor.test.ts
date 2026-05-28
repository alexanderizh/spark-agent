import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '@spark/protocol'
import type { SDKQueryOptions } from '../../sdk/types.js'

const queryMock = vi.hoisted(() => vi.fn())

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: queryMock,
}))

const { ClaudeSDKExecutor, resetSDKLoadState } = await import('../../sdk/claude-sdk-executor.js')

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

describe('ClaudeSDKExecutor', () => {
  beforeEach(() => {
    queryMock.mockReset()
    resetSDKLoadState()
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
    expect(firstOptions.skills).toEqual([])
    expect(secondOptions).toMatchObject({ resume: 'sess-1' })
    expect(secondOptions.sessionId).toBeUndefined()
    expect(secondOptions.continue).toBeUndefined()
    expect(secondOptions.skills).toEqual([])
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
    })

    expect(result).toEqual({
      behavior: 'allow',
      updatedInput: input,
      toolUseID: 'tool-1',
      decisionClassification: 'user_temporary',
    })
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
    })
    const bashResult = await options.canUseTool?.('Bash', { command: 'npm test' }, {
      signal: new AbortController().signal,
      toolUseID: 'tool-bash',
    })

    expect(editResult).toEqual({
      behavior: 'allow',
      updatedInput: input,
      toolUseID: 'tool-edit',
      decisionClassification: 'user_temporary',
    })
    expect(approvalCallback).toHaveBeenCalledTimes(1)
    expect(approvalCallback).toHaveBeenCalledWith('sess-1', 'Bash', { command: 'npm test' })
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
})
