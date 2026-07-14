import { describe, expect, it } from 'vitest'
import type { CanvasPromptDocument } from '@spark/protocol'
import type { CanvasAsset, CanvasNode, CanvasSnapshot } from './canvas.types'
import { buildCanvasPromptSubmission } from './canvasPromptSubmission'

function imageNode(): CanvasNode {
  return {
    id: 'hero', projectId: 'p', boardId: 'b', userId: 1, type: 'image', title: '小满', assetId: 'hero-asset',
    taskId: null, parentNodeId: null, x: 0, y: 0, width: 100, height: 100, rotation: 0, zIndex: 0,
    locked: false, hidden: false, data: { url: 'data:image/png;base64,AA==', mimeType: 'image/png' }, createdAt: '', updatedAt: '',
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
    expect(result.systemPrompt).toBe('hidden')
    expect(result.inputFiles).toEqual([{ type: 'image', role: 'reference', dataUrl: 'data:image/png;base64,AA==', mimeType: 'image/png' }])
    expect(result.relationManifest?.[0]).toMatchObject({ relation: 'character', sourceNodeId: 'hero' })
  })
})
