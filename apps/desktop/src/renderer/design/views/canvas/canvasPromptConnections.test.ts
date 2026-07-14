import { describe, expect, it } from 'vitest'
import type { CanvasPromptDocument } from '@spark/protocol'
import type { CanvasEdge, CanvasNode } from './canvas.types'
import {
  addConnectionReference,
  ensureConnectionReferences,
  reconcilePromptConnections,
  removeConnectionReference,
} from './canvasPromptConnections'

function node(id: string, type: CanvasNode['type'] = 'image'): CanvasNode {
  return {
    id, projectId: 'p', boardId: 'b', userId: 1, type, title: id, assetId: null, taskId: null,
    parentNodeId: null, x: 0, y: 0, width: 100, height: 100, rotation: 0, zIndex: 0,
    locked: false, hidden: false, data: {}, createdAt: '', updatedAt: '',
  }
}

function edge(sourceNodeId: string): CanvasEdge {
  return {
    id: `edge-${sourceNodeId}`, projectId: 'p', boardId: 'b', userId: 1,
    sourceNodeId, targetNodeId: 'target', type: 'used_as_input', metadata: {}, createdAt: '',
  }
}

describe('canvasPromptConnections', () => {
  it('adds one connection reference per source node', () => {
    const document: CanvasPromptDocument = { version: 2, blocks: [{ kind: 'text', id: 't', text: '让' }] }
    const once = addConnectionReference(document, node('hero'))
    const twice = addConnectionReference(once, node('hero'))
    expect(twice.blocks.filter((block) => block.kind === 'reference')).toHaveLength(1)
    expect(twice.blocks[1]).toMatchObject({ source: 'connection', sourceNodeId: 'hero', relation: 'reference_image' })
  })

  it('removes only automatic references and preserves manual references', () => {
    const document: CanvasPromptDocument = {
      version: 2,
      blocks: [
        { kind: 'reference', id: 'auto', source: 'connection', sourceNodeId: 'hero', relation: 'reference_image', label: '自动', order: 0 },
        { kind: 'reference', id: 'manual', source: 'manual', sourceNodeId: 'hero', relation: 'character', label: '主角', order: 1 },
      ],
    }
    const result = removeConnectionReference(document, 'hero')
    expect(result.blocks).toHaveLength(1)
    expect(result.blocks[0]).toMatchObject({ source: 'manual', relation: 'character' })
  })

  it('reconciles disconnected automatic tags and returns unique input node ids', () => {
    const document: CanvasPromptDocument = {
      version: 2,
      blocks: [
        { kind: 'reference', id: 'hero', source: 'connection', sourceNodeId: 'hero', relation: 'reference_image', label: 'hero', order: 0 },
        { kind: 'reference', id: 'scene', source: 'connection', sourceNodeId: 'scene', relation: 'scene', label: 'scene', order: 1 },
        { kind: 'reference', id: 'manual', source: 'manual', sourceNodeId: 'scene', relation: 'character', label: 'scene as character', order: 2 },
      ],
    }
    const result = reconcilePromptConnections(document, [edge('hero'), edge('hero')])
    expect(result.inputNodeIds).toEqual(['hero'])
    expect(result.document.blocks.map((block) => block.id)).toEqual(['hero', 'manual'])
  })

  it('ensures all currently connected nodes are visible without duplicating existing tags', () => {
    const document: CanvasPromptDocument = { version: 2, blocks: [] }
    const result = ensureConnectionReferences(document, [node('hero'), node('scene', 'text'), node('hero')])
    expect(result.blocks.filter((block) => block.kind === 'reference').map((block) => block.sourceNodeId)).toEqual(['hero', 'scene'])
  })
})
