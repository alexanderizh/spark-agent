import type { MediaModelManifest } from './media-model-manifest.js'

export interface MediaManifestValidationIssue {
  path: Array<string | number>
  code:
    | 'invocation_mismatch'
    | 'unknown_template_variable'
    | 'invalid_default'
    | 'invalid_param_policy'
    | 'invalid_error_contract'
    | 'invalid_transport'
    | 'invalid_auth'
    | 'invalid_upload'
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
  'mask',
  'firstFrame',
  'firstFrameImage',
  'lastFrame',
  'lastFrameImage',
  'referenceImages',
  'referenceImageUrls',
  'referenceAudios',
  'referenceAudioUrls',
  'video',
  'videoUrl',
  'videos',
  'inputVideos',
  'inputVideoUrls',
  'audios',
  'audioUrls',
  'inputAudios',
  'inputAudioUrls',
  'firstClip',
  'audio',
  'audioUrl',
  'media',
  'content',
  'params',
  'providerParams',
  'uploads',
  'upload',
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
    if (
      manifest.contractVersion === 2 &&
      invocation.polling &&
      invocation.polling.maxAttempts == null
    ) {
      issues.push({
        path: ['invocation', 'polling', 'maxAttempts'],
        code: 'invalid_transport',
        message: 'async_polling 建议显式配置 maxAttempts，禁止无界轮询',
      })
    }
  }

  if (manifest.contractVersion === 2 && manifest.adapterMode == null) {
    issues.push({
      path: ['adapterMode'],
      code: 'invalid_transport',
      message: 'contractVersion=2 必须显式声明 adapterMode',
    })
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
  if (invocation.request) {
    validateInvocationRequest(invocation.request, ['invocation', 'request'], issues)
  }
  for (const [uploadIndex, upload] of (invocation.uploads ?? []).entries()) {
    if (upload.input.variable.trim().length === 0) {
      issues.push({
        path: ['invocation', 'uploads', uploadIndex, 'input', 'variable'],
        code: 'invalid_upload',
        message: 'upload input variable 不能为空',
      })
    }
    if (upload.constraints?.maxCount != null && upload.constraints.maxCount < 1) {
      issues.push({
        path: ['invocation', 'uploads', uploadIndex, 'constraints', 'maxCount'],
        code: 'invalid_upload',
        message: 'upload maxCount 必须大于 0',
      })
    }
    validateInvocationRequest(
      upload.request,
      ['invocation', 'uploads', uploadIndex, 'request'],
      issues,
    )
    for (const path of upload.result.urlPaths) {
      validateTemplateVariables(
        path,
        ['invocation', 'uploads', uploadIndex, 'result'],
        new Set(),
        issues,
      )
    }
  }

  if (invocation.response.kind === 'task_poll') {
    if (invocation.response.statusEndpoint) {
      validateTemplateVariables(
        invocation.response.statusEndpoint,
        ['invocation', 'response', 'statusEndpoint'],
        new Set(['taskId']),
        issues,
      )
    }
    if (invocation.response.poll) {
      validateInvocationRequest(
        invocation.response.poll,
        ['invocation', 'response', 'poll'],
        issues,
        new Set(['taskId', 'poll']),
      )
    }
    if (invocation.response.artifact) {
      validateInvocationRequest(
        invocation.response.artifact.request,
        ['invocation', 'response', 'artifact', 'request'],
        issues,
        new Set(['taskId', 'poll']),
      )
    }
    if (!invocation.response.statusEndpoint && !invocation.response.poll) {
      issues.push({
        path: ['invocation', 'response'],
        code: 'invalid_transport',
        message: 'task_poll 必须配置 statusEndpoint 或 V2 poll transport',
      })
    }
    if (manifest.contractVersion === 2 && invocation.polling) {
      const mappedStates = new Set(Object.values(invocation.polling.statusMap))
      if (!mappedStates.has('succeeded') || !mappedStates.has('failed')) {
        issues.push({
          path: ['invocation', 'polling', 'statusMap'],
          code: 'invalid_transport',
          message: 'statusMap 必须至少包含 succeeded 和 failed 终态映射',
        })
      }
    }
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
    if (!knownFields.has(entry.name) && !policy.aliases?.[entry.name]) {
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

function validateInvocationRequest(
  request: NonNullable<MediaModelManifest['invocation']['request']>,
  basePath: Array<string | number>,
  issues: MediaManifestValidationIssue[],
  allowedRoots = new Set(STANDARD_TEMPLATE_VARIABLES),
): void {
  if (request.method === 'GET' && request.body && request.body.kind !== 'none') {
    issues.push({
      path: [...basePath, 'body'],
      code: 'invalid_transport',
      message: `${request.method} 请求不能配置 body`,
    })
  }
  validateTemplateVariables(request.endpoint, [...basePath, 'endpoint'], allowedRoots, issues)
  validateTemplateVariables(request.query, [...basePath, 'query'], allowedRoots, issues)
  validateTemplateVariables(request.headers, [...basePath, 'headers'], allowedRoots, issues)
  validateTemplateVariables(request.body, [...basePath, 'body'], allowedRoots, issues)
  if (
    request.auth?.kind === 'api_key_header' &&
    /^(authorization|cookie|set-cookie)$/i.test(request.auth.name)
  ) {
    issues.push({
      path: [...basePath, 'auth', 'name'],
      code: 'invalid_auth',
      message: `鉴权 Header ${request.auth.name} 不允许被自定义 API key 覆盖`,
    })
  }
  if (request.auth?.kind === 'basic') {
    issues.push({
      path: [...basePath, 'auth'],
      code: 'invalid_auth',
      message:
        '当前 Provider 凭据模型不支持 basic auth，请使用 bearer、API key header/query 或无鉴权',
    })
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
