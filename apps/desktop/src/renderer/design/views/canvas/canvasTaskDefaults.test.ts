// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest'

import {
  CANVAS_TASK_DEFAULT_KINDS,
  canvasTaskDefaultKindForOperation,
  hasCanvasTaskDefault,
  readCanvasTaskDefault,
  resetCanvasTaskDefault,
  writeCanvasTaskDefault,
} from './canvasTaskDefaults'

describe('canvasTaskDefaults', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('maps canvas operations to the four user-facing task defaults', () => {
    expect(CANVAS_TASK_DEFAULT_KINDS).toEqual([
      'text',
      'image_understanding',
      'image_generation',
      'video_generation',
    ])
    expect(canvasTaskDefaultKindForOperation('text_generate')).toBe('text')
    expect(canvasTaskDefaultKindForOperation('text_generate', { hasImageInput: true })).toBe(
      'image_understanding',
    )
    expect(canvasTaskDefaultKindForOperation('image_edit')).toBe('image_generation')
    expect(canvasTaskDefaultKindForOperation('video_extend')).toBe('video_generation')
    expect(canvasTaskDefaultKindForOperation('audio_transcribe')).toBeNull()
  })

  it('stores only normalized runtime selections', () => {
    writeCanvasTaskDefault('text', {
      agentId: ' agent:writer ',
      providerProfileId: ' provider:text ',
      modelId: ' gpt-5 ',
      skillIds: ['skill:outline', 42, 'skill:style'] as unknown as string[],
      ignored: 'value',
    } as never)

    expect(readCanvasTaskDefault('text')).toEqual({
      agentId: 'agent:writer',
      providerProfileId: 'provider:text',
      modelId: 'gpt-5',
      skillIds: ['skill:outline', 'skill:style'],
    })
    expect(hasCanvasTaskDefault('text')).toBe(true)
  })

  it('resets one task default without affecting the others', () => {
    writeCanvasTaskDefault('text', {
      providerProfileId: 'provider:text',
      modelId: 'gpt-5',
      skillIds: [],
    })
    writeCanvasTaskDefault('image_generation', {
      providerProfileId: 'provider:image',
      manifestId: 'image.generate',
      modelId: 'seedream-4.5',
      skillIds: [],
    })

    resetCanvasTaskDefault('text')

    expect(readCanvasTaskDefault('text')).toEqual({ skillIds: [] })
    expect(readCanvasTaskDefault('image_generation')).toMatchObject({
      providerProfileId: 'provider:image',
      manifestId: 'image.generate',
      modelId: 'seedream-4.5',
    })
  })
})
