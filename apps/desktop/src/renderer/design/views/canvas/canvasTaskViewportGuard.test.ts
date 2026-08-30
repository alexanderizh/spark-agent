import { describe, expect, it, vi } from 'vitest'
import { captureCanvasTaskViewport, runWithCanvasTaskViewport } from './canvasTaskViewportGuard'

describe('captureCanvasTaskViewport', () => {
  it('uses and freezes the live React Flow viewport instead of a stale cached viewport', () => {
    const liveViewport = { x: -388, y: 146, zoom: 0.82 }
    const setViewport = vi.fn()

    const captured = captureCanvasTaskViewport(
      { getViewport: () => liveViewport, setViewport },
      { x: 120, y: 80, zoom: 1 },
      { x: 0, y: 0, zoom: 1 },
    )

    expect(captured).toEqual(liveViewport)
    expect(setViewport).toHaveBeenCalledWith(liveViewport, { duration: 0 })
  })
})

describe('runWithCanvasTaskViewport', () => {
  it('restores the captured viewport after task creation', async () => {
    const restore = vi.fn()
    const result = await runWithCanvasTaskViewport(
      () => ({ x: 120, y: -48, zoom: 0.8 }),
      restore,
      async () => 'created',
    )

    expect(result).toBe('created')
    expect(restore).toHaveBeenCalledWith({ x: 120, y: -48, zoom: 0.8 })
  })

  it('restores the viewport when task creation fails', async () => {
    const restore = vi.fn()
    const error = new Error('create failed')

    await expect(
      runWithCanvasTaskViewport(
        async () => ({ x: 10, y: 20, zoom: 1.1 }),
        restore,
        async () => {
          throw error
        },
      ),
    ).rejects.toBe(error)

    expect(restore).toHaveBeenCalledWith({ x: 10, y: 20, zoom: 1.1 })
  })
})
