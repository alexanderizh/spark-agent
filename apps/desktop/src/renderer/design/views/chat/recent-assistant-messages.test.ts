import { describe, expect, it } from 'vitest'
import { getRecentAssistantMessageIds } from './recent-assistant-messages'

describe('getRecentAssistantMessageIds', () => {
  it('keeps only the latest two assistant messages regardless of user messages', () => {
    const messages = [
      { id: 'assistant-1', role: 'assistant' as const },
      { id: 'user-1', role: 'user' as const },
      { id: 'assistant-2', role: 'assistant' as const },
      { id: 'user-2', role: 'user' as const },
      { id: 'assistant-3', role: 'assistant' as const },
      { id: 'user-3', role: 'user' as const },
    ]

    expect([...getRecentAssistantMessageIds(messages, 2)]).toEqual(['assistant-3', 'assistant-2'])
  })

  it('returns every assistant message when fewer than the limit exist', () => {
    const messages = [
      { id: 'user-1', role: 'user' as const },
      { id: 'assistant-1', role: 'assistant' as const },
    ]

    expect([...getRecentAssistantMessageIds(messages, 2)]).toEqual(['assistant-1'])
  })
})
