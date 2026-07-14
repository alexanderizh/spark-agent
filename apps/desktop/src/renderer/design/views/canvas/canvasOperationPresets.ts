import type { CanvasOperationType } from './canvas.types'

const STORAGE_KEY = 'spark-canvas:operation-presets:v1'
const LAST_USED_STORAGE_KEY = 'spark-canvas:operation-last-used:v1'

export const CANVAS_OPERATION_PRESET_OPERATIONS: readonly CanvasOperationType[] = [
  'text_to_image',
  'image_to_image',
  'image_edit',
  'image_compose',
  'storyboard_grid',
  'panorama_360',
  'text_generate',
  'text_rewrite',
  'prompt_optimize',
  'text_to_audio',
  'audio_transcribe',
  'text_to_video',
  'image_to_video',
  'video_edit',
  'video_extend',
]

export const CANVAS_PIPELINE_PRESET_TARGETS = [
  {
    id: 'chapter.to_screenplay',
    operation: 'text_rewrite',
    label: '转剧本',
    description: '章节 / 普通文本改写为剧本',
  },
  {
    id: 'screenplay.to_shot_script',
    operation: 'text_generate',
    label: '生成分镜脚本',
    description: '剧本拆成分镜脚本',
  },
  {
    id: 'screenplay.extract_characters',
    operation: 'text_generate',
    label: '提取角色',
    description: '从剧本中提取角色信息',
  },
  {
    id: 'screenplay.extract_scenes',
    operation: 'text_generate',
    label: '提取场景',
    description: '从剧本中提取场景信息',
  },
] as const satisfies readonly {
  id: string
  operation: CanvasOperationType
  label: string
  description: string
}[]

export type CanvasPipelinePresetTargetId = (typeof CANVAS_PIPELINE_PRESET_TARGETS)[number]['id']
export type CanvasPresetTargetId = CanvasOperationType | CanvasPipelinePresetTargetId
export type CanvasPresetTargetDefinition = {
  id: CanvasPresetTargetId
  operation: CanvasOperationType
  label: string
  description: string
  kind: 'operation' | 'pipeline'
}

export const CANVAS_PRESET_TARGETS: readonly CanvasPresetTargetDefinition[] = [
  ...CANVAS_OPERATION_PRESET_OPERATIONS.map((operation) => ({
    id: operation,
    operation,
    label: operation,
    description: '',
    kind: 'operation' as const,
  })),
  ...CANVAS_PIPELINE_PRESET_TARGETS.map((target) => ({
    ...target,
    kind: 'pipeline' as const,
  })),
]

export type CanvasOperationPresetRuntime = {
  providerProfileId?: string
  manifestId?: string
  modelId?: string
  agentId?: string
  skillIds: string[]
}

export type CanvasOperationPreset = {
  prompt: string
  negativePrompt: string
  providerProfileId?: string
  manifestId?: string
  modelId?: string
  agentId?: string
  skillIds: string[]
  modelParams: Record<string, unknown>
}

type StoredCanvasOperationPreset = {
  prompt?: string
  negativePrompt?: string
  providerProfileId?: string
  manifestId?: string
  modelId?: string
  agentId?: string
  skillIds?: string[]
  modelParams?: Record<string, unknown>
}

type CanvasOperationPresetStore = Partial<Record<CanvasOperationType, StoredCanvasOperationPreset>>
type CanvasPresetStore = Partial<Record<CanvasPresetTargetId, StoredCanvasOperationPreset>>
type CanvasLastUsedStore = Partial<Record<CanvasPresetTargetId, StoredCanvasOperationPreset>>

const BUILTIN_PROMPTS: Partial<Record<CanvasOperationType, string>> = {
  text_to_image: '请基于输入内容生成一张高质量图片。',
  image_to_image: '请基于输入图片生成一个高质量变体。',
  image_edit: '请基于输入图片进行自然编辑，保持主体与画面质量。',
  image_compose: '请将输入图片自然合成为一张高质量图片。',
  storyboard_grid: '故事板风格：线描稿。请把场景拆成一张横向多分格故事板图，用于后续视频生成参考。',
  panorama_360: '请基于输入内容生成一张可用于 360° 全景预览的等距柱状投影场景图。',
  text_generate: '请基于输入内容生成结构清晰、信息完整的文本。',
  text_rewrite: '请基于输入内容进行改写，保持原意并提升表达质量。',
  prompt_optimize: '请优化提示词，使其更清晰、可执行，并保留用户原始意图。',
  text_to_audio: '请基于输入文本生成一段自然清晰的音频。',
  audio_transcribe: '请转写输入音频内容。',
  text_to_video: '请基于输入文本生成一段自然流畅的视频。',
  image_to_video: '请基于输入图片生成一段自然流畅的视频。',
  video_edit: '请基于输入视频和参考帧进行自然视频编辑。',
  video_extend: '请基于输入视频最后一帧继续生成自然连贯的视频。',
}

