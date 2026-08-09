export type SchemaField = {
  name: string
  title: string
  type: string
  enumValues: string[]
  /**
   * enum 值 → 展示名的映射。manifest paramSchema 可通过自定义关键字
   * `x-template-labels` 注入（如 MiniMax 视频 Agent 的 11 个模板 id → 中文名），
   * 让下拉显示人类可读名称而非裸枚举值。缺失时回退到 enum 值本身。
   */
  enumLabels?: Record<string, string>
  minimum?: number
  maximum?: number
  multipleOf?: number
  allowCustom?: boolean
  pattern?: string
  description?: string
  placeholder?: string
}

export type CanvasParameterControlKind =
  | 'aspect-ratio'
  | 'size'
  | 'resolution'
  | 'count'
  | 'duration'
  | 'boolean'
  | 'enum'
  | 'autocomplete'
  | 'number'
  | 'text'

export type CanvasParameterTier = 'common' | 'advanced'

export type CanvasParameterPresentation = {
  field: SchemaField
  control: CanvasParameterControlKind
  tier: CanvasParameterTier
  label: string
  unit?: string
}

const ASPECT_ALIASES = new Set(['aspectratio', 'aspect', 'ratio', 'videoaspectratio'])
const RESOLUTION_ALIASES = new Set([
  'resolution',
  'imagesize',
  'videosize',
  'quality',
  'imagequality',
  'videoquality',
])
const COUNT_ALIASES = new Set([
  'n',
  'count',
  'imagecount',
  'numberofimages',
  'numimages',
  'numoutputs',
  'batchsize',
])
const DURATION_ALIASES = new Set([
  'duration',
  'durationseconds',
  'seconds',
  'videoduration',
  'audioduration',
])
const COMMON_ENUM_ALIASES = new Set([
  'fps',
  'framerate',
  'voice',
  'audioformat',
  'format',
  'generateaudio',
])
const FORCE_ADVANCED_ALIASES = new Set([
  'seed',
  'watermark',
  'searchenabled',
  'googlesearch',
  'servicetier',
  'returnlastframe',
])

function normalizeName(name: string): string {
  return name.replace(/[^a-z0-9]/gi, '').toLowerCase()
}

function isRatioValue(value: string): boolean {
  const trimmed = value.trim().toLowerCase()
  return (
    /^\d+(?:\.\d+)?:\d+(?:\.\d+)?$/.test(trimmed) ||
    /^\d+(?:\.\d+)?[x×*]\d+(?:\.\d+)?$/.test(trimmed) ||
    ['auto', 'adaptive', '智能比例', '自适应'].includes(trimmed)
  )
}

export function parameterOptionValues(field: SchemaField): string[] {
  return [...new Set(field.enumValues)]
}

export function aspectRatioOptions(field: SchemaField): string[] {
  const optionValues = parameterOptionValues(field)
  // 自定义输入不代表 provider 接受一组通用比例。快捷选项只能来自当前
  // manifest 的 enum/examples；模型需要任意比例时，用户仍可在输入框中手输。
  return [...new Set(optionValues)]
}

function fieldControl(field: SchemaField): CanvasParameterControlKind {
  const name = normalizeName(field.name)
  const optionValues = parameterOptionValues(field)
  if (ASPECT_ALIASES.has(name)) return 'aspect-ratio'
  if (name === 'size') {
    if (field.allowCustom && optionValues.length > 0) return 'size'
    return optionValues.length > 0 && optionValues.every(isRatioValue)
      ? 'aspect-ratio'
      : 'resolution'
  }
  if (RESOLUTION_ALIASES.has(name)) return 'resolution'
  if (COUNT_ALIASES.has(name)) return 'count'
  if (DURATION_ALIASES.has(name)) return 'duration'
  if (field.type === 'boolean') return 'boolean'
  if (optionValues.length > 0) return field.allowCustom ? 'autocomplete' : 'enum'
  if (field.type === 'integer' || field.type === 'number') return 'number'
  return 'text'
}

function fieldTier(field: SchemaField, control: CanvasParameterControlKind): CanvasParameterTier {
  const name = normalizeName(field.name)
  if (FORCE_ADVANCED_ALIASES.has(name)) return 'advanced'
  if (field.allowCustom && (name === 'width' || name === 'height')) return 'common'
  if (
    control === 'aspect-ratio' ||
    control === 'size' ||
    control === 'resolution' ||
    control === 'count' ||
    control === 'duration' ||
    COMMON_ENUM_ALIASES.has(name)
  ) {
    return 'common'
  }
  return 'advanced'
}

function fieldUnit(field: SchemaField, control: CanvasParameterControlKind): string | undefined {
  if (control === 'count') return '张'
  if (control === 'duration') return '秒'
  if (normalizeName(field.name) === 'fps' || normalizeName(field.name) === 'framerate') {
    return 'fps'
  }
  return undefined
}

export function presentField(field: SchemaField): CanvasParameterPresentation {
  const control = fieldControl(field)
  const unit = fieldUnit(field, control)
  return {
    field,
    control,
    tier: fieldTier(field, control),
    label: field.title || field.name,
    ...(unit ? { unit } : {}),
  }
}

export function partitionParameterFields(fields: readonly SchemaField[]): {
  common: CanvasParameterPresentation[]
  advanced: CanvasParameterPresentation[]
} {
  const common: CanvasParameterPresentation[] = []
  const advanced: CanvasParameterPresentation[] = []
  for (const field of fields) {
    const presentation = presentField(field)
    if (presentation.tier === 'common') common.push(presentation)
    else advanced.push(presentation)
  }
  return { common, advanced }
}

export function aspectRatioShape(value: string): {
  width: number
  height: number
  adaptive?: boolean
} {
  const normalized = value.trim().toLowerCase()
  if (['auto', 'adaptive', '智能比例', '自适应'].includes(normalized)) {
    return { width: 24, height: 18, adaptive: true }
  }
  const match = normalized.match(/^(\d+(?:\.\d+)?)(?::|x|×|\*)(\d+(?:\.\d+)?)$/)
  if (!match) return { width: 24, height: 18 }
  const width = Number(match[1])
  const height = Number(match[2])
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { width: 24, height: 18 }
  }
  const ratio = width / height
  return ratio >= 1
    ? { width: 32, height: Math.max(6, Math.round(32 / ratio)) }
    : { width: Math.max(6, Math.round(32 * ratio)), height: 32 }
}

export function isAspectRatioValue(value: string): boolean {
  return isRatioValue(value)
}

export function parameterSummaryValue(item: CanvasParameterPresentation, value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return '默认'
  if (!item.unit || trimmed.toLowerCase().endsWith(item.unit.toLowerCase())) return trimmed
  return `${trimmed}${item.unit}`
}
