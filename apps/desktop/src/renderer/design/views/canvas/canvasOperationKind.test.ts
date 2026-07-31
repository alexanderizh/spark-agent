import { describe, expect, it } from 'vitest'
import { canvasOperationKind } from './canvasOperationKind'

describe('canvasOperationKind', () => {
  it('routes image prompt reverse through the text vision execution path', () => {
    expect(canvasOperationKind('image_prompt_reverse')).toBe('text')
  })

  it('routes depth video through the local media execution path', () => {
    expect(canvasOperationKind('video_depth_map')).toBe('local_media')
  })

  it('keeps provider-backed image and video tasks on the cloud media path', () => {
    expect(canvasOperationKind('image_to_video')).toBe('cloud_media')
    expect(canvasOperationKind('text_to_image')).toBe('cloud_media')
  })

  it('keeps hidden legacy text operations executable', () => {
    expect(canvasOperationKind('text_generate')).toBe('text')
    expect(canvasOperationKind('text_rewrite')).toBe('text')
    expect(canvasOperationKind('prompt_optimize')).toBe('text')
  })
})
