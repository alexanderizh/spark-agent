import { describe, expect, it } from 'vitest'
import {
  CANVAS_BASE_TASK_MENU_LABEL,
  CANVAS_BASE_CREATE_OPERATION_GROUPS,
  CANVAS_FEATURE_MENU_LABEL,
  CANVAS_FUNCTIONAL_CREATE_OPERATIONS,
  CANVAS_FUNCTIONAL_MENU_LABEL,
  CANVAS_VISIBLE_BASE_CREATE_OPERATION_GROUPS,
  canvasBaseCreateOperations,
  canvasVisibleBaseCreateOperations,
  canvasVisibleFeatureCreateOperations,
  canvasVisiblePrimaryCreateOperations,
} from './canvasNodeGenerationMenu'

describe('canvasNodeGenerationMenu', () => {
  it('names film creation, featured tools, and base tasks separately', () => {
    expect(CANVAS_FUNCTIONAL_MENU_LABEL).toBe('影视创作')
    expect(CANVAS_FEATURE_MENU_LABEL).toBe('特色功能')
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

  it('keeps the basic text task above image, video, and audio groups', () => {
    expect(CANVAS_BASE_CREATE_OPERATION_GROUPS.map((group) => group.id)).toEqual([
      'text',
      'image',
      'video',
      'audio',
    ])
  })

  it('exposes the merged base task operations across image, video, and audio groups', () => {
    expect(canvasBaseCreateOperations().map((item) => item.operation)).toEqual([
      'text_generate',
      'text_to_image',
      'image_prompt_reverse',
      'text_to_video',
      'video_depth_map',
      'extract_audio',
      'extract_first_last_frames',
      'text_to_audio',
      'audio_transcribe',
    ])
  })

  it('offers one unified image generation entry plus image prompt reverse', () => {
    expect(
      CANVAS_BASE_CREATE_OPERATION_GROUPS.find((group) => group.id === 'image')?.items,
    ).toEqual([
      { operation: 'text_to_image', label: '图片生成', icon: 'Image' },
      { operation: 'image_prompt_reverse', label: '图片反推', icon: 'FileText' },
    ])
  })

  it('offers text-to-text as the first basic task without a built-in prompt contract', () => {
    expect(CANVAS_BASE_CREATE_OPERATION_GROUPS.find((group) => group.id === 'text')?.items).toEqual(
      [{ operation: 'text_generate', label: '文本生文', icon: 'FileText' }],
    )
  })

  it('offers one unified video generation entry plus the independent depth tool', () => {
    expect(
      CANVAS_BASE_CREATE_OPERATION_GROUPS.find((group) => group.id === 'video')?.items,
    ).toEqual([
      { operation: 'text_to_video', label: '视频生成', icon: 'Video' },
      { operation: 'video_depth_map', label: '深度视频转换', icon: 'Video' },
      { operation: 'extract_audio', label: '分离音频', icon: 'Audio' },
      { operation: 'extract_first_last_frames', label: '提取首尾帧', icon: 'Image' },
    ])
  })

  it('hides audio from the current right-click menu without deleting its definitions', () => {
    expect(CANVAS_VISIBLE_BASE_CREATE_OPERATION_GROUPS.map((group) => group.id)).toEqual([
      'text',
      'image',
      'video',
    ])
    expect(CANVAS_BASE_CREATE_OPERATION_GROUPS.map((group) => group.id)).toContain('audio')
  })

  it('flattens visible image and video operations for the right-click menu', () => {
    expect(canvasVisibleBaseCreateOperations().map((item) => item.operation)).toEqual([
      'text_generate',
      'text_to_image',
      'image_prompt_reverse',
      'text_to_video',
      'video_depth_map',
      'extract_audio',
      'extract_first_last_frames',
    ])
  })

  it('moves depth conversion, audio extraction and frame extraction into featured tools', () => {
    expect(canvasVisibleFeatureCreateOperations().map((item) => item.operation)).toEqual([
      'video_depth_map',
      'extract_audio',
      'extract_first_last_frames',
    ])
    expect(canvasVisiblePrimaryCreateOperations().map((item) => item.operation)).toEqual([
      'text_generate',
      'text_to_image',
      'image_prompt_reverse',
      'text_to_video',
    ])
  })
})
