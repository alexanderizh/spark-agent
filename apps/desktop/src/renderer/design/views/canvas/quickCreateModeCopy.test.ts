import { describe, expect, it } from 'vitest'
import { QUICK_CREATE_MODES } from './quickCreateTaskStore'
import { QUICK_CREATE_MODE_COPY, quickCreateModeCopy } from './quickCreateModeCopy'

describe('quickCreateModeCopy', () => {
  it('为每个模式都提供完整文案（新增模式漏配会在这里暴露）', () => {
    for (const mode of QUICK_CREATE_MODES) {
      const copy = quickCreateModeCopy(mode)
      expect(copy, `missing copy for ${mode}`).toBeDefined()
      for (const value of [
        copy.note(0),
        copy.promptTitle,
        copy.promptHint,
        copy.promptAriaLabel,
        copy.promptPlaceholder,
        copy.promptMeta,
        copy.generateLabel,
        copy.noModelHint,
      ]) {
        expect(typeof value).toBe('string')
        expect(value.length).toBeGreaterThan(0)
      }
    }
  })

  it('语音 / 音乐不接受参考素材，反推 / 识别要求恰好一个素材', () => {
    expect(quickCreateModeCopy('audio').acceptsInputMaterials).toBe(false)
    expect(quickCreateModeCopy('music').acceptsInputMaterials).toBe(false)
    expect(quickCreateModeCopy('image').acceptsInputMaterials).toBe(true)
    expect(quickCreateModeCopy('video').acceptsInputMaterials).toBe(true)
    expect(quickCreateModeCopy('reverse').requiresSingleInput).toBe(true)
    expect(quickCreateModeCopy('transcribe').requiresSingleInput).toBe(true)
    expect(quickCreateModeCopy('music').requiresSingleInput).toBe(false)
  })

  it('音乐模式的按钮与空态文案指向音乐生成', () => {
    const copy = QUICK_CREATE_MODE_COPY.music
    expect(copy.generateLabel).toBe('生成音乐')
    expect(copy.noModelHint).toContain('音乐')
    expect(copy.offersChannelSetup).toBe(true)
  })

  it('图片模式的说明随素材数量变化', () => {
    const copy = QUICK_CREATE_MODE_COPY.image
    expect(copy.note(0)).toContain('添加参考素材')
    expect(copy.note(1)).toContain('图像编辑')
  })
})
