import type { MediaModelManifest } from './media-model-manifest.js'

export interface MediaManifestValidationIssue {
  path: Array<string | number>
  code: 'invocation_mismatch' | 'unknown_template_variable' | 'invalid_default'
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
  })

  return issues
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
