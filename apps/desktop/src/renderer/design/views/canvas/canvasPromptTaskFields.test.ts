import { describe, expect, it } from 'vitest'
import type { CanvasPromptTaskFields } from '@spark/protocol'
import { buildCanvasRetryInputRoles, pickCanvasPromptTaskFields } from './canvasPromptTaskFields'

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

  it('restores multimodal reference roles when retrying a video task', () => {
    expect(
      buildCanvasRetryInputRoles([
        { blockId: 'video-source-block', sourceNodeId: 'video-source', relation: 'generic', order: 0 },
        {
          blockId: 'video-ref-block',
          sourceNodeId: 'video-ref',
          relation: 'reference_video',
          order: 1,
        },
        {
          blockId: 'audio-ref-block',
          sourceNodeId: 'audio-ref',
          relation: 'reference_audio',
          order: 2,
        },
      ]),
    ).toEqual({
      'video-source': ['input'],
      'video-ref': ['reference'],
      'audio-ref': ['reference'],
    })
  })
})
