import { describe, expect, it } from 'vitest'
import {
  CANVAS_AGENT_PRESETS,
  DEFAULT_MAX_CLIP_SEC,
  DEFAULT_SHOT_SCRIPT_CONFIG,
  applyShotScriptConfigToPrompt,
  buildAgentPresetPrompt,
  getAgentPreset,
} from './canvasAgentPromptPresets'

describe('canvasAgentPromptPresets', () => {
  it('覆盖四个专属 agent 角色', () => {
    expect(CANVAS_AGENT_PRESETS.map((preset) => preset.role)).toEqual([
      'screenwriter',
      'storyboard',
      'director',
      'action',
    ])
  })

  it('四个预设默认操作均为 composer 可选的文本能力', () => {
    const selectable = new Set(['text_generate', 'prompt_optimize'])
    for (const preset of CANVAS_AGENT_PRESETS) {
      expect(selectable.has(preset.defaultOperation)).toBe(true)
    }
  })

  it('每个预设都有人设与模板', () => {
    for (const preset of CANVAS_AGENT_PRESETS) {
      expect(preset.persona.length).toBeGreaterThan(0)
      expect(preset.template).toContain('{upstream}')
    }
  })

  describe('buildAgentPresetPrompt', () => {
    it('填入上游文本与视觉总设定', () => {
      const prompt = buildAgentPresetPrompt('screenwriter', {
        upstreamText: '少年走进茶馆。',
        styleBible: '水墨写意，冷色调',
      })
      expect(prompt).toContain('少年走进茶馆。')
      expect(prompt).toContain('全片视觉总设定')
      expect(prompt).toContain('水墨写意，冷色调')
      // 占位槽位应被替换干净
      expect(prompt).not.toContain('{upstream}')
      expect(prompt).not.toContain('{style}')
    })

    it('缺上游文本时给出中文占位提示', () => {
      const prompt = buildAgentPresetPrompt('storyboard', {})
      expect(prompt).toContain('在此粘贴上游内容')
    })

    it('分镜预设带入时长上限，且不再含节奏基线', () => {
      const prompt = buildAgentPresetPrompt('storyboard', {
        upstreamText: '场1',
        maxClipSec: 8,
      })
      expect(prompt).toContain('不得超过 8 秒')
      // 节奏基线（约 N 秒/镜）已移除，不应再出现
      expect(prompt).not.toContain('秒/镜')
      expect(prompt).toContain('"shots"')
      expect(prompt).toContain('Markdown 表格')
    })

    it('分镜预设时长上限缺省用 DEFAULT_MAX_CLIP_SEC', () => {
      const prompt = buildAgentPresetPrompt('storyboard', { upstreamText: '场1' })
      expect(prompt).toContain(`不得超过 ${DEFAULT_MAX_CLIP_SEC} 秒`)
    })

    it('无视觉总设定时不残留多余空行', () => {
      const prompt = buildAgentPresetPrompt('action', { upstreamText: '二人对峙' })
      expect(prompt).not.toMatch(/\n{3,}/)
    })

    it('未知角色返回空串', () => {
      // @ts-expect-error 故意传非法角色
      expect(buildAgentPresetPrompt('unknown', {})).toBe('')
    })

    it('keepShotScriptPlaceholders=true 时保留 {maxClip} 占位槽', () => {
      const prompt = buildAgentPresetPrompt('storyboard', {
        upstreamText: '场1',
        maxClipSec: 8,
        keepShotScriptPlaceholders: true,
      })
      expect(prompt).toContain('{maxClip}')
      // 占位槽未被替换成具体数值
      expect(prompt).not.toContain('不得超过 8 秒')
    })
  })

  describe('applyShotScriptConfigToPrompt', () => {
    it('替换 {maxClip} 占位槽为配置值', () => {
      const prompt = buildAgentPresetPrompt('storyboard', {
        upstreamText: '场1',
        keepShotScriptPlaceholders: true,
      })
      const filled = applyShotScriptConfigToPrompt(prompt, { maxClipSec: 12 })
      expect(filled).toContain('不得超过 12 秒')
      expect(filled).not.toContain('{maxClip}')
    })

    it('占位槽不存在时为 no-op（非分镜模板 / 用户手编删除）', () => {
      const filled = applyShotScriptConfigToPrompt(
        '没有任何占位符的普通文本',
        DEFAULT_SHOT_SCRIPT_CONFIG,
      )
      expect(filled).toBe('没有任何占位符的普通文本')
    })

    it('默认配置填入 5 秒', () => {
      const prompt = buildAgentPresetPrompt('storyboard', {
        upstreamText: '场1',
        keepShotScriptPlaceholders: true,
      })
      const filled = applyShotScriptConfigToPrompt(prompt, DEFAULT_SHOT_SCRIPT_CONFIG)
      expect(filled).toContain('不得超过 5 秒')
    })
  })
})
