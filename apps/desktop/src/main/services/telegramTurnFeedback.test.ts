import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  formatTelegramDraftPreview,
  TelegramTurnFeedbackManager,
  type TelegramTurnFeedbackTransport,
} from './telegramTurnFeedback.js'

function createHarness(overrides: Partial<TelegramTurnFeedbackTransport> = {}) {
  const transport: TelegramTurnFeedbackTransport = {
    sendTyping: vi.fn(async () => undefined),
    sendDraft: vi.fn(async () => undefined),
    ...overrides,
  }
  const manager = new TelegramTurnFeedbackManager(transport, {
    typingRefreshMs: 4_000,
    draftThrottleMs: 750,
    createDraftId: () => 42,
  })
  return { manager, transport }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('TelegramTurnFeedbackManager', () => {
  it('keeps typing alive until the turn finishes', async () => {
    vi.useFakeTimers()
    const { manager, transport } = createHarness()

    manager.start('turn-1', 'connection-1', '123')
    await vi.advanceTimersByTimeAsync(8_100)

    expect(transport.sendTyping).toHaveBeenCalledTimes(3)
    await manager.finish('turn-1')
    await vi.advanceTimersByTimeAsync(4_100)
    expect(transport.sendTyping).toHaveBeenCalledTimes(3)
  })

  it('coalesces text deltas into a throttled ephemeral draft', async () => {
    vi.useFakeTimers()
    const { manager, transport } = createHarness()

    manager.start('turn-1', 'connection-1', '123')
    manager.update('turn-1', { mode: 'delta', content: '你', segmentId: 'a' })
    manager.update('turn-1', { mode: 'delta', content: '好', segmentId: 'a' })
    await vi.advanceTimersByTimeAsync(800)

    expect(transport.sendDraft).toHaveBeenNthCalledWith(1, 'connection-1', '123', 42, '')
    expect(transport.sendDraft).toHaveBeenNthCalledWith(2, 'connection-1', '123', 42, '你好')
    await manager.finish('turn-1')
  })

  it('falls back to typing when streaming drafts are unsupported', async () => {
    vi.useFakeTimers()
    const { manager, transport } = createHarness({
      sendDraft: vi.fn(async () => {
        throw new Error('unsupported')
      }),
    })

    manager.start('turn-1', 'connection-1', '-100')
    await vi.advanceTimersByTimeAsync(1)
    manager.update('turn-1', { mode: 'delta', content: '不会发送' })
    await vi.advanceTimersByTimeAsync(4_100)

    expect(transport.sendDraft).toHaveBeenCalledTimes(1)
    expect(transport.sendTyping).toHaveBeenCalledTimes(2)
    await manager.finish('turn-1')
  })
})

describe('formatTelegramDraftPreview', () => {
  it('keeps the newest 4096 characters for long streaming output', () => {
    const preview = formatTelegramDraftPreview(`old${'x'.repeat(4_096)}new`)
    expect(preview).toHaveLength(4_096)
    expect(preview.startsWith('…\n')).toBe(true)
    expect(preview.endsWith('new')).toBe(true)
  })
})
