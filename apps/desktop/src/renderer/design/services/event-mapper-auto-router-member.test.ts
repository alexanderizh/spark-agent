import { describe, expect, it } from 'vitest'
import type { AgentEvent, TeamMemberMessageEvent } from '@spark/protocol'
import { MessageBuilder, type UIBlock } from './event-mapper'

/**
 * 显示点 4 数据通道：AutoRouter 一次性强度 worker 的 team_member_message 事件
 * 必须把 autoRouter（强度/模型名/子任务摘要）落到成员消息块上，
 * 供 TeamMemberBubble 头部渲染「强度色点 · 模型名 · 摘要」。
 * worker 是每轮临时合成、不入 Agent 表，渲染端无法反查其模型，只能随事件下发。
 */

function memberMessage(
  patch: Partial<TeamMemberMessageEvent> & Pick<TeamMemberMessageEvent, 'id'>,
): TeamMemberMessageEvent {
  return {
    type: 'team_member_message',
    sessionId: 'session-1',
    turnId: 'turn-1',
    timestamp: '2026-09-21T00:00:00.000Z',
    seq: 1,
    dispatchId: 'dispatch-1',
    memberAgentId: 'autorouter:r1:t1:0',
    mode: 'complete',
    content: '子任务结果',
    isFinal: true,
    ...patch,
  }
}

function memberBlocks(builder: MessageBuilder): UIBlock[] {
  return builder.getAllMessages().flatMap((message) => message.blocks)
}

describe('event-mapper · AutoRouter 子任务块', () => {
  it('worker 事件携带 autoRouter → 块上保留强度/模型名/摘要', () => {
    const builder = new MessageBuilder()
    builder.processEvent(
      memberMessage({
        id: 'e1',
        autoRouter: { intensity: 'low', modelDisplayName: 'haiku-4-5', summary: '检索资料' },
      }) as AgentEvent,
    )

    const block = memberBlocks(builder).find((item) => item.kind === 'team_member_message')
    expect(block).toBeDefined()
    expect(
      block?.kind === 'team_member_message' ? block.autoRouter : undefined,
    ).toEqual({ intensity: 'low', modelDisplayName: 'haiku-4-5', summary: '检索资料' })
  })

  it('普通团队成员事件（无 autoRouter）→ 块上不出现该字段', () => {
    const builder = new MessageBuilder()
    builder.processEvent(
      memberMessage({ id: 'e2', memberAgentId: 'member-1' }) as AgentEvent,
    )

    const block = memberBlocks(builder).find((item) => item.kind === 'team_member_message')
    expect(block?.kind === 'team_member_message' ? block.autoRouter : 'missing').toBeUndefined()
  })
})
