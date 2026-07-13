import { describe, expect, it } from 'vitest'
import {
  buildStoryboardShotNodeDrafts,
  buildStoryboardShotNodeText,
} from './canvasStoryboardNodeSplit'
import type { CanvasNode } from './canvas.types'

describe('canvasStoryboardNodeSplit', () => {
  it('creates one readable markdown node per shot', () => {
    const source = {
      id: 'storyboard',
      type: 'text',
      x: 100,
      y: 80,
      width: 560,
      height: 300,
      data: {
        text: '| 镜号 | 景别 | 画面 |\n| --- | --- | --- |\n| 1 | 远景 | 城市夜景 |\n| 2 | 特写 | 手握门把 |',
      },
    } as CanvasNode
    const drafts = buildStoryboardShotNodeDrafts(source)
    expect(drafts).toHaveLength(2)
    expect(drafts[0]?.text).toContain('城市夜景')
    expect(drafts[1]?.text).toContain('手握门把')
    expect(drafts.every((draft) => draft.x > source.x + source.width)).toBe(true)
  })

  it('keeps each node limited to one shot', () => {
    const text = buildStoryboardShotNodeText({ title: '开场', description: '门打开' }, 0)
    expect(text).toContain('# 镜 01')
    expect(text).toContain('门打开')
  })
})
