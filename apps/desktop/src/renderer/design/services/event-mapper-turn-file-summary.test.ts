import { describe, expect, it } from 'vitest'
import type {
  AgentEvent,
  AgentStatusEvent,
  AssistantMessageEvent,
  FileChangeEvent,
  TurnSource,
  UserMessageEvent,
} from '@spark/protocol'
import { MessageBuilder } from './event-mapper'

function userMessage(
  seq: number,
  turnId: string,
  options?: { turnSource: TurnSource },
): AgentEvent {
  const event: UserMessageEvent = {
    id: `event-user-${seq}`,
    type: 'user_message',
    sessionId: 'session-1',
    turnId,
    timestamp: '2026-09-12T00:00:00.000Z',
    seq,
    content: 'run release flow',
    ...(options != null ? { turnSource: options.turnSource } : {}),
  }
  return event
}

function assistantDelta(seq: number, turnId: string): AgentEvent {
  const event: AssistantMessageEvent = {
    id: `event-assistant-${seq}`,
    type: 'assistant_message',
    sessionId: 'session-1',
    turnId,
    timestamp: '2026-09-12T00:00:01.000Z',
    seq,
    mode: 'delta',
    content: 'working',
    provider: 'claude',
    isFinal: false,
  }
  return event
}

function fileChange(seq: number, turnId: string, path: string): AgentEvent {
  const event: FileChangeEvent = {
    id: `event-file-${seq}`,
    type: 'file_change',
    sessionId: 'session-1',
    turnId,
    timestamp: '2026-09-12T00:00:02.000Z',
    seq,
    changeType: 'modify',
    path,
    diff: `--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-old\n+new`,
  }
  return event
}

function agentCompleted(seq: number, turnId: string): AgentEvent {
  const event: AgentStatusEvent = {
    id: `event-status-${seq}`,
    type: 'agent_status',
    sessionId: 'session-1',
    turnId,
    timestamp: '2026-09-12T00:00:03.000Z',
    seq,
    status: 'completed',
  }
  return event
}

function summaryPaths(message: {
  blocks: Array<{ kind: string; files?: Array<{ path: string }> }>
}) {
  const summary = message.blocks.find((block) => block.kind === 'turn_file_summary')
  return summary?.files?.map((file) => file.path) ?? null
}

