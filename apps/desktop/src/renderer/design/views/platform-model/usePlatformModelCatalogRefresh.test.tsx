// @vitest-environment jsdom

import React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePlatformModelCatalogRefresh } from './usePlatformModelCatalogRefresh'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  reloadLocal: vi.fn(),
  toastError: vi.fn(),
}))

vi.mock('../../hooks/useIpc', () => ({
  useIpcInvoke: () => ({ invoke: mocks.invoke }),
}))

vi.mock('../../components/Toast', () => ({
  useToast: () => ({ toast: { error: mocks.toastError } }),
}))

let manualRefresh: (() => Promise<void>) | null = null

function Harness(): React.ReactElement | null {
  const result = usePlatformModelCatalogRefresh(mocks.reloadLocal)
  React.useEffect(() => {
    manualRefresh = result.refreshPlatformCatalog
    return () => {
      manualRefresh = null
    }
  }, [result.refreshPlatformCatalog])
  return null
}

describe('usePlatformModelCatalogRefresh', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    vi.clearAllMocks()
    manualRefresh = null
    mocks.invoke.mockResolvedValue({ models: ['glm-5'], mediaModels: [], refreshed: true })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it('refreshes the catalog on mount before reloading local providers', async () => {
    await act(async () => root.render(<Harness />))

    await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith({ force: false }))
    expect(mocks.reloadLocal).toHaveBeenCalledOnce()
  })

  it('refreshes after the document becomes visible', async () => {
    await act(async () => root.render(<Harness />))
    await vi.waitFor(() => expect(mocks.reloadLocal).toHaveBeenCalledOnce())
    mocks.invoke.mockClear()
    mocks.reloadLocal.mockClear()
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })

    await act(async () => document.dispatchEvent(new Event('visibilitychange')))

    await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith({ force: false }))
    expect(mocks.reloadLocal).toHaveBeenCalledOnce()
  })

  it('force refreshes when the user requests a refresh', async () => {
    await act(async () => root.render(<Harness />))
    await vi.waitFor(() => expect(mocks.reloadLocal).toHaveBeenCalledOnce())
    mocks.invoke.mockClear()

    await act(async () => {
      await manualRefresh?.()
    })

    expect(mocks.invoke).toHaveBeenCalledWith({ force: true })
  })

  it('keeps local providers visible without a toast when automatic refresh fails', async () => {
    mocks.invoke.mockRejectedValue(new Error('offline'))

    await act(async () => root.render(<Harness />))

    await vi.waitFor(() => expect(mocks.reloadLocal).toHaveBeenCalledOnce())
    expect(mocks.toastError).not.toHaveBeenCalled()
  })
})
