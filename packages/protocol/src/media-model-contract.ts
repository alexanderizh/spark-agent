/**
 * @module media-model-contract
 *
 * Media Model Contract V2 — 参数策略与错误归一类型。
 *
 * Manifest 不仅是能力清单，还要声明：
 *   - 哪些参数允许进入 provider 请求（paramPolicy）
 *   - canonical 字段如何映射到 provider 原生字段（aliases）
 *   - 字段值如何转换（transforms，枚举式，非表达式引擎）
 *   - 错误响应如何归一为内部 code（error contract）
 *
 * 该模块只定义类型与 Zod schema；编译器实现位于
 * `packages/agent-runtime/src/services/media/media-request-compiler.ts`，
 * 错误归一实现位于 `media-error-normalizer.ts`。
 */

import { z } from 'zod'

// ─── Canonical 标准参数语义 ───────────────────────────────────────────────
/**
 * 内部统一字段命名。Provider 原生写法（aspect_ratio / output_format 等）
 * 进入系统后，由 compiler 归一为这套 canonical 字段；aliases 再把 canonical
 * 字段映射到目标 provider 的原生字段名。
 */
export type CanonicalMediaParamName =
  | 'prompt'
  | 'negativePrompt'
  | 'size'
  | 'aspectRatio'
  | 'resolution'
  | 'durationSeconds'
  | 'fps'
  | 'n'
  | 'seed'
  | 'quality'
  | 'outputFormat'
  | 'responseFormat'
  | 'voice'
  | 'format'
  | 'speed'
  | 'editStrength'
  | 'watermark'
  | 'generateAudio'
  | 'returnLastFrame'
  | 'searchEnabled'
  | 'filename'

// ─── 参数策略 ──────────────────────────────────────────────────────────────
export interface MediaParamPassthroughPolicy {
  enabled: boolean
  /** 仅允许标量（string/number/boolean）；首期默认 true，避免透传大对象。 */
  allowScalarsOnly?: boolean | undefined
  /** 白名单：即使 schema 没声明也允许透传。聚合平台可显式列出可透传字段。 */
  allow?: string[] | undefined
  /** 黑名单：永远丢弃，即使 schema 声明过。 */
  deny?: string[] | undefined
}

export type MediaParamTransformRule =
  | { kind: 'rename'; from: string; to: string }
  | { kind: 'map_value'; field: string; values: Record<string, string> }
  | { kind: 'ratio_size_to_aspect'; from: 'size'; to: 'aspectRatio' }
  | { kind: 'drop_when_input_kind'; field: string; inputKinds: string[] }

export interface MediaParamForbiddenEntry {
  name: string
  reason: string
}

export interface MediaParamConflictRule {
  fields: string[]
  strategy: 'prefer_first' | 'prefer_last' | 'error'
}

export interface MediaParamConditionalRule {
  /** 简单条件枚举，未来可扩展。 */
  when: 'input_kind_is' | 'capability_is' | 'model_id_is'
  value: string
  action: 'drop' | 'require' | 'rename'
  field: string
  target?: string | undefined
}

export interface MediaModelParamPolicy {
  /**
   * true：只允许 schema.properties 与 passthrough.allow 中声明的参数。
   * false：兼容模式，允许额外参数，但仍执行 forbidden / 安全黑名单。
   */
  strict?: boolean | undefined
  passthrough?: MediaParamPassthroughPolicy | undefined
  /** Canonical 字段 -> provider 原生字段名；与 capability.aliases 互补。 */
  aliases?: Record<string, string> | undefined
  transforms?: MediaParamTransformRule[] | undefined
  forbidden?: MediaParamForbiddenEntry[] | undefined
  conflicts?: MediaParamConflictRule[] | undefined
  conditionals?: MediaParamConditionalRule[] | undefined
}