describe('MessageBuilder turn file summary boundaries', () => {
  it('keeps the previous turn summary off a scheduled wake turn (user_message resets tracker)', () => {
    const builder = new MessageBuilder()
    // 轮 A：正常编辑 + 终态
    builder.processEvent(userMessage(1, 'turn-a'))
    builder.processEvent(assistantDelta(2, 'turn-a'))
    builder.processEvent(fileChange(3, 'turn-a', 'package.json'))
    builder.processEvent(agentCompleted(4, 'turn-a'))
    // 轮 B：定时任务唤醒轮。本用例在修复前的代码上同样通过（轮 A 终态已置
    // turnSummaryEmitted 且无人重置），作为常规回归防线保留；真正区分新旧实现
    // 的是「终态迟到」与「assistant_message 先行」两个用例。
    builder.processEvent(userMessage(5, 'turn-b', { turnSource: 'scheduled_task' }))
    builder.processEvent(assistantDelta(6, 'turn-b'))
    builder.processEvent(agentCompleted(7, 'turn-b'))

    const messages = builder.getAllMessages()
    const turnA = messages.find(
      (message) => message.turnId === 'turn-a' && message.role === 'assistant',
    )
    const turnB = messages.find(
      (message) => message.turnId === 'turn-b' && message.role === 'assistant',
    )
    expect(summaryPaths(turnA!)).toEqual(['package.json'])
    expect(summaryPaths(turnB!)).toBeNull()
  })

  it('clears the stale tracker when a wake turn starts with assistant_message and no user_message', () => {
    const builder = new MessageBuilder()
    // 轮 A：正常编辑 + 终态（摘要已挂到轮 A）
    builder.processEvent(userMessage(1, 'turn-a'))
    builder.processEvent(assistantDelta(2, 'turn-a'))
    builder.processEvent(fileChange(3, 'turn-a', 'stale.ts'))
    builder.processEvent(agentCompleted(4, 'turn-a'))
    // 轮 B：无 user_message 先行，首个 assistant 侧事件走 assistant_message 内联新建。
    // 旧代码在该分支不重置 tracker（turnSummaryEmitted 仍为 true），轮 B 的变更被整体吞掉。
    builder.processEvent(assistantDelta(5, 'turn-b'))
    builder.processEvent(fileChange(6, 'turn-b', 'wake.ts'))
    builder.processEvent(agentCompleted(7, 'turn-b'))

    const messages = builder.getAllMessages()
    const turnA = messages.find(
      (message) => message.turnId === 'turn-a' && message.role === 'assistant',
    )
    const turnB = messages.find(
      (message) => message.turnId === 'turn-b' && message.role === 'assistant',
    )
    expect(summaryPaths(turnA!)).toEqual(['stale.ts'])
    expect(summaryPaths(turnB!)).toEqual(['wake.ts'])
  })

  it('does not attach wake-turn file changes to a late terminal of the previous turn', () => {
    const builder = new MessageBuilder()
    // 轮 A：有文件变更，但终态事件晚到
    builder.processEvent(userMessage(1, 'turn-a'))
    builder.processEvent(assistantDelta(2, 'turn-a'))
    builder.processEvent(fileChange(3, 'turn-a', 'CHANGELOG.md'))
    // 轮 B：唤醒轮已开始并收集了新的文件变更、正常终态
    builder.processEvent(userMessage(4, 'turn-b', { turnSource: 'scheduled_task' }))
    builder.processEvent(assistantDelta(5, 'turn-b'))
    builder.processEvent(fileChange(6, 'turn-b', 'docs/plan.md'))
    builder.processEvent(agentCompleted(7, 'turn-b'))
    // 轮 A 的终态此刻才补投：tracker 已归属轮 B，不得把轮 B 的变更挂到轮 A
    builder.processEvent(agentCompleted(8, 'turn-a'))

    const messages = builder.getAllMessages()
    const turnA = messages.find(
      (message) => message.turnId === 'turn-a' && message.role === 'assistant',
    )
    const turnB = messages.find(
      (message) => message.turnId === 'turn-b' && message.role === 'assistant',
    )
    expect(summaryPaths(turnA!)).toBeNull()
    expect(summaryPaths(turnB!)).toEqual(['docs/plan.md'])
  })

  it('a same-turn user_message arriving late does not clear collected file changes', () => {
    const builder = new MessageBuilder()
    // 乱序：assistant 先行创建消息（tracker 归属 turn-a），file_change 收集后 user_message 才补投
    builder.processEvent(assistantDelta(1, 'turn-a'))
    builder.processEvent(fileChange(2, 'turn-a', 'src/main.ts'))
    builder.processEvent(userMessage(3, 'turn-a'))
    builder.processEvent(agentCompleted(4, 'turn-a'))

    const messages = builder.getAllMessages()
    const turnA = messages.find(
      (message) => message.turnId === 'turn-a' && message.role === 'assistant',
    )
    expect(summaryPaths(turnA!)).toEqual(['src/main.ts'])
  })

  it('keeps per-turn file change sets isolated across consecutive turns', () => {
    const builder = new MessageBuilder()
    builder.processEvent(userMessage(1, 'turn-a'))
    builder.processEvent(assistantDelta(2, 'turn-a'))
    builder.processEvent(fileChange(3, 'turn-a', 'a.ts'))
    builder.processEvent(agentCompleted(4, 'turn-a'))

    builder.processEvent(userMessage(5, 'turn-b', { turnSource: 'scheduled_task' }))
    builder.processEvent(assistantDelta(6, 'turn-b'))
    builder.processEvent(fileChange(7, 'turn-b', 'b.ts'))
    builder.processEvent(agentCompleted(8, 'turn-b'))

    const messages = builder.getAllMessages()
    const turnA = messages.find(
      (message) => message.turnId === 'turn-a' && message.role === 'assistant',
    )
    const turnB = messages.find(
      (message) => message.turnId === 'turn-b' && message.role === 'assistant',
    )
    expect(summaryPaths(turnA!)).toEqual(['a.ts'])
    expect(summaryPaths(turnB!)).toEqual(['b.ts'])
  })
})
