import { SubmitError } from './relay'
import type { Target } from './relay'

interface DraftSnapshot {
  text: string
  status: 'idle' | 'sending' | 'unconfirmed'
  notice: string
}

export class ChatDraft {
  private snapshot: DraftSnapshot = { text: '', status: 'idle', notice: '' }
  private listeners = new Set<() => void>()

  getSnapshot = () => this.snapshot

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private publish(snapshot: DraftSnapshot) {
    this.snapshot = snapshot
    for (const listener of this.listeners) listener()
  }

  setText = (text: string) => {
    if (this.snapshot.status === 'idle') this.publish({ ...this.snapshot, text })
  }

  resolveUnconfirmed(expected: DraftSnapshot, discard: boolean) {
    if (this.snapshot !== expected || expected.status !== 'unconfirmed') return
    this.publish({ text: discard ? '' : expected.text, status: 'idle', notice: '' })
  }

  async send(submit: (text: string) => Promise<{ started: boolean }>): Promise<boolean> {
    const { text, status } = this.snapshot
    if (status !== 'idle' || !text.trim()) return false
    this.publish({ text, status: 'sending', notice: '' })
    try {
      const result = await submit(text.trim())
      this.publish({ text: '', status: 'idle', notice: result.started ? '' : '已加入电脑端队列' })
      return true
    } catch (error) {
      if (error instanceof SubmitError && error.outcome === 'not-sent') {
        this.publish({
          text,
          status: 'idle',
          notice: '消息未发送，草稿已保留。重新连接后可以发送。',
        })
      } else {
        this.publish({
          text,
          status: 'unconfirmed',
          notice:
            '发送结果未确认：消息可能已在电脑端排队，暂时不会出现在历史里。请勿仅凭历史重发。',
        })
      }
      return false
    }
  }
}

export class ChatDrafts {
  private drafts = new Map<string, ChatDraft>()

  forTarget({ deviceId, sessionId }: Target) {
    const key = JSON.stringify([deviceId, sessionId])
    const existing = this.drafts.get(key)
    if (existing) return existing
    const draft = new ChatDraft()
    this.drafts.set(key, draft)
    return draft
  }
}