// ─── 错误归一 ──────────────────────────────────────────────────────────────
export type MediaNormalizedErrorCode =
  | 'unsupported_parameter'
  | 'invalid_parameter_value'
  | 'missing_required_input'
  | 'auth_failed'
  | 'quota_exceeded'
  | 'rate_limited'
  | 'content_policy_blocked'
  | 'task_failed'
  | 'task_timeout'
  | 'bad_provider_response'
  | 'artifact_download_failed'
  | 'provider_http_error'

export interface MediaErrorContract {
  /** Provider 错误响应中提取 code 的 JSON 路径，如 `error.code`。 */
  codePaths?: string[] | undefined
  /** Provider 错误响应中提取 message 的 JSON 路径。 */
  messagePaths?: string[] | undefined
  /** Provider 错误响应中提取 request id 的 JSON 路径。 */
  requestIdPaths?: string[] | undefined
  /** Provider 错误响应中提取参数名的 JSON 路径。 */
  paramNamePaths?: string[] | undefined
  /** 从 message 中正则抽取参数名（fallback）。 */
  paramNamePatterns?: string[] | undefined
  /** provider code -> 内部 code 映射。 */
  mappings?: Record<string, MediaNormalizedErrorCode> | undefined
  /** 即使 mappings 没命中，provider code 命中以下集合时也标记 retryable。 */
  retryableCodes?: string[] | undefined
}

// ─── 编译器输出 ────────────────────────────────────────────────────────────
export type MediaDroppedParamReason =
  | 'unsupported_by_model'
  | 'forbidden_by_contract'
  | 'conflict_removed'
  | 'blank_value'
  | 'unsafe_passthrough'
  | 'local_only'

export interface MediaDroppedParam {
  name: string
  providerName?: string | undefined
  valuePreview?: string | undefined
  reason: MediaDroppedParamReason
}

export type MediaContractWarningCode =
  | 'param_dropped'
  | 'compat_passthrough'
  | 'missing_param_policy'
  | 'coerced_value'

export interface MediaContractWarning {
  code: MediaContractWarningCode
  message: string
  path?: Array<string | number> | undefined
}

export type MediaContractIssueCode =
  | 'invalid_type'
  | 'invalid_enum'
  | 'out_of_range'
  | 'missing_required'
  | 'forbidden_param'
  | 'conflicting_params'

export interface MediaContractIssue {
  severity: 'error' | 'warning'
  code: MediaContractIssueCode
  message: string
  path: Array<string | number>
}

// ─── Zod schemas ───────────────────────────────────────────────────────────
const nonEmptyString = z.string().min(1).max(800)

export const MediaParamPassthroughPolicySchema: z.ZodType<MediaParamPassthroughPolicy> = z.object({
  enabled: z.boolean(),
  allowScalarsOnly: z.boolean().optional(),
  allow: z.array(nonEmptyString.max(120)).max(200).optional(),
  deny: z.array(nonEmptyString.max(120)).max(200).optional(),
})

export const MediaParamTransformRuleSchema: z.ZodType<MediaParamTransformRule> = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('rename'),
    from: nonEmptyString.max(120),
    to: nonEmptyString.max(120),
  }),
  z.object({
    kind: z.literal('map_value'),
    field: nonEmptyString.max(120),
    values: z.record(z.string(), z.string()),
  }),
  z.object({
    kind: z.literal('ratio_size_to_aspect'),
    from: z.literal('size'),
    to: z.literal('aspectRatio'),
  }),
  z.object({
    kind: z.literal('drop_when_input_kind'),
    field: nonEmptyString.max(120),
    inputKinds: z.array(nonEmptyString.max(60)).min(1).max(20),
  }),
])

export const MediaParamForbiddenEntrySchema: z.ZodType<MediaParamForbiddenEntry> = z.object({
  name: nonEmptyString.max(120),
  reason: nonEmptyString.max(400),
})

export const MediaParamConflictRuleSchema: z.ZodType<MediaParamConflictRule> = z.object({
  fields: z.array(nonEmptyString.max(120)).min(2).max(10),
  strategy: z.enum(['prefer_first', 'prefer_last', 'error']),
})

