import type { CanvasPromptDocument, CanvasPromptReferenceBlock, CanvasPromptRelation } from '@spark/protocol'
import type { CanvasEdge, CanvasNode } from './canvas.types'

export function addConnectionReference(
  document: CanvasPromptDocument,
  node: CanvasNode,
  relation: CanvasPromptRelation = relationForNode(node),
): CanvasPromptDocument {
  const alreadyRepresented = document.blocks.some(
    (block) =>
      (block.kind === 'structured' && block.sourceNodeId === node.id) ||
      (block.kind === 'reference' &&
        block.sourceNodeId === node.id &&
        (block.source === 'connection' || (!block.suppressed && !block.disconnected))),
  )
  if (alreadyRepresented) return cloneDocument(document)
  const reference: CanvasPromptReferenceBlock = {
    kind: 'reference',
    id: `connection-${node.id}`,
    source: 'connection',
    sourceNodeId: node.id,
    relation,
    connectionRelation: relation,
    label: node.title?.trim() || node.id,
    order: document.blocks.filter((block) => block.kind === 'reference').length,
  }
  const blocks = document.blocks.map(cloneBlock)
  const trailing = blocks.at(-1)
  if (trailing?.kind === 'text' && trailing.text.length === 0) {
    blocks.splice(blocks.length - 1, 0, reference)
  } else {
    blocks.push(reference, {
      kind: 'text',
      id: uniqueTrailingTextId(document, node.id),
      text: '',
    })
  }
  return { version: 2, blocks }
}

export function removeConnectionReference(
  document: CanvasPromptDocument,
  nodeId: string,
): CanvasPromptDocument {
  return {
    version: 2,
    blocks: document.blocks
      .filter((block) => !(block.kind === 'reference' && block.source === 'connection' && block.sourceNodeId === nodeId))
      .map(cloneBlock),
  }
}

export function reconcilePromptConnections(
  document: CanvasPromptDocument,
  edges: CanvasEdge[],
): { document: CanvasPromptDocument; inputNodeIds: string[] } {
  const connectedIds = new Set(
    edges.filter((edge) => edge.type === 'used_as_input').map((edge) => edge.sourceNodeId),
  )
  const blocks = document.blocks.flatMap((block) => {
    if (block.kind !== 'reference' || block.source !== 'connection') return [cloneBlock(block)]
    if (connectedIds.has(block.sourceNodeId)) {
      const { disconnected: _disconnected, ...connectedBlock } = block
      return [connectedBlock]
    }
    const wasEdited =
      block.disconnected === true ||
      Boolean(block.note?.trim()) ||
      (block.connectionRelation != null && block.relation !== block.connectionRelation)
    return wasEdited ? [{ ...block, disconnected: true }] : []
  })
  return {
    document: { version: 2, blocks },
    inputNodeIds: Array.from(connectedIds),
  }
}

export function ensureConnectionReferences(
  document: CanvasPromptDocument,
  nodes: CanvasNode[],
): CanvasPromptDocument {
  const visibleManualSourceNodeIds = new Set(
    document.blocks.flatMap((block) => {
      if (block.kind === 'structured') return [block.sourceNodeId]
      if (
        block.kind === 'reference' &&
        block.source !== 'connection' &&
        !block.suppressed &&
        !block.disconnected
      ) {
        return [block.sourceNodeId]
      }
      return []
    }),
  )
  const deduplicated: CanvasPromptDocument = {
    version: 2,
    blocks: document.blocks
      .filter((block) => {
        if (
          block.kind !== 'reference' ||
          block.source !== 'connection' ||
          !visibleManualSourceNodeIds.has(block.sourceNodeId)
        ) {
          return true
        }
        if (block.connectionRelation == null) return true
        const editedRelation =
          block.relation !== block.connectionRelation
        return Boolean(
          block.suppressed || block.disconnected || block.note?.trim() || editedRelation,
        )
      })
      .map(cloneBlock),
  }
  return nodes.reduce((current, node) => addConnectionReference(current, node), deduplicated)
}

function relationForNode(node: CanvasNode): CanvasPromptRelation {
  if (node.data.pipelineRole === 'character') return 'character'
  if (node.data.pipelineRole === 'scene') return 'scene'
  if (node.data.pipelineRole === 'prop') return 'prop'
  if (node.data.pipelineRole === 'shot') return 'storyboard'
  if (node.data.pipelineRole === 'screenplay') return 'screenplay'
  if (node.type === 'image') return 'reference_image'
  if (node.type === 'video') return 'reference_video'
  if (node.type === 'audio') return 'reference_audio'
  return 'generic'
}

function uniqueTrailingTextId(document: CanvasPromptDocument, nodeId: string): string {
  const ids = new Set(document.blocks.map((block) => block.id))
  const prefix = `text-after-connection-${nodeId}`
  let index = 0
  while (ids.has(`${prefix}-${index}`)) index += 1
  return `${prefix}-${index}`
}

function cloneDocument(document: CanvasPromptDocument): CanvasPromptDocument {
  return { version: 2, blocks: document.blocks.map(cloneBlock) }
}

function cloneBlock<T extends CanvasPromptDocument['blocks'][number]>(block: T): T {
  return { ...block }
}
