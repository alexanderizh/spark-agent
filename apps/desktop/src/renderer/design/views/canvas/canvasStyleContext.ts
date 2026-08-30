import type { CanvasOperationType, CanvasProject, CanvasSnapshot } from './canvas.types'
import { buildProductionBiblePrompt, readProductionBible } from './canvasPipeline'

export type CanvasStyleContext = {
  promptBlock: string
  negativePrompt: string
  aspectRatio?: string
  modelParams: Record<string, unknown>
  referenceAssetIds: string[]
  locked: boolean
  ready: boolean
}

const STYLE_AWARE_OPERATIONS = new Set<CanvasOperationType>([
  'text_to_image',
  'image_to_image',
  'image_edit',
  'image_compose',
  'storyboard_grid',
  'panorama_360',
  'text_to_video',
  'image_to_video',
  'video_edit',
  'video_extend',
])

export function buildCanvasStyleContext(
  snapshotOrProject: Pick<CanvasSnapshot, 'project'> | CanvasProject,
  overrides?: {
    negativePrompt?: string
    modelParams?: Record<string, unknown>
    aspectRatio?: string
  },
): CanvasStyleContext {
  const project = 'project' in snapshotOrProject ? snapshotOrProject.project : snapshotOrProject
  const bible = readProductionBible(project.metadata)
  const promptBlock = buildProductionBiblePrompt(project.metadata)
  const inheritedNegativePrompt =
    overrides?.negativePrompt?.trim() ||
    bible?.negativePrompt?.trim() ||
    project.settings?.negativePrompt?.trim() ||
    ''
  const aspectRatio = overrides?.aspectRatio ?? bible?.aspectRatio
  const modelParams = {
    ...(bible?.defaultModelParams ?? {}),
    ...(aspectRatio ? { aspectRatio } : {}),
    ...(overrides?.modelParams ?? {}),
  }
  const ready = Boolean(
    promptBlock.trim() ||
    bible?.negativePrompt ||
    bible?.aspectRatio ||
    (bible?.colorPalette?.length ?? 0) > 0,
  )
  return {
    promptBlock,
    negativePrompt: inheritedNegativePrompt,
    ...(aspectRatio ? { aspectRatio } : {}),
    modelParams,
    referenceAssetIds: bible?.referenceAssetIds ?? [],
    locked: Boolean(bible?.locked),
    ready,
  }
}

export function appendStylePrompt(prompt: string, context: CanvasStyleContext): string {
  const style = context.promptBlock.trim()
  if (!style) return prompt
  if (prompt.includes(style)) return prompt
  return [prompt.trim(), style].filter(Boolean).join('\n\n')
}

export function mergeStyleTaskParams(
  context: CanvasStyleContext,
  local?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  const merged = { ...context.modelParams, ...(local ?? {}) }
  return Object.keys(merged).length > 0 ? merged : undefined
}

export function shouldApplyCanvasProjectStyle(
  operation: CanvasOperationType,
  context: CanvasStyleContext,
): boolean {
  return context.ready && STYLE_AWARE_OPERATIONS.has(operation)
}

export function applyCanvasStyleToTask(
  operation: CanvasOperationType,
  input: {
    prompt: string
    negativePrompt?: string
    modelParams?: Record<string, unknown>
  },
  context: CanvasStyleContext,
): {
  prompt: string
  negativePrompt?: string
  modelParams: Record<string, unknown>
} {
  const shouldApply = shouldApplyCanvasProjectStyle(operation, context)
  const modelParams = shouldApply
    ? (mergeStyleTaskParams(context, input.modelParams) ?? {})
    : (input.modelParams ?? {})
  const negativePrompt = (shouldApply && context.negativePrompt
    ? context.negativePrompt
    : input.negativePrompt
  )?.trim()
  return {
    prompt: shouldApply ? appendStylePrompt(input.prompt, context) : input.prompt,
    ...(negativePrompt ? { negativePrompt } : {}),
    modelParams,
  }
}
