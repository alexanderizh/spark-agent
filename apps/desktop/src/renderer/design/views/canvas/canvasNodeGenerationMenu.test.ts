import { describe, expect, it } from 'vitest'
import {
  CANVAS_BASE_TASK_MENU_LABEL,
  CANVAS_BASE_CREATE_OPERATION_GROUPS,
  CANVAS_FUNCTIONAL_CREATE_OPERATIONS,
  CANVAS_FUNCTIONAL_MENU_LABEL,
  canvasBaseCreateOperations,
} from './canvasNodeGenerationMenu'

describe('canvasNodeGenerationMenu', () => {
  it('names the two task tiers as film creation and base tasks', () => {
    expect(CANVAS_FUNCTIONAL_MENU_LABEL).toBe('影视创作')
    expect(CANVAS_BASE_TASK_MENU_LABEL).toBe('基础任务')
  })

  it('places storyboard and panorama only in the functional creation group', () => {
    expect(CANVAS_FUNCTIONAL_CREATE_OPERATIONS.map((item) => item.operation)).toEqual([
      'storyboard_grid',
      'panorama_360',
    ])
    const generalOperationIds = canvasBaseCreateOperations().map((item) => item.operation)
    expect(generalOperationIds).not.toContain('storyboard_grid')
    expect(generalOperationIds).not.toContain('panorama_360')
  })

  it('keeps operation ids unique across groups', () => {
    const allOperationIds = [
      ...CANVAS_FUNCTIONAL_CREATE_OPERATIONS,
      ...CANVAS_BASE_CREATE_OPERATION_GROUPS.flatMap((group) => group.items),
    ].map((item) => item.operation)
    expect(new Set(allOperationIds).size).toBe(allOperationIds.length)
  })

  it('retains image, text, video, and audio groups', () => {
    expect(CANVAS_BASE_CREATE_OPERATION_GROUPS.map((group) => group.id)).toEqual([
      'image',
      'text',
      'video',
      'audio',
    ])
  })

  it('exposes all twelve base operations without functional operations', () => {
    expect(canvasBaseCreateOperations().map((item) => item.operation)).toEqual([
      'text_to_image',
      'image_edit',
      'image_compose',
      'text_generate',
      'text_rewrite',
      'prompt_optimize',
      'text_to_video',
      'image_to_video',
      'video_edit',
      'video_extend',
      'text_to_audio',
      'audio_transcribe',
    ])
  })
})
