import { composeCanvasMediaProviderPrompt, type MediaContractIssue } from '@spark/protocol'
import type { CanvasMediaTaskInputFile } from '@spark/protocol'
import type { CanvasOperationType, CreateCanvasTaskRequest } from './canvas.types'
import { pruneModelParamsForCanvas } from './canvasMediaContract'
import { buildCanvasImagePromptReversePrompt } from './canvasOperationPresets'
import { decodeCanvasSafeFileUrl } from './canvas-safe-file'

type CanvasTaskSubmissionRequest = Omit<CreateCanvasTaskRequest, 'boardId'> & {
  inputFiles?: CanvasMediaTaskInputFile[]
}

export class CanvasTaskValidationError extends Error {
  readonly issues: MediaContractIssue[]

  constructor(issues: MediaContractIssue[]) {
    super(issues[0]?.message ?? '任务参数校验失败')
    this.name = 'CanvasTaskValidationError'
    this.issues = issues
  }
}

export async function validateCanvasMediaTaskSubmission(
  request: CanvasTaskSubmissionRequest,
): Promise<CanvasTaskSubmissionRequest> {
  const providerPrompt = composeCanvasMediaProviderPrompt({
    userPrompt: request.compiledUserText ?? request.prompt ?? '',
    ...(request.systemPrompt ? { systemPrompt: request.systemPrompt } : {}),
  })
  const basicIssues = validateBasicMediaSubmission(request, providerPrompt)
  if (basicIssues.length > 0) throw new CanvasTaskValidationError(basicIssues)

  const pruned = await pruneModelParamsForCanvas({
    operation: request.operation,
    ...(request.manifestId ? { manifestId: request.manifestId } : {}),
    ...(request.providerProfileId ? { providerProfileId: request.providerProfileId } : {}),
    ...(request.modelId ? { modelId: request.modelId } : {}),
    ...(request.capabilityId ? { capabilityId: request.capabilityId } : {}),
    ...(providerPrompt ? { prompt: providerPrompt } : {}),
    validateSubmission: true,
    modelParams: request.modelParams ?? {},
    ...(request.inputFiles ? { inputFiles: request.inputFiles } : {}),
  })
  if (pruned.fallbackReason) {
    throw new CanvasTaskValidationError([
      issue('missing_required', `无法完成任务预校验：${pruned.fallbackReason}`, ['manifestId']),
    ])
  }
  const advisoryIssues = pruned.validationIssues.map((validationIssue) => ({
    code: validationIssue.code,
    message: validationIssue.message,
  }))
  const modelParamWarnings = [
    ...pruned.warnings.map((warning) => ({ code: warning.code, message: warning.message })),
    ...advisoryIssues,
  ]

  return {
    ...request,
    ...(pruned.resolvedManifestId ? { manifestId: pruned.resolvedManifestId } : {}),
    ...(pruned.resolvedProviderProfileId
      ? { providerProfileId: pruned.resolvedProviderProfileId }
      : {}),
    ...(pruned.resolvedModelId ? { modelId: pruned.resolvedModelId } : {}),
    modelParams: pruned.modelParams,
    ...(pruned.droppedParams.length > 0
      ? {
          droppedModelParams: pruned.droppedParams.map((item) => ({
            name: item.name,
            reason: item.reason,
            ...(item.valuePreview != null ? { valuePreview: item.valuePreview } : {}),
          })),
        }
      : {}),
    ...(modelParamWarnings.length > 0
      ? {
          modelParamWarnings,
        }
      : {}),
  }
}

export function validateCanvasTextTaskSubmission(
  request: CanvasTaskSubmissionRequest,
): CanvasTaskSubmissionRequest {
  const issues: MediaContractIssue[] = []
  const isImagePromptReverse = request.operation === 'image_prompt_reverse'
  const files = request.inputFiles ?? []
  const imageCount = files.filter((file) => matchesMediaKind(file, 'image')).length
  const prompt = (request.compiledUserText ?? request.prompt ?? '').trim()

  if (isImagePromptReverse && imageCount === 0) {
    issues.push(issue('missing_required', '请连接一张输入图片', ['inputFiles']))
  } else if (isImagePromptReverse && (imageCount !== 1 || files.length !== 1)) {
    issues.push(issue('out_of_range', '图片反推仅支持一张输入图片', ['inputFiles']))
  }
  if (!isImagePromptReverse && !prompt) {
    issues.push(issue('missing_required', '请输入提示词或待处理文本', ['prompt']))
  }

  if (isImagePromptReverse) {
    for (const [index, file] of files.entries()) {
      if (file.dataUrl && !/^data:image\/[^;,]+;base64,.+$/is.test(file.dataUrl)) {
        issues.push(
          issue('invalid_type', `第 ${index + 1} 张输入图片的 dataUrl 格式无效`, [
            'inputFiles',
            index,
            'dataUrl',
          ]),
        )
      }
    }
  }

  const params = request.modelParams ?? {}
  validateOptionalNumber(params, ['temperature'], 0, 2, issues)
  validatePositiveInteger(params, ['maxTokens', 'max_tokens'], issues)
  validateOptionalEnum(
    params,
    ['responseFormat', 'response_format'],
    ['json', 'text', 'markdown'],
    issues,
  )

  if (issues.length > 0) throw new CanvasTaskValidationError(issues)
  if (!isImagePromptReverse) return request

  // 画布标准执行链路会把固定指令放在 systemPrompt，用户输入留在 prompt 中。
  // 没有独立 systemPrompt / promptDocument 的直接调用则保留完整指令，兼容旧 API。
  const hasSeparateInstruction = Boolean(request.systemPrompt?.trim() && request.promptDocument)
  return {
    ...request,
    prompt: hasSeparateInstruction ? prompt : buildCanvasImagePromptReversePrompt(prompt),
  }
}

