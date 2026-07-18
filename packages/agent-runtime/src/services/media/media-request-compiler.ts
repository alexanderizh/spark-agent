/**
 * @module media-request-compiler
 *
 * Media Model Contract V2 共享编译器。所有进入 provider 请求的参数都必须先经过
 * compileMediaRequest，确保：
 *   1. snake_case / provider 原生字段名归一为 canonical 命名。
 *   2. defaults 与显式参数合并后按 paramSchema 校验类型/枚举/范围。
 *   3. paramPolicy.aliases 把 canonical 字段映射到 provider 原生字段。
 *   4. transforms 完成枚举式值映射（智能比例 -> adaptive、size: 16:9 -> aspectRatio 等）。
 *   5. conflicts 按策略解决（prefer_first/prefer_last/error）。
 *   6. strict / passthrough.allow/deny 决定哪些字段最终进入 provider 请求。
 *   7. forbidden 字段被丢弃并记录原因。
 *   8. 本地字段（filename 等）永远不进入 provider 请求。
 *
 * Canvas、spark_media MCP、TemplateMediaAdapter 与专用 adapter 都应调用此编译器，
 * 避免参数归一逻辑在多处分叉。
 */

import type {
  MediaContractIssue,
  MediaContractWarning,
  MediaDroppedParam,
  MediaModelCapabilityManifest,
  MediaModelManifest,
  MediaModelParamPolicy,
  MediaParamConflictRule,
  MediaParamTransformRule,
} from '@spark/protocol'
import { isMediaProviderKind } from '@spark/protocol'

/** 入参中"输入文件"的最小形态；conditionals.drop_when_input_kind 需要读 type。 */
export interface CompilerInputFile {
  type: string
  role?: string | undefined
}

/**
 * 调用方传入的输入。MCP / canvas / adapter 各自把自家 input shape 翻成这个最小集。
 */
export interface CompileMediaRequestInput {
  manifest: MediaModelManifest
  capability: MediaModelCapabilityManifest
  modelId: string
  input: {
    prompt?: string | undefined
    negativePrompt?: string | undefined
    modelParams?: Record<string, unknown> | undefined
    inputFiles?: CompilerInputFile[] | undefined
  }
  /** Provider-level 默认值（来自 ProviderMediaDefaults），优先级低于 capability.defaults。 */
  providerDefaults?: Record<string, unknown> | undefined
  /** 用户已确认参数提醒时保留原参数，让供应商最终决定是否接受。 */
  skipParameterValidation?: boolean | undefined
  /**
   * 调用场景：
   *   - 'canvas'：MCP/skill 不在场的画布裁剪（不出 provider 错误，只产警告）。
   *   - 'mcp'：spark_media MCP 工具（strict 失败时抛 invalid_input）。
   *   - 'adapter'：runtime adapter preflight（strict 失败时抛 invalid_input）。
   * 默认 'adapter'。
   */
  mode?: 'canvas' | 'mcp' | 'adapter' | undefined
}

export interface CompileMediaRequestResult {
  /** 经过 canonical 归一、defaults 合并、transforms 后的 canonical 字段集合（不含 aliases 映射）。 */
  canonicalParams: Record<string, unknown>
  /** 最终允许进入 provider 请求的字段（已应用 aliases、过滤 forbidden/local/unknown）。 */
  providerParams: Record<string, unknown>
  droppedParams: MediaDroppedParam[]
  warnings: MediaContractWarning[]
  validationIssues: MediaContractIssue[]
}

/**
 * A `custom:*` ref without an inline manifest is synthesized from a built-in
 * provider manifest for canvas presentation only. Its cloned schema must not
 * validate or prune the custom model's provider parameters.
 */
export function isSynthesizedCustomManifest(
  manifest: Pick<MediaModelManifest, 'id' | 'providerKind'>,
): boolean {
  return (
    manifest.id.startsWith('custom:') &&
    manifest.providerKind !== 'custom' &&
    isMediaProviderKind(manifest.providerKind)
  )
}

// 仅在本地产物命名使用、永远不应进入 provider 请求的字段。
const LOCAL_ONLY_FIELDS = new Set(['filename'])

