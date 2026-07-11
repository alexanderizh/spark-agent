import { describe, expect, it } from 'vitest'
import { mapExtendedContentBlock } from './content-block-mapper.js'

describe('mapExtendedContentBlock', () => {
  it('maps server and MCP tool calls and results to structured events', () => {
    const context = {
      sessionId: 'session-1',
      turnId: 'turn-1',
      toolNamesById: new Map<string, string>(),
    }

    expect(
      mapExtendedContentBlock(
        {
          type: 'server_tool_use',
          id: 'server-tool-1',
          name: 'web_search',
          input: { query: 'Spark Agent' },
        },
        context,
      ),
    ).toEqual([
      expect.objectContaining({
        type: 'tool_call',
        toolCallId: 'server-tool-1',
        toolName: 'web_search',
        source: 'builtin',
      }),
    ])

    expect(
      mapExtendedContentBlock(
        {
          type: 'web_search_tool_result',
          tool_use_id: 'server-tool-1',
          content: [{ type: 'web_search_result', title: 'Spark', url: 'https://example.com' }],
        },
        context,
      ),
    ).toEqual([
      expect.objectContaining({
        type: 'tool_result',
        toolCallId: 'server-tool-1',
        toolName: 'web_search',
        status: 'success',
        output: expect.stringContaining('https://example.com'),
      }),
    ])

    expect(
      mapExtendedContentBlock(
        {
          type: 'mcp_tool_use',
          id: 'mcp-tool-1',
          name: 'lookup',
          server_name: 'docs',
          input: { topic: 'permissions' },
        },
        context,
      ),
    ).toEqual([
      expect.objectContaining({
        type: 'tool_call',
        toolCallId: 'mcp-tool-1',
        toolName: 'lookup',
        source: 'mcp',
        mcpServerId: 'docs',
      }),
    ])

    expect(
      mapExtendedContentBlock(
        {
          type: 'mcp_tool_result',
          tool_use_id: 'mcp-tool-1',
          content: 'Found the permission reference',
          is_error: false,
        },
        context,
      ),
    ).toEqual([
      expect.objectContaining({
        type: 'tool_result',
        toolCallId: 'mcp-tool-1',
        toolName: 'lookup',
        status: 'success',
        output: 'Found the permission reference',
      }),
    ])
  })

  it.each([
    ['web_fetch_tool_result', 'web_fetch'],
    ['code_execution_tool_result', 'code_execution'],
    ['bash_code_execution_tool_result', 'bash_code_execution'],
    ['text_editor_code_execution_tool_result', 'text_editor_code_execution'],
    ['advisor_tool_result', 'advisor'],
    ['tool_search_tool_result', 'tool_search'],
  ])('keeps unmatched %s blocks visible', (type, expectedToolName) => {
    const events = mapExtendedContentBlock(
      {
        type,
        tool_use_id: `${type}-1`,
        content: { type: 'result', stdout: 'visible output', return_code: 0 },
      },
      { sessionId: 'session-1', turnId: 'turn-1' },
    )

    expect(events).toEqual([
      expect.objectContaining({
        type: 'tool_result',
        toolName: expectedToolName,
        status: 'success',
        output: expect.stringContaining('visible output'),
      }),
    ])
  })

  it('never exposes encrypted or redacted payloads', () => {
    const secret = 'opaque-encrypted-secret'
    const redactedEvents = mapExtendedContentBlock(
      { type: 'redacted_thinking', data: secret },
      { sessionId: 'session-1', turnId: 'turn-1' },
    )
    const encryptedResultEvents = mapExtendedContentBlock(
      {
        type: 'code_execution_tool_result',
        tool_use_id: 'code-1',
        content: {
          type: 'encrypted_code_execution_result',
          encrypted_stdout: secret,
          stderr: '',
          return_code: 0,
          content: [],
        },
      },
      { sessionId: 'session-1', turnId: 'turn-1' },
    )

    expect(JSON.stringify([...redactedEvents, ...encryptedResultEvents])).not.toContain(secret)
    expect(redactedEvents).toEqual([
      expect.objectContaining({
        type: 'runtime_signal',
        signal: 'notification',
        title: expect.stringContaining('思考'),
      }),
    ])
  })

  it('maps compaction and emits an audit notice for future unknown blocks', () => {
    const compactionEvents = mapExtendedContentBlock(
      {
        type: 'compaction',
        content: 'Public compacted summary',
        encrypted_content: 'opaque-summary',
      },
      { sessionId: 'session-1', turnId: 'turn-1' },
    )
    const unknownEvents = mapExtendedContentBlock(
      { type: 'future_sdk_block', payload: 'new-shape' },
      { sessionId: 'session-1', turnId: 'turn-1' },
    )

    expect(compactionEvents).toEqual([
      expect.objectContaining({
        type: 'context_compaction',
        phase: 'completed',
        summary: 'Public compacted summary',
      }),
    ])
    expect(JSON.stringify(compactionEvents)).not.toContain('opaque-summary')
    expect(unknownEvents).toEqual([
      expect.objectContaining({
        type: 'runtime_signal',
        signal: 'notification',
        level: 'warning',
        message: expect.stringContaining('future_sdk_block'),
      }),
    ])
  })
})
