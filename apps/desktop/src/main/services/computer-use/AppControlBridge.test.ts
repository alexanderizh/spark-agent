import { describe, expect, it, vi } from 'vitest'
import { AppControlBridge } from './AppControlBridge.js'

describe('AppControlBridge', () => {
  it('binds a renderer result to the exact session and action', async () => {
    const send = vi.fn(() => true)
    const bridge = new AppControlBridge({ send }, () => 'command-1', 1_000)
    const signal = new AbortController().signal
    const resultPromise = bridge.execute({
      computerSessionId: 'computer-1',
      actionId: 'action-1',
      command: { name: 'set_theme', theme: 'dark' },
      signal,
    })

    expect(
      bridge.resolve({
        commandId: 'command-1',
        computerSessionId: 'computer-other',
        actionId: 'action-1',
        status: 'applied',
        uiRevision: 1,
      }),
    ).toBe(false)
    expect(
      bridge.resolve({
        commandId: 'command-1',
        computerSessionId: 'computer-1',
        actionId: 'action-1',
        status: 'applied',
        uiRevision: 1,
      }),
    ).toBe(true)
    await expect(resultPromise).resolves.toMatchObject({ status: 'applied', uiRevision: 1 })
  })

  it('fails closed when canceled before the renderer acknowledges', async () => {
    const bridge = new AppControlBridge({ send: () => true }, () => 'command-2', 1_000)
    const abort = new AbortController()
    const result = bridge.execute({
      computerSessionId: 'computer-1',
      actionId: 'action-2',
      command: { name: 'navigate', view: 'settings' },
      signal: abort.signal,
    })
    abort.abort()
    await expect(result).rejects.toMatchObject({ code: 'session_canceled' })
  })

  it('fails closed when no trusted renderer is available', async () => {
    const bridge = new AppControlBridge({ send: () => false }, () => 'command-3', 1_000)
    await expect(
      bridge.execute({
        computerSessionId: 'computer-1',
        actionId: 'action-3',
        command: { name: 'set_theme', theme: 'light' },
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: 'environment_unavailable' })
  })
})
