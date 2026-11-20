import type { MobileBridgeEvent } from '../../../packages/protocol/src/mobile-bridge'
import type { ComposerFile } from './ChatComposerMedia'
import type { Target } from './relay'

export interface ChatSnapshot {
  timeline: { events: MobileBridgeEvent[]; running?: boolean }
  nextBeforeSeq: number | null
}

export class ChatCache {
  private readonly snapshots = new Map<string, ChatSnapshot>()
  private readonly attachments = new Map<string, ComposerFile[]>()

  private key({ deviceId, sessionId }: Target) {
    return JSON.stringify([deviceId, sessionId])
  }

  read(target: Target) {
    return this.snapshots.get(this.key(target))
  }

  write(target: Target, snapshot: ChatSnapshot) {
    if (!snapshot.timeline.events.length) return
    const key = this.key(target)
    const events: MobileBridgeEvent[] = []
    let size = 0
    for (const event of snapshot.timeline.events.slice(-160).reverse()) {
      size += JSON.stringify(event).length
      if (size > 480_000) break
      events.push(event)
    }
    if (!events.length) return
    this.snapshots.delete(key)
    events.reverse()
    const nextBeforeSeq =
      events.length < snapshot.timeline.events.length ? events[0].seq : snapshot.nextBeforeSeq
    this.snapshots.set(key, { nextBeforeSeq, timeline: { events } })
    if (this.snapshots.size > 8) {
      const oldest = this.snapshots.keys().next().value
      if (oldest !== undefined) this.snapshots.delete(oldest)
    }
  }

  getFiles(target: Target) {
    return this.attachments.get(this.key(target)) ?? []
  }

  setFiles(target: Target, files: ComposerFile[]) {
    const key = this.key(target)
    if (files.length) this.attachments.set(key, files)
    else this.attachments.delete(key)
  }
}
