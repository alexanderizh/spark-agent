/**
 * 低代码自定义工具平台协议（Custom Tools）
 *
 * 用户以「表单 + 声明式模板」创建 Agent 可用的工具。工具以受管 MCP 服务
 * （spark_custom_tools）形态同时供给 claude 与 codex 双引擎。
 *
 * 安全设计（与 docs/plans/2026-08-16-custom-tools-platform.md §3/§4 对齐）：
 * - 声明式 DSL，无自由脚本；模板占位符 `{{name}}` 只能引用 inputSchema 属性
 * - risk 只可上调不可低于类型下限（risk floor）
 * - 密钥只存 KeystoreRef，spec 内禁止出现疑似密钥明文
 * - risk/effect/idempotency 一致性规则对齐 plugin-sdk validateTool
 */

import { z } from 'zod'
import {
  RuntimeEffectSchema,
  RuntimeIdempotencySchema,
  RuntimeRiskSchema,
} from './plugin-runtime.js'
import type { RuntimeEffect, RuntimeIdempotency, RuntimeRisk } from './plugin-runtime.js'

export const CUSTOM_TOOLS_PROTOCOL_VERSION = 1

// ─── 基础词法 ────────────────────────────────────────────────────────────

/** slug 同时是 MCP tool name：小写字母开头，仅小写字母/数字/下划线 */
export const CUSTOM_TOOL_ID_REGEX = /^[a-z][a-z0-9_]{2,63}$/
export const CUSTOM_TOOL_DESCRIPTION_MIN = 10
export const CUSTOM_TOOL_TIMEOUT_MIN_MS = 1_000
export const CUSTOM_TOOL_TIMEOUT_MAX_MS = 300_000
export const CUSTOM_TOOL_TIMEOUT_DEFAULT_MS = 30_000
export const CUSTOM_TOOL_MAX_PARAMS = 32
/** 单次导入/导出的工具数上限 */
export const CUSTOM_TOOL_EXPORT_MAX = 100

const CustomToolIdSchema = z
  .string()
  .regex(CUSTOM_TOOL_ID_REGEX, '工具 ID 必须为小写字母开头的 slug')

// ─── 参数 JSON Schema（编辑器表单生成的最小子集，非手写）─────────────────

export const CustomToolParamTypeSchema = z.enum(['string', 'number', 'integer', 'boolean', 'array'])
export type CustomToolParamType = z.infer<typeof CustomToolParamTypeSchema>

const primitiveParamValue = z.union([z.string().max(2_000), z.number(), z.boolean()])

export const CustomToolParamSchema = z
  .object({
    type: CustomToolParamTypeSchema,
    title: z.string().max(120).optional(),
    description: z.string().max(1_000).optional(),
    default: z.union([primitiveParamValue, z.array(primitiveParamValue).max(50)]).optional(),
    enum: z
      .array(z.union([z.string().max(200), z.number()]))
      .min(1)
      .max(50)
      .optional(),
    /** 仅 array 类型使用；元素限原始类型（不支持嵌套对象） */
    items: z
      .object({ type: z.enum(['string', 'number', 'integer', 'boolean']) })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((param, ctx) => {
    if (param.type === 'array' && param.items == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['items'],
        message: '数组参数必须声明 items 元素类型',
      })
    }
    if (param.type !== 'array' && param.items != null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['items'],
        message: '仅数组参数可声明 items',
      })
    }
    if (param.enum != null) {
      if (param.type === 'array' || param.type === 'boolean') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['enum'],
          message: '仅 string/number/integer 参数支持枚举',
        })
        return
      }
      const expectNumber = param.type === 'number' || param.type === 'integer'
      for (const [index, value] of param.enum.entries()) {
        if (typeof value === 'number' && !expectNumber) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['enum', index],
            message: '枚举值类型与参数类型不一致',
          })
        }
        if (typeof value === 'string' && expectNumber) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['enum', index],
            message: '枚举值类型与参数类型不一致',
          })
        }
        if (param.type === 'integer' && typeof value === 'number' && !Number.isInteger(value)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['enum', index],
            message: 'integer 参数的枚举值必须为整数',
          })
        }
      }
    }
  })
