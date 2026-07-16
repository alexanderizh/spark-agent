import { describe, expect, it } from 'vitest'

import {
  CANVAS_PRESET_TASK_CARDS,
  buildCanvasPresetTargetGroups,
  isImageUnderstandingProvider,
} from './canvasPresetCenterModel'
import { CANVAS_PRESET_TARGETS } from './canvasOperationPresets'

describe('canvasPresetCenterModel', () => {
  it('shows the four real task defaults in a stable order', () => {
    expect(CANVAS_PRESET_TASK_CARDS.map((card) => card.kind)).toEqual([
      'text',
      'image_understanding',
      'image_generation',
      'video_generation',
    ])
    expect(CANVAS_PRESET_TASK_CARDS.map((card) => card.label)).toEqual([
      '文本处理',
      '图片理解',
      '图片生成',
      '视频生成',
    ])
  })

  it('only treats multimodal text providers as image-understanding choices', () => {
    expect(isImageUnderstandingProvider({ modelType: 'multimodal' })).toBe(true)
    expect(isImageUnderstandingProvider({ modelType: 'text' })).toBe(false)
    expect(isImageUnderstandingProvider({ modelType: 'image' })).toBe(false)
  })

  it('groups every preset target into a plain-language node section', () => {
    const groups = buildCanvasPresetTargetGroups(CANVAS_PRESET_TARGETS)

    expect(groups.map((group) => group.id)).toEqual(['text', 'image', 'video', 'audio'])
    expect(groups.flatMap((group) => group.targets)).toHaveLength(CANVAS_PRESET_TARGETS.length)
    expect(
      groups.find((group) => group.id === 'text')?.targets.map((target) => target.id),
    ).toContain('screenplay.to_shot_script')
    expect(
      groups.find((group) => group.id === 'audio')?.targets.map((target) => target.id),
    ).toEqual(['text_to_audio', 'audio_transcribe'])
  })
})
