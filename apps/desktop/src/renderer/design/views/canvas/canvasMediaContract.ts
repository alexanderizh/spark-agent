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
  CanvasMediaTaskInputFile,
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
  modelId?: string | undefined
  prompt?: string | undefined
  validateSubmission?: boolean | undefined
  modelParams: Record<string, unknown>
  /** 最终物化后的输入文件及角色/传输信息。 */
  inputFiles?: CanvasMediaTaskInputFile[] | undefined
}

export interface PruneModelParamsForCanvasResult {
  /** 裁剪后的 modelParams，可直接放入 task payload。 */
  modelParams: Record<string, unknown>
  /** 被丢弃的字段；调用方负责写入任务详情或日志。 */
  droppedParams: MediaDroppedParam[]
  /** 非阻断性提示，供 UI 提示用户。 */
  warnings: CanvasMediaPruneModelParamsResponse['warnings']
  /** schema 校验结果；最终提交预校验中 severity='error' 会阻断任务。 */
  validationIssues: CanvasMediaPruneModelParamsResponse['validationIssues']
  /** 裁剪未执行的原因（manifest 不存在等）；正常裁剪时为 undefined。 */
  fallbackReason?: string | undefined
  /** 最终预校验锁定的执行目标，避免提交时再次自动路由到其他模型。 */
  resolvedManifestId?: string | undefined
  resolvedProviderProfileId?: string | undefined
  resolvedModelId?: string | undefined
}

/**
 * 按目标 manifest 裁剪 modelParams。manifest 缺省或 capability 无法推导时直接返回原值，
 * 不抛错；调用方按 fallbackReason 决定是否提示用户。
 */
export async function pruneModelParamsForCanvas(
  input: PruneModelParamsForCanvasInput,
): Promise<PruneModelParamsForCanvasResult> {
  const {
    manifestId,
    providerProfileId,
    capabilityId,
    modelId,
    prompt,
    validateSubmission,
    modelParams,
    inputFiles,
    operation,
  } = input
  let capability = capabilityId ?? deriveCapabilityId(operation)
  if (!capability) {
    return {
      modelParams,
      droppedParams: [],
      warnings: [],
      validationIssues: [],
      fallbackReason: `无法为 operation=${operation} 推导 capability，跳过 contract 裁剪`,
    }
  }
  let effectiveManifestId = manifestId
  let effectiveProviderProfileId = providerProfileId
  let effectiveModelId = modelId
  if (validateSubmission === true) {
    const referenceCapability = prefersReferenceVideoCapability(operation, inputFiles)
      ? 'video.reference_to_video'
      : undefined
    const discoveryCapability = capabilityId ?? referenceCapability ?? capability
    const hasExplicitModelTarget = Boolean(manifestId || modelId)
    let response = await canvasApi.listMediaModels({
      ...(providerProfileId ? { providerProfileId } : {}),
      ...(!hasExplicitModelTarget ? { capability: discoveryCapability } : {}),
      enabledOnly: true,
    })
    if (
      response.models.length === 0 &&
      !hasExplicitModelTarget &&
      referenceCapability &&
      discoveryCapability !== capability
    ) {
      response = await canvasApi.listMediaModels({
        ...(providerProfileId ? { providerProfileId } : {}),
        capability,
        enabledOnly: true,
      })
    }
    const selected = response.models.find((model) => {
      if (manifestId && model.manifestId !== manifestId) return false
      if (modelId && model.effectiveModelId !== modelId && model.modelId !== modelId) {
        return false
      }
      return true
    })
    if (selected) {
      effectiveManifestId = selected.manifestId
      effectiveProviderProfileId = providerProfileId ?? selected.providerProfileId
      effectiveModelId = modelId ?? selected.effectiveModelId
      if (
        !capabilityId &&
        referenceCapability &&
        selected.capabilities.some((item) => item.id === referenceCapability)
      ) {
        capability = referenceCapability
      }
    } else {
      const target = [manifestId, modelId].filter(Boolean).join(' / ') || capability
      return {
        modelParams,
        droppedParams: [],
        warnings: [],
        validationIssues: [],
        fallbackReason: `未找到已启用且匹配 ${target} 的媒体模型`,
      }
    }
  }
  if (!effectiveManifestId) {
    return {
      modelParams,
      droppedParams: [],
      warnings: [],
      validationIssues: [],
      fallbackReason: '目标模型未携带 manifestId，跳过 contract 裁剪',
    }
  }
  const response = await canvasApi.pruneMediaModelParams({
    manifestId: effectiveManifestId,
    ...(effectiveProviderProfileId != null
      ? { providerProfileId: effectiveProviderProfileId }
      : {}),
    capabilityId: capability,
    ...(effectiveModelId != null ? { modelId: effectiveModelId } : {}),
    ...(prompt != null ? { prompt } : {}),
    ...(validateSubmission != null ? { validateSubmission } : {}),
    modelParams,
    ...(inputFiles != null ? { inputFiles: inputFiles.map(summarizeValidationInputFile) } : {}),
  })
  return {
    modelParams: response.prunedModelParams,
    droppedParams: response.droppedParams,
    warnings: response.warnings,
    validationIssues: response.validationIssues,
    resolvedManifestId: effectiveManifestId,
    ...(effectiveProviderProfileId
      ? { resolvedProviderProfileId: effectiveProviderProfileId }
      : {}),
    ...(effectiveModelId ? { resolvedModelId: effectiveModelId } : {}),
    ...(response.fallbackReason != null ? { fallbackReason: response.fallbackReason } : {}),
  }
}