export type CustomToolParam = z.infer<typeof CustomToolParamSchema>

export const CustomToolInputSchemaSchema = z
  .object({
    type: z.literal('object'),
    properties: z.record(z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/), CustomToolParamSchema),
    required: z.array(z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/)).optional(),
  })
  .strict()
  .superRefine((schema, ctx) => {
    const names = Object.keys(schema.properties)
    if (names.length > CUSTOM_TOOL_MAX_PARAMS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['properties'],
        message: `参数数量超过上限 ${CUSTOM_TOOL_MAX_PARAMS}`,
      })
    }
    if (schema.required != null) {
      if (schema.required.length > CUSTOM_TOOL_MAX_PARAMS) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['required'],
          message: 'required 列表超过上限',
        })
      }
      for (const [index, name] of schema.required.entries()) {
        if (!(name in schema.properties)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['required', index],
            message: `required 引用了未声明的参数: ${name}`,
          })
        }
      }
    }
  })
export type CustomToolInputSchema = z.infer<typeof CustomToolInputSchemaSchema>

// ─── 模板占位符 ──────────────────────────────────────────────────────────

const PLACEHOLDER_REGEX = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g

/** 提取模板中全部合法占位符名 */
export function extractTemplatePlaceholders(template: string): string[] {
  const names: string[] = []
  for (const match of template.matchAll(PLACEHOLDER_REGEX)) {
    const name = match[1]
    if (name != null) names.push(name)
  }
  return names
}

/**
 * 校验模板占位符合法性：
 * - 不允许未闭合/嵌套花括号（剥掉合法占位符后不得残留 {{ 或 }}）
 * - 每个占位符必须引用 inputSchema 已声明的参数
 */
export function validateTemplatePlaceholders(
  template: string,
  inputSchema: CustomToolInputSchema,
  fieldPath: string,
  ctx: z.RefinementCtx,
): void {
  const stripped = template.replace(PLACEHOLDER_REGEX, '')
  if (stripped.includes('{{') || stripped.includes('}}')) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [fieldPath],
      message: `${fieldPath} 存在未闭合或非法的占位符（仅支持 {{参数名}}）`,
    })
    return
  }
  for (const name of extractTemplatePlaceholders(template)) {
    if (!(name in inputSchema.properties)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [fieldPath],
        message: `${fieldPath} 引用了未声明的参数: {{${name}}}`,
      })
    }
  }
}

/** 提取 SQL 模板中的命名参数（:name），不含 :: 前缀场景 */
export function extractSqlNamedParams(sqlTemplate: string): string[] {
  const names: string[] = []
  for (const match of sqlTemplate.matchAll(/(?<![:\w]):([a-zA-Z_][a-zA-Z0-9_]*)/g)) {
    const name = match[1]
    if (name != null) names.push(name)
  }
  return names
}

// ─── JSON body 模板：上下文感知扫描（区分字符串内外占位符）──────────────

/** JSON 字符串内合法的可见哨兵字符（Object Replacement Character） */
const JSON_SENTINEL_CHAR = '￼'
const JSON_SENTINEL_REGEX = /￼ctph(\d+)￼/g
const JSON_PLACEHOLDER_NAME_REGEX = /^[a-zA-Z_][a-zA-Z0-9_]*$/

export type CustomToolTemplateErrorKind = 'INVALID_TEMPLATE' | 'INVALID_INPUT' | 'MISSING_PARAM'

/** 模板渲染错误（协议层无业务错误依赖；执行器按 kind 映射为自身错误码） */
export class CustomToolTemplateError extends Error {
  readonly kind: CustomToolTemplateErrorKind

  constructor(kind: CustomToolTemplateErrorKind, message: string) {
    super(message)
    this.name = 'CustomToolTemplateError'
    this.kind = kind
  }
}

/**
 * 扫描 JSON 模板并按占位符所处上下文打哨兵标记：
 * - 值位置（字符串外）：替换为带引号的哨兵字符串（保持 JSON 合法）
 * - 字符串内：替换为裸哨兵字符（JSON 字符串合法字符）
 * 返回标记后的 JSON 文本与按出现顺序记录的占位符参数名。
 */
