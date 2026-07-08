import type { MediaModelManifest } from './media-model-manifest.js'

export interface MediaManifestValidationIssue {
  path: Array<string | number>
  code:
    | 'invocation_mismatch'
    | 'unknown_template_variable'
    | 'invalid_default'
    | 'invalid_param_policy'
    | 'invalid_error_contract'
  message: string
}

const STANDARD_TEMPLATE_VARIABLES = new Set([
  'modelId',
  'prompt',
  'text',
  'negativePrompt',
  'inputFiles',
  'image',
  'imageUrl',
  'images',
  'inputImages',
  'inputImageUrls',
  'imageUrls',
  'firstFrame',
  'firstFrameImage',
  'lastFrame',
  'lastFrameImage',
  'referenceImages',
  'referenceImageUrls',
  'video',
  'videoUrl',
  'videos',
  'inputVideos',
  'inputVideoUrls',
  'firstClip',
  'audio',
  'audioUrl',
  'media',
  'params',
  'providerParams',
])

export function validateMediaModelManifestSemantics(
  manifest: MediaModelManifest,
): MediaManifestValidationIssue[] {
  const issues: MediaManifestValidationIssue[] = []
  const invocation = manifest.invocation

  if (invocation.mode === 'async_polling') {
    if (invocation.response.kind !== 'task_poll') {
      issues.push({
        path: ['invocation', 'response'],
        code: 'invocation_mismatch',
        message: 'async_polling 调用必须使用 task_poll 响应',
      })
    }
    if (!invocation.polling) {
      issues.push({
        path: ['invocation', 'polling'],
        code: 'invocation_mismatch',
        message: 'async_polling 调用必须配置轮询间隔、超时和状态映射',
      })
    }
  }

  const allowedVariables = new Set(STANDARD_TEMPLATE_VARIABLES)
  for (const capability of manifest.capabilities) {
    const properties = schemaProperties(capability.paramSchema)
    Object.keys(properties).forEach((key) => allowedVariables.add(key))
  }
  validateTemplateVariables(
    invocation.endpoint,
    ['invocation', 'endpoint'],
    allowedVariables,
    issues,
  )
  validateTemplateVariables(invocation.headers, ['invocation', 'headers'], allowedVariables, issues)
  validateTemplateVariables(
    invocation.requestTemplate,
    ['invocation', 'requestTemplate'],
    allowedVariables,
    issues,
  )

  if (invocation.response.kind === 'task_poll') {
    validateTemplateVariables(
      invocation.response.statusEndpoint,
      ['invocation', 'response', 'statusEndpoint'],
      new Set(['taskId']),
      issues,
    )
  }

  manifest.capabilities.forEach((capability, capabilityIndex) => {
    const properties = schemaProperties(capability.paramSchema)
    for (const [key, value] of Object.entries(capability.defaults ?? {})) {
      const schema = properties[key]
      if (!schema || defaultMatchesSchema(value, schema)) continue
      issues.push({
        path: ['capabilities', capabilityIndex, 'defaults', key],
        code: 'invalid_default',
        message: `默认值 ${key} 不符合参数 Schema`,
      })
    }
    validateCapabilityParamPolicy(capability, capabilityIndex, properties, issues)
  })

  if (manifest.error) {
    validateErrorContract(manifest.error, ['error'], issues)
  }

  return issues
}

