import { describe, expect, it } from 'vitest'
import type { MobileBridgeEvent } from '@spark/protocol'
import { summarizeRemoteTimeline } from './useRemoteSessionTimelineSummary'

let seq = 0
function event(partial: Partial<MobileBridgeEvent>): MobileBridgeEvent {
  seq += 1
  return {
    id: `e${seq}`,
    seq,
    turnId: 'turn-1',
    type: 'agent_status',
    timestamp: '2026-11-25T10:00:00.000Z',
    ...partial,
  }
}

describe('summarizeRemoteTimeline', () => {
  it('collects presented_files by latest title and tool call stats', () => {
    const summary = summarizeRemoteTimeline([
      event({ type: 'user_message', content: '帮我导出报告' }),
      event({ type: 'tool_call', toolName: 'Bash', toolCallId: 'c1' }),
      event({ type: 'tool_result', toolName: 'Bash', toolCallId: 'c1', toolStatus: 'success' }),
      event({ type: 'tool_call', toolName: 'Bash', toolCallId: 'c2' }),
      event({ type: 'tool_result', toolName: 'Bash', toolCallId: 'c2', toolStatus: 'error' }),
      event({ type: 'presented_files', files: [{ path: '/ws/a.md', title: '旧标题' }] }),
      event({ type: 'presented_files', files: [{ path: '/ws/a.md', title: '新标题' }] }),
    ])
    expect(summary.messageCount).toBe(1)
    expect(summary.files).toEqual([{ path: '/ws/a.md', title: '新标题' }])
    expect(summary.toolCalls).toEqual([
      {
        toolName: 'Bash',
        total: 2,
        success: 1,
        error: 1,
        running: 0,
        lastStatus: 'error',
        lastUsedAt: '2026-11-25T10:00:00.000Z',
      },
    ])
  })

  it('keeps in-flight calls as running and sorts tools by recency', () => {
    const summary = summarizeRemoteTimeline([
      event({ type: 'tool_call', toolName: 'Read', toolCallId: 'r1' }),
      event({
        type: 'tool_call',
        toolName: 'mcp__spark_ui__suggest_replies',
        toolCallId: 'r2',
        timestamp: '2026-11-25T10:01:00.000Z',
      }),
    ])
    expect(summary.toolCalls.map((stat) => stat.toolName)).toEqual([
      'mcp__spark_ui__suggest_replies',
      'Read',
    ])
    expect(summary.toolCalls.every((stat) => stat.running === 1 && stat.total === 1)).toBe(true)
  })

  it('ignores malformed presented files and other event types', () => {
    // 旧版目标端可能下发脏 payload：类型上不允许，但聚合函数必须防御
    const dirtyFiles = [null, { title: 'no path' }] as unknown as NonNullable<
      MobileBridgeEvent['files']
    >
    const summary = summarizeRemoteTimeline([
      event({ type: 'presented_files', files: dirtyFiles }),
      event({ type: 'agent_status', status: 'running' }),
      event({ type: 'presented_files' }),
    ])
    expect(summary.files).toEqual([])
    expect(summary.messageCount).toBe(0)
    expect(summary.lastActivityAt).toBe('2026-11-25T10:00:00.000Z')
  })

  it('returns an empty summary for an empty event list', () => {
    const summary = summarizeRemoteTimeline([])
    expect(summary.files).toEqual([])
    expect(summary.toolCalls).toEqual([])
    expect(summary.messageCount).toBe(0)
    expect(summary.lastActivityAt).toBeNull()
  })
})