function scanAndMarkJsonTemplate(template: string): { marked: string; names: string[] } {
  const names: string[] = []
  let marked = ''
  let inString = false
  let escaped = false
  let cursor = 0

  const readPlaceholder = (start: number): { name: string; end: number } => {
    const closeIndex = template.indexOf('}}', start + 2)
    if (closeIndex < 0) {
      throw new CustomToolTemplateError('INVALID_TEMPLATE', 'JSON 模板存在未闭合的 {{ 占位符')
    }
    const name = template.slice(start + 2, closeIndex).trim()
    if (!JSON_PLACEHOLDER_NAME_REGEX.test(name)) {
      throw new CustomToolTemplateError('INVALID_TEMPLATE', `JSON 模板占位符不合法：{{${name}}}`)
    }
    return { name, end: closeIndex + 2 }
  }

  while (cursor < template.length) {
    const char = template[cursor]
    if (!inString) {
      if (char === '"') {
        inString = true
        marked += char
        cursor += 1
        continue
      }
      if (char === '{' && template[cursor + 1] === '{') {
        const { name, end } = readPlaceholder(cursor)
        names.push(name)
        marked += `"${JSON_SENTINEL_CHAR}ctph${names.length - 1}${JSON_SENTINEL_CHAR}"`
        cursor = end
        continue
      }
      marked += char ?? ''
      cursor += 1
      continue
    }
    // 字符串内部
    if (escaped) {
      marked += char ?? ''
      escaped = false
      cursor += 1
      continue
    }
    if (char === '\\') {
      escaped = true
      marked += char ?? ''
      cursor += 1
      continue
    }
    if (char === '"') {
      inString = false
      marked += char ?? ''
      cursor += 1
      continue
    }
    if (char === '{' && template[cursor + 1] === '{') {
      const { name, end } = readPlaceholder(cursor)
      names.push(name)
      marked += `${JSON_SENTINEL_CHAR}ctph${names.length - 1}${JSON_SENTINEL_CHAR}`
      cursor = end
      continue
    }
    marked += char ?? ''
    cursor += 1
  }
  return { marked, names }
}

/** 保存期结构校验：模板打标记后必须可解析为 JSON */
export function assertJsonTemplateStructure(template: string): void {
  let marked: string
  try {
    ;({ marked } = scanAndMarkJsonTemplate(template))
  } catch (error) {
    if (error instanceof CustomToolTemplateError) throw error
    throw error
  }
  try {
    JSON.parse(marked)
  } catch {
    throw new CustomToolTemplateError('INVALID_TEMPLATE', 'JSON body 模板不是合法的 JSON 结构')
  }
}

function templateValueToString(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

/**
 * 执行期渲染（parse-based，结构性注入在解析层死亡）：
 * 1. 上下文感知打标记 → JSON.parse 校验结构
 * 2. 遍历解析树回填：值位置占位符保留原始类型；字符串内嵌占位符按字符串转义
 * 3. 重新序列化输出
 */
export function renderJsonBodyTemplate(template: string, input: Record<string, unknown>): string {
  const { marked, names } = scanAndMarkJsonTemplate(template)
  let parsed: unknown
  try {
    parsed = JSON.parse(marked)
  } catch {
    throw new CustomToolTemplateError('INVALID_TEMPLATE', 'JSON body 模板不是合法的 JSON 结构')
  }

  const resolveName = (indexText: string): string => {
    const name = names[Number(indexText)]
    if (name == null) {
      throw new CustomToolTemplateError('INVALID_TEMPLATE', 'JSON 模板哨兵解析异常')
    }
    return name
  }
  const requireValue = (name: string): unknown => {
    const value = input[name]
    if (value == null) {
      throw new CustomToolTemplateError('MISSING_PARAM', `模板引用了参数 ${name}，但调用输入未提供`)
    }
    return value
  }

  const fill = (node: unknown): unknown => {
    if (typeof node === 'string') {
      const exact = node.match(/^￼ctph(\d+)￼$/)
      if (exact != null && exact[1] != null) {
        return requireValue(resolveName(exact[1]))
      }
      if (node.includes(JSON_SENTINEL_CHAR)) {
        return node.replace(JSON_SENTINEL_REGEX, (_match, indexText: string) =>
          templateValueToString(requireValue(resolveName(indexText))),
        )
      }
      return node
    }
    if (Array.isArray(node)) return node.map(fill)
    if (node != null && typeof node === 'object') {
      const result: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        result[key] = fill(value)
      }
      return result
    }
    return node
  }

  return JSON.stringify(fill(parsed))
}

