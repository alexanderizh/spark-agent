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

  it('三视图是基准图，不需要输入基准；其余面向需要', () => {
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
  })
})
