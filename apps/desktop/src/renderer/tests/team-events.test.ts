/**
 * MessageBuilder 团队模式事件归约测试（Phase 5）
 *
 * 验证 team_dispatch_requested / team_member_message / team_member_status /
 * team_dispatch_completed 如何归约为 team_dispatch / team_member_message UIBlock。
 */
import { describe, expect, it } from 'vitest'
import type { AgentEvent, TeamA2ATask, TeamA2AReply } from '@spark/protocol'
import { MessageBuilder } from '../design/services/event-mapper'
import type { UIBlock } from '../design/services/event-mapper'

let seq = 0
function base(type: AgentEvent['type'], id?: string) {
  return {
    id: id ?? `${type}-${seq++}`,
    type,
    sessionId: 'session-1',
    turnId: 'turn-1',
    timestamp: '2026-06-05T00:00:00.000Z',
    seq: 0,
  }
}

const task: TeamA2ATask = {
  taskId: 'task-1',
  hostAgentId: 'code-agent',
  memberAgentId: 'reviewer',
  rootTurnId: 'turn-1',
  instruction: 'review this',
}

function findBlock<K extends UIBlock['kind']>(
  builder: MessageBuilder,
  kind: K,
): Extract<UIBlock, { kind: K }> | undefined {
  for (const msg of builder.getAllMessages()) {
    const block = msg.blocks.find((b) => b.kind === kind)
    if (block) return block as Extract<UIBlock, { kind: K }>
  }
  return undefined
}

function findBlocks<K extends UIBlock['kind']>(
  builder: MessageBuilder,
  kind: K,
): Array<Extract<UIBlock, { kind: K }>> {
  const blocks: Array<Extract<UIBlock, { kind: K }>> = []
  for (const msg of builder.getAllMessages()) {
    for (const block of msg.blocks) {
      if (block.kind === kind) blocks.push(block as Extract<UIBlock, { kind: K }>)
    }
  }
  return blocks
}