const BUILTIN_PROMPT_PREFIXES: Partial<Record<CanvasOperationType, string>> = {
  storyboard_grid: [
    '请生成一张单图故事板（storyboard sheet），不是多张图片。',
    '画面必须由多个清晰分格组成，按剧情进度从左到右、从上到下排列，每格展示一个关键画面。',
    '每个分格必须包含：镜号或进度编号、关键动作、人物位置关系、镜头景别/视角、必要的对话或对白摘录、人物标注（谁是谁）。',
    '如果输入了多张参考图，必须严格按输入图片顺序匹配提示词中的角色/场景/道具说明：参考图 1 对应第 1 个带入说明，参考图 2 对应第 2 个带入说明，以此类推，不要交换身份、服装、脸部特征或道具归属。',
    '故事板风格只能在「线描稿」或「彩绘稿」中选择：线描稿使用黑白线稿、灰阶阴影、清晰构图；彩绘稿使用完整色彩、电影感光影、统一美术风格。若用户未指定，默认使用线描稿。',
    '最终图应像专业影视/动画前期故事板：分格边框清楚、阅读顺序明确、角色一致、场景连续、动作可追踪，便于视频模型按故事板生成连续镜头。',
    '避免：单幅海报、角色设定表、无分格拼贴、文字过多遮挡画面、水印、Logo、杂乱 UI、错配角色参考图。',
  ].join('\n'),
  panorama_360:
    '请基于入参生成一张可用于 360° 全景查看器的完整场景全景图。必须输出单张 2:1 等距柱状投影（equirectangular panorama）图片，覆盖水平 360° 与垂直 180° 视野；左右边缘必须无缝衔接，地平线保持水平，避免黑边、拼接缝、文字、水印、边框、鱼眼圆图、六面体展开图或多宫格。画面应适合映射到球体内部进行沉浸式 3D 预览。',
}

const BUILTIN_MODEL_PARAMS: Partial<Record<CanvasOperationType, Record<string, unknown>>> = {
  panorama_360: {
    aspect_ratio: '2:1',
    resolution: '2k',
  },
}

function canUseLocalStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'
}

function cloneJsonRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  try {
    return JSON.parse(JSON.stringify(value)) as Record<string, unknown>
  } catch {
    return {}
  }
}

function normalizeStoredPreset(value: unknown): StoredCanvasOperationPreset {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const preset = value as Record<string, unknown>
  return {
    ...(typeof preset.prompt === 'string' ? { prompt: preset.prompt.trim() } : {}),
    ...(typeof preset.negativePrompt === 'string'
      ? { negativePrompt: preset.negativePrompt.trim() }
      : {}),
    ...(preset.modelParams &&
    typeof preset.modelParams === 'object' &&
    !Array.isArray(preset.modelParams)
      ? { modelParams: cloneJsonRecord(preset.modelParams) }
      : {}),
    ...(typeof preset.providerProfileId === 'string'
      ? { providerProfileId: preset.providerProfileId.trim() }
      : {}),
    ...(typeof preset.manifestId === 'string' ? { manifestId: preset.manifestId.trim() } : {}),
    ...(typeof preset.modelId === 'string' ? { modelId: preset.modelId.trim() } : {}),
    ...(typeof preset.agentId === 'string' ? { agentId: preset.agentId.trim() } : {}),
    ...(Array.isArray(preset.skillIds)
      ? {
          skillIds: preset.skillIds.filter(
            (skillId): skillId is string => typeof skillId === 'string',
          ),
        }
      : {}),
  }
}

function hasStoredPresetValue(preset: StoredCanvasOperationPreset): boolean {
  return Boolean(
    preset.prompt ||
    preset.negativePrompt ||
    preset.providerProfileId ||
    preset.manifestId ||
    preset.modelId ||
    preset.agentId ||
    (preset.skillIds && preset.skillIds.length > 0) ||
    (preset.modelParams && Object.keys(preset.modelParams).length > 0),
  )
}

