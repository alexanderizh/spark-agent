import { describe, expect, it } from 'vitest'
import type { UIBlock } from '../../services/event-mapper'
import { splitAssistantMessageBlocks, teamMemberContextKey } from './ChatTeamTimelineSegments'

/**
 * 成员活动分段的核心归并行为：并行成员的块在时间线上交错时，
 * 同一 (dispatchId, memberAgentId) 的全部块收敛为一个气泡（首次出现处），
 * 不再被其他成员/host 的块拆散；不同 dispatch 仍各自成段。
 */

let seq = 0

const memberMessage = (
  memberAgentId: string,
  content: string,
  options: { streaming?: boolean } = {},
): Extract<UIBlock, { kind: 'team_member_message' }> => ({
  kind: 'team_member_message',
  dispatchId: `dispatch-${memberAgentId}`,
  memberAgentId,
  content,
  isStreaming: options.streaming ?? false,
  eventIds: [`event-${++seq}`],
})

const memberToolCall = (
  memberAgentId: string,
  toolCallId: string,
  status: 'success' | 'running',
): Extract<UIBlock, { kind: 'tool_call' }> => ({
  kind: 'tool_call',
  toolCallId,
  toolName: 'bash',
  toolInput: { command: 'ls' },
  status,
  output: '',
  error: undefined,
  durationMs: 10,
  teamMemberContext: {
    dispatchId: `dispatch-${memberAgentId}`,
    memberAgentId,
  },
})

const hostText = (
  content: string,
  options: { streaming?: boolean } = {},
): Extract<UIBlock, { kind: 'text' }> => ({
  kind: 'text',
  content,
  isStreaming: options.streaming ?? false,
})

describe('splitAssistantMessageBlocks · 成员活动归并', () => {
  it('并行成员交错输出 → 各自收敛为一个气泡（位置在首次出现处）', () => {
    const a1 = memberMessage('autorouter:r1:t1:0', 'A 第一段')
    const b1 = memberMessage('autorouter:r1:t1:1', 'B 第一段')
    const a2 = memberToolCall('autorouter:r1:t1:0', 'tool-a', 'success')
    const b2 = memberToolCall('autorouter:r1:t1:1', 'tool-b', 'success')

    const segments = splitAssistantMessageBlocks([a1, b1, a2, b2])
    expect(segments).toHaveLength(2)
    expect(segments[0]).toMatchObject({ kind: 'team_member_activity' })
    expect(segments[1]).toMatchObject({ kind: 'team_member_activity' })
    const first = segments[0] as Extract<
      (typeof segments)[number],
      { kind: 'team_member_activity' }
    >
    const second = segments[1] as Extract<
      (typeof segments)[number],
      { kind: 'team_member_activity' }
    >
    expect(first.blocks).toEqual([a1, a2])
    expect(second.blocks).toEqual([b1, b2])
    expect(first.memberContext.memberAgentId).toBe('autorouter:r1:t1:0')
    expect(second.memberContext.memberAgentId).toBe('autorouter:r1:t1:1')
  })

  it('host 块夹在中间 → member 活动仍合并回首段，host 保持独立气泡', () => {
    const a1 = memberMessage('member-a', '成员先说')
    const host = hostText('host 补充说明')
    const a2 = memberMessage('member-a', '成员继续')

    const segments = splitAssistantMessageBlocks([a1, host, a2])
    expect(segments).toHaveLength(2)
    const memberSegment = segments[0] as Extract<
      (typeof segments)[number],
      { kind: 'team_member_activity' }
    >
    expect(memberSegment.blocks).toEqual([a1, a2])
    const hostSegment = segments[1] as Extract<(typeof segments)[number], { kind: 'agent' }>
    expect(hostSegment.blocks).toEqual([host])
  })

  it('同一成员不同 dispatch → 各自成段（明确的新一轮输出）', () => {
    const first = memberMessage('member-a', '第一轮')
    const second: Extract<UIBlock, { kind: 'team_member_message' }> = {
      ...memberMessage('member-a', '第二轮'),
      dispatchId: 'dispatch-second',
    }

    const segments = splitAssistantMessageBlocks([first, second])
    expect(segments).toHaveLength(2)
    const seg1 = segments[0] as Extract<(typeof segments)[number], { kind: 'team_member_activity' }>
    const seg2 = segments[1] as Extract<(typeof segments)[number], { kind: 'team_member_activity' }>
    expect(seg1).toBeDefined()
    expect(seg2).toBeDefined()
    expect(teamMemberContextKey(seg1.memberContext)).not.toBe(
      teamMemberContextKey(seg2.memberContext),
    )
  })

  it('host 的多个块连续时合并为一个 agent 段', () => {
    const segments = splitAssistantMessageBlocks([hostText('a'), hostText('b')])
    expect(segments).toHaveLength(1)
    expect(segments[0]).toMatchObject({ kind: 'agent' })
  })
})

describe('splitAssistantMessageBlocks · running 态', () => {
  it('成员块仍在流式 → running=true', () => {
    const streaming = memberMessage('member-a', '输出中', { streaming: true })
    const segments = splitAssistantMessageBlocks([streaming])
    expect(segments[0]).toMatchObject({ kind: 'team_member_activity', running: true })
  })

  it('成员全部块结束 → running=false', () => {
    const done = memberMessage('member-a', '输出完成')
    const segments = splitAssistantMessageBlocks([done])
    expect(segments[0]).toMatchObject({ kind: 'team_member_activity', running: false })
  })
})
