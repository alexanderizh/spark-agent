/**
 * Session-scoped barrier used while a host-rendered question is awaiting the user.
 * Multiple agent/team requests may overlap, so the gate is reference counted.
 */
export class SessionQuestionGate {
  private readonly counts = new Map<string, number>()

  enter(sessionId: string): () => void {
    this.counts.set(sessionId, (this.counts.get(sessionId) ?? 0) + 1)
    let released = false
    return () => {
      if (released) return
      released = true
      const next = (this.counts.get(sessionId) ?? 1) - 1
      if (next <= 0) this.counts.delete(sessionId)
      else this.counts.set(sessionId, next)
    }
  }

  isBlocked(sessionId: string): boolean {
    return (this.counts.get(sessionId) ?? 0) > 0
  }

  clear(): void {
    this.counts.clear()
  }
}
