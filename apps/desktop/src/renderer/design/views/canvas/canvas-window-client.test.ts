import { describe, expect, it, vi } from 'vitest'

import { openCanvasProjectWindow } from './canvas-window-client'

describe('openCanvasProjectWindow', () => {
  it('opens the singleton canvas window for a project', async () => {
    const invoke = vi.fn(() =>
      Promise.resolve({ success: true, windowId: 7, projectId: 'canvas_project_1' }),
    )
    vi.stubGlobal('window', { spark: { invoke } })

    await expect(openCanvasProjectWindow('canvas_project_1')).resolves.toEqual({
      success: true,
      windowId: 7,
      projectId: 'canvas_project_1',
    })
    expect(invoke).toHaveBeenCalledWith('canvas:window:open', {
      projectId: 'canvas_project_1',
    })
  })
})
