import { describe, expect, it } from 'vitest'
import { validateCanvasSemanticTextOutput } from './canvasTextOutputValidation'

function actionBeats(durationSec: number): string {
  return Array.from({ length: durationSec * 2 }, (_, index) => {
    const start = index / 2
    const end = start + 0.5
    return `${start.toFixed(1)}–${end.toFixed(1)}s：主体动作与镜头变化`
  }).join('；')
}

function cinematicShot(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const durationSec = typeof overrides.durationSec === 'number' ? overrides.durationSec : 1
  return {
    index: 1,
    title: '雨夜进入茶馆',
    durationSec,
    shotSize: '全景',
    angle: '机位高 150cm，平视客观视角',
    movement: '固定机位，稳定拍摄',
    description: '林岚推门进入茶馆。',
    lighting: '主光 4300K，辅光 3200K，光比 4:1',
    composition: '九宫格右侧落点，前中后景比例 2:5:3',
    blocking: '林岚距镜头 300cm，距门 20cm',
    actionBeats: actionBeats(durationSec),
    transition: '入：硬切；出：动作匹配硬切',
    firstFrame: '0.0s，林岚位于门外，右手贴近门把手。',
    lastFrame: '镜末，林岚站在门内，视线朝画左。',
    continuity: '保持人物身份、光向、视线和门把手手位。',
    shotPrompt: '雨夜茶馆全景，林岚稳定入画，真实物理运动。',
    negativePrompt: '错误角色、畸形手指、文字水印、画面闪烁。',
    ...overrides,
  }
}

function storyboard(shots: Record<string, unknown>[]): string {
  return JSON.stringify({
    shots,
    summary: {
      shotCount: shots.length,
      totalDurationSec: shots.reduce(
        (total, shot) => total + (typeof shot.durationSec === 'number' ? shot.durationSec : 0),
        0,
      ),
    },
  })
}

