import type { CanvasWindowOpenResponse } from '@spark/protocol'

export function openCanvasProjectWindow(projectId: string): Promise<CanvasWindowOpenResponse> {
  return window.spark.invoke('canvas:window:open', { projectId })
}
