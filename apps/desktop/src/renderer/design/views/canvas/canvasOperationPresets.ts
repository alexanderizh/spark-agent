import type { CanvasOperationType } from './canvas.types'
import {
  canvasTaskDefaultKindForOperation,
  readCanvasTaskDefault,
  type CanvasTaskDefaultContext,
} from './canvasTaskDefaults'

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
  'image_prompt_reverse',
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
  {
    id: 'screenplay.extract_props',
    operation: 'text_generate',
    label: '提取道具',
    description: '从剧本中提取道具信息',
  },
  {
    id: 'screenplay.extract_effects',
    operation: 'text_generate',
    label: '提取特效',
    description: '从剧本中提取特效信息',
  },
  {
    id: 'screenplay.split_episodes',
    operation: 'text_generate',
    label: '按剧情分集',
    description: '把长剧本拆分为结构化分集剧本',
  },
] as const satisfies readonly {
  id: string
  operation: CanvasOperationType
  label: string
  description: string
}[]

export type CanvasPipelinePresetTargetId = (typeof CANVAS_PIPELINE_PRESET_TARGETS)[number]['id']
export type CanvasPresetTargetId = CanvasOperationType | CanvasPipelinePresetTargetId

const CANVAS_PIPELINE_MODEL_PARAM_DEFAULTS: Partial<
  Record<CanvasPipelinePresetTargetId, Record<string, unknown>>
> = {
  'screenplay.to_shot_script': { workflow: 'shot_script', responseFormat: 'json' },
  'screenplay.extract_characters': { workflow: 'extract_character', responseFormat: 'json' },
  'screenplay.extract_scenes': { workflow: 'extract_scene', responseFormat: 'json' },
  'screenplay.extract_props': { workflow: 'extract_prop', responseFormat: 'json' },
  'screenplay.extract_effects': { workflow: 'extract_effect', responseFormat: 'json' },
  'screenplay.split_episodes': { workflow: 'split_episodes' },
}

const CANVAS_PIPELINE_CONTROL_PARAM_NAMES = new Set([
  'workflow',
  'responseFormat',
  'response_format',
])
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

const LEGACY_IMAGE_PROMPT_REVERSE_PROMPT = [
  '请分析输入图片，并反推出可直接用于文生图或图生视频的一段中文完整提示词。',
  '提示词必须覆盖主体、环境、构图、镜头、光影、色彩、材质与风格。',
  '只输出一段中文完整提示词，不输出分析过程、标题、Markdown、代码块或额外解释。',
  '无法从画面可靠判断的细节不要虚构为事实。',
].join('\n')

export const IMAGE_PROMPT_REVERSE_PROMPT = [
  '请分析输入图片，并反推出可直接用于文生图或图生视频的一段中文完整提示词。',
  '未提供反推要求时，提示词覆盖主体、环境、构图、镜头、光影、色彩、材质与风格。',
  '如果用户提供了反推要求，请严格以该要求为重点，只反推用户指定的内容；未指定的内容不要展开。',
  '只输出一段中文完整提示词，不输出分析过程、标题、Markdown、代码块或额外解释。',
  '无法从画面可靠判断的细节不要虚构为事实。',
].join('\n')

const IMAGE_PROMPT_REVERSE_REQUIREMENT_MARKER = '反推要求：'

/**
 * 从图片反推节点的可编辑文本中读取用户要求。
 * 兼容旧节点里已经保存的固定反推指令，避免它重新显示在编辑框中。
 */
export function readCanvasImagePromptReverseRequirement(prompt: string | null | undefined): string {
  const value = prompt?.trim() ?? ''
  if (
    !value ||
    value === IMAGE_PROMPT_REVERSE_PROMPT ||
    value === LEGACY_IMAGE_PROMPT_REVERSE_PROMPT
  ) {
    return ''
  }
  if (!value.startsWith(IMAGE_PROMPT_REVERSE_PROMPT)) return value
  const suffix = value.slice(IMAGE_PROMPT_REVERSE_PROMPT.length).trim()
  if (!suffix.startsWith(IMAGE_PROMPT_REVERSE_REQUIREMENT_MARKER)) return ''
  return suffix.slice(IMAGE_PROMPT_REVERSE_REQUIREMENT_MARKER.length).trim()
}