// ─── 密钥安全嗅探 ────────────────────────────────────────────────────────

/** 与 plugin-runtime/runtime-broker.ts 的 SENSITIVE_METADATA_KEY 对齐 */
export const CUSTOM_TOOL_SENSITIVE_FIELD_REGEX =
  /(?:^|[_-])(access[_-]?token|refresh[_-]?token|token|secret|password|authorization|cookie|credential|api[_-]?key|private[_-]?key)(?:$|[_-])/i

/** 常见密钥明文形态：spec 模板中出现即拒绝（必须走 secretRefs） */
const LITERAL_SECRET_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{16,}/, // OpenAI 系
  /\bAKIA[0-9A-Z]{16}\b/, // AWS access key id
  /\bghp_[A-Za-z0-9]{20,}\b/, // GitHub PAT
  /\bgho_[A-Za-z0-9]{20,}\b/, // GitHub OAuth
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/, // Slack
  /\bbearer\s+[A-Za-z0-9._~+/-]{20,}={0,2}/i, // 硬编码 bearer
  /-----BEGIN[A-Z ]*PRIVATE KEY-----/, // PEM 私钥
]

export function containsLiteralSecret(text: string): boolean {
  return LITERAL_SECRET_PATTERNS.some((pattern) => pattern.test(text))
}

// ─── 类型专属 spec ───────────────────────────────────────────────────────

export const HTTP_TOOL_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const
export const HttpMethodSchema = z.enum(HTTP_TOOL_METHODS)
export type HttpMethod = z.infer<typeof HttpMethodSchema>

export const HttpHeaderSchema = z
  .object({
    name: z.string().min(1).max(128),
    valueTemplate: z.string().max(2_000).optional(),
    secretRef: z
      .string()
      .regex(/^[A-Za-z0-9_-]{1,64}$/)
      .optional(),
  })
  .strict()
  .superRefine((header, ctx) => {
    const sensitive = CUSTOM_TOOL_SENSITIVE_FIELD_REGEX.test(header.name)
    if (sensitive) {
      if (header.valueTemplate != null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['valueTemplate'],
          message: `敏感请求头 ${header.name} 必须通过密钥库（secretRef）提供，禁止明文模板`,
        })
      }
      if (header.secretRef == null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['secretRef'],
          message: `敏感请求头 ${header.name} 必须绑定 secretRef`,
        })
      }
      return
    }
    if (header.valueTemplate == null && header.secretRef == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `请求头 ${header.name} 必须提供 valueTemplate 或 secretRef 之一`,
      })
    }
    if (header.valueTemplate != null && header.secretRef != null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `请求头 ${header.name} 的 valueTemplate 与 secretRef 只能二选一`,
      })
    }
  })
export type HttpHeader = z.infer<typeof HttpHeaderSchema>

export const HttpToolSpecSchema = z
  .object({
    request: z
      .object({
        method: HttpMethodSchema,
        urlTemplate: z
          .string()
          .min(1)
          .max(2_000)
          .refine((url) => /^https?:\/\//i.test(url), 'URL 必须以 http:// 或 https:// 开头'),
        headers: z.array(HttpHeaderSchema).max(32).optional(),
        body: z
          .object({
            mode: z.literal('json'),
            jsonTemplate: z.string().min(1).max(100_000),
          })
          .strict()
          .optional(),
      })
      .strict(),
    response: z
      .object({
        format: z.enum(['markdown-table', 'json', 'text']),
        extract: z
          .array(
            z
              .object({
                label: z.string().min(1).max(120),
                jsonPath: z.string().min(1).max(500),
              })
              .strict(),
          )
          .max(32)
          .optional(),
        maxSizeBytes: z.number().int().min(1).max(1_048_576).optional(),
      })
      .strict(),
    /** 内网 API 是核心场景，默认 true；详情页常显徽标 */
    allowPrivateNetwork: z.boolean().optional(),
  })
  .strict()
  .superRefine((spec, ctx) => {
    const jsonTemplate = spec.request.body?.jsonTemplate
    if (jsonTemplate == null) return
    try {
      assertJsonTemplateStructure(jsonTemplate)
    } catch (error) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['request', 'body', 'jsonTemplate'],
        message:
          error instanceof CustomToolTemplateError ? error.message : 'JSON body 模板结构不合法',
      })
    }
  })
