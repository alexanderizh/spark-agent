/**
 * @module canvasMediaContract
 *
 * 画布侧 Contract V2 裁剪与诊断工具。封装 main 进程的 prune IPC 调用，
 * 给 CanvasInlineAiComposer / CanvasOperationPanel / canvas.api.ts 提供统一入口。
 *
 * 设计要点：
 *   - renderer 不直接持有 manifest，统一走 IPC 让 main 进程用 catalog 解析。
 *   - 调用方决定如何使用 prunedModelParams 和 droppedParams：
 *     - InlineAiComposer：直接用 prunedModelParams 提交任务，droppedParams 进任务详情。
 *     - canvas.api.ts：preset/继承/input 合并后再次裁剪，避免旧节点继承污染新模型请求。
 *   - 裁剪失败（manifest 不存在等）不阻塞提交，返回原值 + fallbackReason。
 *   - capabilityId 由调用方传入；缺省时按 operation 推导。
 */
import { capabilityForOperation } from '@spark/protocol'
import type { CanvasOperationType } from '@spark/protocol'
import type {
  CanvasMediaPruneModelParamsResponse,
  MediaDroppedParam,
} from '@spark/protocol'
import { canvasApi } from './canvas.api'

export interface PruneModelParamsForCanvasInput {
  operation: CanvasOperationType
  /** 目标模型 manifest id；缺省时不裁剪，直接返回原值。 */
  manifestId?: string | undefined
  providerProfileId?: string | undefined
  /** 显式 capability；缺省时按 operation 推导。 */
  capabilityId?: string | undefined
  modelParams: Record<string, unknown>
  /** 输入文件类型摘要（image / video / first_frame / last_frame / mask 等）。 */
  inputFiles?: Array<{ type: string; role?: string | undefined }> | undefined
}

export interface PruneModelParamsForCanvasResult {
  /** 裁剪后的 modelParams，可直接放入 task payload。 */
  modelParams: Record<string, unknown>
  /** 被丢弃的字段；调用方负责写入任务详情或日志。 */
  droppedParams: MediaDroppedParam[]
  /** 非阻断性提示，供 UI 提示用户。 */
  warnings: CanvasMediaPruneModelParamsResponse['warnings']
  /** schema 校验失败摘要，severity='error 时建议 UI 提示但仍允许提交。 */
  validationIssues: CanvasMediaPruneModelParamsResponse['validationIssues']
  /** 裁剪未执行的原因（manifest 不存在等）；正常裁剪时为 undefined。 */
  fallbackReason?: string | undefined
}

/**
 * 按目标 manifest 裁剪 modelParams。manifest 缺省或 capability 无法推导时直接返回原值，
 * 不抛错；调用方按 fallbackReason 决定是否提示用户。
 */
export async function pruneModelParamsForCanvas(
  input: PruneModelParamsForCanvasInput,
): Promise<PruneModelParamsForCanvasResult> {
  const { manifestId, providerProfileId, capabilityId, modelParams, inputFiles, operation } = input
  if (!manifestId) {
    return {
      modelParams,
      droppedParams: [],
      warnings: [],
      validationIssues: [],
      fallbackReason: '目标模型未携带 manifestId，跳过 contract 裁剪',
    }
  }
  const capability = capabilityId ?? deriveCapabilityId(operation)
  if (!capability) {
    return {
      modelParams,
      droppedParams: [],
      warnings: [],
      validationIssues: [],
      fallbackReason: `无法为 operation=${operation} 推导 capability，跳过 contract 裁剪`,
    }
  }
  const response = await canvasApi.pruneMediaModelParams({
    manifestId,
    ...(providerProfileId != null ? { providerProfileId } : {}),
    capabilityId: capability,
    modelParams,
    ...(inputFiles != null ? { inputFiles } : {}),
  })
  return {
    modelParams: response.prunedModelParams,
    droppedParams: response.droppedParams,
    warnings: response.warnings,
    validationIssues: response.validationIssues,
    ...(response.fallbackReason != null ? { fallbackReason: response.fallbackReason } : {}),
  }
}

function deriveCapabilityId(operation: CanvasOperationType): string | undefined {
  const capabilities = capabilityForOperation(operation)
  return capabilities[0] ?? undefined
}

/**
 * 把 droppedParams 渲染成单行摘要字符串，便于在任务详情 / debug 卡片展示。
 * 例如：`output_format (unsupported_by_model), searchEnabled (forbidden_by_contract)`。
 */
export function summarizeDroppedParams(dropped: MediaDroppedParam[]): string {
  if (dropped.length === 0) return ''
  return dropped.map((d) => `${d.name} (${d.reason})`).join(', ')
}
