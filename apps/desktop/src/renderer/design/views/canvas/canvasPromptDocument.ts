import type {
  CanvasPromptBlock,
  CanvasPromptDocument,
  CanvasPromptReferenceBlock,
  CanvasPromptRelation,
} from '@spark/protocol'
import type { CanvasAsset, CanvasNode } from './canvas.types'
import { scanCanvasPromptMentionTokens } from './canvasPromptMentions'
import { formatCanvasTextInputContext, readCanvasTextInputContent } from './canvasTextInputPresentation'

const LEGACY_CONTEXT_MARKER = '\n\n画布节点内容：\n'

export function emptyCanvasPromptDocument(): CanvasPromptDocument {
  return { version: 2, blocks: [] }
}

export function migrateLegacyPrompt(input: {
  prompt: string
  nodes: CanvasNode[]
  assets: CanvasAsset[]
}): CanvasPromptDocument {
  const { visiblePrompt, contextBlocks } = extractLegacyCanvasContext(input)
  const tokens = scanCanvasPromptMentionTokens(visiblePrompt)
  if (tokens.length === 0) {
    return normalizeCanvasPromptDocument({
      version: 2,
      blocks: [...textBlock(visiblePrompt, 0), ...contextBlocks],
    })
  }

  const nodeById = new Map(input.nodes.map((node) => [node.id, node]))
  const blocks: CanvasPromptBlock[] = []
  let cursor = 0
  for (const [index, token] of tokens.entries()) {
    blocks.push(...textBlock(visiblePrompt.slice(cursor, token.start), blocks.length))
    const node = nodeById.get(token.nodeId)
    if (!node) {
      blocks.push(...textBlock(token.raw, blocks.length))
    } else {
      blocks.push(referenceBlock(node, token.label, index, 'manual'))
    }
    cursor = token.end
  }
  blocks.push(...textBlock(visiblePrompt.slice(cursor), blocks.length), ...contextBlocks)
  return normalizeCanvasPromptDocument({ version: 2, blocks })
}

export function normalizeCanvasPromptDocument(document: CanvasPromptDocument): CanvasPromptDocument {
  const blocks: CanvasPromptBlock[] = []
  for (const block of document.blocks) {
    if (block.kind === 'text') {
      if (!block.text) continue
      const previous = blocks.at(-1)
      if (previous?.kind === 'text') {
        previous.text += block.text
      } else {
        blocks.push({ ...block })
      }
      continue
    }
    blocks.push(cloneBlock(block))
  }
  return { version: 2, blocks }
}

export function serializeCanvasPromptDocument(document: CanvasPromptDocument): string {
  return JSON.stringify(normalizeCanvasPromptDocument(document))
}

export function toCanvasPromptPlainText(document: CanvasPromptDocument): string {
  return document.blocks
    .map((block) => {
      if (block.kind === 'text') return block.text
      if (block.kind === 'reference') return block.suppressed ? '' : `@${block.label}`
      if (block.kind === 'structured') return `@${block.summary}`
      const unit = block.unit ? ` ${block.unit}` : ''
      return `${String(block.value)}${unit}`
    })
    .join('')
}

export function toCanvasPromptLegacyText(document: CanvasPromptDocument): string {
  return document.blocks
    .map((block) => {
      if (block.kind === 'text') return block.text
      if (block.kind === 'reference') {
        return block.suppressed ? '' : `@[${block.label}](node:${block.sourceNodeId})`
      }
      if (block.kind === 'structured') return `@[${block.summary}](node:${block.sourceNodeId})`
      const unit = block.unit ? ` ${block.unit}` : ''
      return `${String(block.value)}${unit}`
    })
    .join('')
}

export function replacePromptBlock(
  document: CanvasPromptDocument,
  blockId: string,
  next: CanvasPromptBlock,
): CanvasPromptDocument {
  return normalizeCanvasPromptDocument({
    version: 2,
    blocks: document.blocks.map((block) => (block.id === blockId ? cloneBlock(next) : cloneBlock(block))),
  })
}

export function removePromptBlock(
  document: CanvasPromptDocument,
  blockId: string,
): CanvasPromptDocument {
  return normalizeCanvasPromptDocument({
    version: 2,
    blocks: document.blocks.filter((block) => block.id !== blockId).map(cloneBlock),
  })
}

function extractLegacyCanvasContext(input: {
  prompt: string
  nodes: CanvasNode[]
  assets: CanvasAsset[]
}): { visiblePrompt: string; contextBlocks: CanvasPromptBlock[] } {
  const markerIndex = input.prompt.indexOf(LEGACY_CONTEXT_MARKER)
  if (markerIndex < 0) return { visiblePrompt: input.prompt, contextBlocks: [] }

  const visiblePrompt = input.prompt.slice(0, markerIndex)
  const context = input.prompt.slice(markerIndex + LEGACY_CONTEXT_MARKER.length).trim()
  const matched = input.nodes
    .filter((node) => node.type === 'text' || node.type === 'prompt')
    .map((node) => ({ node, rendered: formatCanvasTextInputContext(node, input.assets) }))
    .filter((item) => item.rendered.length > 0 && context.includes(item.rendered))
  const rebuilt = matched.map((item) => item.rendered).join('\n\n').trim()
  if (!rebuilt || rebuilt !== context) {
    return { visiblePrompt: input.prompt, contextBlocks: [] }
  }

  return {
    visiblePrompt,
    contextBlocks: matched.map(({ node }, index) => {
      const content = readCanvasTextInputContent(node, input.assets)
      const structured = node.data.pipelineRole === 'shot' || looksStructured(content)
      return structured
        ? {
            kind: 'structured' as const,
            id: `legacy-structured-${node.id}-${index}`,
            sourceNodeId: node.id,
            schema: node.data.pipelineRole === 'screenplay' ? ('screenplay' as const) : ('storyboard' as const),
            summary: node.title?.trim() || '结构化内容',
          }
        : referenceBlock(node, node.title?.trim() || '文本输入', index, 'connection')
    }),
  }
}

function referenceBlock(
  node: CanvasNode,
  label: string,
  order: number,
  source: CanvasPromptReferenceBlock['source'],
): CanvasPromptReferenceBlock {
  return {
    kind: 'reference',
    id: `legacy-reference-${node.id}-${order}`,
    source,
    sourceNodeId: node.id,
    relation: relationForNode(node),
    label,
    order,
  }
}

function relationForNode(node: CanvasNode): CanvasPromptRelation {
  if (node.data.pipelineRole === 'shot') return 'storyboard'
  if (node.data.pipelineRole === 'screenplay') return 'screenplay'
  if (node.type === 'image') return 'reference_image'
  if (node.type === 'video') return 'reference_video'
  if (node.type === 'audio') return 'reference_audio'
  return 'generic'
}

function looksStructured(content: string): boolean {
  const trimmed = content.trim()
  return trimmed.startsWith('{') || trimmed.startsWith('[') || trimmed.includes('| 镜号 |')
}

function textBlock(text: string, index: number): CanvasPromptBlock[] {
  return text ? [{ kind: 'text', id: `legacy-text-${index}`, text }] : []
}

function cloneBlock<T extends CanvasPromptBlock>(block: T): T {
  return { ...block }
}
