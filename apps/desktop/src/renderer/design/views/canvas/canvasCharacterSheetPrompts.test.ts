import { describe, expect, it } from 'vitest'
import {
  CHARACTER_SHEET_ASPECT_ORDER,
  CHARACTER_SHEET_TEMPLATES,
  buildCharacterCoreDescription,
  buildCharacterSheetPrompt,
  getCharacterSheetTemplate,
} from './canvasCharacterSheetPrompts'

describe('canvasCharacterSheetPrompts', () => {
  it('覆盖六个面向且顺序稳定', () => {
    expect(CHARACTER_SHEET_ASPECT_ORDER).toEqual([
      'turnaround',
      'expression',
      'distance',
      'costume',
      'facial',
      'props',
    ])
    expect(CHARACTER_SHEET_TEMPLATES).toHaveLength(6)
  })

  it('角色身份板是基准图，不需要输入基准；其余面向需要', () => {
    expect(getCharacterSheetTemplate('turnaround')?.needsBaseImage).toBe(false)
    expect(getCharacterSheetTemplate('expression')?.needsBaseImage).toBe(true)
    expect(getCharacterSheetTemplate('props')?.needsBaseImage).toBe(true)
  })

  it('面向回挂到合理的 reference kind', () => {
    expect(getCharacterSheetTemplate('turnaround')?.referenceKind).toBe('concept')
    expect(getCharacterSheetTemplate('expression')?.referenceKind).toBe('expression')
    expect(getCharacterSheetTemplate('costume')?.referenceKind).toBe('costume')
  })

  describe('buildCharacterCoreDescription', () => {
    it('拼接角色结构化字段', () => {
      const core = buildCharacterCoreDescription({
        gender: 'male',
        ageStage: 'young adult',
        appearance: 'tall, scar on cheek',
        signatureProps: ['black sword'],
      })
      expect(core).toBe('male, young adult, tall, scar on cheek, black sword')
    })

    it('忽略空字段', () => {
      expect(buildCharacterCoreDescription({ name: '甲' })).toBe('')
    })

    it('穿透新增精细字段（身高/肤色/五官/眼睛/配饰/标志特征/气质）', () => {
      const core = buildCharacterCoreDescription({
        gender: 'male',
        height: '178cm lean',
        skinTone: 'tanned skin',
        appearance: 'wiry build',
        facialFeatures: 'sharp brows, thin lips',
        eyeColor: 'amber eyes',
        accessories: ['leather wrist guard'],
        distinguishingMarks: 'scar on left cheek',
        temperament: 'composed',
      })
      expect(core).toContain('178cm lean')
      expect(core).toContain('tanned skin')
      expect(core).toContain('sharp brows, thin lips')
      expect(core).toContain('amber eyes')
      expect(core).toContain('leather wrist guard')
      expect(core).toContain('scar on left cheek')
      expect(core).toContain('composed')
    })
  })

  describe('buildCharacterSheetPrompt', () => {
    it('组装核心描述 + 面向积木 + 风格 + 锁定项', () => {
      const prompt = buildCharacterSheetPrompt({
        aspect: 'turnaround',
        character: { appearance: 'tall warrior', lockedAttributes: ['red eyes'] },
        styleBible: 'anime style, cinematic',
      })
      expect(prompt).toContain('tall warrior')
      expect(prompt).toContain('character turnaround model sheet')
      expect(prompt).toContain('anime style, cinematic')
      expect(prompt).toContain('keep consistent: red eyes')
    })

    it('去重相同片段', () => {
      const prompt = buildCharacterSheetPrompt({
        aspect: 'expression',
        character: { appearance: 'neutral background' },
      })
      const count = prompt.split(',').filter((s) => s.trim() === 'neutral background').length
      expect(count).toBe(1)
    })

    it('附加用户额外补充', () => {
      const prompt = buildCharacterSheetPrompt({
        aspect: 'costume',
        character: {},
        extraPrompt: 'winter and summer outfits',
      })
      expect(prompt).toContain('winter and summer outfits')
    })

    it('角色身份板：渲染角色名标题与角色定位说明，含坐姿与仰视俯视视角面板', () => {
      const prompt = buildCharacterSheetPrompt({
        aspect: 'turnaround',
        character: { name: '林岚', occupation: '主角', temperament: '沉静内敛' },
      })
      expect(prompt).toContain('林岚')
      expect(prompt).toContain('主角 · 沉静内敛')
      // 角色身份板含表情条与配饰板等加厚积木
      expect(prompt).toContain('expression panel')
      expect(prompt).toContain('accessories')
      // 身份板额外含坐姿与仰视/俯视视角面板
      expect(prompt).toContain('sitting pose')
      expect(prompt).toContain('low-angle')
      expect(prompt).toContain('high-angle')
    })

    it('非身份板面向用角色名锚点保持一致性', () => {
      const prompt = buildCharacterSheetPrompt({
        aspect: 'expression',
        character: { name: '林岚' },
      })
      expect(prompt).toContain('character named "林岚"')
    })
  })
})
