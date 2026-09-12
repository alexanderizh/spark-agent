const DEFAULT_TYPING_REFRESH_MS = 4_000
const DEFAULT_DRAFT_THROTTLE_MS = 750
const TELEGRAM_DRAFT_MAX_LENGTH = 4_096

export type TelegramTurnDraftUpdate = {
  content: string
  mode: 'delta' | 'complete'
  segmentId?: string
}

export type TelegramTurnFeedbackTransport = {
  sendTyping(connectionId: string, externalId: string): Promise<void>
  sendDraft(connectionId: string, externalId: string, draftId: number, text: string): Promise<void>
}

type TelegramTurnFeedbackState = {
  connectionId: string
  externalId: string
  draftId: number
  segmentOrder: string[]
  segments: Map<string, string>
  lastDraftText: string
  draftSupported: boolean
  closed: boolean
  typingTimer: ReturnType<typeof setInterval> | null
  draftTimer: ReturnType<typeof setTimeout> | null
  draftQueue: Promise<void>
  activityRequests: Set<Promise<void>>
}

type TelegramTurnFeedbackOptions = {
  typingRefreshMs?: number
  draftThrottleMs?: number
  createDraftId?: () => number
}

function detachTimer(timer: ReturnType<typeof setTimeout>): void {
  if (typeof timer === 'object' && timer != null && 'unref' in timer) timer.unref()
}

export function formatTelegramDraftPreview(text: string): string {
  if (text.length <= TELEGRAM_DRAFT_MAX_LENGTH) return text
  return `…\n${text.slice(-(TELEGRAM_DRAFT_MAX_LENGTH - 2))}`
}

/**
 * Keeps Telegram's short-lived typing state alive and coalesces assistant deltas
 * into the Bot API's ephemeral streaming draft. Draft failures are intentionally
 * isolated because sendMessageDraft is limited to supported private chats.
 */
export class TelegramTurnFeedbackManager {
  private readonly states = new Map<string, TelegramTurnFeedbackState>()
  private readonly typingRefreshMs: number
  private readonly draftThrottleMs: number
  private readonly createDraftId: () => number

  constructor(
    private readonly transport: TelegramTurnFeedbackTransport,
    options: TelegramTurnFeedbackOptions = {},
  ) {
    this.typingRefreshMs = options.typingRefreshMs ?? DEFAULT_TYPING_REFRESH_MS
    this.draftThrottleMs = options.draftThrottleMs ?? DEFAULT_DRAFT_THROTTLE_MS
    this.createDraftId =
      options.createDraftId ?? (() => Math.floor(Math.random() * 2_147_483_646) + 1)
  }

  start(turnId: string, connectionId: string, externalId: string): void {
    if (this.states.has(turnId)) return
    const state: TelegramTurnFeedbackState = {
      connectionId,
      externalId,
      draftId: this.createDraftId(),
      segmentOrder: [],
      segments: new Map(),
      lastDraftText: '',
      draftSupported: true,
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
    this.enqueueDraft(state, '')
  }

  update(turnId: string, update: TelegramTurnDraftUpdate): void {
    const state = this.states.get(turnId)
    if (state == null || state.closed || !state.draftSupported) return
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

  async finish(turnId: string): Promise<void> {
    const state = this.states.get(turnId)
    if (state == null) return
    this.states.delete(turnId)
    state.closed = true
    if (state.typingTimer != null) clearInterval(state.typingTimer)
    if (state.draftTimer != null) clearTimeout(state.draftTimer)
    await state.draftQueue.catch(() => undefined)
    await Promise.allSettled(Array.from(state.activityRequests))
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
    if (state.closed || !state.draftSupported) return
    const text = formatTelegramDraftPreview(
      state.segmentOrder.map((segmentId) => state.segments.get(segmentId) ?? '').join('\n\n'),
    )
    if (text.length === 0 || text === state.lastDraftText) return
    state.lastDraftText = text
    this.enqueueDraft(state, text)
  }

  private enqueueDraft(state: TelegramTurnFeedbackState, text: string): void {
    state.draftQueue = state.draftQueue
      .catch(() => undefined)
      .then(async () => {
        if (state.closed || !state.draftSupported) return
        try {
          await this.transport.sendDraft(state.connectionId, state.externalId, state.draftId, text)
        } catch {
          // Unsupported Bot API versions and non-private chats fall back to typing.
          state.draftSupported = false
        }
      })
  }
}
