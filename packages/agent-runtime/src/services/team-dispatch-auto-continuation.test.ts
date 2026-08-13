import { describe, expect, it } from 'vitest'
import {
  MAX_TEAM_DISPATCH_AUTO_CONTINUATIONS,
  TEAM_DISPATCH_AUTO_CONTINUATION_PRESENTATION,
  TEAM_DISPATCH_AUTO_CONTINUATION_PROMPT,
  TeamDispatchAutoContinuationTracker,
} from './team-dispatch-auto-continuation.js'

describe('TeamDispatchAutoContinuationTracker', () => {
  it('claims attempts up to the safety valve and then stops', () => {
    const tracker = new TeamDispatchAutoContinuationTracker()

    expect(tracker.claim('session-1')).toBe(1)
    for (let attempt = 2; attempt <= MAX_TEAM_DISPATCH_AUTO_CONTINUATIONS; attempt += 1) {
      expect(tracker.claim('session-1')).toBe(attempt)
    }
    expect(tracker.claim('session-1')).toBeNull()
  })

  it('tracks sessions independently and resets a continuation chain', () => {
    const tracker = new TeamDispatchAutoContinuationTracker()

    expect(tracker.claim('session-1')).toBe(1)
    expect(tracker.claim('session-2')).toBe(1)
    tracker.reset('session-1')
    expect(tracker.claim('session-1')).toBe(1)
    expect(tracker.claim('session-2')).toBe(2)
  })

  it('keeps the continuation turn hidden from the user', () => {
    expect(TEAM_DISPATCH_AUTO_CONTINUATION_PROMPT).toContain('Continue the previous team task')
    expect(TEAM_DISPATCH_AUTO_CONTINUATION_PRESENTATION.userMessageVisibility).toBe('hidden')
  })
})
