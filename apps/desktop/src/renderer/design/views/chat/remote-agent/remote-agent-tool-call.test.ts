import { describe, expect, it } from 'vitest'
import type { UIBlock, UIMessage } from '../../../services/event-mapper'
import { translate } from '../../../i18n'
import {
  extractRemoteAgentToolCalls,
  presentRemoteAgentToolCall,
  projectRemoteAgentTimelineMessages,
} from './remote-agent-tool-call'

function remoteTool(
  name: string,
  toolInput: Record<string, unknown> = {},
  options: { output?: string; status?: 'pending' | 'running' | 'success' | 'error' } = {},
): Extract<UIBlock, { kind: 'tool_call' }> {
  return {
    kind: 'tool_call',
    toolCallId: `${name}-id`,
    toolName: `mcp__spark_remote__${name}`,
    toolInput,
    status: options.status ?? 'success',
    output: options.output,
    error: undefined,
    durationMs: undefined,
  }
}

function assistant(id: string, blocks: UIBlock[]): UIMessage {
  return { id, role: 'assistant', status: 'completed', blocks, usage: null, eventIds: [] }
}

describe('remote agent tool call projection', () => {
  it('extracts calls in message and block order without including other tools or user messages', () => {
    const first = remoteTool('message_send', { text: 'Build the project' })
    const second = remoteTool('events_read', { operationId: 'operation-1' })
    const calls = extractRemoteAgentToolCalls([
      { ...assistant('user', []), role: 'user' },
      assistant('assistant-1', [first, remoteTool('devices_list'), second]),
      assistant('assistant-2', [remoteTool('operation_cancel')]),
    ])

    expect(calls.map((entry) => entry.block.toolCallId)).toEqual([
      first.toolCallId,
      remoteTool('devices_list').toolCallId,
      second.toolCallId,
      remoteTool('operation_cancel').toolCallId,
    ])
  })

  it('projects message input and extracts remote Agent output from events_read JSON', () => {
    const block = remoteTool(
      'events_read',
      { operationId: 'operation-1' },
      {
        output: `\`\`\`json\n${JSON.stringify({
          operationId: 'operation-1',
          operationStatus: 'completed',
          events: [
            {
              id: 'remote-message',
              seq: 4,
              turnId: 'remote-turn',
              type: 'assistant_message',
              timestamp: '2026-11-16T02:00:00.000Z',
              mode: 'complete',
              content: 'Build passed. Output: /Users/remote-user/project/dist/app.zip',
            },
          ],
        })}\n\`\`\``,
      },
    )
    const presentation = presentRemoteAgentToolCall(block)

    expect(presentation.requestText).toBe(translate('remoteAgent.call.request.eventsRead'))
    expect(presentation.remoteStatus).toBe('completed')
    expect(presentation.outputText).toContain('Build passed.')
    expect(presentation.outputText).toContain('[本机路径]')
    expect(presentation.outputText).not.toContain('/Users/remote-user')
    expect(presentation.outputText).not.toContain('"operationId"')
  })

  it('shows only a local filename for outbound attachments', () => {
    const presentation = presentRemoteAgentToolCall(
      remoteTool('artifact_transfer', {
        direction: 'to_remote',
        sourcePath: '/Users/local-user/workspace/private/report.pdf',
      }),
    )

    expect(presentation.requestText).toBe(
      translate('remoteAgent.call.request.sendFile', { name: 'report.pdf' }),
    )
  })

  it('marks a remotely failed operation as failed even when events_read itself succeeded', () => {
    const presentation = presentRemoteAgentToolCall(
      remoteTool(
        'message_send',
        { linkId: 'link-1', operationId: 'operation-1', text: 'Run tests' },
        {
          output: JSON.stringify({
            linkId: 'link-1',
            operationId: 'operation-1',
            operationStatus: 'failed',
            events: [],
          }),
        },
      ),
    )

    expect(presentation.status).toBe('error')
    expect(presentation.remoteStatus).toBe('failed')
  })

  it('attaches a later events_read response to the original send position', () => {
    const send = remoteTool(
      'message_send',
      { linkId: 'link-1', operationId: 'operation-1', text: 'Run the test suite' },
      {
        output: JSON.stringify({
          linkId: 'link-1',
          operationId: 'operation-1',
          status: 'queued',
          targetStatus: 'accepted',
        }),
      },
    )
    const read = remoteTool(
      'events_read',
      { linkId: 'link-1', operationId: 'operation-1' },
      {
        output: JSON.stringify({
          linkId: 'link-1',
          operationId: 'operation-1',
          operationStatus: 'completed',
          events: [],
        }),
      },
    )
    const intervening = remoteTool('devices_list')
    const source = assistant('assistant-1', [send, intervening, read])

    const [projected] = projectRemoteAgentTimelineMessages([source])
    if (projected == null) throw new Error('Projected message missing')

    expect(
      projected?.blocks.map((block) => ('toolCallId' in block ? block.toolCallId : block.kind)),
    ).toEqual([send.toolCallId, intervening.toolCallId])
    expect(projected?.blocks[0]).toMatchObject({
      kind: 'tool_call',
      toolCallId: send.toolCallId,
      output: read.output,
    })
    expect(extractRemoteAgentToolCalls([projected]).map((entry) => entry.block.toolCallId)).toEqual(
      [send.toolCallId, intervening.toolCallId],
    )
  })
})
