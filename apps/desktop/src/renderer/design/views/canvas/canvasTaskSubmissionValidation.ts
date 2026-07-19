import { composeCanvasMediaProviderPrompt, type MediaContractIssue } from '@spark/protocol'
import type { CanvasMediaTaskInputFile } from '@spark/protocol'
import type { CanvasOperationType, CreateCanvasTaskRequest } from './canvas.types'
import { pruneModelParamsForCanvas } from './canvasMediaContract'

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
  const prompt = (request.compiledUserText ?? request.prompt ?? '').trim()
  if (!prompt) {
    issues.push(issue('missing_required', '请输入提示词或待处理文本', ['prompt']))
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
  return request
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

  if (operationRequiresPrompt(request.operation) && !providerPrompt) {
    issues.push(issue('missing_required', '请输入提示词', ['prompt']))
  }
  if (operationRequiresImage(request.operation) && imageCount === 0) {
    issues.push(issue('missing_required', '请至少选择一张输入图片', ['inputFiles']))
  }
  if (
    (request.operation === 'video_edit' || request.operation === 'video_extend') &&
    videoCount === 0
  ) {
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
