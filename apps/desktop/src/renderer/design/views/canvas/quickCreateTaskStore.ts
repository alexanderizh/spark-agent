import type {
  CanvasMediaTaskAsset,
  CanvasMediaTaskInputFile,
  CanvasOperationType,
} from '@spark/protocol'

const STORAGE_KEY = 'spark-canvas:quick-create-tasks:v1'
const MAX_TASKS = 60
const VALID_OPERATIONS = new Set<CanvasOperationType>([
  'text_to_image',
  'image_to_image',
  'image_edit',
  'image_compose',
  'storyboard_grid',
  'panorama_360',
  'text_generate',
  'text_rewrite',
  'prompt_optimize',
  'image_prompt_reverse',
  'text_to_audio',
  'audio_transcribe',
  'text_to_video',
  'image_to_video',
  'video_edit',
  'video_extend',
  'video_depth_map',
  'extract_audio',
  'extract_first_last_frames',
])

/**
 * 快速创作支持的模式。这里是唯一事实来源：任务存储、偏好白名单与模式推导都从这里取，
 * 避免新增模式时漏改某处白名单导致记录被静默丢弃或强转。
 */
export const QUICK_CREATE_MODES = ['image', 'reverse', 'video', 'audio'] as const

export type QuickCreateMode = (typeof QUICK_CREATE_MODES)[number]

export function isQuickCreateMode(value: unknown): value is QuickCreateMode {
  return typeof value === 'string' && (QUICK_CREATE_MODES as readonly string[]).includes(value)
}

export type QuickCreateTaskStatus = 'running' | 'succeeded' | 'failed' | 'cancelled'

export type QuickCreateTaskRecord = {
  id: string
  mode: QuickCreateMode
  operation: CanvasOperationType
  prompt: string
  negativePrompt?: string
  inputFiles: CanvasMediaTaskInputFile[]
  providerProfileId?: string
  providerName?: string
  modelId?: string
  modelName?: string
  manifestId?: string
  modelParams: Record<string, unknown>
  status: QuickCreateTaskStatus
  progress?: number
  runtimeTaskId?: string
  requestId?: string
  assets: CanvasMediaTaskAsset[]
  text?: string
  error?: { code: string; message: string }
  createdAt: string
  updatedAt: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeInputFile(value: unknown): CanvasMediaTaskInputFile | null {
  if (!isRecord(value)) return null
  if (
    value.type !== 'image' &&
    value.type !== 'video' &&
    value.type !== 'audio' &&
    value.type !== 'file'
  ) {
    return null
  }
  const input: CanvasMediaTaskInputFile = { type: value.type }
  for (const key of ['fileId', 'path', 'url', 'mimeType', 'role'] as const) {
    const next = value[key]
    if (typeof next === 'string' && next.trim()) {
      if (
        key === 'role' &&
        !['input', 'first_frame', 'last_frame', 'reference', 'mask'].includes(next)
      )
        continue
      input[key] = next as never
    }
  }
  return input
}

function normalizeAsset(value: unknown): CanvasMediaTaskAsset | null {
  if (!isRecord(value)) return null
  if (
    value.type !== 'image' &&
    value.type !== 'audio' &&
    value.type !== 'video' &&
    value.type !== 'text'
  )
    return null
  const asset: CanvasMediaTaskAsset = { type: value.type }
  for (const key of [
    'filePath',
    'url',
    'previewDataUrl',
    'mimeType',
    'contentText',
    'title',
  ] as const) {
    const next = value[key]
    if (typeof next === 'string' && next.length > 0) asset[key] = next
  }
  for (const key of ['width', 'height', 'durationMs'] as const) {
    const next = value[key]
    if (typeof next === 'number' && Number.isFinite(next)) asset[key] = next
  }
  return asset
}

function normalizeTask(value: unknown): QuickCreateTaskRecord | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.prompt !== 'string')
    return null
  const mode = isQuickCreateMode(value.mode) ? value.mode : 'image'
  const status =
    value.status === 'succeeded' || value.status === 'failed' || value.status === 'cancelled'
      ? value.status
      : 'running'
  const now = new Date().toISOString()
  const error =
    isRecord(value.error) && typeof value.error.message === 'string'
      ? {
          code: typeof value.error.code === 'string' ? value.error.code : 'unknown',
          message: value.error.message,
        }
      : undefined
  return {
    id: value.id,
    mode,
    operation:
      typeof value.operation === 'string' &&
      VALID_OPERATIONS.has(value.operation as CanvasOperationType)
        ? (value.operation as CanvasOperationType)
        : mode === 'video'
          ? 'text_to_video'
          : mode === 'reverse'
            ? 'image_prompt_reverse'
            : mode === 'audio'
              ? 'text_to_audio'
              : 'text_to_image',
    prompt: value.prompt,
    ...(typeof value.negativePrompt === 'string' ? { negativePrompt: value.negativePrompt } : {}),
    inputFiles: Array.isArray(value.inputFiles)
      ? value.inputFiles
          .map(normalizeInputFile)
          .filter((item): item is CanvasMediaTaskInputFile => item != null)
      : [],
    ...(typeof value.providerProfileId === 'string'
      ? { providerProfileId: value.providerProfileId }
      : {}),
    ...(typeof value.providerName === 'string' ? { providerName: value.providerName } : {}),
    ...(typeof value.modelId === 'string' ? { modelId: value.modelId } : {}),
    ...(typeof value.modelName === 'string' ? { modelName: value.modelName } : {}),
    ...(typeof value.manifestId === 'string' ? { manifestId: value.manifestId } : {}),
    modelParams: isRecord(value.modelParams) ? value.modelParams : {},
    status,
    ...(typeof value.progress === 'number' ? { progress: value.progress } : {}),
    ...(typeof value.runtimeTaskId === 'string' ? { runtimeTaskId: value.runtimeTaskId } : {}),
    ...(typeof value.requestId === 'string' ? { requestId: value.requestId } : {}),
    assets: Array.isArray(value.assets)
      ? value.assets
          .map(normalizeAsset)
          .filter((item): item is CanvasMediaTaskAsset => item != null)
      : [],
    ...(typeof value.text === 'string' ? { text: value.text } : {}),
    ...(error ? { error } : {}),
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : now,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : now,
  }
}

export function readQuickCreateTasks(): QuickCreateTaskRecord[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    return Array.isArray(parsed)
      ? parsed
          .map(normalizeTask)
          .filter((item): item is QuickCreateTaskRecord => item != null)
          .slice(0, MAX_TASKS)
      : []
  } catch {
    return []
  }
}

export function writeQuickCreateTasks(tasks: readonly QuickCreateTaskRecord[]): void {
  if (typeof localStorage === 'undefined') return
  try {
    // 预览 data URL 只用于当前页面即时展示；持久化时保留 filePath/url，
    // 避免每张约 2MB 的图片预览把任务索引膨胀到数十 MB。
    const persisted = tasks.slice(0, MAX_TASKS).map((task) => ({
      ...task,
      assets: task.assets.map(({ previewDataUrl: _previewDataUrl, ...asset }) => asset),
    }))
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted))
    window.dispatchEvent(new CustomEvent('spark:quick-create-tasks-updated'))
  } catch {
    // A full localStorage should not make an already completed task unusable.
  }
}
