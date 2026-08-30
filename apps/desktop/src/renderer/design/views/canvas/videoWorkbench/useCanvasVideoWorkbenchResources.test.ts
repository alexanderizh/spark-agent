import { describe, expect, it } from 'vitest'
import { inferVideoWorkbenchResourceKindFromPath } from './useCanvasVideoWorkbenchResources'

describe('video workbench local resource kind inference', () => {
  it('recognizes image, audio, and video extensions case-insensitively', () => {
    expect(inferVideoWorkbenchResourceKindFromPath('/project/cover.PNG')).toBe('image')
    expect(inferVideoWorkbenchResourceKindFromPath('/project/voice.M4A')).toBe('audio')
    expect(inferVideoWorkbenchResourceKindFromPath('/project/shot.mov')).toBe('video')
  })
})
