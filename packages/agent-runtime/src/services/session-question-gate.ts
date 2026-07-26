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

  /**
   * 强制解除单个 session 的闸门，忽略当前引用计数。
   *
   * 用于会话被删除/清空这类「提问方已经不存在了」的场景——此时不会再有人调用
   * enter() 返回的 release 闭包。残留的闭包之后即使被调用也是安全的：
   * 计数已删除，减一后仍 <= 0，只会重复删除同一个 key。
   */
  releaseSession(sessionId: string): void {
    this.counts.delete(sessionId)
  }

  clear(): void {
    this.counts.clear()
  }
}
