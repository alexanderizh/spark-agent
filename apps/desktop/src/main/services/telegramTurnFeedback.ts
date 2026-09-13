const DEFAULT_TYPING_REFRESH_MS = 4_000
const DEFAULT_DRAFT_THROTTLE_MS = 1_000
const TELEGRAM_DRAFT_MAX_LENGTH = 3_900

export type TelegramTurnDraftUpdate = {
  content: string
  mode: 'delta' | 'complete'
  segmentId?: string
}

export type TelegramTurnFeedbackTransport = {
  sendTyping(connectionId: string, externalId: string): Promise<void>
  sendPreview(connectionId: string, externalId: string, text: string): Promise<number>
  editPreview(
    connectionId: string,
    externalId: string,
    messageId: number,
    text: string,
  ): Promise<void>
}

type TelegramTurnFeedbackState = {
  connectionId: string
  externalId: string
  messageId: number | null
  segmentOrder: string[]
  segments: Map<string, string>
  lastDraftText: string
  lastDeliveredText: string
  previewSupported: boolean
  closed: boolean
  typingTimer: ReturnType<typeof setInterval> | null
  draftTimer: ReturnType<typeof setTimeout> | null
  draftQueue: Promise<void>
  activityRequests: Set<Promise<void>>
}

type TelegramTurnFeedbackOptions = {
  typingRefreshMs?: number
  draftThrottleMs?: number
}

function detachTimer(timer: ReturnType<typeof setTimeout>): void {
  if (typeof timer === 'object' && timer != null && 'unref' in timer) timer.unref()
}

export function formatTelegramDraftPreview(text: string): string {
  if (text.length <= TELEGRAM_DRAFT_MAX_LENGTH) return text
  return `…\n${text.slice(-(TELEGRAM_DRAFT_MAX_LENGTH - 2))}`
}

/**
 * Keeps Telegram's typing state alive and coalesces assistant deltas into one
 * persistent message. Telegram edits replace a message, so each edit contains
 * the full accumulated text; a final answer can reuse that same message.
 */
export class TelegramTurnFeedbackManager {
  private readonly states = new Map<string, TelegramTurnFeedbackState>()
  private readonly typingRefreshMs: number
  private readonly draftThrottleMs: number

  constructor(
    private readonly transport: TelegramTurnFeedbackTransport,
    options: TelegramTurnFeedbackOptions = {},
  ) {
    this.typingRefreshMs = options.typingRefreshMs ?? DEFAULT_TYPING_REFRESH_MS
    this.draftThrottleMs = options.draftThrottleMs ?? DEFAULT_DRAFT_THROTTLE_MS
  }

  start(turnId: string, connectionId: string, externalId: string): void {
    if (this.states.has(turnId)) return
    const state: TelegramTurnFeedbackState = {
      connectionId,
      externalId,
      messageId: null,
      segmentOrder: [],
      segments: new Map(),
      lastDraftText: '',
      lastDeliveredText: '',
      previewSupported: true,
      closed: false,
      typingTimer: null,
      draftTimer: null,
      draftQueue: Promise.resolve(),
      activityRequests: new Set(),
    }
    state.typingTimer = setInterval(() => this.sendTyping(state), this.typingRefreshMs)
    detachTimer(state.typingTimer)
    this.states.set(turnId, state)

    this.sendTyping(state)
  }

  update(turnId: string, update: TelegramTurnDraftUpdate): void {
    const state = this.states.get(turnId)
    if (state == null || state.closed || !state.previewSupported) return
    const segmentId = update.segmentId ?? 'default'
    if (!state.segments.has(segmentId)) state.segmentOrder.push(segmentId)
    const previous = state.segments.get(segmentId) ?? ''
    state.segments.set(
      segmentId,
      update.mode === 'delta' ? `${previous}${update.content}` : update.content,
    )
    if (state.draftTimer != null) return
    state.draftTimer = setTimeout(() => {
      state.draftTimer = null
      this.flushDraft(state)
    }, this.draftThrottleMs)
    detachTimer(state.draftTimer)
  }

  async finish(turnId: string, finalText?: string): Promise<boolean> {
    const state = this.states.get(turnId)
    if (state == null) return false
    this.states.delete(turnId)
    state.closed = true
    if (state.typingTimer != null) clearInterval(state.typingTimer)
    if (state.draftTimer != null) clearTimeout(state.draftTimer)
    await state.draftQueue.catch(() => undefined)
    await Promise.allSettled(Array.from(state.activityRequests))
    if (
      finalText == null ||
      finalText.length === 0 ||
      finalText.length > TELEGRAM_DRAFT_MAX_LENGTH ||
      state.messageId == null
    )
      return false
    if (state.lastDeliveredText === finalText) return true
    try {
      await this.transport.editPreview(
        state.connectionId,
        state.externalId,
        state.messageId,
        finalText,
      )
      return true
    } catch {
      return false
    }
  }

  async stopAll(): Promise<void> {
    await Promise.all(Array.from(this.states.keys(), (turnId) => this.finish(turnId)))
  }

  private sendTyping(state: TelegramTurnFeedbackState): void {
    if (state.closed) return
    const request = this.transport
      .sendTyping(state.connectionId, state.externalId)
      .catch(() => undefined)
    state.activityRequests.add(request)
    void request.finally(() => state.activityRequests.delete(request))
  }

  private flushDraft(state: TelegramTurnFeedbackState): void {
    if (state.closed || !state.previewSupported) return
    const text = formatTelegramDraftPreview(
      state.segmentOrder.map((segmentId) => state.segments.get(segmentId) ?? '').join('\n\n'),
    )
    if (text.length === 0 || text === state.lastDraftText) return
    state.lastDraftText = text
    this.enqueuePreview(state, text)
  }

  private enqueuePreview(state: TelegramTurnFeedbackState, text: string): void {
    state.draftQueue = state.draftQueue
      .catch(() => undefined)
      .then(async () => {
        if (state.closed || !state.previewSupported) return
        try {
          if (state.messageId == null) {
            state.messageId = await this.transport.sendPreview(
              state.connectionId,
              state.externalId,
              text,
            )
          } else {
            await this.transport.editPreview(
              state.connectionId,
              state.externalId,
              state.messageId,
              text,
            )
          }
          state.lastDeliveredText = text
        } catch {
          // Delivery errors fall back to typing; the final answer is still sent normally.
          state.previewSupported = false
        }
      })
  }
}
