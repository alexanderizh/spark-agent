/**
 * Team dispatch budget continuation policy.
 *
 * The dispatch budget is intentionally scoped to one host turn. When that
 * window is exhausted, SessionService can start a hidden continuation turn
 * against the same provider session instead of making the model stop.
 */

import type { UserMessagePresentation } from '@spark/protocol'

/** Safety valve: 20 continuation turns allow up to 210 dispatches per task. */
export const MAX_TEAM_DISPATCH_AUTO_CONTINUATIONS = 20

export const TEAM_DISPATCH_AUTO_CONTINUATION_PROMPT = [
  'Continue the previous team task from the exact point where the host turn stopped because the per-turn team dispatch budget was exhausted.',
  'Reuse the existing conversation, workspace, and team discussion state. Do not repeat completed work.',
  'Inspect the current progress, dispatch the remaining necessary work, and keep going until the user task is complete or a real blocker requires user input.',
].join('\n')

export const TEAM_DISPATCH_AUTO_CONTINUATION_PRESENTATION = {
  userMessageVisibility: 'hidden',
} as const satisfies UserMessagePresentation

/** Tracks one automatic continuation chain per session. */
export class TeamDispatchAutoContinuationTracker {
  private readonly attemptsBySession = new Map<string, number>()

  clear(): void {
    this.attemptsBySession.clear()
  }

  reset(sessionId: string): void {
    this.attemptsBySession.delete(sessionId)
  }

  /** Returns the 1-based attempt number, or null after the safety valve. */
  claim(sessionId: string): number | null {
    const next = (this.attemptsBySession.get(sessionId) ?? 0) + 1
    if (next > MAX_TEAM_DISPATCH_AUTO_CONTINUATIONS) return null
    this.attemptsBySession.set(sessionId, next)
    return next
  }
}
