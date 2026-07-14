import { describe, expect, it } from 'vitest'
import {
  isReadableCanvasOperationTextOutput,
  resolveCanvasTextOutputPresentation,
} from './canvasOperationOutputPresentation'

describe('canvas operation output presentation', () => {
  it('recognizes storyboard JSON and returns structured rows', () => {
    const result = resolveCanvasTextOutputPresentation(`\`\`\`json
{
  "shots": [
    { "index": 1, "durationSec": 3, "title": "开场", "shotSize": "远景" },
    { "index": 2, "durationSec": 2, "title": "人物入画", "shotSize": "中景" }
  ]
}
\`\`\``)

    expect(result.kind).toBe('storyboard')
    if (result.kind === 'storyboard') {
      expect(result.rows).toHaveLength(2)
      expect(result.rows[0]).toEqual(expect.objectContaining({ index: 1, title: '开场' }))
    }
  })

  it('recognizes a split storyboard output containing one shot', () => {
    const result = resolveCanvasTextOutputPresentation(
      '| 镜号 | 景别 | 画面/动作 |\n| --- | --- | --- |\n| 1 | 远景 | 城市夜景 |',
    )

    expect(result.kind).toBe('storyboard')
    if (result.kind === 'storyboard') expect(result.rows).toHaveLength(1)
  })

  it('formats non-storyboard JSON instead of treating it as a storyboard', () => {
    const result = resolveCanvasTextOutputPresentation('{"name":"魏德","age":68}')

    expect(result).toEqual({
      kind: 'json',
      text: '{\n  "name": "魏德",\n  "age": 68\n}',
    })
  })

  it('keeps regular prose as text', () => {
    expect(resolveCanvasTextOutputPresentation('一段普通剧本文本')).toEqual({
      kind: 'text',
      text: '一段普通剧本文本',
    })
  })

  it('formats fenced markdown as readable prose instead of an empty file shell', () => {
    expect(resolveCanvasTextOutputPresentation('```markdown\n# 场景\n开放阳台。\n```')).toEqual({
      kind: 'text',
      text: '# 场景\n开放阳台。',
    })
  })

  it('treats prompt and file outputs with text as readable output', () => {
    expect(isReadableCanvasOperationTextOutput({ type: 'prompt', text: '场景描述' })).toBe(true)
    expect(isReadableCanvasOperationTextOutput({ type: 'file', text: '结构化内容' })).toBe(true)
    expect(isReadableCanvasOperationTextOutput({ type: 'image', text: 'alt' })).toBe(false)
  })
})
