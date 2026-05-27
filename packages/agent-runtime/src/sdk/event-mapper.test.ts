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
})
