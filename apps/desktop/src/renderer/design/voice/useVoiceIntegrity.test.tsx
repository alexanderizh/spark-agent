// @vitest-environment jsdom

import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { VoiceIntegrityStatus } from '@spark/protocol'
import { useVoiceIntegrity, type UseVoiceIntegrityResult } from './useVoiceIntegrity'

const localStatus: VoiceIntegrityStatus = {
  ready: false,
  downloading: false,
  supported: true,
  unsupportedReason: null,
  components: [],
  lastError: null,
}

let root: Root | null = null
let container: HTMLDivElement | null = null
let latest: UseVoiceIntegrityResult | null = null
const invoke = vi.fn()

function Harness(): null {
  const current = useVoiceIntegrity()
  useEffect(() => {
    latest = current
  }, [current])
  return null
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
    .IS_REACT_ACT_ENVIRONMENT = true
  latest = null
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  Object.defineProperty(window, 'spark', {
    configurable: true,
    value: {
      invoke,
      on: vi.fn(() => vi.fn()),
      platform: 'darwin',
      sendVoiceAudioChunk: vi.fn(),
    },
  })
})

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
})

describe('useVoiceIntegrity', () => {
  it('unblocks from the local check before the remote manifest refresh completes', async () => {
    let resolveLatest!: (value: { status: VoiceIntegrityStatus }) => void
    invoke.mockImplementation((_channel: string, request: { checkLatest: boolean }) => {
      if (!request.checkLatest) return Promise.resolve({ status: localStatus })
      return new Promise((resolve) => {
        resolveLatest = resolve
      })
    })

    await act(async () => {
      root?.render(<Harness />)
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(latest?.checking).toBe(false)
    expect(latest?.status).toEqual(localStatus)
    expect(invoke).toHaveBeenNthCalledWith(1, 'voice:check-integrity', { checkLatest: false })

    resolveLatest({ status: { ...localStatus, lastError: 'remote advisory' } })
    await act(async () => Promise.resolve())
    expect(latest?.status.lastError).toBe('remote advisory')
  })
})
