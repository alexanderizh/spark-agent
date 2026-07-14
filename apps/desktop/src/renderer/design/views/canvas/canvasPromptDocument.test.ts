import { describe, expect, it } from 'vitest'
import type { CanvasPromptDocument } from '@spark/protocol'
import type { CanvasAsset, CanvasNode } from './canvas.types'
import {
  emptyCanvasPromptDocument,
  migrateLegacyPrompt,
  normalizeCanvasPromptDocument,
  removePromptBlock,
  replacePromptBlock,
  serializeCanvasPromptDocument,
  toCanvasPromptPlainText,
} from './canvasPromptDocument'
import { formatCanvasTextInputContext } from './canvasTextInputPresentation'

function node(id: string, type: CanvasNode['type'], title: string, data: CanvasNode['data'] = {}): CanvasNode {
  return {
    id,
    projectId: 'p1',
    boardId: 'b1',
    userId: 1,
    type,
    title,
    assetId: null,
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
    data,
    createdAt: '',
    updatedAt: '',
  }
}

describe('canvasPromptDocument', () => {
  it('creates an empty versioned document', () => {
    expect(emptyCanvasPromptDocument()).toEqual({ version: 2, blocks: [] })
  })

  it('migrates known legacy mention tokens and preserves their text order', () => {
    const hero = node('hero', 'image', '小满')
    const result = migrateLegacyPrompt({
      prompt: '让 @[参考图1:小满](node:hero) 保持服装一致',
      nodes: [hero],
      assets: [],
    })

    expect(result.blocks.map((block) => block.kind)).toEqual(['text', 'reference', 'text'])
    expect(result.blocks[1]).toMatchObject({ sourceNodeId: 'hero', relation: 'reference_image' })
    expect(toCanvasPromptPlainText(result)).toBe('让 @参考图1:小满 保持服装一致')
  })

  it('keeps an unresolved legacy token as ordinary text', () => {
    const prompt = '使用 @[参考图1:已删除](node:missing) 继续生成'
    const result = migrateLegacyPrompt({ prompt, nodes: [], assets: [] })
    expect(result.blocks).toEqual([{ kind: 'text', id: 'legacy-text-0', text: prompt }])
  })

  it('converts an exact legacy canvas context into a structured block', () => {
    const storyboard = node('shots', 'text', '第一场分镜', {
      pipelineRole: 'shot',
      text: '| 镜号 | 画面 |\n| --- | --- |\n| 1 | 开门 |',
    })
    const context = formatCanvasTextInputContext(storyboard)
    const result = migrateLegacyPrompt({
      prompt: `生成视频\n\n画布节点内容：\n${context}`,
      nodes: [storyboard],
      assets: [],
    })

    expect(result.blocks).toEqual([
      { kind: 'text', id: 'legacy-text-0', text: '生成视频' },
      {
        kind: 'structured',
        id: 'legacy-structured-shots-0',
        sourceNodeId: 'shots',
        schema: 'storyboard',
        summary: '第一场分镜',
      },
    ])
  })

  it('preserves ambiguous legacy canvas context verbatim', () => {
    const prompt = '生成视频\n\n画布节点内容：\n无法确定来源的内容'
    expect(migrateLegacyPrompt({ prompt, nodes: [], assets: [] }).blocks).toEqual([
      { kind: 'text', id: 'legacy-text-0', text: prompt },
    ])
  })

  it('normalizes adjacent text blocks without mutating the source', () => {
    const source: CanvasPromptDocument = {
      version: 2,
      blocks: [
        { kind: 'text', id: 'a', text: '前' },
        { kind: 'text', id: 'b', text: '后' },
      ],
    }
    expect(normalizeCanvasPromptDocument(source).blocks).toEqual([
      { kind: 'text', id: 'a', text: '前后' },
    ])
    expect(source.blocks).toHaveLength(2)
  })

  it('replaces and removes blocks immutably and serializes deterministically', () => {
    const source: CanvasPromptDocument = {
      version: 2,
      blocks: [{ kind: 'parameter', id: 'duration', parameter: 'duration', value: 8, unit: 's' }],
    }
    const replaced = replacePromptBlock(source, 'duration', {
      kind: 'parameter',
      id: 'duration',
      parameter: 'duration',
      value: 12,
      unit: 's',
    })
    expect(toCanvasPromptPlainText(replaced)).toBe('12 s')
    expect(removePromptBlock(replaced, 'duration')).toEqual(emptyCanvasPromptDocument())
    expect(serializeCanvasPromptDocument(replaced)).toBe(JSON.stringify(replaced))
    expect((source.blocks[0] as { value: number }).value).toBe(8)
  })
})
