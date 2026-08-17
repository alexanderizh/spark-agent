import { describe, expect, it } from 'vitest'
import type { UIMessage } from '../../services/event-mapper'
import { buildChatTurnNavItems } from './chat-turn-navigation'
import { groupChatPanelMessagesByTurn } from '../../components/chat-panel-turns'
import {
  HIDDEN_INTERNAL_TURN_PLACEHOLDER,
  getVisibleTurnPromptSnapshotUserMessage,
  projectVisibleChatMessages,
  projectQueuedTurnsForDisplay,
} from './internal-turn-message-visibility'

function message(patch: Partial<UIMessage> & Pick<UIMessage, 'id' | 'role'>): UIMessage {
  return {
    status: 'completed',
    blocks: [],
    usage: null,
    eventIds: [patch.id],
    ...patch,
  }
}

describe('projectVisibleChatMessages', () => {
  it('hides only the internal user bubble and keeps the assistant result', () => {
    const logicalMessages: UIMessage[] = [
      message({
        id: 'internal-user',
        turnId: 'turn-1',
        role: 'user',
        blocks: [{ kind: 'text', content: 'built-in prompt', isStreaming: false }],
        turnSource: 'scheduled_task',
        userMessageVisibility: 'hidden',
      }),
      message({ id: 'assistant-result', turnId: 'turn-1', role: 'assistant' }),
      message({ id: 'real-user', turnId: 'turn-2', role: 'user' }),
    ]

    const visible = projectVisibleChatMessages(logicalMessages)

    expect(visible.map((item) => item.id)).toEqual(['assistant-result', 'real-user'])
    expect(visible[0]).toMatchObject({
      turnSource: 'scheduled_task',
      userMessageVisibility: 'hidden',
    })
    expect(buildChatTurnNavItems(visible)).toMatchObject([
      {
        turnId: 'turn-1',
        startMessageIndex: 0,
        assistantPreview: '等待 Agent 回复',
      },
      { turnId: 'turn-2' },
    ])
    expect(groupChatPanelMessagesByTurn(visible)[0]?.messages.map((item) => item.id)).toEqual([
      'assistant-result',
    ])
    expect(logicalMessages).toHaveLength(3)
  })

  it('keeps legacy and explicitly visible user messages unchanged', () => {
    const legacy = message({ id: 'legacy', role: 'user' })
    const visible = message({
      id: 'visible',
      role: 'user',
      turnSource: 'user',
      userMessageVisibility: 'visible',
    })

    expect(projectVisibleChatMessages([legacy, visible])).toEqual([legacy, visible])
  })

  it('redacts hidden internal prompts while preserving renderer queue controls', () => {
    expect(
      projectQueuedTurnsForDisplay([
        {
          turnId: 'internal',
          message: 'internal prompt',
          enqueuedAt: '2026-08-13T00:00:00.000Z',
          turnSource: 'scheduled_task',
          userMessageVisibility: 'hidden',
        },
        {
          turnId: 'user',
          message: 'visible prompt',
          enqueuedAt: '2026-08-13T00:00:01.000Z',
        },
      ]),
    ).toEqual([
      expect.objectContaining({
        turnId: 'internal',
        message: '定时任务自动执行',
        userMessageVisibility: 'hidden',
      }),
      expect.objectContaining({ turnId: 'user', message: 'visible prompt' }),
    ])
  })

  it('command follow-up turns render as hidden with a command label, never the built-in prompt', () => {
    const logicalMessages: UIMessage[] = [
      message({
        id: 'command-echo',
        turnId: 'turn-cmd',
        role: 'user',
        blocks: [{ kind: 'text', content: '/spark-app-create 记账工具', isStreaming: false }],
      }),
      message({
        id: 'command-follow-up',
        turnId: 'turn-follow',
        role: 'user',
        blocks: [
          {
            kind: 'text',
            content: '强制进入子应用工具链 {"requirement":"记账工具"}',
            isStreaming: false,
          },
        ],
        turnSource: 'command_follow_up',
        userMessageVisibility: 'hidden',
      }),
      message({ id: 'assistant-work', turnId: 'turn-follow', role: 'assistant' }),
    ]

    const visible = projectVisibleChatMessages(logicalMessages)

    // 内置 follow-up 提示词气泡被隐藏，只剩命令回显与 Agent 回复
    expect(visible.map((item) => item.id)).toEqual(['command-echo', 'assistant-work'])
    // 排队展示也不泄漏提示词正文
    expect(
      projectQueuedTurnsForDisplay([
        {
          turnId: 'turn-follow',
          message: '强制进入子应用工具链 {"requirement":"记账工具"}',
          enqueuedAt: '2026-08-17T00:00:00.000Z',
          turnSource: 'command_follow_up',
          userMessageVisibility: 'hidden',
        },
      ]),
    ).toEqual([expect.objectContaining({ turnId: 'turn-follow', message: '命令自动执行' })])
  })

  it('redacts hidden user text in prompt-inspector snapshots', () => {
    expect(
      getVisibleTurnPromptSnapshotUserMessage({
        id: 'snapshot',
        type: 'turn_prompt_snapshot',
        sessionId: 'session',
        turnId: 'turn',
        timestamp: '2026-08-13T00:00:00.000Z',
        seq: 1,
        userMessage: 'internal prompt',
        systemPromptSections: [],
        model: 'model',
        adapterKind: 'codex',
        permissionMode: 'default',
        toolCount: 0,
        userMessageVisibility: 'hidden',
      }),
    ).toBe(HIDDEN_INTERNAL_TURN_PLACEHOLDER)
  })
})