function validateCapabilityParamPolicy(
  capability: MediaModelManifest['capabilities'][number],
  capabilityIndex: number,
  properties: Record<string, Record<string, unknown>>,
  issues: MediaManifestValidationIssue[],
): void {
  const policy = capability.paramPolicy
  if (!policy) return
  const basePath: Array<string | number> = ['capabilities', capabilityIndex, 'paramPolicy']
  const knownFields = new Set<string>(Object.keys(properties))

  // capability.aliases 与 paramPolicy.aliases 应保持互补，不冲突。
  // 此处只校验 paramPolicy 内部一致性，aliases 与 schema 的对齐在 compiler 中处理。

  for (const entry of policy.forbidden ?? []) {
    if (!knownFields.has(entry.name) && !(policy.aliases?.[entry.name])) {
      issues.push({
        path: [...basePath, 'forbidden'],
        code: 'invalid_param_policy',
        message: `forbidden 字段 ${entry.name} 未在 paramSchema 或 aliases 中声明`,
      })
    }
  }

  const allow = new Set(policy.passthrough?.allow ?? [])
  const deny = new Set(policy.passthrough?.deny ?? [])
  for (const field of deny) {
    if (allow.has(field)) {
      issues.push({
        path: [...basePath, 'passthrough'],
        code: 'invalid_param_policy',
        message: `passthrough 字段 ${field} 同时出现在 allow 与 deny 中`,
      })
    }
  }

  for (const rule of policy.conflicts ?? []) {
    if (rule.fields.length < 2) {
      issues.push({
        path: [...basePath, 'conflicts'],
        code: 'invalid_param_policy',
        message: 'conflicts.fields 至少需要 2 个字段',
      })
    }
  }

  for (const rule of policy.transforms ?? []) {
    if (rule.kind === 'rename' && !rule.from) {
      issues.push({
        path: [...basePath, 'transforms'],
        code: 'invalid_param_policy',
        message: 'transforms.rename 必须提供 from',
      })
    }
  }
}

function validateErrorContract(
  contract: NonNullable<MediaModelManifest['error']>,
  basePath: Array<string | number>,
  issues: MediaManifestValidationIssue[],
): void {
  const paths = [
    ['codePaths', contract.codePaths],
    ['messagePaths', contract.messagePaths],
    ['requestIdPaths', contract.requestIdPaths],
    ['paramNamePaths', contract.paramNamePaths],
  ] as const
  for (const [field, list] of paths) {
    if (!list) continue
    for (const raw of list) {
      if (typeof raw !== 'string' || raw.trim().length === 0) {
        issues.push({
          path: [...basePath, field],
          code: 'invalid_error_contract',
          message: `${field} 中存在空字符串路径`,
        })
      }
    }
  }
}

function validateTemplateVariables(
  value: unknown,
  path: Array<string | number>,
  allowed: Set<string>,
  issues: MediaManifestValidationIssue[],
): void {
  if (typeof value === 'string') {
    for (const variable of templateVariables(value)) {
      const root = variable.split('.')[0] ?? variable
      if (allowed.has(root)) continue
      issues.push({
        path,
        code: 'unknown_template_variable',
        message: `模板变量 ${variable} 无法由标准输入或参数 Schema 提供`,
      })
    }
    return
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      validateTemplateVariables(item, [...path, index], allowed, issues),
    )
    return
  }
  if (!isRecord(value)) return
  for (const [key, child] of Object.entries(value)) {
    validateTemplateVariables(child, [...path, key], allowed, issues)
  }
}

function templateVariables(value: string): string[] {
  return [...value.matchAll(/{{\s*([^}]+?)\s*}}/g)]
    .map((match) => match[1]?.trim() ?? '')
    .filter(Boolean)
}

function schemaProperties(
  schema: Record<string, unknown>,
): Record<string, Record<string, unknown>> {
  const properties = schema.properties
  if (!isRecord(properties)) return {}
  return Object.fromEntries(
    Object.entries(properties).filter((entry): entry is [string, Record<string, unknown>] =>
      isRecord(entry[1]),
    ),
  )
}

function defaultMatchesSchema(value: unknown, schema: Record<string, unknown>): boolean {
  if (Array.isArray(schema.enum) && !schema.enum.some((item) => Object.is(item, value)))
    return false
  switch (schema.type) {
    case 'string':
      if (typeof value !== 'string') return false
      break
    case 'integer':
      if (typeof value !== 'number' || !Number.isInteger(value)) return false
      break
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) return false
      break
    case 'boolean':
      if (typeof value !== 'boolean') return false
      break
    case 'array':
      if (!Array.isArray(value)) return false
      break
    case 'object':
      if (!isRecord(value)) return false
      break
  }
  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) return false
    if (typeof schema.maximum === 'number' && value > schema.maximum) return false
  }
  return true
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}