export function validateCanvasLocalTaskSubmission<T extends CanvasTaskSubmissionRequest>(
  request: T,
): T {
  const issues: MediaContractIssue[] = []
  // local_media 通道的 operation 共用一段视频校验，文案按 operation 区分
  const taskTitle =
    request.operation === 'extract_audio'
      ? '分离音频'
      : request.operation === 'extract_first_last_frames'
        ? '提取首尾帧'
        : '深度视频转换'
  const files = request.inputFiles ?? []
  const videoCount = files.filter((file) => matchesMediaKind(file, 'video')).length
  if (videoCount === 0) {
    issues.push(issue('missing_required', '请连接一段输入视频', ['inputFiles']))
  } else if (videoCount !== 1 || files.length !== 1) {
    // __SPARK_DEBUG_START__
    const __sparkDebugFiles = files.map((file, index) => ({
      index,
      type: file.type,
      mimeType: file.mimeType,
      hasUrl: Boolean(file.url),
      urlHead: file.url ? String(file.url).slice(0, 64) : undefined,
      pathHead: file.path ? String(file.path).slice(0, 64) : undefined,
    }))
    const __sparkDebugNodeIds = (request as { inputNodeIds?: unknown }).inputNodeIds
    issues.push(
      issue(
        'out_of_range',
        `${taskTitle}仅支持一段输入视频 [spark-debug files=${files.length} videos=${videoCount} inputNodeIds=${JSON.stringify(
          __sparkDebugNodeIds,
        )} details=${JSON.stringify(__sparkDebugFiles)}]`,
        ['inputFiles'],
      ),
    )
    // __SPARK_DEBUG_END__
  }
  const inputFile = files[0]
  const localPath =
    inputFile?.path?.trim() ||
    decodeCanvasSafeFileUrl(inputFile?.url) ||
    // 云产物/云端素材（如视频生成任务的 https:// 产物 URL）：ffmpeg 可直读，不再要求本地路径
    (inputFile?.url && /^https?:\/\//i.test(inputFile.url) ? inputFile.url : null)
  if (videoCount === 1 && files.length === 1 && !localPath) {
    issues.push(
      issue('missing_required', `${taskTitle}需要可读取的本地视频路径或可访问的视频 URL`, [
        'inputFiles',
        0,
        'path',
      ]),
    )
  }
  if (issues.length > 0) throw new CanvasTaskValidationError(issues)
  if (!inputFile || !localPath || inputFile.path === localPath) return request
  return {
    ...request,
    inputFiles: [{ ...inputFile, path: localPath }],
  }
}

function validateOptionalEnum(
  params: Record<string, unknown>,
  names: string[],
  allowedValues: string[],
  issues: MediaContractIssue[],
): void {
  const entry = firstEntry(params, names)
  if (!entry || entry.value == null || entry.value === '') return
  if (typeof entry.value !== 'string') {
    issues.push(issue('invalid_type', `${entry.name} 必须是字符串`, ['modelParams', entry.name]))
    return
  }
  const normalized = entry.value.trim().toLowerCase()
  if (!allowedValues.includes(normalized)) {
    issues.push(
      issue('invalid_enum', `${entry.name} 仅支持 ${allowedValues.join(' 或 ')}`, [
        'modelParams',
        entry.name,
      ]),
    )
  }
}

function validateBasicMediaSubmission(
  request: CanvasTaskSubmissionRequest,
  providerPrompt: string,
): MediaContractIssue[] {
  const issues: MediaContractIssue[] = []
  const files = request.inputFiles ?? []
  const imageCount = files.filter((file) => matchesMediaKind(file, 'image')).length
  const videoCount = files.filter((file) => matchesMediaKind(file, 'video')).length
  const audioCount = files.filter((file) => matchesMediaKind(file, 'audio')).length
  const videoCapability = request.capabilityId?.startsWith('video.')
    ? request.capabilityId
    : undefined
  const imageCapability = request.capabilityId?.startsWith('image.')
    ? request.capabilityId
    : undefined

  for (const [index, file] of files.entries()) {
    if (file.dataUrl && !/^data:[^;,]+;base64,.+$/is.test(file.dataUrl)) {
      issues.push(
        issue('invalid_type', `第 ${index + 1} 个输入文件的 dataUrl 格式无效`, [
          'inputFiles',
          index,
          'dataUrl',
        ]),
      )
    }
  }

  // 按 capability 命名空间分层判定，避免统一容器（text_to_image + image.edit reference 模式等）
  // 误用字面 operation 的提示词 / 图片要求。capabilityId 缺失（旧 retry / inline 边界）时
  // 回退字面 operation 判定，保持向后兼容。
  const requiresPrompt = imageCapability
    ? imageCapability === 'image.generate'
    : videoCapability
      ? videoCapability === 'video.generate'
      : operationRequiresPrompt(request.operation)
  const requiresImage = imageCapability
    ? imageCapability === 'image.edit'
    : videoCapability
      ? videoCapability === 'video.image_to_video'
      : operationRequiresImage(request.operation)
  const requiresVideo = imageCapability
    ? false
    : videoCapability
      ? videoCapability === 'video.edit' || videoCapability === 'video.extend'
      : request.operation === 'video_edit' || request.operation === 'video_extend'

  if (requiresPrompt && !providerPrompt) {
    issues.push(issue('missing_required', '请输入提示词', ['prompt']))
  }
  if (requiresImage && imageCount === 0) {
    issues.push(issue('missing_required', '请至少选择一张输入图片', ['inputFiles']))
  }
  if (requiresVideo && videoCount === 0) {
    issues.push(issue('missing_required', '请选择输入视频', ['inputFiles']))
  }
  if (request.operation === 'audio_transcribe' && audioCount === 0) {
    issues.push(issue('missing_required', '请选择输入音频', ['inputFiles']))
  }
  return issues
}

function matchesMediaKind(
  file: CanvasMediaTaskInputFile,
  kind: 'image' | 'video' | 'audio',
): boolean {
  if (file.type === kind) return true
  if (file.type !== 'file') return false
  if (file.mimeType) return file.mimeType.toLowerCase().startsWith(`${kind}/`)
  return kind === 'image'
}

function operationRequiresPrompt(operation: CanvasOperationType): boolean {
  return (
    operation === 'text_to_image' ||
    operation === 'storyboard_grid' ||
    operation === 'panorama_360' ||
    operation === 'text_to_audio' ||
    operation === 'text_to_video'
  )
}

function operationRequiresImage(operation: CanvasOperationType): boolean {
  return (
    operation === 'image_to_image' ||
    operation === 'image_edit' ||
    operation === 'image_compose' ||
    operation === 'image_to_video'
  )
}

function validateOptionalNumber(
  params: Record<string, unknown>,
  names: string[],
  min: number,
  max: number,
  issues: MediaContractIssue[],
): void {
  const value = firstValue(params, names)
  if (value == null || value === '') return
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    issues.push(
      issue('invalid_type', `${names[0]} 必须是数字`, ['modelParams', names[0] ?? 'value']),
    )
    return
  }
  if (value < min || value > max) {
    issues.push(
      issue('out_of_range', `${names[0]} 必须在 ${min}–${max} 之间`, [
        'modelParams',
        names[0] ?? 'value',
      ]),
    )
  }
}

function validatePositiveInteger(
  params: Record<string, unknown>,
  names: string[],
  issues: MediaContractIssue[],
): void {
  const value = firstValue(params, names)
  if (value == null || value === '') return
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    issues.push(
      issue('out_of_range', `${names[0]} 必须是正整数`, ['modelParams', names[0] ?? 'value']),
    )
  }
}

function firstValue(params: Record<string, unknown>, names: string[]): unknown {
  for (const name of names) {
    if (params[name] !== undefined) return params[name]
  }
  return undefined
}

function firstEntry(
  params: Record<string, unknown>,
  names: string[],
): { name: string; value: unknown } | undefined {
  for (const name of names) {
    if (params[name] !== undefined) return { name, value: params[name] }
  }
  return undefined
}

function issue(
  code: MediaContractIssue['code'],
  message: string,
  path: Array<string | number>,
): MediaContractIssue {
  return { severity: 'error', code, message, path }
}
