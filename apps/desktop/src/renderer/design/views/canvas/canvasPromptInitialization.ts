import type { CanvasPromptDocument } from '@spark/protocol'
import type { CanvasAsset, CanvasNode } from './canvas.types'
import { ensureConnectionReferences } from './canvasPromptConnections'
import { migrateLegacyPrompt } from './canvasPromptDocument'

export function isCanvasPromptMediaNode(node: CanvasNode): boolean {
  return node.type === 'image' || node.type === 'video' || node.type === 'audio'
}

export function isCanvasPromptInlineNode(node: CanvasNode): boolean {
  return !isCanvasPromptMediaNode(node)
}

export function stripCanvasFunctionalPromptInput(prompt: string, presetTargetId: string): string {
  const marker =
    presetTargetId === 'screenplay.to_shot_script'
      ? '【场次剧本】'
      : presetTargetId === 'chapter.to_screenplay'
        ? '章节原文：'
        : presetTargetId === 'screenplay.extract_characters' ||
            presetTargetId === 'screenplay.extract_scenes'
          ? '【剧本】'
          : ''
  if (!marker) return prompt.trim()
  const markerIndex = prompt.indexOf(marker)
  return markerIndex >= 0 ? prompt.slice(0, markerIndex).trim() : prompt.trim()
}

/**
 * Canonical editor initialization. Media inputs intentionally stay out of the
 * visible document: the media selector represents them, and the submission
 * compiler adds them back to the executable document.
 */
export function buildCanvasVisiblePromptDocument(input: {
  document?: CanvasPromptDocument
  prompt: string
  nodes: CanvasNode[]
  connections: CanvasNode[]
  assets: CanvasAsset[]
  hideText?: boolean
}): CanvasPromptDocument {
  const source =
    input.document ??
    migrateLegacyPrompt({ prompt: input.prompt, nodes: input.nodes, assets: input.assets })
  const inlineConnections = input.connections.filter(isCanvasPromptInlineNode)
  const mediaConnectionIds = new Set(
    input.connections.filter(isCanvasPromptMediaNode).map((node) => node.id),
  )
  const visible: CanvasPromptDocument = {
    version: 2,
    blocks: source.blocks
      .filter((block) => {
        if (input.hideText && block.kind === 'text') return false
        return !(
          block.kind === 'reference' &&
          block.source === 'connection' &&
          mediaConnectionIds.has(block.sourceNodeId)
        )
      })
      .map((block) => ({ ...block })),
  }
  return ensureConnectionReferences(visible, inlineConnections)
}

/** Add selected inputs to the executable document without exposing them in the editor. */
export function buildCanvasSubmissionPromptDocument(input: {
  document: CanvasPromptDocument
  inputNodes: CanvasNode[]
}): CanvasPromptDocument {
  return ensureConnectionReferences(
    { version: 2, blocks: input.document.blocks.map((block) => ({ ...block })) },
    input.inputNodes,
  )
}
