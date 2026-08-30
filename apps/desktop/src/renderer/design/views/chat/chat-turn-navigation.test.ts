import { describe, expect, it } from 'vitest'
import type { UIBlock, UIMessage } from '../../services/event-mapper'
import { buildChatTurnNavItems } from './chat-turn-navigation'

function message(
  id: string,
  role: UIMessage['role'],
  turnId: string | undefined,
  blocks: UIBlock[],
  overrides: Partial<UIMessage> = {},
): UIMessage {
  return {
    id,
    ...(turnId != null ? { turnId } : {}),
    role,
    status: 'completed',
    blocks,
    usage: null,
    eventIds: [id],
    ...overrides,
  }
}

describe('chat turn navigation', () => {
  it('groups both sides of a turn and preserves the first user message index', () => {
    const items = buildChatTurnNavItems([
      message('assistant-orphan', 'assistant', 'turn-1', [
        { kind: 'text', content: '答复', isStreaming: false },
      ]),
      message('user', 'user', 'turn-1', [{ kind: 'text', content: '问题', isStreaming: false }]),
      message('user-2', 'user', 'turn-2', [
        { kind: 'text', content: '下一问', isStreaming: false },
      ]),
    ])

    expect(items).toHaveLength(2)
    expect(items[0]).toMatchObject({
      key: 'turn-1',
      startMessageIndex: 1,
      messageIndexes: [0, 1],
      userPreview: '问题',
      assistantPreview: '答复',
    })
    expect(items[1]?.messageIndexes).toEqual([2])
  })

  it('uses attachment, streaming, tool-only and missing-turn fallbacks', () => {
    const items = buildChatTurnNavItems([
      message('attachment', 'user', undefined, [], {
        attachments: [{ type: 'image', path: '/tmp/a.png' }],
      }),
      message(
        'streaming',
        'assistant',
        'turn-stream',
        [{ kind: 'thinking', content: 'hidden', isStreaming: true }],
        { status: 'streaming' },
      ),
      message('tool', 'assistant', 'turn-tool', [
        {
          kind: 'tool_call',
          toolCallId: 'tool-1',
          toolName: 'read',
          toolInput: {},
          status: 'success',
          output: 'ignored',
          error: undefined,
          durationMs: 1,
        },
      ]),
    ])

    expect(items[0]).toMatchObject({
      key: 'message:attachment',
      userPreview: '发送了 1 个附件',
    })
    expect(items[1]).toMatchObject({ assistantPreview: '正在处理…', status: 'streaming' })
    expect(items[2]).toMatchObject({ assistantPreview: '本轮主要包含工具执行' })
  })

  it('normalizes whitespace and truncates without breaking a grapheme cluster', () => {
    const family = '👨‍👩‍👧‍👦'
    const items = buildChatTurnNavItems([
      message('long', 'user', 'turn-long', [
        { kind: 'text', content: `  hello\n\nworld  ${family.repeat(230)}`, isStreaming: false },
      ]),
    ])

    expect(items[0]?.userPreview).toMatch(/^hello world /)
    expect(items[0]?.userPreview.endsWith('…')).toBe(true)
    expect(items[0]?.userPreview).not.toContain('\n')
    expect(items[0]?.userPreview).not.toContain('\ud83d…')
  })
})
