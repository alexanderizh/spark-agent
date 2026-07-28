// @vitest-environment jsdom

import React, { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useCanvasReload } from './useCanvasReload'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  isCanvasDirty: vi.fn(),
  revertProject: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}))

vi.mock('./canvas.api', () => ({
  isCanvasDirty: mocks.isCanvasDirty,
  revertProject: mocks.revertProject,
}))

vi.mock('antd', () => ({
  message: {
    success: mocks.success,
    error: mocks.error,
  },
}))

type ReloadOptions = Parameters<typeof useCanvasReload>[0]
let currentReload: (() => Promise<void>) | null = null
const mounted: Array<{ root: Root; container: HTMLDivElement }> = []

function Harness(props: ReloadOptions) {
  const { reload } = useCanvasReload(props)
  useEffect(() => {
    currentReload = reload
    return () => {
      currentReload = null
    }
  }, [reload])
  return null
}

async function renderHook(overrides: Partial<ReloadOptions> = {}) {
  const props: ReloadOptions = {
    projectId: 'project-1',
    savingRef: { current: false },
    requestConfirm: vi.fn().mockResolvedValue(true),
    refresh: vi.fn().mockResolvedValue(undefined),
    onBeforeReload: vi.fn(),
    onReloaded: vi.fn(),
    ...overrides,
  }
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  mounted.push({ root, container })
  await act(async () => root.render(<Harness {...props} />))
  return props
}

beforeEach(() => {
  currentReload = null
  mocks.isCanvasDirty.mockReset().mockReturnValue(false)
  mocks.revertProject.mockReset().mockResolvedValue(undefined)
  mocks.success.mockReset()
  mocks.error.mockReset()
})

afterEach(() => {
  while (mounted.length > 0) {
    const item = mounted.pop()
    if (item == null) break
    act(() => item.root.unmount())
    item.container.remove()
  }
})

describe('useCanvasReload', () => {
  it('reloads persisted state and resets canvas history', async () => {
    const props = await renderHook()
    if (currentReload == null) throw new Error('Reload callback was not mounted')

    await act(async () => currentReload?.())

    expect(props.onBeforeReload).toHaveBeenCalledTimes(1)
    expect(props.refresh).toHaveBeenCalledWith({ resetHistory: true })
    expect(props.onReloaded).toHaveBeenCalledTimes(1)
    expect(mocks.success).toHaveBeenCalledWith('画布已刷新')
  })

  it('requires confirmation before discarding unsaved state', async () => {
    mocks.isCanvasDirty.mockReturnValue(true)
    const requestConfirm = vi.fn().mockResolvedValue(false)
    const props = await renderHook({ requestConfirm })
    if (currentReload == null) throw new Error('Reload callback was not mounted')

    await act(async () => currentReload?.())

    expect(requestConfirm).toHaveBeenCalledTimes(1)
    expect(mocks.revertProject).not.toHaveBeenCalled()
    expect(props.refresh).not.toHaveBeenCalled()
  })

  it('discards the hot state only after confirmation', async () => {
    mocks.isCanvasDirty.mockReturnValue(true)
    const props = await renderHook()
    if (currentReload == null) throw new Error('Reload callback was not mounted')

    await act(async () => currentReload?.())

    expect(mocks.revertProject).toHaveBeenCalledWith('project-1')
    expect(mocks.revertProject.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(props.refresh).mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
    )
  })

  it('does not reload while a save is in progress', async () => {
    const props = await renderHook({ savingRef: { current: true } })
    if (currentReload == null) throw new Error('Reload callback was not mounted')

    await act(async () => currentReload?.())

    expect(props.requestConfirm).not.toHaveBeenCalled()
    expect(props.refresh).not.toHaveBeenCalled()
  })

  it('reports reload failures without running the success callback', async () => {
    const refreshError = new Error('snapshot unavailable')
    const props = await renderHook({ refresh: vi.fn().mockRejectedValue(refreshError) })
    if (currentReload == null) throw new Error('Reload callback was not mounted')

    await act(async () => currentReload?.())

    expect(props.onReloaded).not.toHaveBeenCalled()
    expect(mocks.success).not.toHaveBeenCalled()
    expect(mocks.error).toHaveBeenCalledWith('snapshot unavailable')
  })
})