// Provider 写法 -> canonical camelCase 的固定映射表。
// 仅在 paramPolicy 没显式声明 aliases 时作为兜底；不强行覆盖 provider 原生命。
const CANONICAL_ALIASES_FALLBACK: Record<string, string> = {
  aspect_ratio: 'aspectRatio',
  ratio: 'aspectRatio',
  duration: 'durationSeconds',
  output_format: 'outputFormat',
  response_format: 'responseFormat',
  generate_audio: 'generateAudio',
  return_last_frame: 'returnLastFrame',
  search_enabled: 'searchEnabled',
  enable_search: 'searchEnabled',
  negative_prompt: 'negativePrompt',
  edit_strength: 'editStrength',
}

export function compileMediaRequest(input: CompileMediaRequestInput): CompileMediaRequestResult {
  const mode = input.mode ?? 'adapter'
  const rawParams = removeBlankParams(input.input.modelParams ?? {})
  if (isSynthesizedCustomManifest(input.manifest)) {
    const providerParams = { ...rawParams }
    const droppedParams: MediaDroppedParam[] = []
    if (Object.prototype.hasOwnProperty.call(providerParams, 'filename')) {
      droppedParams.push({
        name: 'filename',
        providerName: 'filename',
        valuePreview: String(providerParams.filename).slice(0, 80),
        reason: 'local_only',
      })
      delete providerParams.filename
    }
    return {
      canonicalParams: { ...rawParams },
      providerParams,
      droppedParams,
      warnings: [],
      validationIssues: [],
    }
  }
  const issues: MediaContractIssue[] = []
  const warnings: MediaContractWarning[] = []
  const dropped: MediaDroppedParam[] = []

  const canonicalFromRaw = normalizeCanonicalParams(rawParams)
  const defaults = mergeDefaults(input.providerDefaults, input.capability.defaults)
  const merged = { ...defaults, ...canonicalFromRaw }

  const schema = input.capability.paramSchema
  const { validated, dropped: schemaDropped, issues: schemaIssues } = validateAgainstParamSchema(
    merged,
    schema,
    input.capability.id,
    input.skipParameterValidation === true,
  )
  dropped.push(...schemaDropped)
  issues.push(...schemaIssues)

  const policy = resolveParamPolicy(input.capability)
  if (!input.capability.paramPolicy && policy.strict === false) {
    warnings.push({
      code: 'missing_param_policy',
      message: '当前模型未声明 paramPolicy，自动按 additionalProperties 进入兼容透传，可能被 provider 拒绝未知字段',
    })
  }

  const { params: transformed, dropped: transformDropped } = applyPolicyTransforms(
    validated,
    policy.transforms,
    input.input.inputFiles ?? [],
    input.capability.id,
  )
  dropped.push(...transformDropped)

  const { params: conflictResolved, dropped: conflictDropped, issues: conflictIssues } =
    input.skipParameterValidation
      ? { params: transformed, dropped: [], issues: [] }
      : resolveConflicts(transformed, policy.conflicts, input.capability.id)
  dropped.push(...conflictDropped)
  issues.push(...conflictIssues)

  // 关键顺序：filter 在 canonical 空间做，避免 provider 字段反查；最后再做 aliases 映射。
  const filtered = input.skipParameterValidation
    ? { params: conflictResolved, dropped: [], issues: [], warnings: [] }
    : filterCanonicalParams(
        conflictResolved,
        policy,
        schema,
        mode,
        input.capability.id,
      )
  dropped.push(...filtered.dropped)
  issues.push(...filtered.issues)
  for (const w of filtered.warnings) warnings.push(w)

  const canonicalParams = { ...filtered.params }
  const providerParams = toProviderParams(filtered.params, policy, input.capability.aliases)

  return {
    canonicalParams,
    providerParams,
    droppedParams: dedupeDropped(dropped),
    warnings,
    validationIssues: issues,
  }
}

// ─── 内部 helper ──────────────────────────────────────────────────────────
function removeBlankParams(params: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue
    if (typeof value === 'string' && value.trim().length === 0) continue
    next[key] = value
  }
  return next
}

function normalizeCanonicalParams(params: Record<string, unknown>): Record<string, unknown> {
  const next: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(params)) {
    next[CANONICAL_ALIASES_FALLBACK[key] ?? key] = value
  }
  return next
}

function mergeDefaults(
  providerDefaults: Record<string, unknown> | undefined,
  capabilityDefaults: Record<string, unknown> | undefined,
): Record<string, unknown> {
  return { ...(providerDefaults ?? {}), ...(capabilityDefaults ?? {}) }
}