function summarizeValidationInputFile(file: CanvasMediaTaskInputFile): CanvasMediaTaskInputFile {
  if (!file.dataUrl) return file
  const commaIndex = file.dataUrl.indexOf(',')
  const summary =
    commaIndex >= 0 && commaIndex <= 512
      ? `${file.dataUrl.slice(0, commaIndex + 1)}${file.dataUrl.slice(
          commaIndex + 1,
          commaIndex + 33,
        )}`
      : file.dataUrl.slice(0, 512)
  return { ...file, dataUrl: summary }
}

function deriveCapabilityId(operation: CanvasOperationType): string | undefined {
  const capabilities = capabilityForOperation(operation)
  return capabilities[0] ?? undefined
}

function prefersReferenceVideoCapability(
  operation: CanvasOperationType,
  inputFiles: CanvasMediaTaskInputFile[] | undefined,
): boolean {
  if (operation !== 'text_to_video' && operation !== 'image_to_video') return false
  if (operation === 'text_to_video') {
    return (inputFiles ?? []).some((file) => isMediaFile(file))
  }
  const images = (inputFiles ?? []).filter((file) => file.type === 'image')
  if ((inputFiles ?? []).some((file) => file.type === 'video' || file.type === 'audio')) {
    return true
  }
  if (images.some((file) => file.role === 'reference')) return true
  // Older canvas payloads did not persist roles. With multiple unassigned
  // images the only unambiguous safe mode is reference-to-video; otherwise a
  // provider's one-image first-frame limit can reject a valid request.
  return (
    images.length > 1 &&
    !images.some((file) => file.role === 'first_frame' || file.role === 'last_frame')
  )
}

function isMediaFile(file: CanvasMediaTaskInputFile): boolean {
  if (file.type === 'image' || file.type === 'video' || file.type === 'audio') return true
  return file.type === 'file' && /^((image|video|audio)\/)/i.test(file.mimeType ?? '')
}

/**
 * 把 droppedParams 渲染成单行摘要字符串，便于在任务详情 / debug 卡片展示。
 * 例如：`output_format (unsupported_by_model), searchEnabled (forbidden_by_contract)`。
 */
export function summarizeDroppedParams(dropped: MediaDroppedParam[]): string {
  if (dropped.length === 0) return ''
  return dropped.map((d) => `${d.name} (${d.reason})`).join(', ')
}
