export type CanvasTaskViewport = {
  x: number
  y: number
  zoom: number
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