function validateAgainstParamSchema(
  params: Record<string, unknown>,
  schema: Record<string, unknown>,
  capabilityId: string,
  keepInvalid = false,
): {
  validated: Record<string, unknown>
  dropped: MediaDroppedParam[]
  issues: MediaContractIssue[]
} {
  const properties = isPlainRecord(schema.properties) ? schema.properties : {}
  // 仅对 schema 中已声明的字段做类型/枚举/范围校验。
  // 未声明字段在这里保留透传，由 filterCanonicalParams 按 strict/passthrough/forbidden
  // 决定是否丢弃，避免在 validate 阶段就过早裁剪导致 filename / allow 字段丢失。
  const validated: Record<string, unknown> = {}
  const dropped: MediaDroppedParam[] = []
  const issues: MediaContractIssue[] = []

  for (const [key, value] of Object.entries(params)) {
    const propSchema = properties[key]
    if (!propSchema || !isPlainRecord(propSchema)) {
      validated[key] = value
      continue
    }
    const result = coerceParamValue(value, propSchema)
    const issue = validateParamValue(result.value, propSchema, key, capabilityId)
    if (issue) {
      issues.push(issue)
      if (keepInvalid) validated[key] = result.value
      continue
    }
    validated[key] = result.value
  }
  return { validated, dropped, issues }
}

function coerceParamValue(
  value: unknown,
  schema: Record<string, unknown>,
): { value: unknown; coerced: boolean } {
  const type = schema.type
  const allowedTypes = Array.isArray(type)
    ? type.filter((item): item is string => typeof item === 'string')
    : typeof type === 'string'
      ? [type]
      : []
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (allowedTypes.includes('integer') || allowedTypes.includes('number')) {
      const numeric = Number(trimmed)
      if (trimmed.length > 0 && Number.isFinite(numeric)) return { value: numeric, coerced: true }
    }
    if (allowedTypes.includes('boolean')) {
      if (trimmed.toLowerCase() === 'true') return { value: true, coerced: true }
      if (trimmed.toLowerCase() === 'false') return { value: false, coerced: true }
    }
  }
  return { value, coerced: false }
}

function validateParamValue(
  value: unknown,
  schema: Record<string, unknown>,
  key: string,
  capabilityId: string,
): MediaContractIssue | undefined {
  const type = schema.type
  const allowedTypes = Array.isArray(type)
    ? type.filter((item): item is string => typeof item === 'string')
    : typeof type === 'string'
      ? [type]
      : []
  if (allowedTypes.length > 0 && !allowedTypes.some((item) => matchesSchemaType(value, item))) {
    return {
      severity: 'error',
      code: 'invalid_type',
      message: `Invalid parameter "${key}" for ${capabilityId}: expected type ${allowedTypes.join('|')}`,
      path: [key],
    }
  }
  const enumValues = Array.isArray(schema.enum) ? schema.enum : []
  const allowCustom = schema['x-allow-custom'] === true
  if (enumValues.length > 0 && !allowCustom && !enumValues.some((item) => Object.is(item, value))) {
    return {
      severity: 'error',
      code: 'invalid_enum',
      message: `Invalid parameter "${key}" for ${capabilityId}: expected one of ${enumValues.map(String).join(', ')}`,
      path: [key],
    }
  }
  if (typeof value === 'number') {
    const minimum = typeof schema.minimum === 'number' ? schema.minimum : undefined
    const maximum = typeof schema.maximum === 'number' ? schema.maximum : undefined
    const exclusiveMinimum = typeof schema.exclusiveMinimum === 'number' ? schema.exclusiveMinimum : undefined
    const exclusiveMaximum = typeof schema.exclusiveMaximum === 'number' ? schema.exclusiveMaximum : undefined
    if (minimum !== undefined && value < minimum)
      return outOfRangeIssue(key, capabilityId, `must be >= ${minimum}`)
    if (maximum !== undefined && value > maximum)
      return outOfRangeIssue(key, capabilityId, `must be <= ${maximum}`)
    if (exclusiveMinimum !== undefined && value <= exclusiveMinimum)
      return outOfRangeIssue(key, capabilityId, `must be > ${exclusiveMinimum}`)
    if (exclusiveMaximum !== undefined && value >= exclusiveMaximum)
      return outOfRangeIssue(key, capabilityId, `must be < ${exclusiveMaximum}`)
  }
  if (typeof value === 'string') {
    const minLength = typeof schema.minLength === 'number' ? schema.minLength : undefined
    const maxLength = typeof schema.maxLength === 'number' ? schema.maxLength : undefined
    if (minLength !== undefined && value.length < minLength)
      return outOfRangeIssue(key, capabilityId, `length must be >= ${minLength}`)
    if (maxLength !== undefined && value.length > maxLength)
      return outOfRangeIssue(key, capabilityId, `length must be <= ${maxLength}`)
  }
  return undefined
}

