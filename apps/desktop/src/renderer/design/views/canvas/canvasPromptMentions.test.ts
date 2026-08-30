import { describe, expect, it } from 'vitest'
import type { CanvasNode } from './canvas.types'
import {
  buildCanvasPromptMentionItems,
  extractCanvasPromptMentionTokens,
  filterCanvasPromptMentionItems,
  findCanvasPromptMentionQuery,
  insertCanvasPromptMention,
} from './canvasPromptMentions'

function node(id: string, type: CanvasNode['type'], title?: string): CanvasNode {
  return {
    id,
    projectId: 'p1',
    boardId: 'b1',
    userId: 1,
    type,
    title: title ?? null,
    assetId: `asset-${id}`,
    taskId: null,
    parentNodeId: null,
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    zIndex: 0,
    locked: false,
    hidden: false,
    data: {},
    createdAt: '',
    updatedAt: '',
  }
}

describe('canvasPromptMentions', () => {
  it('builds stable @ markers from canvas node order', () => {
    const items = buildCanvasPromptMentionItems([
      node('img-a', 'image', '角色参考'),
      node('img-b', 'image'),
      node('txt-a', 'text'),
    ])

    expect(items.map((item) => [item.marker, item.label])).toEqual([
      ['参考图1', '角色参考'],
      ['参考图2', '图片 2'],
      ['参考图3', '文本 3'],
    ])
    expect(items[0]?.token).toBe('@[参考图1:角色参考](node:img-a)')
  })

  it('detects the active @ query before the cursor', () => {
    expect(findCanvasPromptMentionQuery('让 @角 保持一致', 3)).toMatchObject({
      active: true,
      start: 2,
      end: 3,
      query: '',
    })
    expect(findCanvasPromptMentionQuery('让 @角 保持一致', 4)).toMatchObject({
      active: true,
      start: 2,
      end: 4,
      query: '角',
    })
    expect(findCanvasPromptMentionQuery('让 @[参考图1:角色参考](node:img-a) 保持一致', 5).active).toBe(
      false,
    )
  })

  it('replaces the active @ query with the selected marker', () => {
    const item = buildCanvasPromptMentionItems([node('img-a', 'image', '角色参考')])[0]
    const mention = findCanvasPromptMentionQuery('让 @角 保持一致', 4)

    expect(item).toBeDefined()
    if (!item) throw new Error('expected mention item')
    expect(insertCanvasPromptMention('让 @角 保持一致', mention, item)).toEqual({
      value: '让 @[参考图1:角色参考](node:img-a) 保持一致',
      cursor: '让 @[参考图1:角色参考](node:img-a)'.length,
    })
  })

  it('filters candidates by label, marker, or id', () => {
    const items = buildCanvasPromptMentionItems([
      node('hero-ref', 'image', '角色参考'),
      node('scene-ref', 'image', '场景参考'),
    ])

    expect(filterCanvasPromptMentionItems(items, '角色').map((item) => item.id)).toEqual([
      'hero-ref',
    ])
    expect(filterCanvasPromptMentionItems(items, '2').map((item) => item.id)).toEqual(['scene-ref'])
    expect(filterCanvasPromptMentionItems(items, 'scene').map((item) => item.id)).toEqual([
      'scene-ref',
    ])
  })

  it('extracts inserted mention tokens for styled prompt chips', () => {
    expect(
      extractCanvasPromptMentionTokens(
        '让 @[参考图1:角色参考](node:hero-ref) 和 @[参考图2:场景参考](node:scene-ref) 保持一致',
      ),
    ).toEqual([
      { label: '参考图1:角色参考', nodeId: 'hero-ref' },
      { label: '参考图2:场景参考', nodeId: 'scene-ref' },
    ])
  })
})