export type HttpToolSpec = z.infer<typeof HttpToolSpecSchema>

export const SqlToolSpecSchema = z
  .object({
    connection: z
      .object({
        kind: z.literal('sqlite'),
        databasePath: z.string().min(1).max(1_000),
      })
      .strict(),
    mode: z.enum(['readonly', 'readwrite']),
    sqlTemplate: z.string().min(1).max(20_000),
    limits: z
      .object({
        maxRows: z.number().int().min(1).max(5_000).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
export type SqlToolSpec = z.infer<typeof SqlToolSpecSchema>

export const CommandToolSpecSchema = z
  .object({
    exec: z
      .object({
        /** 运行时名（python/node）或白名单内的脚本绝对路径 */
        command: z.string().min(1).max(500),
        argsTemplate: z.array(z.string().max(2_000)).max(64),
        cwdMode: z.enum(['workspace-root', 'tool-assets']),
        envAllowlist: z.array(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/)).max(32),
      })
      .strict(),
    safety: z
      .object({
        maxOutputBytes: z.number().int().min(1).max(10_485_760).optional(),
        killGraceMs: z.number().int().min(500).max(30_000).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
export type CommandToolSpec = z.infer<typeof CommandToolSpecSchema>

export const PromptToolSpecSchema = z
  .object({
    promptTemplate: z.string().min(1).max(50_000),
  })
  .strict()
export type PromptToolSpec = z.infer<typeof PromptToolSpecSchema>

// ─── risk floor ─────────────────────────────────────────────────────────

export const RISK_ORDER: Record<RuntimeRisk, number> = {
  read: 0,
  'low-write': 1,
  'high-write': 2,
  destructive: 3,
}

export function riskAtLeast(risk: RuntimeRisk, floor: RuntimeRisk): boolean {
  return RISK_ORDER[risk] >= RISK_ORDER[floor]
}

/** HTTP 方法的 risk 下限：GET→read；POST/PUT/PATCH→low-write；DELETE→destructive */
export function httpMethodRiskFloor(method: HttpMethod): RuntimeRisk {
  if (method === 'GET') return 'read'
  if (method === 'DELETE') return 'destructive'
  return 'low-write'
}

export type CustomToolType = 'http' | 'sql' | 'command' | 'prompt'

// ─── 工具 DSL（用户提交的完整声明）──────────────────────────────────────

const CustomToolSecretRefsSchema = z
  .record(z.string().regex(/^[A-Za-z0-9_-]{1,64}$/), z.string().min(1).max(512))
  .refine((refs) => Object.keys(refs).length <= 16, '密钥引用数量超过上限 16')

const customToolBaseShape = {
  id: CustomToolIdSchema,
  title: z.string().min(1).max(160),
  description: z
    .string()
    .min(
      CUSTOM_TOOL_DESCRIPTION_MIN,
      `工具说明至少 ${CUSTOM_TOOL_DESCRIPTION_MIN} 个字符（给 Agent 看的，写清何时使用）`,
    )
    .max(4_000),
  inputSchema: CustomToolInputSchemaSchema,
  risk: RuntimeRiskSchema,
  effect: RuntimeEffectSchema,
  idempotency: RuntimeIdempotencySchema,
  timeoutMs: z.number().int().min(CUSTOM_TOOL_TIMEOUT_MIN_MS).max(CUSTOM_TOOL_TIMEOUT_MAX_MS),
  secretRefs: CustomToolSecretRefsSchema.optional(),
}

function templateTextsOf(type: CustomToolType, spec: unknown): string[] {
  if (type === 'http') {
    const http = spec as HttpToolSpec
    const texts = [http.request.urlTemplate]
    for (const header of http.request.headers ?? []) {
      if (header.valueTemplate != null) texts.push(header.valueTemplate)
    }
    if (http.request.body != null) texts.push(http.request.body.jsonTemplate)
    return texts
  }
  if (type === 'sql') return [(spec as SqlToolSpec).sqlTemplate]
  if (type === 'command') return [...(spec as CommandToolSpec).exec.argsTemplate]
  return [(spec as PromptToolSpec).promptTemplate]
}

function refineCustomToolDraft(
  draft: {
    type: CustomToolType
    inputSchema: CustomToolInputSchema
    risk: RuntimeRisk
    effect: RuntimeEffect
    idempotency: RuntimeIdempotency
    secretRefs?: Record<string, string> | undefined
    spec: unknown
  },
  ctx: z.RefinementCtx,
): void {
  const { type, inputSchema, risk, effect, idempotency, secretRefs, spec } = draft

  // 1. risk/effect/idempotency 一致性（对齐 plugin-sdk validateTool）
  if (risk === 'read' && effect !== 'read') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['effect'],
      message: 'read 风险的工具 effect 必须为 read',
    })
  }
  if (risk === 'destructive' && idempotency !== 'unsafe') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['idempotency'],
      message: 'destructive 风险的工具 idempotency 必须为 unsafe',
    })
  }

  // 2. risk floor（只可上调不可低于类型下限）
  const floor: RuntimeRisk =
    type === 'http'
      ? httpMethodRiskFloor((spec as HttpToolSpec).request.method)
      : type === 'sql'
        ? (spec as SqlToolSpec).mode === 'readonly'
          ? 'read'
          : 'high-write'
        : type === 'command'
          ? 'low-write'
          : 'read'
  if (!riskAtLeast(risk, floor)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['risk'],
      message: `该类型工具的 risk 不可低于 ${floor}（可上调）`,
    })
  }
  if (type === 'prompt' && (risk !== 'read' || effect !== 'read')) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['risk'],
      message: '提示词工具无副作用，risk/effect 固定为 read',
    })
  }

  // 3. 模板占位符必须引用已声明参数
  const templates = templateTextsOf(type, spec)
  for (const [index, template] of templates.entries()) {
    if (type === 'sql') {
      for (const name of extractSqlNamedParams(template)) {
        if (!(name in inputSchema.properties)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['spec', 'sqlTemplate'],
            message: `SQL 命名参数 :${name} 未在输入参数中声明`,
          })
        }
      }
    } else {
      validateTemplatePlaceholders(template, inputSchema, `spec.template[${index}]`, ctx)
    }
  }

  // 4. spec 内禁止疑似密钥明文
  for (const [index, template] of templates.entries()) {
    if (containsLiteralSecret(template)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['spec', `template[${index}]`],
        message: '模板中检测到疑似密钥明文，请改用密钥库（secretRefs）存储',
      })
    }
  }

  // 5. secretRefs 引用的名称必须被 spec 实际使用（http header secretRef）
  if (secretRefs != null && type === 'http') {
    const used = new Set(
      ((spec as HttpToolSpec).request.headers ?? [])
        .map((header) => header.secretRef)
        .filter((ref): ref is string => ref != null),
    )
    for (const name of Object.keys(secretRefs)) {
      if (!used.has(name)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['secretRefs', name],
          message: `密钥 ${name} 未被任何请求头引用`,
        })
      }
    }
  }
}

