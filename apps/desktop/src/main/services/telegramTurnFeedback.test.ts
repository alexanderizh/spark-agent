import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  formatTelegramDraftPreview,
  TelegramTurnFeedbackManager,
  type TelegramTurnFeedbackTransport,
} from './telegramTurnFeedback.js'

function createHarness(overrides: Partial<TelegramTurnFeedbackTransport> = {}) {
  const transport: TelegramTurnFeedbackTransport = {
    sendTyping: vi.fn(async () => undefined),
    sendPreview: vi.fn(async () => 99),
    editPreview: vi.fn(async () => undefined),
    ...overrides,
  }
  const manager = new TelegramTurnFeedbackManager(transport, {
    typingRefreshMs: 4_000,
    draftThrottleMs: 750,
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

  it('sends no blank bubble and incrementally edits one persistent message', async () => {
    vi.useFakeTimers()
    const { manager, transport } = createHarness()

    manager.start('turn-1', 'connection-1', '123')
    await vi.advanceTimersByTimeAsync(1)
    expect(transport.sendPreview).not.toHaveBeenCalled()
    manager.update('turn-1', { mode: 'delta', content: '你', segmentId: 'a' })
    manager.update('turn-1', { mode: 'delta', content: '好', segmentId: 'a' })
    await vi.advanceTimersByTimeAsync(1_100)

    expect(transport.sendPreview).toHaveBeenCalledExactlyOnceWith('connection-1', '123', '你好')
    manager.update('turn-1', { mode: 'delta', content: '，世界', segmentId: 'a' })
    await vi.advanceTimersByTimeAsync(1_100)

    expect(transport.editPreview).toHaveBeenCalledExactlyOnceWith(
      'connection-1',
      '123',
      99,
      '你好，世界',
    )
    expect(await manager.finish('turn-1', '你好，世界')).toBe(true)
    expect(transport.editPreview).toHaveBeenCalledTimes(1)
  })

  it('replaces only a completed segment and appends later segments', async () => {
    vi.useFakeTimers()
    const { manager, transport } = createHarness()
    manager.start('turn-1', 'connection-1', '123')
    manager.update('turn-1', { mode: 'delta', content: '第一', segmentId: 'a' })
    manager.update('turn-1', { mode: 'complete', content: '第一行', segmentId: 'a' })
    manager.update('turn-1', { mode: 'delta', content: '第二行', segmentId: 'b' })
    await vi.advanceTimersByTimeAsync(1_100)

    expect(transport.sendPreview).toHaveBeenCalledWith('connection-1', '123', '第一行\n\n第二行')
    await manager.finish('turn-1')
  })

  it('edits the streamed message to the final answer instead of sending another bubble', async () => {
    vi.useFakeTimers()
    const { manager, transport } = createHarness()
    manager.start('turn-1', 'connection-1', '123')
    manager.update('turn-1', { mode: 'delta', content: '草稿' })
    await vi.advanceTimersByTimeAsync(1_100)

    expect(await manager.finish('turn-1', '最终回答')).toBe(true)
    expect(transport.sendPreview).toHaveBeenCalledTimes(1)
    expect(transport.editPreview).toHaveBeenCalledWith('connection-1', '123', 99, '最终回答')
  })

  it('lets the caller send a normal final reply when no preview was posted yet', async () => {
    vi.useFakeTimers()
    const { manager, transport } = createHarness()
    manager.start('turn-1', 'connection-1', '123')
    manager.update('turn-1', { mode: 'delta', content: '草稿' })

    expect(await manager.finish('turn-1', '最终回答')).toBe(false)
    await vi.advanceTimersByTimeAsync(1_100)
    expect(transport.sendPreview).not.toHaveBeenCalled()
  })

  it('falls back to typing when preview delivery fails', async () => {
    vi.useFakeTimers()
    const { manager, transport } = createHarness({
      sendPreview: vi.fn(async () => {
        throw new Error('unsupported')
      }),
    })

    manager.start('turn-1', 'connection-1', '-100')
    manager.update('turn-1', { mode: 'delta', content: '不会发送' })
    await vi.advanceTimersByTimeAsync(4_100)

    expect(transport.sendPreview).toHaveBeenCalledTimes(1)
    expect(transport.sendTyping).toHaveBeenCalledTimes(2)
    expect(await manager.finish('turn-1', '最终回复')).toBe(false)
  })
})

describe('formatTelegramDraftPreview', () => {
  it('keeps the newest 3900 characters for long streaming output', () => {
    const preview = formatTelegramDraftPreview(`old${'x'.repeat(4_096)}new`)
    expect(preview).toHaveLength(3_900)
    expect(preview.startsWith('…\n')).toBe(true)
    expect(preview.endsWith('new')).toBe(true)
  })
})
