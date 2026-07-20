import type { CanvasPromptDocument } from '@spark/protocol'
import type { CanvasAsset, CanvasNode } from './canvas.types'
import { ensureConnectionReferences } from './canvasPromptConnections'
import { migrateLegacyPrompt } from './canvasPromptDocument'

export function stripCanvasFunctionalPromptInput(prompt: string, presetTargetId: string): string {
  const marker =
    presetTargetId === 'screenplay.to_shot_script'
      ? '【场次剧本】'
      : presetTargetId === 'chapter.to_screenplay'
        ? '章节原文：'
        : presetTargetId === 'screenplay.extract_characters' ||
            presetTargetId === 'screenplay.extract_scenes' ||
            presetTargetId === 'screenplay.extract_props' ||
            presetTargetId === 'screenplay.extract_effects'
          ? '【剧本】'
          : ''
  if (!marker) return prompt.trim()
  const markerIndex = prompt.indexOf(marker)
  return markerIndex >= 0 ? prompt.slice(0, markerIndex).trim() : prompt.trim()
}

const FUNCTIONAL_PROMPT_START_MARKERS: Record<string, readonly string[]> = {
  'screenplay.to_shot_script': ['【任务】把下面的场次剧本拆成'],
  'chapter.to_screenplay': [
    '请把下面的小说/长文稿章节改写为影视剧本',
    '【任务】把下面的原文改写为规范的影视场次剧本',
  ],
  'screenplay.extract_characters': [
    '【任务】你是资深影视美术/设定师。通读下面的剧本，抽取其中出现的全部角色',
  ],
  'screenplay.extract_scenes': [
    '【任务】你是资深影视美术/设定师。通读下面的剧本，抽取其中出现的全部场景',
  ],
  'screenplay.extract_props': [
    '【任务】你是资深影视美术/设定师。通读下面的剧本，抽取其中出现的全部道具',
  ],
  'screenplay.extract_effects': [
    '【任务】你是资深影视美术/设定师。通读下面的剧本，抽取其中出现的全部特效',
  ],
  'screenplay.split_episodes': ['请把下面的长剧本按剧情冲突、悬念节奏和合理时长完成分集'],
}

/**
 * Repair legacy functional nodes whose dedicated contract was prefixed by an unrelated
 * generic operation preset. The target-specific marker is deliberately conservative:
 * if it cannot be found, preserve the authored prompt unchanged.
 */
export function normalizeCanvasFunctionalSystemPrompt(
  prompt: string | null | undefined,
  presetTargetId: string,
): string {
  const value = prompt?.trim() ?? ''
  if (!value) return ''
  const markers = FUNCTIONAL_PROMPT_START_MARKERS[presetTargetId] ?? []
  const markerIndexes = markers.map((marker) => value.indexOf(marker)).filter((index) => index >= 0)
  if (markerIndexes.length === 0) return value
  return value.slice(Math.min(...markerIndexes)).trim()
}

/** Canonical editor initialization for text and media connection tags. */
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
  const visible: CanvasPromptDocument = {
    version: 2,
    blocks: source.blocks
      .filter((block) => {
        if (input.hideText && block.kind === 'text') return false
        return true
      })
      .map((block) => ({ ...block })),
  }
  return ensureConnectionReferences(visible, input.connections)
}

/** Add selected inputs to the executable document without exposing them in the editor. */
export function buildCanvasSubmissionPromptDocument(input: {
  document: CanvasPromptDocument
  inputNodes: CanvasNode[]
}): CanvasPromptDocument {
  const referencedNodeIds = new Set(
    input.document.blocks.flatMap((block) => {
      if (block.kind === 'structured') return [block.sourceNodeId]
      if (block.kind === 'reference' && !block.suppressed && !block.disconnected) {
        return [block.sourceNodeId]
      }
      return []
    }),
  )
  return ensureConnectionReferences(
    { version: 2, blocks: input.document.blocks.map((block) => ({ ...block })) },
    input.inputNodes.filter((node) => !referencedNodeIds.has(node.id)),
  )
}
