import { describe, expect, it } from 'vitest'
import {
  applyCanvasStyleToTask,
  appendStylePrompt,
  buildCanvasStyleContext,
} from './canvasStyleContext'
import { checkCanvasTaskConsistency } from './canvasConsistencyCheck'
import { writeProductionBible } from './canvasPipeline'
import type { CanvasProject, CanvasTask } from './canvas.types'

function project(): CanvasProject {
  return {
    id: 'p1',
    userId: 0,
    title: 'Demo',
    status: 'active',
    settings: { negativePrompt: 'global negative' },
    metadata: writeProductionBible(undefined, {
      locked: true,
      visualStyle: 'warm cinematic',
      aspectRatio: '2.39:1',
      negativePrompt: 'no watermark',
      defaultModelParams: { seed: 42 },
    }),
    nodeCount: 0,
    assetCount: 0,
    taskCount: 0,
    createdAt: '2026-06-21T00:00:00Z',
    updatedAt: '2026-06-21T00:00:00Z',
  }
}

describe('canvasStyleContext', () => {
  it('从 Production Bible 构建 prompt / negative / modelParams', () => {
    const ctx = buildCanvasStyleContext(project())
    expect(ctx.locked).toBe(true)
    expect(ctx.negativePrompt).toBe('no watermark')
    expect(ctx.modelParams).toMatchObject({ seed: 42, aspectRatio: '2.39:1' })
    expect(appendStylePrompt('hero shot', ctx)).toContain('warm cinematic')
  })

  it('一致性检查能发现缺失的项目约束', () => {
    const task = {
      operation: 'text_to_image',
      prompt: 'hero shot',
      negativePrompt: '',
      modelParams: {},
      inputNodeIds: [],
    } as Pick<
      CanvasTask,
      'operation' | 'prompt' | 'negativePrompt' | 'modelParams' | 'inputNodeIds'
    >
    const result = checkCanvasTaskConsistency(task, project())
    expect(result.level).toBe('low')
    expect(result.missing).toEqual(
      expect.arrayContaining(['未继承项目视觉圣经提示词', '未继承项目宽高比 2.39:1']),
    )
  })

  it('媒体任务提交前会继承项目视觉总设定', () => {
    const ctx = buildCanvasStyleContext(project(), {
      negativePrompt: 'local negative',
      modelParams: { seed: 7, guidance: 4 },
    })

    const task = applyCanvasStyleToTask(
      'image_to_video',
      {
        prompt: 'hero shot',
        negativePrompt: 'local negative',
        modelParams: { seed: 7, guidance: 4 },
      },
      ctx,
    )

    expect(task.prompt).toContain('hero shot')
    expect(task.prompt).toContain('warm cinematic')
    expect(task.negativePrompt).toBe('local negative')
    expect(task.modelParams).toMatchObject({
      aspectRatio: '2.39:1',
      seed: 7,
      guidance: 4,
    })
  })

  it('文本任务不会注入视觉总设定', () => {
    const ctx = buildCanvasStyleContext(project())

    const task = applyCanvasStyleToTask(
      'text_generate',
      {
        prompt: 'write a synopsis',
        modelParams: { temperature: 0.4 },
      },
      ctx,
    )

    expect(task.prompt).toBe('write a synopsis')
    expect(task.negativePrompt).toBeUndefined()
    expect(task.modelParams).toEqual({ temperature: 0.4 })
  })
})
