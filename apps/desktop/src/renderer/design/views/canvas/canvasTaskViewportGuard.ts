export type CanvasTaskViewport = {
  x: number
  y: number
  zoom: number
}

type CanvasTaskViewportControls = {
  getViewport: () => CanvasTaskViewport | null
  setViewport: (viewport: CanvasTaskViewport, options?: { duration?: number }) => void
}

/** Read and freeze React Flow's live transform before task submission mutates UI state. */
export function captureCanvasTaskViewport(
  controls: CanvasTaskViewportControls | null,
  cachedViewport: CanvasTaskViewport | null,
  fallbackViewport: CanvasTaskViewport,
): CanvasTaskViewport {
  const viewport = controls?.getViewport() ?? cachedViewport ?? fallbackViewport
  controls?.setViewport(viewport, { duration: 0 })
  return viewport
}

/**
 * Keep task creation from replacing the user's current canvas view with the
 * viewport returned by the refreshed task snapshot.
 */
export async function runWithCanvasTaskViewport<T>(
  captureViewport: () => CanvasTaskViewport | null | Promise<CanvasTaskViewport | null>,
  restoreViewport: (viewport: CanvasTaskViewport | null) => void,
  run: () => Promise<T>,
): Promise<T> {
  const viewport = await captureViewport()
  try {
    return await run()
  } finally {
    restoreViewport(viewport)
  }
}
