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

  it('removes the general text group while retaining image, video, and audio groups', () => {
    expect(CANVAS_BASE_CREATE_OPERATION_GROUPS.map((group) => group.id)).toEqual([
      'image',
      'video',
      'audio',
    ])
  })

  it('exposes the merged base task operations across image, video, and audio groups', () => {
    expect(canvasBaseCreateOperations().map((item) => item.operation)).toEqual([
      'text_to_image',
      'image_prompt_reverse',
      'text_to_video',
      'video_depth_map',
      'text_to_audio',
      'audio_transcribe',
    ])
  })

  it('offers one unified image generation entry plus image prompt reverse', () => {
    expect(CANVAS_BASE_CREATE_OPERATION_GROUPS.find((group) => group.id === 'image')?.items).toEqual([
      { operation: 'text_to_image', label: '图片生成', icon: 'Image' },
      { operation: 'image_prompt_reverse', label: '图片反推', icon: 'FileText' },
    ])
  })

  it('offers one unified video generation entry plus the independent depth tool', () => {
    expect(CANVAS_BASE_CREATE_OPERATION_GROUPS.find((group) => group.id === 'video')?.items).toEqual([
      { operation: 'text_to_video', label: '视频生成', icon: 'Video' },
      { operation: 'video_depth_map', label: '深度视频转换', icon: 'Video' },
    ])
  })
})