describe('canvas semantic text output validation', () => {
  it('keeps non-empty screenplay prose usable by adding a blank first scene', () => {
    expect(validateCanvasSemanticTextOutput('screenplay', '这是一个故事梗概。')).toEqual({
      ok: true,
      text: '第1场｜｜｜\n\n这是一个故事梗概。',
    })
  })

  it('only rejects an empty screenplay result', () => {
    expect(validateCanvasSemanticTextOutput('screenplay', '   ')).toMatchObject({
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

  it('accepts the pipe-delimited scene heading used by chapter conversion', () => {
    const result = validateCanvasSemanticTextOutput(
      'screenplay',
      '第1场｜内景｜二年级教室｜傍晚\n\n动作：苏晴走进教室。',
    )

    expect(result).toMatchObject({ ok: true })
  })

  it.each([
    '【场号 1 内景｜二年级教室｜傍晚】',
    '场次1｜内景｜二年级教室｜傍晚',
    '场景一：内景｜二年级教室｜傍晚',
    '1. INT. CLASSROOM - DAY',
  ])('accepts common screenplay scene heading variant: %s', (heading) => {
    expect(
      validateCanvasSemanticTextOutput('screenplay', `${heading}\n\n动作：人物入场。`),
    ).toEqual({
      ok: true,
      text: `${heading}\n\n动作：人物入场。`,
    })
  })

  it('does not require optional screenplay sections before creating a usable draft', () => {
    expect(validateCanvasSemanticTextOutput('screenplay', '【第2场｜外景｜操场｜清晨】')).toEqual({
      ok: true,
      text: '【第2场｜外景｜操场｜清晨】',
    })
  })

  it('normalizes valid storyboard JSON to the existing markdown presentation', () => {
    const result = validateCanvasSemanticTextOutput(
      'shot',
      storyboard([
        cinematicShot({
          characters: ['林岚'],
        }),
      ]),
    )

    expect(result).toMatchObject({ ok: true })
    if (result.ok) {
      expect(result.storyboardRows).toHaveLength(1)
      expect(result.text).toContain('| 镜号 |')
      expect(result.text).toContain('雨夜进入茶馆')
      expect(result.text).toContain('文字水印')
    }
  })

  it('repairs minor JSON syntax flaws before validating storyboard output', () => {
    const result = validateCanvasSemanticTextOutput(
      'shot',
      `模型输出：
{shots:[{index:1,title:'雨夜进入茶馆',durationSec:1,description:“林岚推门进入茶馆。” ,}],summary:{shotCount:1,totalDurationSec:1,},}`,
    )

    expect(result).toMatchObject({ ok: true })
    if (result.ok) expect(result.storyboardRows?.[0]).toMatchObject({ title: '雨夜进入茶馆' })
  })

  it('repairs missing actionBeats from duration and shot description', () => {
    const shot = cinematicShot({
      durationSec: 1.5,
      description: '林岚抬手推门，镜头缓慢跟入。',
    })
    delete shot.actionBeats
    const result = validateCanvasSemanticTextOutput('shot', storyboard([shot]))

    expect(result).toMatchObject({ ok: true })
    if (result.ok) {
      expect(result.storyboardRows?.[0]?.actionBeats).toContain('0.0–0.5s')
      expect(result.storyboardRows?.[0]?.actionBeats).toContain('1.0–1.5s')
      expect(result.storyboardRows?.[0]?.actionBeats).toContain('林岚抬手推门')
    }
  })

  it('accepts advisory storyboard rows with missing optional production fields', () => {
    const shot = {
      index: 1,
      title: '雨夜进入茶馆',
      durationSec: 1,
      description: '林岚推门进入茶馆。',
    }
    const result = validateCanvasSemanticTextOutput('shot', storyboard([shot]))

    expect(result).toMatchObject({ ok: true })
    if (result.ok) {
      expect(result.storyboardRows?.[0]).toMatchObject({
        index: 1,
        title: '雨夜进入茶馆',
        durationSec: 1,
        shotSize: '',
        dialogue: '',
        negativePrompt: '',
      })
    }
  })

  it('keeps storyboard rows with entirely missing fields as blank editable shots', () => {
    const result = validateCanvasSemanticTextOutput(
      'shot',
      JSON.stringify({
        shots: [cinematicShot(), {}],
        summary: { shotCount: 2, totalDurationSec: 1 },
      }),
    )

    expect(result).toMatchObject({ ok: true })
    if (result.ok) {
      expect(result.storyboardRows).toHaveLength(2)
      expect(result.storyboardRows?.[1]).toMatchObject({
        index: 2,
        title: '镜2',
        description: '',
        shotPrompt: '',
      })
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
    const serialized = JSON.stringify(storyboard([cinematicShot()]))
    expect(validateCanvasSemanticTextOutput('shot', serialized)).toMatchObject({ ok: true })
  })

  it('rejects truncated JSON even when complete shot prefixes can be recovered', () => {
    const first = JSON.stringify(cinematicShot({ index: 1 }))
    const second = JSON.stringify(cinematicShot({ index: 2 }))
    const truncated = `{"shots":[${first},${second},{"index":3,"title":"未完成"`

    expect(validateCanvasSemanticTextOutput('shot', truncated)).toMatchObject({
      ok: false,
      code: 'invalid_storyboard_output',
      message: expect.stringContaining('截断'),
    })
  })

  it('does not reject editable storyboard rows for quality-only issues', () => {
    expect(
      validateCanvasSemanticTextOutput('shot', storyboard([cinematicShot({ durationSec: 4.5 })]), {
        shotScriptConfig: { maxClipSec: 4 },
      }),
    ).toMatchObject({ ok: true })

    const invalidBeats = cinematicShot({ actionBeats: '0.0–0.5s：动作；1.0–1.5s：跳段' })
    expect(validateCanvasSemanticTextOutput('shot', storyboard([invalidBeats]))).toMatchObject({
      ok: true,
    })
  })

  it('does not reject editable shots when the optional summary is stale', () => {
    const mismatchedSummary = JSON.stringify({
      shots: [cinematicShot()],
      summary: { shotCount: 2, totalDurationSec: 1 },
    })
    expect(validateCanvasSemanticTextOutput('shot', mismatchedSummary)).toMatchObject({ ok: true })
  })

  it('accepts common segments and groups envelopes and fills their missing fields', () => {
    const result = validateCanvasSemanticTextOutput(
      'shot',
      JSON.stringify({ groups: [{ name: '第一场', segments: [{ title: '建立镜头' }] }] }),
    )

    expect(result).toMatchObject({ ok: true })
    if (result.ok) {
      expect(result.storyboardRows?.[0]).toMatchObject({
        title: '建立镜头',
        groupName: '第一场',
        description: '',
        transition: '',
      })
    }
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

  it('repairs minor JSON syntax flaws before validating entity output', () => {
    expect(
      validateCanvasSemanticTextOutput(
        'character',
        "{entities:[{name:'林岚',description:“清瘦的夜行者”,},],}",
      ),
    ).toMatchObject({ ok: true })
  })

  it('leaves non-semantic text roles unchanged', () => {
    expect(validateCanvasSemanticTextOutput(undefined, '普通文本')).toEqual({
      ok: true,
      text: '普通文本',
    })
  })
})