describe('MessageBuilder · Team Mode', () => {
  it('team_dispatch_requested creates a team_dispatch block in working state', () => {
    const b = new MessageBuilder()
    b.processEvent({
      ...base('team_dispatch_requested'),
      type: 'team_dispatch_requested',
      dispatchId: 'd1',
      hostAgentId: 'code-agent',
      memberAgentId: 'reviewer',
      task,
    } as AgentEvent)

    const block = findBlock(b, 'team_dispatch')
    expect(block).toBeDefined()
    expect(block?.dispatchId).toBe('d1')
    expect(block?.state).toBe('working')
  })

  it('team_member_message accumulates deltas then finalizes on complete', () => {
    const b = new MessageBuilder()
    b.processEvent({
      ...base('team_dispatch_requested'),
      type: 'team_dispatch_requested',
      dispatchId: 'd1',
      hostAgentId: 'code-agent',
      memberAgentId: 'reviewer',
      task,
    } as AgentEvent)
    b.processEvent({
      ...base('team_member_message'),
      type: 'team_member_message',
      dispatchId: 'd1',
      memberAgentId: 'reviewer',
      mode: 'delta',
      content: 'looks ',
      isFinal: false,
    } as AgentEvent)
    b.processEvent({
      ...base('team_member_message'),
      type: 'team_member_message',
      dispatchId: 'd1',
      memberAgentId: 'reviewer',
      mode: 'delta',
      content: 'good',
      isFinal: false,
    } as AgentEvent)

    let block = findBlock(b, 'team_member_message')
    expect(block?.content).toBe('looks good')
    expect(block?.isStreaming).toBe(true)

    b.processEvent({
      ...base('team_member_message'),
      type: 'team_member_message',
      dispatchId: 'd1',
      memberAgentId: 'reviewer',
      mode: 'complete',
      content: 'looks good, ship it',
      isFinal: true,
    } as AgentEvent)

    block = findBlock(b, 'team_member_message')
    expect(block?.content).toBe('looks good, ship it')
    expect(block?.isStreaming).toBe(false)
  })

  it('skips empty-content member deltas so no phantom block is created', () => {
    const b = new MessageBuilder()
    b.processEvent({
      ...base('team_dispatch_requested'),
      type: 'team_dispatch_requested',
      dispatchId: 'd1',
      hostAgentId: 'code-agent',
      memberAgentId: 'reviewer',
      task,
    } as AgentEvent)
    // 带新 segmentId 的空 delta：Claude SDK 在切段时（输出→调工具→再输出）
    // 会发这种占位；以前会 push 一个空 content 的空气泡。
    b.processEvent({
      ...base('team_member_message', 'd1-empty-1'),
      type: 'team_member_message',
      dispatchId: 'd1',
      memberAgentId: 'reviewer',
      mode: 'delta',
      segmentId: 'seg-2',
      content: '',
      isFinal: false,
    } as AgentEvent)
    b.processEvent({
      ...base('team_member_message', 'd1-empty-2'),
      type: 'team_member_message',
      dispatchId: 'd1',
      memberAgentId: 'reviewer',
      mode: 'delta',
      segmentId: 'seg-3',
      content: '',
      isFinal: false,
    } as AgentEvent)

    expect(findBlocks(b, 'team_member_message')).toHaveLength(0)

    // 后续带 segmentId 的真实内容应该正常建块，并继承之前空 delta 的 stream 状态。
    b.processEvent({
      ...base('team_member_message', 'd1-real'),
      type: 'team_member_message',
      dispatchId: 'd1',
      memberAgentId: 'reviewer',
      mode: 'delta',
      segmentId: 'seg-4',
      content: 'first real content',
      isFinal: false,
    } as AgentEvent)

    const blocks = findBlocks(b, 'team_member_message')
    expect(blocks).toHaveLength(1)
    expect(blocks[0]?.content).toBe('first real content')
    expect(blocks[0]?.isStreaming).toBe(true)
    expect(blocks[0]?.segmentId).toBe('seg-4')
  })

  it('skips empty-content legacy deltas (no segmentId) so no phantom block is created', () => {
    const b = new MessageBuilder()
    // legacy 路径：无 segmentId 的流式，content='' 不应建块。
    b.processEvent({
      ...base('team_member_message', 'd1-legacy-empty'),
      type: 'team_member_message',
      dispatchId: 'd1',
      memberAgentId: 'reviewer',
      mode: 'delta',
      content: '',
      isFinal: false,
    } as AgentEvent)

    expect(findBlocks(b, 'team_member_message')).toHaveLength(0)
  })

  it('merges member complete events by dispatchId instead of duplicating the answer', () => {
    const b = new MessageBuilder()
    b.processEvent({
      ...base('team_member_message', 'd1-delta'),
      type: 'team_member_message',
      dispatchId: 'd1',
      memberAgentId: 'reviewer',
      mode: 'delta',
      content: 'hello',
      isFinal: false,
    } as AgentEvent)
    b.processEvent({
      ...base('team_member_message', 'd1-complete'),
      type: 'team_member_message',
      dispatchId: 'd1',
      memberAgentId: 'reviewer',
      mode: 'complete',
      content: 'hello',
      isFinal: true,
    } as AgentEvent)

    const blocks = findBlocks(b, 'team_member_message')
    expect(blocks).toHaveLength(1)
    expect(blocks[0]?.content).toBe('hello')
    expect(blocks[0]?.isStreaming).toBe(false)
  })

  it('team_dispatch_completed updates dispatch block with reply + final state', () => {
    const b = new MessageBuilder()
    b.processEvent({
      ...base('team_dispatch_requested'),
      type: 'team_dispatch_requested',
      dispatchId: 'd1',
      hostAgentId: 'code-agent',
      memberAgentId: 'reviewer',
      task,
    } as AgentEvent)

    const reply: TeamA2AReply = {
      taskId: 'task-1',
      memberAgentId: 'reviewer',
      memberName: 'Reviewer',
      state: 'completed',
      content: 'done',
      usage: { durationMs: 1200, outputTokens: 480 },
    }
    b.processEvent({
      ...base('team_dispatch_completed'),
      type: 'team_dispatch_completed',
      dispatchId: 'd1',
      hostAgentId: 'code-agent',
      memberAgentId: 'reviewer',
      reply,
    } as AgentEvent)

    const block = findBlock(b, 'team_dispatch')
    expect(block?.state).toBe('completed')
    expect(block?.reply?.usage?.outputTokens).toBe(480)
  })

  it('team_member_status failure marks the dispatch block failed', () => {
    const b = new MessageBuilder()
    b.processEvent({
      ...base('team_dispatch_requested'),
      type: 'team_dispatch_requested',
      dispatchId: 'd1',
      hostAgentId: 'code-agent',
      memberAgentId: 'reviewer',
      task,
    } as AgentEvent)
    b.processEvent({
      ...base('team_member_status'),
      type: 'team_member_status',
      dispatchId: 'd1',
      memberAgentId: 'reviewer',
      status: 'failed',
    } as AgentEvent)

    expect(findBlock(b, 'team_dispatch')?.state).toBe('failed')
  })

  it('maps peer messages, round dividers, and discussion conclusion into timeline blocks', () => {
    const b = new MessageBuilder()
    b.processEvent({
      ...base('team_peer_message'),
      type: 'team_peer_message',
      discussionId: 'discussion-1',
      memberAgentId: 'reviewer',
      targetAgentId: 'writer',
      content: '请你补一下结论段。',
    } as AgentEvent)
    b.processEvent({
      ...base('team_round_advanced'),
      type: 'team_round_advanced',
      discussionId: 'discussion-1',
      round: 1,
      maxRounds: 6,
    } as AgentEvent)
    b.processEvent({
      ...base('team_discussion_concluded'),
      type: 'team_discussion_concluded',
      discussionId: 'discussion-1',
      reason: 'concluded',
    } as AgentEvent)

    expect(findBlock(b, 'team_peer_message')).toMatchObject({
      discussionId: 'discussion-1',
      memberAgentId: 'reviewer',
      targetAgentId: 'writer',
      content: '请你补一下结论段。',
    })
    expect(findBlock(b, 'team_round_divider')).toMatchObject({
      discussionId: 'discussion-1',
      round: 1,
      maxRounds: 6,
    })
    expect(findBlock(b, 'team_discussion_status')).toMatchObject({
      discussionId: 'discussion-1',
      reason: 'concluded',
    })
  })

  it('carries autoForwarded flag on auto @-mention forwarded peer messages', () => {
    const b = new MessageBuilder()
    b.processEvent({
      ...base('team_peer_message'),
      type: 'team_peer_message',
      discussionId: 'discussion-1',
      memberAgentId: 'backend',
      targetAgentId: 'tester',
      content: '（正文回复原文副本）@测试 到你了',
      autoForwarded: true,
    } as AgentEvent)

    expect(findBlock(b, 'team_peer_message')).toMatchObject({
      memberAgentId: 'backend',
      targetAgentId: 'tester',
      autoForwarded: true,
    })
  })

  it('preserves member ownership on forwarded tool activity', () => {
    const b = new MessageBuilder()
    b.processEvent({
      ...base('team_dispatch_requested'),
      type: 'team_dispatch_requested',
      dispatchId: 'd1',
      hostAgentId: 'code-agent',
      memberAgentId: 'reviewer',
      task,
    } as AgentEvent)
    b.processEvent({
      ...base('tool_call'),
      type: 'tool_call',
      toolCallId: 'tool-1',
      toolName: 'read_file',
      toolInput: { file_path: '/tmp/a.ts' },
      source: 'builtin',
      teamMemberContext: { dispatchId: 'd1', memberAgentId: 'reviewer' },
    } as AgentEvent)
    b.processEvent({
      ...base('tool_result'),
      type: 'tool_result',
      toolCallId: 'tool-1',
      toolName: 'read_file',
      status: 'success',
      output: 'ok',
      teamMemberContext: { dispatchId: 'd1', memberAgentId: 'reviewer' },
    } as AgentEvent)

    const block = findBlock(b, 'tool_call')
    expect(block?.teamMemberContext).toEqual({ dispatchId: 'd1', memberAgentId: 'reviewer' })
    expect(block?.status).toBe('success')
    expect(block?.output).toBe('ok')
  })
})
