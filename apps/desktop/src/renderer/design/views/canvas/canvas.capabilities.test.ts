import { describe, expect, it } from 'vitest'
import { CANVAS_CAPABILITIES, getCanvasCapability } from './canvas.capabilities'

describe('canvas capabilities', () => {
  it('places text-to-text before image generation in the basic task list', () => {
    const textIndex = CANVAS_CAPABILITIES.findIndex(
      (capability) => capability.operation === 'text_generate',
    )
    const imageIndex = CANVAS_CAPABILITIES.findIndex(
      (capability) => capability.operation === 'text_to_image',
    )
    expect(textIndex).toBeGreaterThanOrEqual(0)
    expect(imageIndex).toBeGreaterThan(textIndex)
    expect(CANVAS_CAPABILITIES[textIndex]?.label).toBe('文本生文')
  })

  it('text_to_video allows optional media references for multimodal video models', () => {
    const capability = getCanvasCapability('text_to_video')
    expect(capability?.inputTypes).toEqual(
      expect.arrayContaining(['text', 'prompt', 'image', 'video', 'audio']),
    )
  })
})
