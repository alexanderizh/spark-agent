import { describe, expect, it } from 'vitest'
import type { UIMessage } from './event-mapper'
import {
  buildQuickReplyMessage,
  parseQuickReplies,
  resolvePendingQuickReplies,
} from './quick-reply-suggestions'

function message(id: string, role: UIMessage['role'], blocks: UIMessage['blocks']): UIMessage {
  return {
    id,
    turnId: id,
    role,
    status: 'completed',
    blocks,
    usage: null,
    eventIds: [id],
  }
}

describe('quick reply suggestions', () => {
  it('sanitizes replies to four distinct short strings', () => {
    expect(
      parseQuickReplies({
        replies: [' 确认无误 ', '确认无误', '', '需要调整', '先暂停', '继续讨论', '忽略我'],
      }),
    ).toEqual(['确认无误', '需要调整', '先暂停', '继续讨论'])
  })

  it('keeps a quick reply unchanged when the draft has no content', () => {
    expect(buildQuickReplyMessage(' 确认无误 ', '   ')).toBe('确认无误')
  })

  it('appends a non-empty draft as an explicit user supplement', () => {
    expect(buildQuickReplyMessage('确认修复', '  请先补一个回归测试。\n不要改现有交互。  ')).toBe(
      '确认修复\n\n用户补充：\n请先补一个回归测试。\n不要改现有交互。',
    )
  })

  it('resolves only the latest suggestions after the latest user message', () => {
    const messages: UIMessage[] = [
      message('assistant-old', 'assistant', [
        { kind: 'quick_replies', toolCallId: 'old', replies: ['旧建议'] },
      ]),
      message('user-next', 'user', [{ kind: 'text', content: '继续', isStreaming: false }]),
      message('assistant-new', 'assistant', [
        { kind: 'quick_replies', toolCallId: 'new', replies: ['确认无误', '需要调整'] },
      ]),
    ]

    expect(resolvePendingQuickReplies(messages)).toEqual({
      key: 'assistant-new:new',
      toolCallId: 'new',
      replies: ['确认无误', '需要调整'],
    })
  })

  it('suppresses quick replies when a structured question is still unanswered', () => {
    const messages: UIMessage[] = [
      message('assistant', 'assistant', [
        { kind: 'quick_replies', toolCallId: 'quick', replies: ['确认无误'] },
        {
          kind: 'user_question',
          toolCallId: 'question',
          questions: [],
          answered: false,
        },
      ]),
    ]

    expect(resolvePendingQuickReplies(messages)).toBeNull()
  })
})
