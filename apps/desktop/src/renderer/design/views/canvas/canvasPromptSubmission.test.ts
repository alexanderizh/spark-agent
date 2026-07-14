import { describe, expect, it } from 'vitest'
import type { CanvasPromptDocument } from '@spark/protocol'
import type { CanvasAsset, CanvasNode, CanvasSnapshot } from './canvas.types'
import { buildCanvasPromptDocumentForInputs, buildCanvasPromptSubmission } from './canvasPromptSubmission'

function imageNode(): CanvasNode {
  return {
    id: 'hero', projectId: 'p', boardId: 'b', userId: 1, type: 'image', title: '小满', assetId: 'hero-asset',
    taskId: null, parentNodeId: null, x: 0, y: 0, width: 100, height: 100, rotation: 0, zIndex: 0,
    locked: false, hidden: false, data: { url: 'data:image/png;base64,AA==', mimeType: 'image/png' }, createdAt: '', updatedAt: '',
  }
}

function textNode(): CanvasNode {
  return {
    id: 'script', projectId: 'p', boardId: 'b', userId: 1, type: 'text', title: '场次剧本',
    assetId: null, taskId: null, parentNodeId: null, x: 0, y: 0, width: 100, height: 100,
    rotation: 0, zIndex: 0, locked: false, hidden: false,
    data: { text: '雨夜里，小满走进车站。', pipelineRole: 'screenplay' }, createdAt: '', updatedAt: '',
  }
}

const asset: CanvasAsset = {
  id: 'hero-asset', projectId: 'p', userId: 1, type: 'image', source: 'upload', title: '小满',
  mimeType: 'image/png', metadata: {}, createdAt: '', updatedAt: '',
}

const snapshot = (): CanvasSnapshot => ({
  project: {} as CanvasSnapshot['project'], board: {} as CanvasSnapshot['board'], nodes: [imageNode()], edges: [], assets: [asset], tasks: [],
})

describe('canvasPromptSubmission', () => {
  it('keeps media inputs out of the visible editor document', () => {
    const document = buildCanvasPromptDocumentForInputs({
      prompt: '保持人物一致',
      nodes: [imageNode()],
      assets: [asset],
    })
    expect(document.blocks).toEqual([
      { kind: 'text', id: expect.any(String), text: '保持人物一致' },
    ])
  })

  it('injects a media-selector input into the executable request without exposing its tag', async () => {
    const document = buildCanvasPromptDocumentForInputs({
      prompt: '保持人物一致',
      nodes: [imageNode()],
      assets: [asset],
    })
    const result = await buildCanvasPromptSubmission({
      document,
      snapshot: snapshot(),
      operation: 'text_to_image',
      inputNodeIds: ['hero'],
      inputTransport: 'base64',
    })

    expect(result.promptDocument).toEqual(document)
    expect(result.prompt).toContain('[参考图 ref-1: 小满]')
    expect(result.inputFiles).toEqual([
      { type: 'image', role: 'reference', dataUrl: 'data:image/png;base64,AA==', mimeType: 'image/png' },
    ])
    expect(result.relationManifest).toEqual([
      expect.objectContaining({ sourceNodeId: 'hero', relation: 'reference_image' }),
    ])
  })

  it('compiles an upstream text tag into the model user prompt and relation manifest', async () => {
    const script = textNode()
    const document = buildCanvasPromptDocumentForInputs({
      prompt: '提取主要场景：', nodes: [script], assets: [],
    })
    const textSnapshot: CanvasSnapshot = {
      ...snapshot(), nodes: [script], assets: [],
    }
    const result = await buildCanvasPromptSubmission({
      document, snapshot: textSnapshot, operation: 'text_generate', inputNodeIds: ['script'],
    })

    expect(result.promptDocument?.blocks).toEqual([
      expect.objectContaining({ kind: 'text', text: '提取主要场景：' }),
      expect.objectContaining({ kind: 'reference', sourceNodeId: 'script', relation: 'screenplay' }),
      expect.objectContaining({ kind: 'text', text: '' }),
    ])
    expect(result.prompt).toContain('[剧本 ref-1: 场次剧本]')
    expect(result.prompt).toContain('雨夜里，小满走进车站。')
    expect(result.relationManifest).toEqual([
      expect.objectContaining({ sourceNodeId: 'script', relation: 'screenplay' }),
    ])
  })

  it('returns a compiled prompt, document, relation manifest and materialized image input', async () => {
    const document: CanvasPromptDocument = {
      version: 2,
      blocks: [
        { kind: 'text', id: 't1', text: '让' },
        { kind: 'reference', id: 'r1', source: 'manual', sourceNodeId: 'hero', relation: 'character', label: '小满', order: 0 },
      ],
    }
    const result = await buildCanvasPromptSubmission({ document, snapshot: snapshot(), operation: 'text_to_image', inputTransport: 'base64', systemPrompt: 'hidden' })

    expect(result.prompt).toContain('[角色 ref-1: 小满]')
    expect(result.compiledUserText).toBe(result.prompt)
    expect(result.promptDocument).toEqual(document)
    expect(result.promptSnapshot?.capturedAt).toEqual(expect.any(String))
    expect(result.systemPrompt).toBe('hidden')
    expect(result.inputFiles).toEqual([{ type: 'image', role: 'reference', dataUrl: 'data:image/png;base64,AA==', mimeType: 'image/png' }])
    expect(result.relationManifest?.[0]).toMatchObject({ relation: 'character', sourceNodeId: 'hero' })
  })
})
