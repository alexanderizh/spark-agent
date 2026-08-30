import type { CanvasProject, CanvasTask } from './canvas.types'
import { buildCanvasStyleContext } from './canvasStyleContext'

export type ConsistencyCheckResult = {
  score: number
  level: 'high' | 'medium' | 'low'
  warnings: string[]
  missing: string[]
}

const MEDIA_OPS = new Set([
  'text_to_image',
  'image_to_image',
  'text_to_video',
  'image_to_video',
  'video_edit',
  'video_extend',
  'image_edit',
  'image_compose',
  'storyboard_grid',
])

export function checkCanvasTaskConsistency(
  task: Pick<
    CanvasTask,
    'operation' | 'prompt' | 'negativePrompt' | 'modelParams' | 'inputNodeIds'
  >,
  project: CanvasProject,
): ConsistencyCheckResult {
  const ctx = buildCanvasStyleContext(project)
  const warnings: string[] = []
  const missing: string[] = []
  let score = 100
  if (!MEDIA_OPS.has(task.operation)) {
    return { score, level: 'high', warnings, missing }
  }
  const prompt = task.prompt ?? ''
  if (
    ctx.promptBlock &&
    !prompt.includes(ctx.promptBlock.slice(0, Math.min(24, ctx.promptBlock.length)))
  ) {
    score -= 30
    missing.push('未继承项目视觉圣经提示词')
  }
  if (ctx.aspectRatio && task.modelParams?.['aspectRatio'] !== ctx.aspectRatio) {
    score -= 20
    missing.push(`未继承项目宽高比 ${ctx.aspectRatio}`)
  }
  if (ctx.negativePrompt && task.negativePrompt !== ctx.negativePrompt) {
    score -= 15
    missing.push('未继承项目反向提示词')
  }
  if (ctx.locked && missing.length > 0) {
    score -= 10
    warnings.push('项目视觉圣经已锁定，但本任务缺少部分锁定约束')
  }
  const normalized = Math.max(0, Math.min(100, score))
  return {
    score: normalized,
    level: normalized >= 80 ? 'high' : normalized >= 50 ? 'medium' : 'low',
    warnings,
    missing,
  }
}
