/**
 * 步骤模式资产/任务创建的类型契约（P4/P5 共用）。
 *
 * 单独成文件：StepSetupView、StepStoryboardView 与 AssetCreateModal 都需要
 * 「发起媒体任务」的最小签名，直接引用 canvas.api 的完整 options 类型会
 * 把主进程契约泄漏进组件层；这里收敛为渲染端所需子集。
 */

import type { CreateCanvasTaskRequest } from '../canvas.types'
import type { CanvasMediaTaskInputFile } from '@spark/protocol'

/** createMediaTask 渲染端所需子集 */
export type CanvasMediaTaskSubmitter = (
  request: CreateCanvasTaskRequest & { inputFiles?: CanvasMediaTaskInputFile[] },
  options?: {
    /** P4：产物自动挂影视资产参考图 */
    filmOutput?: {
      assetId: string
      referenceKind?:
        | 'concept'
        | 'reference'
        | 'expression'
        | 'costume'
        | 'action'
        | 'storyboard'
        | 'angle'
        | 'other'
    }
    /** P5：任务创建后回填 taskId，供分镜分段关联任务（无竞态） */
    createdTaskRef?: { taskId?: string }
  },
) => Promise<unknown>