function outOfRangeIssue(key: string, capabilityId: string, reason: string): MediaContractIssue {
  return {
    severity: 'error',
    code: 'out_of_range',
    message: `Invalid parameter "${key}" for ${capabilityId}: ${reason}`,
    path: [key],
  }
}

function matchesSchemaType(value: unknown, type: string): boolean {
  if (type === 'integer') return typeof value === 'number' && Number.isInteger(value)
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value)
  if (type === 'string') return typeof value === 'string'
  if (type === 'boolean') return typeof value === 'boolean'
  if (type === 'array') return Array.isArray(value)
  if (type === 'object') return isPlainRecord(value)
  if (type === 'null') return value === null
  return true
}

function resolveParamPolicy(capability: MediaModelCapabilityManifest): MediaModelParamPolicy {
  if (capability.paramPolicy) return capability.paramPolicy
  // 兼容旧 manifest：additionalProperties:false 视为 strict:true。
  const schema = capability.paramSchema
  if (isPlainRecord(schema) && schema.additionalProperties === false) {
    return { strict: true, passthrough: { enabled: false } }
  }
  return { strict: false, passthrough: { enabled: true } }
}

function applyPolicyTransforms(
  params: Record<string, unknown>,
  transforms: MediaParamTransformRule[] | undefined,
  inputFiles: CompilerInputFile[],
  capabilityId: string,
): { params: Record<string, unknown>; dropped: MediaDroppedParam[] } {
  if (!transforms || transforms.length === 0) return { params, dropped: [] }
  const next = { ...params }
  const dropped: MediaDroppedParam[] = []
  for (const rule of transforms) {
    if (rule.kind === 'rename') {
      if (rule.from in next) {
        const value = next[rule.from]
        delete next[rule.from]
        next[rule.to] = value
      }
      continue
    }
    if (rule.kind === 'map_value') {
      const current = next[rule.field]
      if (typeof current === 'string' && current in rule.values) {
        next[rule.field] = rule.values[current]
      }
      continue
    }
    if (rule.kind === 'ratio_size_to_aspect') {
      const size = next[rule.from]
      if (typeof size === 'string' && /^\d+:\d+$/.test(size) && !(rule.to in next)) {
        next[rule.to] = size
        delete next[rule.from]
      }
      continue
    }
    if (rule.kind === 'drop_when_input_kind') {
      const matched = inputFiles.some((file) => rule.inputKinds.includes(file.type) || rule.inputKinds.includes(file.role ?? ''))
      if (matched && rule.field in next) {
        const value = next[rule.field]
        delete next[rule.field]
        dropped.push({
          name: rule.field,
          valuePreview: previewValue(value),
          reason: 'forbidden_by_contract',
        })
      }
      continue
    }
  }
  // 标记 capabilityId 用于未来调试（当前不直接使用）。
  void capabilityId
  return { params: next, dropped }
}

function resolveConflicts(
  params: Record<string, unknown>,
  conflicts: MediaParamConflictRule[] | undefined,
  capabilityId: string,
): {
  params: Record<string, unknown>
  dropped: MediaDroppedParam[]
  issues: MediaContractIssue[]
} {
  if (!conflicts || conflicts.length === 0) {
    return { params, dropped: [], issues: [] }
  }
  const next = { ...params }
  const dropped: MediaDroppedParam[] = []
  const issues: MediaContractIssue[] = []
  for (const rule of conflicts) {
    const present = rule.fields.filter((field) => field in next)
    if (present.length < 2) continue
    if (rule.strategy === 'error') {
      issues.push({
        severity: 'error',
        code: 'conflicting_params',
        message: `Invalid parameters for ${capabilityId}: ${present.join(', ')} 互斥`,
        path: present,
      })
      continue
    }
    const keep = rule.strategy === 'prefer_first' ? present[0] : present[present.length - 1]
    if (!keep) continue
    for (const field of present) {
      if (field === keep) continue
      const value = next[field]
      delete next[field]
      dropped.push({
        name: field,
        valuePreview: previewValue(value),
        reason: 'conflict_removed',
      })
    }
  }
  return { params: next, dropped, issues }
}

