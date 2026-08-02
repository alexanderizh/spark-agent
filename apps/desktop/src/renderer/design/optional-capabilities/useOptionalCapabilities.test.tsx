// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useOptionalCapabilities } from './useOptionalCapabilities'
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

describe('useOptionalCapabilities', () => {
  afterEach(() => {
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  it('checks the cached or remote manifest when the capability store starts', async () => {
    const snapshot = {
      capabilities: [],
      checkedAt: '2026-08-02T00:00:00.000Z',
      manifestUpdatedAt: '2026-08-02',
      remoteAvailable: true,
    }
    const invoke = vi.fn(async () => snapshot)
    Object.assign(window, {
      spark: {
        on: vi.fn(() => () => undefined),
        invoke,
      },
    })
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const Probe = () => {
      const capabilities = useOptionalCapabilities()
      return <span>{capabilities.loading ? 'loading' : 'ready'}</span>
    }

    await act(async () => root.render(<Probe />))
    await act(async () => undefined)

    expect(invoke).toHaveBeenCalledWith('optional-capability:check', { forceRemote: false })
    expect(invoke).not.toHaveBeenCalledWith('optional-capability:list', expect.anything())
    await act(async () => root.unmount())
  })
})
