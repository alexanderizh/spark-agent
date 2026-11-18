import { describe, expect, it } from 'vitest'
import type { UIBlock, UIMessage } from '../../../services/event-mapper'
import { translate } from '../../../i18n'
import {
  extractRemoteAgentToolCalls,
  presentRemoteAgentToolCall,
  projectRemoteAgentTimelineMessages,
} from './remote-agent-tool-call'

let toolCallOrdinal = 0

function remoteTool(
  name: string,
  toolInput: Record<string, unknown> = {},
  options: { output?: string; status?: 'pending' | 'running' | 'success' | 'error' } = {},
): Extract<UIBlock, { kind: 'tool_call' }> {
  return {
    kind: 'tool_call',
    toolCallId: `${name}-${++toolCallOrdinal}`,
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
  it('extracts only meaningful remote operations in message and block order', () => {
    const first = remoteTool('message_send', { text: 'Build the project' })
    const second = remoteTool('events_read', { operationId: 'operation-1' })
    const cancel = remoteTool('operation_cancel')
    const calls = extractRemoteAgentToolCalls([
      { ...assistant('user', []), role: 'user' },
      assistant('assistant-1', [first, remoteTool('devices_list'), second]),
      assistant('assistant-2', [remoteTool('session_open'), cancel]),
    ])

    expect(calls.map((entry) => entry.block.toolCallId)).toEqual([
      first.toolCallId,
      second.toolCallId,
      cancel.toolCallId,
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

  it('summarizes model catalog reads and route changes', () => {
    const catalog = presentRemoteAgentToolCall(
      remoteTool(
        'model_catalog',
        {},
        {
          output: JSON.stringify({
            providers: [
              { id: 'provider-a', models: [{ id: 'model-a' }, { id: 'model-b' }] },
              { id: 'provider-b', models: [{ id: 'model-c' }] },
            ],
          }),
        },
      ),
    )
    expect(catalog.outputText).toBe(
      translate('remoteAgent.call.result.modelCatalog', { providers: 2, models: 3 }),
    )
    expect(catalog.requestText).toBe(translate('remoteAgent.call.request.modelCatalog'))

    const switched = presentRemoteAgentToolCall(
      remoteTool(
        'session_model_set',
        {
          providerProfileId: 'provider-b',
          modelId: 'model-c',
        },
        {
          output: JSON.stringify({
            linkId: 'link-1',
            providerProfileId: 'provider-b',
            modelId: 'model-c',
          }),
        },
      ),
    )
    expect(switched.action).toBe('session_model_set')
    expect(switched.requestText).toBe('provider-b / model-c')
    expect(switched.outputText).toBe(translate('remoteAgent.call.result.modelUpdated'))
  })

  it('keeps model changes visible and hides successful catalog setup calls', () => {
    const catalog = remoteTool('model_catalog')
    const switchModel = remoteTool('session_model_set', {
      providerProfileId: 'provider-b',
      modelId: 'model-c',
    })
    const failedCatalog = remoteTool('model_catalog', {}, { status: 'error' })
    const [projected] = projectRemoteAgentTimelineMessages([
      assistant('assistant-1', [catalog, switchModel, failedCatalog]),
    ])

    expect(projected?.blocks).toEqual([switchModel, failedCatalog])
    expect(
      extractRemoteAgentToolCalls([
        assistant('assistant-1', [catalog, switchModel, failedCatalog]),
      ]).map((entry) => entry.block.toolCallId),
    ).toEqual([switchModel.toolCallId, failedCatalog.toolCallId])
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

  it('keeps one compact card at the send position and removes setup and polling calls', () => {
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
          events: [
            {
              id: 'remote-event-2',
              seq: 5,
              turnId: 'remote-turn',
              type: 'assistant_message',
              timestamp: '2026-11-16T02:01:00.000Z',
              mode: 'complete',
              content: 'Final result',
            },
          ],
        }),
      },
    )
    const olderRead = remoteTool(
      'events_read',
      {
        linkId: 'link-1',
        operationId: 'operation-1',
      },
      {
        output: JSON.stringify({
          linkId: 'link-1',
          operationId: 'operation-1',
          operationStatus: 'running',
          events: [
            {
              id: 'remote-event-1',
              seq: 4,
              turnId: 'remote-turn',
              type: 'assistant_message',
              timestamp: '2026-11-16T02:00:00.000Z',
              mode: 'complete',
              content: 'Initial result',
            },
          ],
        }),
      },
    )
    const source = assistant('assistant-1', [
      remoteTool('devices_list'),
      remoteTool('device_inspect'),
      remoteTool('session_open'),
      send,
      olderRead,
      read,
    ])

    const [projected] = projectRemoteAgentTimelineMessages([source])
    if (projected == null) throw new Error('Projected message missing')

    expect(
      projected?.blocks.map((block) => ('toolCallId' in block ? block.toolCallId : block.kind)),
    ).toEqual([send.toolCallId])
    expect(projected?.blocks[0]).toMatchObject({
      kind: 'tool_call',
      toolCallId: send.toolCallId,
    })
    const projectedResponse = JSON.parse(
      (projected?.blocks[0] as Extract<UIBlock, { kind: 'tool_call' }>).output ?? '{}',
    ) as { operationStatus: string; events: Array<{ id: string }> }
    expect(projectedResponse.operationStatus).toBe('completed')
    expect(projectedResponse.events.map((event) => event.id)).toEqual([
      'remote-event-1',
      'remote-event-2',
    ])
    expect(
      presentRemoteAgentToolCall(projected?.blocks[0] as Extract<UIBlock, { kind: 'tool_call' }>)
        .outputText,
    ).toContain('Initial result\n\nFinal result')
    expect(extractRemoteAgentToolCalls([projected]).map((entry) => entry.block.toolCallId)).toEqual(
      [send.toolCallId],
    )
  })

  it('merges unpaired incremental reads by link and deduplicates remote event IDs', () => {
    const older = remoteTool(
      'events_read',
      {
        linkId: 'link-outside-page',
        afterCursor: 1,
      },
      {
        output: JSON.stringify({
          linkId: 'link-outside-page',
          nextCursor: 4,
          events: [
            {
              id: 'remote-event-1',
              seq: 2,
              type: 'assistant_message',
              mode: 'complete',
              content: 'First event',
            },
            {
              id: 'remote-event-2',
              seq: 3,
              type: 'assistant_message',
              mode: 'complete',
              content: 'Second event',
            },
          ],
        }),
      },
    )
    const latest = remoteTool(
      'events_read',
      {
        linkId: 'link-outside-page',
        afterCursor: 9,
      },
      {
        output: JSON.stringify({
          linkId: 'link-outside-page',
          nextCursor: 12,
          operationStatus: 'running',
          events: [
            {
              id: 'remote-event-2',
              seq: 3,
              type: 'assistant_message',
              mode: 'complete',
              content: 'Second event',
            },
            {
              id: 'remote-event-3',
              seq: 10,
              type: 'assistant_message',
              mode: 'complete',
              content: 'Third event',
            },
          ],
        }),
      },
    )
    const terminalRead = remoteTool(
      'events_read',
      {
        linkId: 'link-outside-page',
        afterCursor: 12,
      },
      {
        output: JSON.stringify({
          linkId: 'link-outside-page',
          nextCursor: 13,
          operationStatus: 'completed',
          events: [],
        }),
      },
    )
    const [projected] = projectRemoteAgentTimelineMessages([
      assistant('assistant-1', [older, latest, terminalRead]),
    ])

    expect(projected?.blocks).toHaveLength(1)
    const merged = projected?.blocks[0] as Extract<UIBlock, { kind: 'tool_call' }>
    expect(merged.toolCallId).toBe(older.toolCallId)
    const response = JSON.parse(merged.output ?? '{}') as {
      nextCursor: number
      operationStatus: string
      events: Array<{ id: string }>
    }
    expect(response.nextCursor).toBe(13)
    expect(response.operationStatus).toBe('completed')
    expect(response.events.map((event) => event.id)).toEqual([
      'remote-event-1',
      'remote-event-2',
      'remote-event-3',
    ])
    expect(presentRemoteAgentToolCall(merged).outputText).toContain(
      'First event\n\nSecond event\n\nThird event',
    )
  })

  it('keeps failed setup calls visible for troubleshooting', () => {
    const failedOpen = remoteTool('session_open', {}, { status: 'error' })
    const [projected] = projectRemoteAgentTimelineMessages([
      assistant('assistant-1', [remoteTool('devices_list'), failedOpen]),
    ])

    expect(projected?.blocks).toEqual([failedOpen])
    expect(extractRemoteAgentToolCalls([assistant('assistant-1', [failedOpen])])).toHaveLength(1)
  })
})
