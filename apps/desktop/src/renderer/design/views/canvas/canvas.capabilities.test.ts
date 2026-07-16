import { describe, expect, it } from 'vitest'
import { getCanvasCapability } from './canvas.capabilities'

describe('canvas capabilities', () => {
  it('text_to_video allows optional media references for multimodal video models', () => {
    const capability = getCanvasCapability('text_to_video')
    expect(capability?.inputTypes).toEqual(
      expect.arrayContaining(['text', 'prompt', 'image', 'video', 'audio']),
    )
  })
})