export const CustomToolHttpDraftSchema = z
  .object({ ...customToolBaseShape, type: z.literal('http'), spec: HttpToolSpecSchema })
  .strict()
export const CustomToolSqlDraftSchema = z
  .object({ ...customToolBaseShape, type: z.literal('sql'), spec: SqlToolSpecSchema })
  .strict()
export const CustomToolCommandDraftSchema = z
  .object({ ...customToolBaseShape, type: z.literal('command'), spec: CommandToolSpecSchema })
  .strict()
export const CustomToolPromptDraftSchema = z
  .object({ ...customToolBaseShape, type: z.literal('prompt'), spec: PromptToolSpecSchema })
  .strict()

export const CustomToolDraftSchema = z
  .discriminatedUnion('type', [
    CustomToolHttpDraftSchema,
    CustomToolSqlDraftSchema,
    CustomToolCommandDraftSchema,
    CustomToolPromptDraftSchema,
  ])
  .superRefine((draft, ctx) => refineCustomToolDraft(draft, ctx))
export type CustomToolDraft = z.infer<typeof CustomToolDraftSchema>

// ─── 持久化记录与视图模型 ───────────────────────────────────────────────

export const CUSTOM_TOOL_ORIGINS = ['local', 'imported'] as const
export const CustomToolOriginSchema = z.enum(CUSTOM_TOOL_ORIGINS)
export type CustomToolOrigin = z.infer<typeof CustomToolOriginSchema>

