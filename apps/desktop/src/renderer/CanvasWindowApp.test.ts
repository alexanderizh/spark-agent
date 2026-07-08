import { describe, expect, it } from 'vitest'

import { getCanvasWindowPlatformClass, readCanvasWindowProjectId } from './canvasWindowParams'

describe('readCanvasWindowProjectId', () => {
  it('returns the project id only for standalone canvas windows', () => {
    expect(readCanvasWindowProjectId('?window=canvas&projectId=canvas_project_1')).toBe(
      'canvas_project_1',
    )
    expect(readCanvasWindowProjectId('?window=chat&projectId=canvas_project_1')).toBeNull()
    expect(readCanvasWindowProjectId('?window=canvas')).toBeNull()
  })
})

describe('getCanvasWindowPlatformClass', () => {
  it('maps standalone canvas windows to normal platform classes', () => {
    expect(getCanvasWindowPlatformClass('darwin')).toBe('platform-darwin')
    expect(getCanvasWindowPlatformClass('win32')).toBe('platform-win32')
    expect(getCanvasWindowPlatformClass('linux')).toBe('platform-linux')
  })
})