export const MediaParamConditionalRuleSchema: z.ZodType<MediaParamConditionalRule> = z.object({
  when: z.enum(['input_kind_is', 'capability_is', 'model_id_is']),
  value: nonEmptyString.max(120),
  action: z.enum(['drop', 'require', 'rename']),
  field: nonEmptyString.max(120),
  target: nonEmptyString.max(120).optional(),
})

export const MediaModelParamPolicySchema: z.ZodType<MediaModelParamPolicy> = z.object({
  strict: z.boolean().optional(),
  passthrough: MediaParamPassthroughPolicySchema.optional(),
  aliases: z.record(nonEmptyString.max(120), nonEmptyString.max(120)).optional(),
  transforms: z.array(MediaParamTransformRuleSchema).max(50).optional(),
  forbidden: z.array(MediaParamForbiddenEntrySchema).max(100).optional(),
  conflicts: z.array(MediaParamConflictRuleSchema).max(50).optional(),
  conditionals: z.array(MediaParamConditionalRuleSchema).max(50).optional(),
})

export const MediaNormalizedErrorCodeSchema: z.ZodType<MediaNormalizedErrorCode> = z.enum([
  'unsupported_parameter',
  'invalid_parameter_value',
  'missing_required_input',
  'auth_failed',
  'quota_exceeded',
  'rate_limited',
  'content_policy_blocked',
  'task_failed',
  'task_timeout',
  'bad_provider_response',
  'artifact_download_failed',
  'provider_http_error',
])

export const MediaErrorContractSchema: z.ZodType<MediaErrorContract> = z.object({
  codePaths: z.array(nonEmptyString.max(200)).max(20).optional(),
  messagePaths: z.array(nonEmptyString.max(200)).max(20).optional(),
  requestIdPaths: z.array(nonEmptyString.max(200)).max(20).optional(),
  paramNamePaths: z.array(nonEmptyString.max(200)).max(20).optional(),
  paramNamePatterns: z.array(nonEmptyString.max(200)).max(20).optional(),
  mappings: z.record(nonEmptyString.max(120), MediaNormalizedErrorCodeSchema).optional(),
  retryableCodes: z.array(nonEmptyString.max(120)).max(50).optional(),
})

export const MediaDroppedParamReasonSchema: z.ZodType<MediaDroppedParamReason> = z.enum([
  'unsupported_by_model',
  'forbidden_by_contract',
  'conflict_removed',
  'blank_value',
  'unsafe_passthrough',
  'local_only',
])

export const MediaDroppedParamSchema: z.ZodType<MediaDroppedParam> = z.object({
  name: nonEmptyString.max(120),
  providerName: nonEmptyString.max(120).optional(),
  valuePreview: z.string().max(200).optional(),
  reason: MediaDroppedParamReasonSchema,
})

export const MediaContractWarningCodeSchema: z.ZodType<MediaContractWarningCode> = z.enum([
  'param_dropped',
  'compat_passthrough',
  'missing_param_policy',
  'coerced_value',
])

export const MediaContractWarningSchema: z.ZodType<MediaContractWarning> = z.object({
  code: MediaContractWarningCodeSchema,
  message: nonEmptyString.max(400),
  path: z.array(z.union([z.string(), z.number()])).max(20).optional(),
})

export const MediaContractIssueCodeSchema: z.ZodType<MediaContractIssueCode> = z.enum([
  'invalid_type',
  'invalid_enum',
  'out_of_range',
  'missing_required',
  'forbidden_param',
  'conflicting_params',
])

export const MediaContractIssueSchema: z.ZodType<MediaContractIssue> = z.object({
  severity: z.enum(['error', 'warning']),
  code: MediaContractIssueCodeSchema,
  message: nonEmptyString.max(400),
  path: z.array(z.union([z.string(), z.number()])).max(20),
})
