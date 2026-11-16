import { describe, expect, it } from 'vitest'
import { extractSearchableEventBody } from './event.repository.js'

describe('extractSearchableEventBody', () => {
  it('does not index remote-agent continuation receipts as user-authored content', () => {
    expect(
      extractSearchableEventBody(
        'user_message',
        JSON.stringify({
          content: 'remote collaboration receipt',
          turnSource: 'remote_agent',
        }),
      ),
    ).toBeNull()
  })
})