function readStore(): CanvasOperationPresetStore {
  if (!canUseLocalStorage()) return {}
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const result: CanvasOperationPresetStore = {}
    for (const operation of CANVAS_OPERATION_PRESET_OPERATIONS) {
      const preset = normalizeStoredPreset(parsed[operation])
      if (hasStoredPresetValue(preset)) {
        result[operation] = preset
      }
    }
    return result
  } catch {
    return {}
  }
}

function writeStore(store: CanvasOperationPresetStore): void {
  if (!canUseLocalStorage()) return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
  } catch {
    // Ignore storage failures in restricted renderers.
  }
}

function readPresetStore(): CanvasPresetStore {
  if (!canUseLocalStorage()) return {}
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const result: CanvasPresetStore = {}
    for (const target of CANVAS_PRESET_TARGETS) {
      const preset = normalizeStoredPreset(parsed[target.id])
      if (hasStoredPresetValue(preset)) result[target.id] = preset
    }
    return result
  } catch {
    return {}
  }
}

function writePresetStore(store: CanvasPresetStore): void {
  writeStore(store as CanvasOperationPresetStore)
}

function readLastUsedStore(): CanvasLastUsedStore {
  if (!canUseLocalStorage()) return {}
  try {
    const raw = window.localStorage.getItem(LAST_USED_STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const result: CanvasLastUsedStore = {}
    for (const target of CANVAS_PRESET_TARGETS) {
      const preset = normalizeStoredPreset(parsed[target.id])
      if (hasStoredPresetValue(preset)) result[target.id] = preset
    }
    return result
  } catch {
    return {}
  }
}

function writeLastUsedStore(store: CanvasLastUsedStore): void {
  if (!canUseLocalStorage()) return
  try {
    window.localStorage.setItem(LAST_USED_STORAGE_KEY, JSON.stringify(store))
  } catch {
    // Ignore storage failures in restricted renderers.
  }
}

export function getCanvasPresetTargetDefinition(
  targetId: CanvasPresetTargetId,
): CanvasPresetTargetDefinition | null {
  return CANVAS_PRESET_TARGETS.find((target) => target.id === targetId) ?? null
}

export function resolveCanvasPresetTarget(input: {
  operation: CanvasOperationType
  taskPipelineRole?: string | null
  outputPipelineRole?: string | null
  workflow?: unknown
}): CanvasPresetTargetId {
  const workflow = typeof input.workflow === 'string' ? input.workflow.trim() : ''
  if (input.operation === 'text_rewrite' && input.outputPipelineRole === 'screenplay') {
    return 'chapter.to_screenplay'
  }
  if (input.operation === 'text_generate' && input.taskPipelineRole === 'shot') {
    return 'screenplay.to_shot_script'
  }
  if (
    input.operation === 'text_generate' &&
    input.taskPipelineRole === 'character' &&
    workflow === 'extract_character'
  ) {
    return 'screenplay.extract_characters'
  }
  if (
    input.operation === 'text_generate' &&
    input.taskPipelineRole === 'scene' &&
    workflow === 'extract_scene'
  ) {
    return 'screenplay.extract_scenes'
  }
  return input.operation
}

export function readCanvasOperationPresetOverrides(): CanvasOperationPresetStore {
  return readStore()
}

export function readBuiltinCanvasOperationPreset(
  operation: CanvasOperationType,
): CanvasOperationPreset {
  return {
    prompt: BUILTIN_PROMPTS[operation] ?? '',
    negativePrompt: '',
    skillIds: [],
    modelParams: {
      ...(BUILTIN_MODEL_PARAMS[operation] ?? {}),
    },
  }
}

export function readCanvasOperationPresetPromptPrefix(operation: CanvasOperationType): string {
  return BUILTIN_PROMPT_PREFIXES[operation] ?? ''
}

/** Compose hidden capability instructions without leaking them into the user document. */
export function buildCanvasOperationSystemPrompt(
  operation: CanvasOperationType,
  ...sections: Array<string | null | undefined>
): string {
  const values = [readCanvasOperationPresetPromptPrefix(operation), ...sections]
    .map((section) => section?.trim() ?? '')
    .filter(Boolean)
  return values.filter((section, index) => values.indexOf(section) === index).join('\n\n')
}

export function buildCanvasOperationPrompt(
  operation: CanvasOperationType,
  prompt: string | undefined,
): string | undefined {
  const prefix = readCanvasOperationPresetPromptPrefix(operation).trim()
  const body = unwrapCanvasOperationPromptBody(prefix, prompt)
  if (!prefix) return body || undefined
  return body ? `${prefix}\n\n入参/场景要求：\n${body}` : prefix
}

function unwrapCanvasOperationPromptBody(prefix: string, prompt: string | undefined): string {
  let body = (prompt ?? '').trim()
  if (!prefix) return body
  const marker = '入参/场景要求：'
  while (body.startsWith(prefix)) {
    const rest = body.slice(prefix.length).trim()
    if (!rest.startsWith(marker)) break
    const next = rest.slice(marker.length).trim()
    if (!next || next === body) break
    body = next
  }
  return body
}

export function readCanvasOperationPreset(operation: CanvasOperationType): CanvasOperationPreset {
  const builtin = readBuiltinCanvasOperationPreset(operation)
  const overrides = readStore()[operation] ?? {}
  return {
    prompt: overrides.prompt ?? builtin.prompt,
    negativePrompt: overrides.negativePrompt ?? builtin.negativePrompt,
    ...((overrides.providerProfileId ?? builtin.providerProfileId)
      ? { providerProfileId: overrides.providerProfileId ?? builtin.providerProfileId }
      : {}),
    ...((overrides.manifestId ?? builtin.manifestId)
      ? { manifestId: overrides.manifestId ?? builtin.manifestId }
      : {}),
    ...((overrides.modelId ?? builtin.modelId)
      ? { modelId: overrides.modelId ?? builtin.modelId }
      : {}),
    ...((overrides.agentId ?? builtin.agentId)
      ? { agentId: overrides.agentId ?? builtin.agentId }
      : {}),
    skillIds: [...(overrides.skillIds ?? builtin.skillIds)],
    modelParams: {
      ...builtin.modelParams,
      ...(overrides.modelParams ?? {}),
    },
  }
}

export function readCanvasPresetTargetOverrides(): CanvasPresetStore {
  return readPresetStore()
}

export function readCanvasPresetTarget(targetId: CanvasPresetTargetId): CanvasOperationPreset {
  const target = getCanvasPresetTargetDefinition(targetId)
  if (!target) {
    return readCanvasOperationPreset(targetId as CanvasOperationType)
  }
  const base = readCanvasOperationPreset(target.operation)
  const overrides = readPresetStore()[targetId] ?? {}
  return {
    prompt: overrides.prompt ?? base.prompt,
    negativePrompt: overrides.negativePrompt ?? base.negativePrompt,
    ...((overrides.providerProfileId ?? base.providerProfileId)
      ? { providerProfileId: overrides.providerProfileId ?? base.providerProfileId }
      : {}),
    ...((overrides.manifestId ?? base.manifestId)
      ? { manifestId: overrides.manifestId ?? base.manifestId }
      : {}),
    ...((overrides.modelId ?? base.modelId)
      ? { modelId: overrides.modelId ?? base.modelId }
      : {}),
    ...((overrides.agentId ?? base.agentId)
      ? { agentId: overrides.agentId ?? base.agentId }
      : {}),
    skillIds: [...(overrides.skillIds ?? base.skillIds)],
    modelParams: {
      ...base.modelParams,
      ...(overrides.modelParams ?? {}),
    },
  }
}

export function writeCanvasOperationPreset(
  operation: CanvasOperationType,
  preset: Partial<CanvasOperationPreset>,
): void {
  const store = readStore()
  const next = normalizeStoredPreset(preset)
  if (!hasStoredPresetValue(next)) {
    delete store[operation]
  } else {
    store[operation] = next
  }
  writeStore(store)
}

export function writeCanvasPresetTarget(
  targetId: CanvasPresetTargetId,
  preset: Partial<CanvasOperationPreset>,
): void {
  const store = readPresetStore()
  const next = normalizeStoredPreset(preset)
  if (!hasStoredPresetValue(next)) {
    delete store[targetId]
  } else {
    store[targetId] = next
  }
  writePresetStore(store)
}

export function resetCanvasOperationPreset(operation: CanvasOperationType): void {
  const store = readStore()
  delete store[operation]
  writeStore(store)
}

export function resetCanvasPresetTarget(targetId: CanvasPresetTargetId): void {
  const store = readPresetStore()
  delete store[targetId]
  writePresetStore(store)
}

export function resetCanvasLastUsedPresetTarget(targetId: CanvasPresetTargetId): void {
  const store = readLastUsedStore()
  delete store[targetId]
  writeLastUsedStore(store)
}

export function readCanvasLastUsedPresetTarget(
  targetId: CanvasPresetTargetId,
): Partial<CanvasOperationPreset> {
  const stored = readLastUsedStore()[targetId]
  if (!stored) return {}
  return { ...normalizeStoredPreset(stored) }
}

export function writeCanvasLastUsedPresetTarget(
  targetId: CanvasPresetTargetId,
  preset: Partial<CanvasOperationPreset>,
): void {
  const store = readLastUsedStore()
  const next = normalizeStoredPreset(preset)
  if (!hasStoredPresetValue(next)) {
    delete store[targetId]
  } else {
    store[targetId] = next
  }
  writeLastUsedStore(store)
}

export function readCanvasResolvedPresetTarget(targetId: CanvasPresetTargetId): CanvasOperationPreset {
  const targetPreset = readCanvasPresetTarget(targetId)
  const lastUsed = readLastUsedStore()[targetId] ?? {}
  return {
    // 用户在任务面板中输入的内容不能反向覆盖功能节点的内置指令。
    // 历史版本曾把 prompt 写进 last-used，这里固定以显式 preset 为准，
    // 同时继续沿用上次选择的模型、Agent 与参数。
    prompt: targetPreset.prompt,
    negativePrompt: lastUsed.negativePrompt ?? targetPreset.negativePrompt,
    ...((lastUsed.providerProfileId ?? targetPreset.providerProfileId)
      ? { providerProfileId: lastUsed.providerProfileId ?? targetPreset.providerProfileId }
      : {}),
    ...((lastUsed.manifestId ?? targetPreset.manifestId)
      ? { manifestId: lastUsed.manifestId ?? targetPreset.manifestId }
      : {}),
    ...((lastUsed.modelId ?? targetPreset.modelId)
      ? { modelId: lastUsed.modelId ?? targetPreset.modelId }
      : {}),
    ...((lastUsed.agentId ?? targetPreset.agentId)
      ? { agentId: lastUsed.agentId ?? targetPreset.agentId }
      : {}),
    skillIds: [...(lastUsed.skillIds ?? targetPreset.skillIds)],
    modelParams: {
      ...targetPreset.modelParams,
      ...(lastUsed.modelParams ?? {}),
    },
  }
}

export function hasCanvasPresetTargetOverride(targetId: CanvasPresetTargetId): boolean {
  const preset = readPresetStore()[targetId]
  return preset ? hasStoredPresetValue(preset) : false
}

export function mergeCanvasOperationPresetPrompt(prompt: string, presetPrompt: string): string {
  const trimmedPrompt = prompt.trim()
  const trimmedPresetPrompt = presetPrompt.trim()
  return trimmedPrompt || trimmedPresetPrompt
}

export function mergeCanvasOperationPresetNegativePrompt(
  negativePrompt: string,
  presetNegativePrompt: string,
): string {
  const trimmedPrimary = negativePrompt.trim()
  const trimmedSecondary = presetNegativePrompt.trim()
  if (!trimmedPrimary) return trimmedSecondary
  if (!trimmedSecondary) return trimmedPrimary
  if (trimmedPrimary.includes(trimmedSecondary)) return trimmedPrimary
  if (trimmedSecondary.includes(trimmedPrimary)) return trimmedSecondary
  return `${trimmedPrimary}\n${trimmedSecondary}`
}

export function mergeCanvasOperationPresetModelParams(
  operation: CanvasOperationType,
  modelParams?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...(BUILTIN_MODEL_PARAMS[operation] ?? {}),
    ...readCanvasOperationPreset(operation).modelParams,
    ...(modelParams ?? {}),
  }
}

export function mergeCanvasPresetTargetModelParams(
  targetId: CanvasPresetTargetId,
  modelParams?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...readCanvasPresetTarget(targetId).modelParams,
    ...(modelParams ?? {}),
  }
}

export function formatCanvasOperationPresetModelParams(
  modelParams: Record<string, unknown>,
): string {
  if (Object.keys(modelParams).length === 0) return ''
  return JSON.stringify(modelParams, null, 2)
}

export function parseCanvasOperationPresetModelParams(text: string): Record<string, unknown> {
  const trimmed = text.trim()
  if (!trimmed) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    throw new Error('默认参数必须是合法 JSON，例如 {"size":"1792x1024"}')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('默认参数必须是 JSON 对象，例如 {"size":"1792x1024"}')
  }
  return cloneJsonRecord(parsed)
}
