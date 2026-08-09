import { describe, expect, it } from 'vitest'
import { parseCanvasJson, repairCanvasJsonText } from './canvasJsonRepair'

describe('canvasJsonRepair', () => {
  it('extracts JSON from surrounding prose and repairs trailing commas/comments', () => {
    const result = parseCanvasJson(`模型输出如下：
\`\`\`json
{
  "shots": [{ "title": "推门入画", "description": "雨夜", },], // 结束
}
\`\`\``)

    expect(result).toEqual({
      shots: [{ title: '推门入画', description: '雨夜' }],
    })
  })

  it('repairs smart quotes, single-quoted strings, full-width punctuation and bare keys', () => {
    const result = parseCanvasJson(
      "{shots: [{title: '推门入画', description: “雨夜，门外有雾”}], summary: {shotCount: 1,},}",
    )

    expect(result).toEqual({
      shots: [{ title: '推门入画', description: '雨夜，门外有雾' }],
      summary: { shotCount: 1 },
    })
  })

  it('escapes literal line breaks without changing punctuation inside strings', () => {
    const malformed = '{"description":"第一行：雨声，第二行：推门\n继续前进"}'

    expect(parseCanvasJson(malformed)).toEqual({
      description: '第一行：雨声，第二行：推门\n继续前进',
    })
  })

  it('unwraps an extra JSON serialization layer', () => {
    const serialized = JSON.stringify(JSON.stringify({ entities: [{ name: '林岚' }] }))

    expect(parseCanvasJson(serialized)).toEqual({ entities: [{ name: '林岚' }] })
  })

  it('does not silently close a truncated double-quoted JSON object', () => {
    expect(parseCanvasJson('{"shots":[{"title":"未完成"}')).toBeNull()
  })

  it('returns a directly repairable JSON text for callers that need to display it', () => {
    const repaired = repairCanvasJsonText("{shots: [{title: '镜头'}],}")

    expect(JSON.parse(repaired)).toEqual({ shots: [{ title: '镜头' }] })
  })
})
