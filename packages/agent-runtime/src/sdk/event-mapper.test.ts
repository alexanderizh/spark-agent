import { describe, expect, it } from 'vitest'
import { mapSDKMessageToEvents } from './event-mapper.js'
import type { SDKAssistantMessage, SDKResultMessage, SDKUserMessage } from './types.js'

describe('mapSDKMessageToEvents', () => {
  it('keeps SDK tool result names and emits file changes for write tools', () => {
    const ctx = { sessionId: 'session-1', turnId: 'turn-1', toolNamesById: new Map<string, string>() }
    const assistant: SDKAssistantMessage = {
      type: 'assistant',
      uuid: 'assistant-1',
      session_id: 'sdk-session',
      parent_tool_use_id: null,
      message: {
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: 'tool-1',
          name: 'Edit',
          input: { file_path: 'src/index.ts', old_string: 'a', new_string: 'b' },
        }],
      },
    }
    const user: SDKUserMessage = {
      type: 'user',
      uuid: 'user-1',
      session_id: 'sdk-session',
      message: {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: 'tool-1',
          content: 'Updated src/index.ts',
        }],
      },
    }

    const toolCallEvents = mapSDKMessageToEvents(assistant, ctx)
    const resultEvents = mapSDKMessageToEvents(user, ctx)

    expect(toolCallEvents).toEqual([
      expect.objectContaining({
        type: 'tool_call',
        toolCallId: 'tool-1',
        toolName: 'edit_file',
        toolInput: expect.objectContaining({ file_path: 'src/index.ts' }),
      }),
    ])
    expect(resultEvents).toEqual([
      expect.objectContaining({
        type: 'tool_result',
        toolCallId: 'tool-1',
        toolName: 'edit_file',
        status: 'success',
      }),
      expect.objectContaining({
        type: 'file_change',
        changeType: 'modify',
        path: 'src/index.ts',
      }),
    ])
  })

  it('maps SDK result checkpoint metadata', () => {
    const result: SDKResultMessage = {
      type: 'result',
      subtype: 'success',
      uuid: 'result-1',
      session_id: 'sdk-session',
      duration_ms: 10,
      duration_api_ms: 5,
      is_error: false,
      num_turns: 1,
      result: 'done',
      total_cost_usd: 0.01,
      usage: {
        input_tokens: 100,
        output_tokens: 20,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
      checkpoint: {
        checkpoint_id: 'chk_123',
        label: 'Before edits',
        file_paths: ['src/index.ts'],
      },
    }

    const events = mapSDKMessageToEvents(result, { sessionId: 'session-1', turnId: 'turn-1' })

    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'checkpoint',
        checkpointId: 'chk_123',
        label: 'Before edits',
        filePaths: ['src/index.ts'],
      }),
    ]))
  })

  it('emits subagent_started when Agent tool_use is encountered', () => {
    const ctx = { sessionId: 'session-1', turnId: 'turn-1', toolNamesById: new Map<string, string>() }
    const assistant: SDKAssistantMessage = {
      type: 'assistant',
      uuid: 'assistant-1',
      session_id: 'sdk-session',
      parent_tool_use_id: null,
      message: {
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: 'agent-tool-1',
          name: 'Agent',
          input: { agent: 'Researcher', description: 'Finds bugs', prompt: 'Search for null pointer issues' },
        }],
      },
    }

    const events = mapSDKMessageToEvents(assistant, ctx)

    expect(events).toEqual([
      expect.objectContaining({
        type: 'subagent_started',
        toolCallId: 'agent-tool-1',
        name: 'Researcher',
        role: 'Finds bugs',
        task: 'Search for null pointer issues',
      }),
    ])
  })

  it('emits subagent_completed when subagent tool_result is received', () => {
    const toolNamesById = new Map<string, string>()
    toolNamesById.set('agent-tool-1', 'subagent')
    const ctx = { sessionId: 'session-1', turnId: 'turn-1', toolNamesById }

    // First, register the input via a prior assistant message (simulates toolInputs map)
    const assistant: SDKAssistantMessage = {
      type: 'assistant',
      uuid: 'assistant-1',
      session_id: 'sdk-session',
      parent_tool_use_id: null,
      message: {
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: 'agent-tool-1',
          name: 'Agent',
          input: { agent: 'Researcher', description: 'Finds bugs', prompt: 'Search for null pointer issues' },
        }],
      },
    }
    mapSDKMessageToEvents(assistant, ctx)

    const user: SDKUserMessage = {
      type: 'user',
      uuid: 'user-1',
      session_id: 'sdk-session',
      message: {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: 'agent-tool-1',
          content: 'Found 3 null pointer issues in auth module.',
        }],
      },
    }

    const events = mapSDKMessageToEvents(user, ctx)

    expect(events).toEqual([
      expect.objectContaining({
        type: 'subagent_completed',
        toolCallId: 'agent-tool-1',
        name: 'Researcher',
        status: 'success',
        resultSummary: 'Found 3 null pointer issues in auth module.',
        output: 'Found 3 null pointer issues in auth module.',
      }),
    ])
  })

  it('accumulates subagent token usage from parent_tool_use_id messages and attaches to subagent_completed', () => {
    const toolNamesById = new Map<string, string>()
    toolNamesById.set('agent-tool-usage', 'subagent')
    const ctx = { sessionId: 'session-1', turnId: 'turn-1', toolNamesById }

    // Main agent spawns the subagent
    const spawn: SDKAssistantMessage = {
      type: 'assistant',
      uuid: 'assistant-spawn',
      session_id: 'sdk-session',
      parent_tool_use_id: null,
      message: {
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: 'agent-tool-usage',
          name: 'Agent',
          input: { agent: 'Researcher', description: 'Find news', prompt: 'Search news' },
        }],
      },
    }
    mapSDKMessageToEvents(spawn, ctx)

    // Subagent emits two internal assistant messages (each carries parent_tool_use_id + usage)
    const inner1: SDKAssistantMessage = {
      type: 'assistant',
      uuid: 'inner-1',
      session_id: 'sdk-session',
      parent_tool_use_id: 'agent-tool-usage',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'searching...' }],
        usage: { input_tokens: 1200, output_tokens: 80 },
      },
    }
    const inner2: SDKAssistantMessage = {
      type: 'assistant',
      uuid: 'inner-2',
      session_id: 'sdk-session',
      parent_tool_use_id: 'agent-tool-usage',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'summarizing...' }],
        usage: { input_tokens: 800, output_tokens: 120 },
      },
    }
    mapSDKMessageToEvents(inner1, ctx)
    mapSDKMessageToEvents(inner2, ctx)

    // tool_result returns to main agent
    const result: SDKUserMessage = {
      type: 'user',
      uuid: 'user-1',
      session_id: 'sdk-session',
      message: {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: 'agent-tool-usage',
          content: 'Headlines: A, B, C',
        }],
      },
    }
    const events = mapSDKMessageToEvents(result, ctx)

    expect(events).toEqual([
      expect.objectContaining({
        type: 'subagent_completed',
        toolCallId: 'agent-tool-usage',
        name: 'Researcher',
        status: 'success',
        inputTokens: 2000,
        outputTokens: 200,
      }),
    ])
  })

  it('emits subagent_completed with error status on failed tool_result', () => {
    const toolNamesById = new Map<string, string>()
    toolNamesById.set('agent-tool-2', 'subagent')
    const ctx = { sessionId: 'session-1', turnId: 'turn-1', toolNamesById }

    const assistant: SDKAssistantMessage = {
      type: 'assistant',
      uuid: 'assistant-1',
      session_id: 'sdk-session',
      parent_tool_use_id: null,
      message: {
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: 'agent-tool-2',
          name: 'Agent',
          input: { agent: 'Writer', description: 'Writes docs', prompt: 'Write README' },
        }],
      },
    }
    mapSDKMessageToEvents(assistant, ctx)

    const user: SDKUserMessage = {
      type: 'user',
      uuid: 'user-1',
      session_id: 'sdk-session',
      message: {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: 'agent-tool-2',
          content: 'Permission denied',
          is_error: true,
        }],
      },
    }

    const events = mapSDKMessageToEvents(user, ctx)

    expect(events).toEqual([
      expect.objectContaining({
        type: 'subagent_completed',
        toolCallId: 'agent-tool-2',
        name: 'Writer',
        status: 'error',
        resultSummary: 'Permission denied',
        output: 'Permission denied',
      }),
    ])
  })

  it('truncates long subagent output in resultSummary', () => {
    const toolNamesById = new Map<string, string>()
    toolNamesById.set('agent-tool-3', 'subagent')
    const ctx = { sessionId: 'session-1', turnId: 'turn-1', toolNamesById }

    const assistant: SDKAssistantMessage = {
      type: 'assistant',
      uuid: 'assistant-1',
      session_id: 'sdk-session',
      parent_tool_use_id: null,
      message: {
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: 'agent-tool-3',
          name: 'Agent',
          input: { agent: 'Analyst', description: 'Deep analysis', prompt: 'Analyze all files' },
        }],
      },
    }
    mapSDKMessageToEvents(assistant, ctx)

    const longOutput = 'x'.repeat(300)
    const user: SDKUserMessage = {
      type: 'user',
      uuid: 'user-1',
      session_id: 'sdk-session',
      message: {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: 'agent-tool-3',
          content: longOutput,
        }],
      },
    }

    const events = mapSDKMessageToEvents(user, ctx)

    expect(events[0]).toEqual(
      expect.objectContaining({
        type: 'subagent_completed',
        resultSummary: `${'x'.repeat(197)}...`,
        output: longOutput,
      }),
    )
  })

  it('maps ExitPlanMode tool input to a plan proposal event', () => {
    const assistant: SDKAssistantMessage = {
      type: 'assistant',
      uuid: 'assistant-1',
      session_id: 'sdk-session',
      parent_tool_use_id: null,
      message: {
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: 'tool-1',
          name: 'ExitPlanMode',
          input: { plan: '# Plan\n\n1. Do the thing' },
        }],
      },
    }

    const events = mapSDKMessageToEvents(assistant, {
      sessionId: 'session-1',
      turnId: 'turn-1',
      toolNamesById: new Map<string, string>(),
    })

    expect(events).toEqual([
      expect.objectContaining({
        type: 'plan_proposed',
        plan: '# Plan\n\n1. Do the thing',
      }),
    ])
  })
})