/** 将用户的精确反推要求附加到图片反推执行指令中。 */
export function buildCanvasImagePromptReversePrompt(
  requirement: string | null | undefined,
): string {
  const userRequirement = readCanvasImagePromptReverseRequirement(requirement)
  if (!userRequirement) return IMAGE_PROMPT_REVERSE_PROMPT
  return `${IMAGE_PROMPT_REVERSE_PROMPT}\n${IMAGE_PROMPT_REVERSE_REQUIREMENT_MARKER}\n${userRequirement}`
}

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
  image_prompt_reverse: IMAGE_PROMPT_REVERSE_PROMPT,
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
  if (
    input.operation === 'text_generate' &&
    (input.taskPipelineRole === 'shot' ||
      input.outputPipelineRole === 'shot' ||
      workflow === 'shot_script')
  ) {
    return 'screenplay.to_shot_script'
  }
  if (
    input.operation === 'text_generate' &&
    (input.taskPipelineRole === 'character' || input.outputPipelineRole === 'character') &&
    workflow === 'extract_character'
  ) {
    return 'screenplay.extract_characters'
  }
  if (
    input.operation === 'text_generate' &&
    (input.taskPipelineRole === 'scene' || input.outputPipelineRole === 'scene') &&
    workflow === 'extract_scene'
  ) {
    return 'screenplay.extract_scenes'
  }
  if (
    input.operation === 'text_generate' &&
    (input.taskPipelineRole === 'prop' || input.outputPipelineRole === 'prop') &&
    workflow === 'extract_prop'
  ) {
    return 'screenplay.extract_props'
  }
  if (
    input.operation === 'text_generate' &&
    (input.taskPipelineRole === 'effect' || input.outputPipelineRole === 'effect') &&
    workflow === 'extract_effect'
  ) {
    return 'screenplay.extract_effects'
  }
  if (
    input.operation === 'text_generate' &&
    (input.taskPipelineRole === 'screenplay' || input.outputPipelineRole === 'screenplay') &&
    workflow === 'split_episodes'
  ) {
    return 'screenplay.split_episodes'
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

/**
 * Prompt presets authored in the global preset center must never become hidden
 * instructions for a generic node in another project. Generic operations keep
 * only their built-in capability prompt; dedicated pipeline targets retain
 * their explicit functional contract.
 */
export function readCanvasExecutionPresetPrompt(
  targetId: CanvasPresetTargetId,
  context: CanvasPresetResolutionContext = {},
): string {
  const target = getCanvasPresetTargetDefinition(targetId)
  if (!target) return ''
  return target.kind === 'pipeline'
    ? readCanvasResolvedPresetTarget(targetId, context).prompt
    : readBuiltinCanvasOperationPreset(target.operation).prompt
}

/**
 * Repair nodes created before generic preset prompts were isolated. The value
 * is removed only when the whole composed system prompt exactly matches the
 * legacy global preset composition, so explicit node prompts are preserved.
 */
export function sanitizeLegacyCanvasSystemPrompt(input: {
  operation: CanvasOperationType
  targetId: CanvasPresetTargetId
  systemPrompt?: string | null
  projectPrompt?: string | null
  context?: CanvasPresetResolutionContext
}): string {
  const current = input.systemPrompt?.trim() ?? ''
  if (!current || input.targetId !== input.operation) return current
  const context = input.context ?? {}
  const legacyPresetPrompt = readCanvasResolvedPresetTarget(input.targetId, context).prompt
  const safePresetPrompt = readCanvasExecutionPresetPrompt(input.targetId, context)
  if (!legacyPresetPrompt.trim() || legacyPresetPrompt.trim() === safePresetPrompt.trim()) {
    return current
  }
  const legacySystemPrompt = buildCanvasOperationSystemPrompt(
    input.operation,
    legacyPresetPrompt,
    input.projectPrompt,
  )
  const legacySystemPromptWithoutProject = buildCanvasOperationSystemPrompt(
    input.operation,
    legacyPresetPrompt,
  )
  if (current !== legacySystemPrompt && current !== legacySystemPromptWithoutProject) return current
  return buildCanvasOperationSystemPrompt(input.operation, safePresetPrompt, input.projectPrompt)
}

export function buildCanvasOperationPrompt(
  operation: CanvasOperationType,
  prompt: string | undefined,
): string | undefined {
  if (operation === 'image_prompt_reverse') return buildCanvasImagePromptReversePrompt(prompt)
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

export type CanvasPresetResolutionContext = CanvasTaskDefaultContext & {
  /**
   * When supplied, last-used model parameters are reused only for this exact
   * provider/model identity. This prevents a custom size from leaking to a
   * different model with a narrower contract.
   */
  modelIdentity?: {
    providerProfileId?: string | undefined
    manifestId?: string | undefined
    modelId?: string | undefined
  } | null
}

export function readCanvasInheritedPresetTarget(
  targetId: CanvasPresetTargetId,
  context: CanvasPresetResolutionContext = {},
): CanvasOperationPreset {
  const target = getCanvasPresetTargetDefinition(targetId)
  if (!target) {
    return readBuiltinCanvasOperationPreset(targetId as CanvasOperationType)
  }
  const builtin = readBuiltinCanvasOperationPreset(target.operation)
  const operationOverrides =
    target.id === target.operation ? {} : (readStore()[target.operation] ?? {})
  const inheritedModelParams = {
    ...builtin.modelParams,
    ...(operationOverrides.modelParams ?? {}),
  }
  if (target.id !== target.operation) {
    for (const name of CANVAS_PIPELINE_CONTROL_PARAM_NAMES) delete inheritedModelParams[name]
  }
  const taskDefaultKind = canvasTaskDefaultKindForOperation(target.operation, context)
  const taskDefault = taskDefaultKind ? readCanvasTaskDefault(taskDefaultKind) : { skillIds: [] }
  return {
    // A dedicated pipeline contract owns its task identity and output schema.
    // Reuse runtime/model defaults from the generic operation, but never inherit
    // its authored prompt (for example a character extractor into a shot task).
    prompt: target.id === target.operation ? (operationOverrides.prompt ?? builtin.prompt) : '',
    negativePrompt: operationOverrides.negativePrompt ?? builtin.negativePrompt,
    ...((operationOverrides.providerProfileId ?? taskDefault.providerProfileId)
      ? {
          providerProfileId: operationOverrides.providerProfileId ?? taskDefault.providerProfileId,
        }
      : {}),
    ...((operationOverrides.manifestId ?? taskDefault.manifestId)
      ? { manifestId: operationOverrides.manifestId ?? taskDefault.manifestId }
      : {}),
    ...((operationOverrides.modelId ?? taskDefault.modelId)
      ? { modelId: operationOverrides.modelId ?? taskDefault.modelId }
      : {}),
    ...((operationOverrides.agentId ?? taskDefault.agentId)
      ? { agentId: operationOverrides.agentId ?? taskDefault.agentId }
      : {}),
    skillIds: [...(operationOverrides.skillIds ?? taskDefault.skillIds)],
    modelParams: {
      ...inheritedModelParams,
      ...(CANVAS_PIPELINE_MODEL_PARAM_DEFAULTS[target.id as CanvasPipelinePresetTargetId] ?? {}),
    },
  }
}

export function readCanvasPresetTarget(
  targetId: CanvasPresetTargetId,
  context: CanvasPresetResolutionContext = {},
): CanvasOperationPreset {
  const base = readCanvasInheritedPresetTarget(targetId, context)
  const overrides = readPresetStore()[targetId] ?? {}
  const resolved = {
    prompt: overrides.prompt ?? base.prompt,
    negativePrompt: overrides.negativePrompt ?? base.negativePrompt,
    ...((overrides.providerProfileId ?? base.providerProfileId)
      ? { providerProfileId: overrides.providerProfileId ?? base.providerProfileId }
      : {}),
    ...((overrides.manifestId ?? base.manifestId)
      ? { manifestId: overrides.manifestId ?? base.manifestId }
      : {}),
    ...((overrides.modelId ?? base.modelId) ? { modelId: overrides.modelId ?? base.modelId } : {}),
    ...((overrides.agentId ?? base.agentId) ? { agentId: overrides.agentId ?? base.agentId } : {}),
    skillIds: [...(overrides.skillIds ?? base.skillIds)],
    modelParams: {
      ...base.modelParams,
      ...(overrides.modelParams ?? {}),
    },
  }
  resolved.modelParams = enforceCanvasPresetTargetModelParams(targetId, resolved.modelParams)
  return resolved
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
  const runtimeOnlyPreset = { ...preset }
  delete runtimeOnlyPreset.prompt
  const next = normalizeStoredPreset(runtimeOnlyPreset)
  if (!hasStoredPresetValue(next)) {
    delete store[targetId]
  } else {
    store[targetId] = next
  }
  writeLastUsedStore(store)
}

export function readCanvasResolvedPresetTarget(
  targetId: CanvasPresetTargetId,
  context: CanvasPresetResolutionContext = {},
): CanvasOperationPreset {
  const targetPreset = readCanvasPresetTarget(targetId, context)
  const lastUsed = readLastUsedStore()[targetId] ?? {}
  const hasModelIdentityContext = Object.prototype.hasOwnProperty.call(context, 'modelIdentity')
  const reuseLastUsedModelParams =
    !hasModelIdentityContext || lastUsedModelMatchesContext(lastUsed, context.modelIdentity)
  const resolved = {
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
      ...(reuseLastUsedModelParams ? (lastUsed.modelParams ?? {}) : {}),
    },
  }
  resolved.modelParams = enforceCanvasPresetTargetModelParams(targetId, resolved.modelParams)
  return resolved
}

function lastUsedModelMatchesContext(
  lastUsed: StoredCanvasOperationPreset,
  modelIdentity: CanvasPresetResolutionContext['modelIdentity'],
): boolean {
  if (!modelIdentity) return false
  const keys: Array<'providerProfileId' | 'manifestId' | 'modelId'> = [
    'providerProfileId',
    'manifestId',
    'modelId',
  ]
  const storedKeys = keys.filter((key) => typeof lastUsed[key] === 'string' && lastUsed[key])
  if (storedKeys.length === 0) return false
  return storedKeys.every((key) => lastUsed[key] === modelIdentity[key])
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
  return mergeModelParamAliases(
    {
      ...(BUILTIN_MODEL_PARAMS[operation] ?? {}),
      ...readCanvasOperationPreset(operation).modelParams,
    },
    modelParams,
  )
}

export function mergeCanvasPresetTargetModelParams(
  targetId: CanvasPresetTargetId,
  modelParams?: Record<string, unknown>,
): Record<string, unknown> {
  return enforceCanvasPresetTargetModelParams(
    targetId,
    mergeModelParamAliases(readCanvasPresetTarget(targetId).modelParams, modelParams),
  )
}

/** Keep a functional node's routing identity separate from provider parameter inheritance. */
export function enforceCanvasPresetTargetModelParams(
  targetId: CanvasPresetTargetId,
  modelParams: Record<string, unknown>,
): Record<string, unknown> {
  const workflow =
    CANVAS_PIPELINE_MODEL_PARAM_DEFAULTS[targetId as CanvasPipelinePresetTargetId]?.workflow
  return typeof workflow === 'string' ? { ...modelParams, workflow } : { ...modelParams }
}

function mergeModelParamAliases(
  base: Record<string, unknown>,
  overrides: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const nextBase = { ...base }
  const nextOverrides = { ...(overrides ?? {}) }
  let selectedDuration: { name: 'duration' | 'durationSeconds'; value: unknown } | undefined
  for (const [name, value] of Object.entries(nextOverrides)) {
    if (name === 'duration' || name === 'durationSeconds') {
      selectedDuration = { name, value }
    }
  }
  if (selectedDuration) {
    delete nextBase.duration
    delete nextBase.durationSeconds
    delete nextOverrides.duration
    delete nextOverrides.durationSeconds
    nextOverrides[selectedDuration.name] = selectedDuration.value
  }
  return { ...nextBase, ...nextOverrides }
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