function toProviderParams(
  canonical: Record<string, unknown>,
  policy: MediaModelParamPolicy,
  capabilityAliases: Record<string, string> | undefined,
): Record<string, unknown> {
  const aliases: Record<string, string> = { ...(capabilityAliases ?? {}), ...(policy.aliases ?? {}) }
  const providerParams: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(canonical)) {
    const providerKey = aliases[key] ?? key
    providerParams[providerKey] = value
  }
  return providerParams
}

function filterCanonicalParams(
  canonical: Record<string, unknown>,
  policy: MediaModelParamPolicy,
  schema: Record<string, unknown>,
  mode: 'canvas' | 'mcp' | 'adapter',
  capabilityId: string,
): {
  params: Record<string, unknown>
  dropped: MediaDroppedParam[]
  issues: MediaContractIssue[]
  warnings: MediaContractWarning[]
} {
  const properties = isPlainRecord(schema.properties) ? schema.properties : {}
  const declared = new Set(Object.keys(properties))
  const allowSet = new Set(policy.passthrough?.allow ?? [])
  const denySet = new Set(policy.passthrough?.deny ?? [])
  const strict = policy.strict === true
  const passthroughEnabled = !strict || (policy.passthrough?.enabled ?? false)
  const forbiddenEntries = policy.forbidden ?? []
  const forbiddenByName = new Map(forbiddenEntries.map((entry) => [entry.name, entry]))

  const next: Record<string, unknown> = {}
  const dropped: MediaDroppedParam[] = []
  const issues: MediaContractIssue[] = []
  const warnings: MediaContractWarning[] = []

  for (const [name, value] of Object.entries(canonical)) {
    if (LOCAL_ONLY_FIELDS.has(name)) {
      dropped.push({ name, valuePreview: previewValue(value), reason: 'local_only' })
      continue
    }

    const forbidden = forbiddenByName.get(name)
    if (forbidden) {
      // forbidden 在 adapter/mcp 模式直接报错；canvas 模式仅丢弃，不打断 UI。
      if (mode === 'adapter' || mode === 'mcp') {
        issues.push({
          severity: 'error',
          code: 'forbidden_param',
          message: `Invalid parameter "${name}" for ${capabilityId}: ${forbidden.reason}`,
          path: [name],
        })
      }
      dropped.push({ name, valuePreview: previewValue(value), reason: 'forbidden_by_contract' })
      continue
    }

    if (denySet.has(name)) {
      dropped.push({ name, valuePreview: previewValue(value), reason: 'unsafe_passthrough' })
      continue
    }

    if (declared.has(name)) {
      next[name] = value
      continue
    }

    if (allowSet.has(name)) {
      if (policy.passthrough?.allowScalarsOnly !== false && !isScalar(value)) {
        dropped.push({ name, valuePreview: previewValue(value), reason: 'unsafe_passthrough' })
        continue
      }
      next[name] = value
      warnings.push({
        code: 'compat_passthrough',
        message: `参数 ${name} 不在 schema 中，按 passthrough.allow 透传`,
        path: [name],
      })
      continue
    }

    if (passthroughEnabled && !strict) {
      if (policy.passthrough?.allowScalarsOnly !== false && !isScalar(value)) {
        dropped.push({ name, valuePreview: previewValue(value), reason: 'unsafe_passthrough' })
        continue
      }
      next[name] = value
      warnings.push({
        code: 'compat_passthrough',
        message: `参数 ${name} 不在 schema 中，按兼容透传放行（contract 未收紧）`,
        path: [name],
      })
      continue
    }

    dropped.push({ name, valuePreview: previewValue(value), reason: 'unsupported_by_model' })
  }

  return { params: next, dropped, issues, warnings }
}

function isScalar(value: unknown): boolean {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
}

function previewValue(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (typeof value === 'string') return value.length > 80 ? `${value.slice(0, 77)}...` : value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    const json = JSON.stringify(value)
    return json && json.length > 80 ? `${json.slice(0, 77)}...` : (json ?? undefined)
  } catch {
    return undefined
  }
}

function dedupeDropped(dropped: MediaDroppedParam[]): MediaDroppedParam[] {
  const seen = new Set<string>()
  const next: MediaDroppedParam[] = []
  for (const entry of dropped) {
    const key = `${entry.name}::${entry.reason}`
    if (seen.has(key)) continue
    seen.add(key)
    next.push(entry)
  }
  return next
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
