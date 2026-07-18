import { describe, expect, it } from 'vitest'
import { validateCanvasSemanticTextOutput } from './canvasTextOutputValidation'

describe('canvas semantic text output validation', () => {
  it('rejects arbitrary prose as a screenplay result', () => {
    expect(validateCanvasSemanticTextOutput('screenplay', '这是一个故事梗概。')).toMatchObject({
      ok: false,
      code: 'invalid_screenplay_output',
    })
  })

  it('accepts the existing scene screenplay markdown format', () => {
    const result = validateCanvasSemanticTextOutput(
      'screenplay',
      '# 场1 内景 茶馆 日\n\n出场人物：林岚、老板\n\n林岚推门进入。\n\n林岚：还有空房吗？',
    )

    expect(result).toMatchObject({ ok: true })
    if (result.ok) expect(result.text).toContain('场1 内景 茶馆 日')
  })

  it('normalizes valid storyboard JSON to the existing markdown presentation', () => {
    const result = validateCanvasSemanticTextOutput(
      'shot',
      JSON.stringify({
        shots: [
          {
            index: 1,
            title: '雨夜进入茶馆',
            durationSec: 4,
            shotSize: '全景',
            angle: '平视',
            movement: '缓慢推进',
            description: '林岚推门进入茶馆。',
            characters: ['林岚'],
            shotPrompt: '雨夜茶馆全景',
            negativePrompt: '文字水印',
          },
        ],
        summary: { shotCount: 1, totalDurationSec: 4 },
      }),
    )

    expect(result).toMatchObject({ ok: true })
    if (result.ok) {
      expect(result.storyboardRows).toHaveLength(1)
      expect(result.text).toContain('| 镜号 |')
      expect(result.text).toContain('雨夜进入茶馆')
      expect(result.text).toContain('文字水印')
    }
  })

  it('rejects empty or unparseable storyboard results', () => {
    expect(validateCanvasSemanticTextOutput('shot', '{"shots":[]}')).toMatchObject({
      ok: false,
      code: 'invalid_storyboard_output',
      message: expect.stringContaining('镜头数组为空'),
    })
    expect(validateCanvasSemanticTextOutput('shot', '普通段落')).toMatchObject({
      ok: false,
      code: 'invalid_storyboard_output',
    })
  })

  it('reports the received JSON schema when another functional task leaked into shots', () => {
    expect(
      validateCanvasSemanticTextOutput(
        'shot',
        JSON.stringify({ episode: 1, characters: [{ name: '苏烬' }] }),
      ),
    ).toMatchObject({
      ok: false,
      code: 'invalid_storyboard_output',
      message: expect.stringContaining('episode、characters'),
    })
  })

  it('accepts storyboard JSON serialized one extra time by an adapter', () => {
    const serialized = JSON.stringify(
      JSON.stringify({
        shots: [{ index: 1, durationSec: 3, description: '苏烬抬头。' }],
      }),
    )
    expect(validateCanvasSemanticTextOutput('shot', serialized)).toMatchObject({ ok: true })
  })

  it('validates every structured entity output role', () => {
    for (const role of ['character', 'scene', 'prop', 'effect'] as const) {
      expect(validateCanvasSemanticTextOutput(role, '无法按要求输出')).toMatchObject({
        ok: false,
        code: 'invalid_entity_output',
      })
      expect(
        validateCanvasSemanticTextOutput(
          role,
          JSON.stringify({ entities: [{ name: `${role}-1`, description: '详细描述' }] }),
        ),
      ).toMatchObject({ ok: true })
    }
  })

  it('leaves non-semantic text roles unchanged', () => {
    expect(validateCanvasSemanticTextOutput(undefined, '普通文本')).toEqual({
      ok: true,
      text: '普通文本',
    })
  })
})
