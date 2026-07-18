import { describe, expect, it } from 'vitest'
import { normalizeCanvasFunctionalSystemPrompt } from './canvasPromptInitialization'

describe('canvas functional prompt initialization', () => {
  it('removes a legacy character-extraction prefix from a storyboard contract', () => {
    const prompt = [
      '你是专业的影视角色分析师。只输出 characters JSON。',
      '【任务】把下面的场次剧本拆成「精确到秒、超详细」的分镜表。',
      'JSON 顶层结构必须为：{"shots":[]}',
    ].join('\n\n')

    expect(
      normalizeCanvasFunctionalSystemPrompt(prompt, 'screenplay.to_shot_script'),
    ).toBe(
      '【任务】把下面的场次剧本拆成「精确到秒、超详细」的分镜表。\n\nJSON 顶层结构必须为：{"shots":[]}',
    )
  })

  it('preserves authored prompts when no target contract marker is present', () => {
    expect(normalizeCanvasFunctionalSystemPrompt('用户自定义要求', 'text_generate')).toBe(
      '用户自定义要求',
    )
  })
})
