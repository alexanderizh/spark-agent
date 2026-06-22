import type { CanvasProject, CanvasSnapshot } from './canvas.types'
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
