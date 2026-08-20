import { describe, expect, it } from 'vitest'
import {
  updateComposerReplyReferenceBucket,
  type ComposerReplyReferenceMap,
} from './composer-reply-references'

const reply = (messageId: string, contentPreview: string) => ({
  messageId,
  role: 'assistant' as const,
  contentPreview,
})

describe('composer reply reference buckets', () => {
  it('keeps unsent conversation references isolated between sessions', () => {
    let state: ComposerReplyReferenceMap = {}
    state = updateComposerReplyReferenceBucket(state, 'session-a', reply('a-1', 'A'))
    state = updateComposerReplyReferenceBucket(state, 'session-b', reply('b-1', 'B'))

    expect(state['session-a']).toEqual(reply('a-1', 'A'))
    expect(state['session-b']).toEqual(reply('b-1', 'B'))
  })

  it('restores the original reference when switching back and clears only the current bucket', () => {
    let state: ComposerReplyReferenceMap = {
      'session-a': reply('a-1', 'A'),
      'session-b': reply('b-1', 'B'),
    }

    state = updateComposerReplyReferenceBucket(state, 'session-b', null)

    expect(state['session-a']).toEqual(reply('a-1', 'A'))
    expect(state['session-b']).toBeUndefined()
  })
})
