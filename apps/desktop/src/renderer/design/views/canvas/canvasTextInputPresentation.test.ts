import { describe, expect, it } from 'vitest'
import {
  formatCanvasTextInputContext,
  presentCanvasTextForModel,
} from './canvasTextInputPresentation'
import type { CanvasNode } from './canvas.types'

describe('canvasTextInputPresentation', () => {
  it('converts storyboard JSON to readable markdown before sending it to a model', () => {
    const source = JSON.stringify({
      shots: [
        { index: 1, title: '走廊', durationSec: 3, shotSize: '中景', description: '人物向前走' },
      ],
    })
    const result = presentCanvasTextForModel(source)
    expect(result).toContain('| 镜号 |')
    expect(result).toContain('人物向前走')
    expect(result).not.toContain('"shots"')
  })

  it('keeps ordinary text unchanged', () => {
    expect(presentCanvasTextForModel('雨夜里的旧车站')).toBe('雨夜里的旧车站')
  })

  it('labels parsed storyboard content in node context', () => {
    const node = {
      id: 'storyboard-1',
      type: 'text',
      title: '第一场分镜',
      data: { text: '| 镜号 | 画面 |\n| --- | --- |\n| 1 | 门缓慢打开 |' },
    } as CanvasNode
    expect(formatCanvasTextInputContext(node)).toContain('【分镜脚本｜第一场分镜】')
  })
})
