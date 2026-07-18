import type { CanvasMediaTaskInputFile } from '@spark/protocol'
import type { CanvasTask, CanvasTaskInputDiagnostic } from './canvas.types'

const VALUE_PREVIEW_MAX = 72

export function summarizeCanvasTaskInputFiles(
  files: CanvasMediaTaskInputFile[] | undefined,
): CanvasTaskInputDiagnostic[] {
  if (!files || files.length === 0) return []
  return files.map((file) => summarizeCanvasTaskInputFile(file))
}

export function buildCanvasTaskDetailParams(
  task: Pick<
    CanvasTask,
    | 'operation'
    | 'agentId'
    | 'skillIds'
    | 'providerProfileId'
    | 'manifestId'
    | 'modelId'
    | 'reasoningEffort'
    | 'modelParams'
    | 'inputFileDiagnostics'
    | 'taskPipelineRole'
    | 'outputPipelineRole'
    | 'shotScriptConfig'
  >,
): Record<string, unknown> {
  return {
    operation: task.operation,
    agentId: task.agentId ?? null,
    skillIds: task.skillIds ?? [],
    providerProfileId: task.providerProfileId ?? null,
    manifestId: task.manifestId ?? null,
    modelId: task.modelId ?? null,
    reasoningEffort: task.reasoningEffort ?? null,
    taskPipelineRole: task.taskPipelineRole ?? null,
    outputPipelineRole: task.outputPipelineRole ?? null,
    shotScriptConfig: task.shotScriptConfig ?? null,
    modelParams: task.modelParams ?? {},
    requestInputFiles: task.inputFileDiagnostics ?? [],
  }
}

function summarizeCanvasTaskInputFile(file: CanvasMediaTaskInputFile): CanvasTaskInputDiagnostic {
  const payloadField = file.dataUrl ? 'dataUrl' : file.url ? 'url' : file.path ? 'path' : 'unknown'
  const rawValue = file.dataUrl ?? file.url ?? file.path ?? ''
  const mimeType = normalizeNullableString(file.mimeType) ?? detectMimeType(file)
  const format = detectFormat(rawValue, mimeType)
  return {
    type: file.type,
    ...(file.role ? { role: file.role } : {}),
    payloadField,
    transport: detectTransport(file),
    ...(mimeType ? { mimeType } : {}),
    ...(format ? { format } : {}),
    ...(rawValue ? { valuePreview: previewValue(rawValue) } : {}),
  }
}

function detectTransport(file: CanvasMediaTaskInputFile): CanvasTaskInputDiagnostic['transport'] {
  if (file.dataUrl) return 'base64_data_url'
  if (file.path) return 'local_path'
  if (file.url?.startsWith('safe-file://')) return 'safe_file_url'
  if (file.url && /^https?:\/\//i.test(file.url)) return 'remote_url'
  return 'unknown'
}

function detectMimeType(file: CanvasMediaTaskInputFile): string | null {
  const dataUrl = file.dataUrl?.match(/^data:([^;,]+)(?:;base64)?,/i)?.[1]
  return normalizeNullableString(dataUrl ?? null)
}

function detectFormat(rawValue: string, mimeType: string | null): string | null {
  const mimeFormat = normalizeNullableString(mimeType?.split('/')[1]?.split('+')[0] ?? null)
  if (mimeFormat) return mimeFormat
  const match = rawValue.match(/\.([a-z0-9]+)(?:[?#].*)?$/i)
  return normalizeNullableString(match?.[1] ?? null)
}

function previewValue(value: string): string {
  if (value.length <= VALUE_PREVIEW_MAX) return value
  return `${value.slice(0, VALUE_PREVIEW_MAX)}…<len=${value.length}>`
}

function normalizeNullableString(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}