export type CustomToolRecord = CustomToolDraft & {
  enabled: boolean
  origin: CustomToolOrigin
  lastTestAt: string | null
  createdAt: string
  updatedAt: string
}

/** 列表页摘要（不含完整 spec，体积友好） */
export interface CustomToolSummary {
  id: string
  title: string
  description: string
  type: CustomToolType
  risk: RuntimeRisk
  effect: RuntimeEffect
  idempotency: RuntimeIdempotency
  timeoutMs: number
  enabled: boolean
  origin: CustomToolOrigin
  /** secretRefs 的名称列表（用于状态灯；值永不外出） */
  secretNames: string[]
  lastTestAt: string | null
  createdAt: string
  updatedAt: string
}

export type CustomToolDetails = CustomToolRecord & {
  /** 各密钥位是否已写入密钥库 */
  secretStatus: Record<string, boolean>
}

export function toCustomToolSummary(record: CustomToolRecord): CustomToolSummary {
  return {
    id: record.id,
    title: record.title,
    description: record.description,
    type: record.type,
    risk: record.risk,
    effect: record.effect,
    idempotency: record.idempotency,
    timeoutMs: record.timeoutMs,
    enabled: record.enabled,
    origin: record.origin,
    secretNames: Object.keys(record.secretRefs ?? {}),
    lastTestAt: record.lastTestAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

// ─── 测试运行与执行结果 ─────────────────────────────────────────────────

export interface CustomToolExecutionMeta {
  durationMs: number
  bytes: number
  truncated: boolean
}

export interface CustomToolTestRunResult {
  ok: boolean
  text: string
  meta: CustomToolExecutionMeta
  errorCode?: string
}

// ─── 导入导出 ───────────────────────────────────────────────────────────

export const CustomToolExportEntrySchema = z
  .object({
    spec: CustomToolDraftSchema,
    /** 导出时密钥不随文件走，仅留占位名称供导入方补齐 */
    secretNames: z
      .array(z.string().regex(/^[A-Za-z0-9_-]{1,64}$/))
      .max(16)
      .optional(),
  })
  .strict()

export const CustomToolsExportPayloadSchema = z
  .object({
    formatVersion: z.literal(1),
    exportedAt: z.string().max(64).optional(),
    tools: z.array(CustomToolExportEntrySchema).max(CUSTOM_TOOL_EXPORT_MAX),
  })
  .strict()
export type CustomToolsExportPayload = z.infer<typeof CustomToolsExportPayloadSchema>

export interface CustomToolImportSkipped {
  id: string
  reason: string
}

// ─── IPC 契约 ───────────────────────────────────────────────────────────

export interface CustomToolListRequest {
  query?: string
}
export interface CustomToolListResponse {
  tools: CustomToolSummary[]
}
export interface CustomToolGetRequest {
  id: string
}
export interface CustomToolGetResponse {
  tool: CustomToolDetails
}
export interface CustomToolCreateRequest {
  spec: CustomToolDraft
}
export interface CustomToolCreateResponse {
  tool: CustomToolSummary
}
export interface CustomToolUpdateRequest {
  id: string
  spec: CustomToolDraft
}
export interface CustomToolUpdateResponse {
  tool: CustomToolSummary
}
export interface CustomToolDeleteRequest {
  id: string
}
export interface CustomToolDeleteResponse {
  ok: boolean
}
export interface CustomToolSetEnabledRequest {
  id: string
  enabled: boolean
}
export interface CustomToolSetEnabledResponse {
  tool: CustomToolSummary
}
export interface CustomToolTestRunRequest {
  /** 已保存工具 id 与 draftSpec 二选一 */
  toolId?: string
  draftSpec?: CustomToolDraft
  input: Record<string, unknown>
}
export interface CustomToolTestRunResponse {
  result: CustomToolTestRunResult
}
export interface CustomToolWriteSecretRequest {
  id: string
  name: string
  value: string
}
export interface CustomToolWriteSecretResponse {
  ok: boolean
}
export interface CustomToolHasSecretRequest {
  id: string
}
export interface CustomToolHasSecretResponse {
  secrets: Record<string, boolean>
}
export interface CustomToolExportRequest {
  ids?: string[]
}
export interface CustomToolExportResponse {
  payload: CustomToolsExportPayload
}
export interface CustomToolImportRequest {
  payload: unknown
}
export interface CustomToolImportResponse {
  imported: CustomToolSummary[]
  skipped: CustomToolImportSkipped[]
}

export interface CustomToolsIpcChannelMap {
  'custom-tools:list': [CustomToolListRequest, CustomToolListResponse]
  'custom-tools:get': [CustomToolGetRequest, CustomToolGetResponse]
  'custom-tools:create': [CustomToolCreateRequest, CustomToolCreateResponse]
  'custom-tools:update': [CustomToolUpdateRequest, CustomToolUpdateResponse]
  'custom-tools:delete': [CustomToolDeleteRequest, CustomToolDeleteResponse]
  'custom-tools:set-enabled': [CustomToolSetEnabledRequest, CustomToolSetEnabledResponse]
  'custom-tools:test-run': [CustomToolTestRunRequest, CustomToolTestRunResponse]
  'custom-tools:write-secret': [CustomToolWriteSecretRequest, CustomToolWriteSecretResponse]
  'custom-tools:has-secret': [CustomToolHasSecretRequest, CustomToolHasSecretResponse]
  'custom-tools:export': [CustomToolExportRequest, CustomToolExportResponse]
  'custom-tools:import': [CustomToolImportRequest, CustomToolImportResponse]
}

// ─── IPC Request zod 校验注册表 ─────────────────────────────────────────

const testInputSchema = z.record(z.string().max(200), z.unknown())

export const CustomToolsIpcSchemaRegistry = {
  'custom-tools:list': z.object({ query: z.string().max(120).optional() }).strict(),
  'custom-tools:get': z.object({ id: CustomToolIdSchema }).strict(),
  'custom-tools:create': z.object({ spec: CustomToolDraftSchema }).strict(),
  'custom-tools:update': z
    .object({ id: CustomToolIdSchema, spec: CustomToolDraftSchema })
    .strict()
    .refine((request) => request.spec.id === request.id, 'spec.id 与目标工具 ID 不一致'),
  'custom-tools:delete': z.object({ id: CustomToolIdSchema }).strict(),
  'custom-tools:set-enabled': z.object({ id: CustomToolIdSchema, enabled: z.boolean() }).strict(),
  'custom-tools:test-run': z
    .object({
      toolId: CustomToolIdSchema.optional(),
      draftSpec: CustomToolDraftSchema.optional(),
      input: testInputSchema,
    })
    .strict()
    .refine(
      (request) => (request.toolId != null) !== (request.draftSpec != null),
      'toolId 与 draftSpec 必须且只能提供一个',
    ),
  'custom-tools:write-secret': z
    .object({
      id: CustomToolIdSchema,
      name: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
      value: z.string().min(1).max(16_000),
    })
    .strict(),
  'custom-tools:has-secret': z.object({ id: CustomToolIdSchema }).strict(),
  'custom-tools:export': z
    .object({ ids: z.array(CustomToolIdSchema).max(CUSTOM_TOOL_EXPORT_MAX).optional() })
    .strict(),
  // payload 来自用户文件，结构在 handler 内用 CustomToolsExportPayloadSchema 深校验
  'custom-tools:import': z.object({ payload: z.unknown() }).strict(),
}
