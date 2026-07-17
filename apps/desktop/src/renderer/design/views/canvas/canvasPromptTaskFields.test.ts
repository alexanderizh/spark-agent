import { describe, expect, it } from 'vitest'
import type { CanvasPromptTaskFields } from '@spark/protocol'
import { pickCanvasPromptTaskFields } from './canvasPromptTaskFields'

describe('pickCanvasPromptTaskFields', () => {
  it('preserves canonical input bindings across task persistence boundaries', () => {
    const inputBindings: NonNullable<CanvasPromptTaskFields['inputBindings']> = [
      {
        id: 'manual:image-1:reference',
        sourceNodeId: 'image-1',
        origin: 'manual',
        kind: 'image',
        relation: 'reference_image',
        role: 'reference',
        enabled: true,
        order: 0,
        promptBlockId: 'image-tag',
      },
    ]

    expect(pickCanvasPromptTaskFields({ inputBindings })).toEqual({ inputBindings })
  })
})
