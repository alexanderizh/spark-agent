import { describe, expect, it } from 'vitest'
import type { CanvasPromptDocument } from '@spark/protocol'
import type { CanvasAsset, CanvasNode } from './canvas.types'
import { CanvasPromptCompileError, compileCanvasPromptDocument } from './canvasPromptCompiler'

function node(id: string, type: CanvasNode['type'], title: string, data: CanvasNode['data'] = {}): CanvasNode {
  return {
    id,
    projectId: 'p1',
    boardId: 'b1',
    userId: 1,
    type,
    title,
    assetId: data.url ? `asset-${id}` : null,
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

function imageNode(id: string, url: string, title: string): CanvasNode {
  return node(id, 'image', title, { url, thumbnailUrl: `${url}?thumb`, mimeType: 'image/png' })
}

const imageAsset = (id: string, url: string, title: string): CanvasAsset => ({
  id,
  projectId: 'p1',
  userId: 1,
  type: 'image',
  source: 'upload',
  title,
  mimeType: 'image/png',
  storageKey: `assets/${id}.png`,
  url,
  thumbnailUrl: `${url}?thumb`,
  metadata: {},
  createdAt: '',
  updatedAt: '',
})

describe('canvasPromptCompiler', () => {
  it('keeps document order and maps image relations to stable media roles', () => {
    const hero = imageNode('hero', 'safe-file://hero.png', '小满')
    const first = imageNode('first', 'safe-file://first.png', '首帧')
    const last = imageNode('last', 'safe-file://last.png', '尾帧')
    const document: CanvasPromptDocument = {
      version: 2,
      blocks: [
        { kind: 'text', id: 't1', text: '让' },
        { kind: 'reference', id: 'r1', source: 'manual', sourceNodeId: 'hero', relation: 'character', label: '小满', order: 0 },
        { kind: 'text', id: 't2', text: '从首帧到尾帧保持一致' },
        { kind: 'reference', id: 'r2', source: 'connection', sourceNodeId: 'first', relation: 'first_frame', label: '首帧', order: 1 },
        { kind: 'reference', id: 'r3', source: 'connection', sourceNodeId: 'last', relation: 'last_frame', label: '尾帧', order: 2 },
      ],
    }
    const result = compileCanvasPromptDocument({
      document,
      nodes: [hero, first, last],
      assets: [imageAsset('asset-hero', 'safe-file://hero.png', '小满'), imageAsset('asset-first', 'safe-file://first.png', '首帧'), imageAsset('asset-last', 'safe-file://last.png', '尾帧')],
      operation: 'image_to_video',
      systemPrompt: 'hidden capability',
    })

    expect(result.compiledUserText).toContain('[角色 ref-1: 小满]')
    expect(result.compiledUserText).not.toContain('hidden capability')
    expect(result.inputFiles?.map((file) => file.role)).toEqual(['reference', 'first_frame', 'last_frame'])
    expect(result.relationManifest.map((item) => item.relation)).toEqual(['character', 'first_frame', 'last_frame'])
    expect(result.inputSnapshots[0]).toMatchObject({ previewUrl: 'safe-file://hero.png?thumb', kind: 'image' })
  })

  it('renders structured storyboard content and keeps structured snapshot data', () => {
    const shots = node('shots', 'text', '镜头表', { pipelineRole: 'shot', text: JSON.stringify({ shots: [{ index: 1, title: '车站', description: '小满走入雨幕' }] }) })
    const document: CanvasPromptDocument = {
      version: 2,
      blocks: [{ kind: 'structured', id: 's1', sourceNodeId: 'shots', schema: 'storyboard', summary: '镜头 1' }],
    }
    const result = compileCanvasPromptDocument({ document, nodes: [shots], assets: [], operation: 'text_generate' })

    expect(result.compiledUserText).toContain('[分镜表 ref-1: 镜头 1]')
    expect(result.inputSnapshots[0]?.structuredData).toEqual({ shots: [{ index: 1, title: '车站', description: '小满走入雨幕' }] })
    expect(result.relationManifest[0]).toMatchObject({ relation: 'storyboard', sourceNodeId: 'shots' })
  })

  it('blocks missing references instead of silently dropping them', () => {
    const document: CanvasPromptDocument = {
      version: 2,
      blocks: [{ kind: 'reference', id: 'missing', source: 'manual', sourceNodeId: 'gone', relation: 'scene', label: '已删除场景', order: 0 }],
    }
    expect(() => compileCanvasPromptDocument({ document, nodes: [], assets: [], operation: 'text_to_image' })).toThrow(CanvasPromptCompileError)
  })

  it('is deterministic for identical input and warns for empty documents', () => {
    const document: CanvasPromptDocument = { version: 2, blocks: [] }
    const a = compileCanvasPromptDocument({ document, nodes: [], assets: [], operation: 'text_generate' })
    const b = compileCanvasPromptDocument({ document, nodes: [], assets: [], operation: 'text_generate' })
    expect(a).toEqual(b)
    expect(a.promptWarnings).toEqual([{ code: 'empty_prompt', message: '提示词和媒体输入均为空' }])
  })
})
