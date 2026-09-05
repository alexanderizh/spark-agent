import { load as parseYaml } from 'js-yaml'
import type {
  CustomToolInputSchema,
  CustomToolParam,
  HttpHeader,
  HttpMethod,
} from '@spark/protocol'
import { CUSTOM_TOOL_SENSITIVE_FIELD_REGEX } from '@spark/protocol'
import { createCustomToolEditorDraft, type CustomToolEditorDraft } from './custom-tools-model'

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const

type JsonObject = Record<string, unknown>

export interface OpenApiOperationImport {
  key: string
  method: HttpMethod
  path: string
  title: string
  editor: CustomToolEditorDraft | null
  diagnostics: string[]
  warnings: string[]
}

export interface OpenApiImportResult {
  title: string
  version: string
  operations: OpenApiOperationImport[]
}

function isObject(value: unknown): value is JsonObject {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function asObject(value: unknown, label: string): JsonObject {
  if (!isObject(value)) throw new Error(`${label} 必须是对象`)
  return value
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function resolveLocalRef(root: JsonObject, value: unknown, label: string): JsonObject {
  let current = asObject(value, label)
  const visited = new Set<string>()
  for (let depth = 0; depth < 16; depth += 1) {
    const ref = asString(current.$ref)
    if (ref == null) return current
    if (!ref.startsWith('#/')) throw new Error(`${label} 使用了暂不支持的外部引用 ${ref}`)
    if (visited.has(ref)) throw new Error(`${label} 存在循环引用 ${ref}`)
    visited.add(ref)
    let resolved: unknown = root
    for (const rawPart of ref.slice(2).split('/')) {
      const part = rawPart.replace(/~1/g, '/').replace(/~0/g, '~')
      resolved = isObject(resolved) ? resolved[part] : undefined
    }
    current = asObject(resolved, `${label} 引用 ${ref}`)
  }
  throw new Error(`${label} 引用层级过深`)
}

function normalizeName(source: string, used: Set<string>): string {
  let base = source.replace(/[^a-zA-Z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'param'
  if (!/^[a-zA-Z_]/.test(base)) base = `param_${base}`
  let candidate = base.slice(0, 48)
  let suffix = 2
  while (used.has(candidate)) {
    candidate = `${base.slice(0, 43)}_${suffix}`
    suffix += 1
  }
  used.add(candidate)
  return candidate
}

function toolId(source: string, used: Set<string>): string {
  let base = source
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  if (!base) base = 'openapi_tool'
  if (!/^[a-z]/.test(base)) base = `api_${base}`
  if (base.length < 3) base = `${base}_api`
  base = base.slice(0, 58)
  let candidate = base
  let suffix = 2
  while (used.has(candidate)) {
    candidate = `${base.slice(0, 59)}_${suffix}`.slice(0, 64)
    suffix += 1
  }
  used.add(candidate)
  return candidate
}

function serverUrl(
  root: JsonObject,
  pathItem: JsonObject,
  operation: JsonObject,
  swagger2: boolean,
): string {
  if (swagger2) {
    const scheme = Array.isArray(root.schemes) ? asString(root.schemes[0]) : undefined
    const host = asString(root.host)
    if (host == null) throw new Error('Swagger 2.0 规范缺少 host')
    const basePath = asString(root.basePath) ?? ''
    return `${scheme ?? 'https'}://${host}${basePath.replace(/\/$/u, '')}`
  }
  const candidates = [operation.servers, pathItem.servers, root.servers]
  const servers = candidates.find((value) => Array.isArray(value)) as unknown[] | undefined
  const first = servers?.[0]
  const server = asObject(first, 'OpenAPI server')
  let url = asString(server.url)
  if (url == null) throw new Error('OpenAPI server 缺少 url')
  const variables = isObject(server.variables) ? server.variables : {}
  url = url.replace(/\{([^{}]+)\}/g, (_match, name: string) => {
    const variable = isObject(variables[name]) ? variables[name] : null
    const fallback = variable == null ? undefined : asString(variable.default)
    if (fallback == null) throw new Error(`server 变量 ${name} 缺少 default`)
    return fallback
  })
  if (!/^https?:\/\//iu.test(url)) throw new Error(`server url 必须是 http(s) 绝对地址：${url}`)
  return url.replace(/\/$/u, '')
}

function schemaToParam(root: JsonObject, value: unknown, label: string): CustomToolParam {
  const schema = resolveLocalRef(root, value, label)
  const type =
    asString(schema.type) ?? (Array.isArray(schema.enum) ? typeof schema.enum[0] : undefined)
  if (!['string', 'number', 'integer', 'boolean', 'array'].includes(type ?? '')) {
    throw new Error(`${label} 的类型 ${type ?? 'unknown'} 暂不支持；仅支持原始类型和原始类型数组`)
  }
  const param: CustomToolParam = {
    type: type as CustomToolParam['type'],
    ...(asString(schema.title) != null ? { title: asString(schema.title) } : {}),
    ...(asString(schema.description) != null ? { description: asString(schema.description) } : {}),
  }
  if (schema.default != null && ['string', 'number', 'boolean'].includes(typeof schema.default)) {
    param.default = schema.default as string | number | boolean
  }
  if (Array.isArray(schema.enum)) {
    const values = schema.enum.filter(
      (item): item is string | number => typeof item === 'string' || typeof item === 'number',
    )
    if (values.length > 0) param.enum = values.slice(0, 50)
  }
  if (type === 'array') {
    const items = resolveLocalRef(root, schema.items, `${label}.items`)
    const itemType = asString(items.type)
    if (!['string', 'number', 'integer', 'boolean'].includes(itemType ?? '')) {
      throw new Error(`${label} 的数组元素必须是原始类型`)
    }
    param.items = { type: itemType as 'string' | 'number' | 'integer' | 'boolean' }
  }
  return param
}

function securityHeaders(
  root: JsonObject,
  operation: JsonObject,
  swagger2: boolean,
): { headers: HttpHeader[]; warnings: string[] } {
  const security = operation.security ?? root.security
  if (!Array.isArray(security) || security.length === 0) return { headers: [], warnings: [] }
  const requirements = security.filter(isObject)
  const requirement = requirements[0]
  if (requirement == null) return { headers: [], warnings: [] }
  // security 是 OR 列表：每个元素是一种可互换的鉴权方案组合。工具只能表达一种 Header 集，
  // 因此导入第一个组合，其余组合以 warning 告知用户未导入。
  const warnings: string[] = []
  if (requirements.length > 1) {
    warnings.push(
      `规范声明了 ${requirements.length} 种可互换的鉴权方案，已导入第一种，其余 ${requirements.length - 1} 种未导入`,
    )
  }
  const definitions = swagger2
    ? asObject(root.securityDefinitions ?? {}, 'securityDefinitions')
    : asObject(
        isObject(root.components) ? (root.components.securitySchemes ?? {}) : {},
        'securitySchemes',
      )
  const headers: HttpHeader[] = []
  for (const schemeName of Object.keys(requirement)) {
    const scheme = resolveLocalRef(root, definitions[schemeName], `安全方案 ${schemeName}`)
    const type = asString(scheme.type)
    const location = asString(scheme.in)
    if (type === 'apiKey' && location === 'header') {
      const name = asString(scheme.name)
      if (name == null) throw new Error(`安全方案 ${schemeName} 缺少 Header 名称`)
      headers.push({
        name,
        secretRef: `${normalizeName(schemeName, new Set())}_secret`.toLowerCase(),
      })
      continue
    }
    if (
      (!swagger2 &&
        type === 'http' &&
        ['bearer', 'basic'].includes(asString(scheme.scheme) ?? '')) ||
      (swagger2 && type === 'basic')
    ) {
      headers.push({
        name: 'Authorization',
        secretRef: `${normalizeName(schemeName, new Set())}_secret`.toLowerCase(),
      })
      continue
    }
    throw new Error(`安全方案 ${schemeName}（${type ?? 'unknown'}）暂不支持自动导入`)
  }
  return { headers, warnings }
}

function requestBodySchema(
  root: JsonObject,
  pathItem: JsonObject,
  operation: JsonObject,
  swagger2: boolean,
): JsonObject | null {
  if (swagger2) {
    const pathParams = Array.isArray(pathItem.parameters) ? pathItem.parameters : []
    const operationParams = Array.isArray(operation.parameters) ? operation.parameters : []
    const bodyParams = [...pathParams, ...operationParams]
      .map((value) => resolveLocalRef(root, value, 'body 参数'))
      .filter((value) => value.in === 'body')
    const bodyParam = bodyParams.at(-1)
    return bodyParam == null ? null : resolveLocalRef(root, bodyParam.schema, 'body schema')
  }
  if (operation.requestBody == null) return null
  const body = resolveLocalRef(root, operation.requestBody, 'requestBody')
  const content = asObject(body.content, 'requestBody.content')
  const media = content['application/json'] ?? content['application/*+json']
  if (media == null) {
    if (
      Object.keys(content).some(
        (key) => key.includes('multipart') || key.includes('form-urlencoded'),
      )
    ) {
      throw new Error('暂不支持 multipart 或 form-urlencoded requestBody')
    }
    throw new Error('requestBody 仅支持 application/json')
  }
  return resolveLocalRef(root, asObject(media, 'application/json').schema, 'requestBody schema')
}

function buildOperation(
  root: JsonObject,
  path: string,
  pathItem: JsonObject,
  method: (typeof HTTP_METHODS)[number],
  operation: JsonObject,
  swagger2: boolean,
  usedIds: Set<string>,
): { draft: CustomToolEditorDraft; warnings: string[] } {
  const baseUrl = serverUrl(root, pathItem, operation, swagger2)
  const usedNames = new Set<string>()
  const properties: CustomToolInputSchema['properties'] = {}
  const required = new Set<string>()
  const pathParameters = Array.isArray(pathItem.parameters) ? pathItem.parameters : []
  const operationParameters = Array.isArray(operation.parameters) ? operation.parameters : []
  const merged = new Map<string, JsonObject>()
  for (const value of [...pathParameters, ...operationParameters]) {
    const param = resolveLocalRef(root, value, 'parameter')
    const name = asString(param.name)
    const location = asString(param.in)
    if (name != null && location != null && location !== 'body')
      merged.set(`${location}:${name}`, param)
  }
  for (const match of path.matchAll(/\{([^{}]+)\}/g)) {
    if (!merged.has(`path:${match[1] ?? ''}`)) {
      throw new Error(`路径模板参数 ${match[1] ?? ''} 没有对应的 path 参数声明`)
    }
  }
  let resolvedPath = path
  const queryParts: string[] = []
  const { headers, warnings } = securityHeaders(root, operation, swagger2)
  for (const param of merged.values()) {
    const originalName = asString(param.name) ?? 'param'
    const location = asString(param.in)
    if (!['path', 'query', 'header'].includes(location ?? '')) {
      throw new Error(`参数 ${originalName} 位于 ${location ?? 'unknown'}，暂不支持自动导入`)
    }
    if (location === 'header' && CUSTOM_TOOL_SENSITIVE_FIELD_REGEX.test(originalName)) {
      headers.push({
        name: originalName,
        secretRef: `${normalizeName(originalName, new Set())}_secret`.toLowerCase(),
      })
      continue
    }
    const inputName = normalizeName(originalName, usedNames)
    const schemaValue = swagger2 ? param : param.schema
    const property = schemaToParam(root, schemaValue, `参数 ${originalName}`)
    if (property.type === 'array') {
      throw new Error(
        `参数 ${originalName} 是数组；当前 HTTP 工具无法准确保留 OpenAPI 的数组序列化规则`,
      )
    }
    properties[inputName] = property
    // HTTP 模板当前不支持条件省略字段；凡是写入 URL/Header/Body 的占位符，
    // 调用时都必须提供值。将其标为 required，避免“Schema 说可选、运行时却报缺参”。
    required.add(inputName)
    if (location === 'path') {
      resolvedPath = resolvedPath.replace(
        new RegExp(`\\{${originalName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\}`, 'g'),
        `{{${inputName}}}`,
      )
    } else if (location === 'query') {
      queryParts.push(`${encodeURIComponent(originalName)}={{${inputName}}}`)
    } else {
      headers.push({ name: originalName, valueTemplate: `{{${inputName}}}` })
    }
  }
  let bodyJsonTemplate = ''
  const bodySchema = requestBodySchema(root, pathItem, operation, swagger2)
  if (bodySchema != null) {
    if (asString(bodySchema.type) !== 'object' && !isObject(bodySchema.properties)) {
      throw new Error('requestBody 顶层必须是 object')
    }
    const bodyProperties = asObject(bodySchema.properties ?? {}, 'requestBody.properties')
    const template: JsonObject = {}
    for (const [originalName, schema] of Object.entries(bodyProperties)) {
      const inputName = normalizeName(originalName, usedNames)
      properties[inputName] = schemaToParam(root, schema, `requestBody.${originalName}`)
      required.add(inputName)
      template[originalName] = `__SPARK_PLACEHOLDER_${inputName}__`
    }
    bodyJsonTemplate = JSON.stringify(template, null, 2).replace(
      /"__SPARK_PLACEHOLDER_([a-zA-Z_][a-zA-Z0-9_]*)__"/g,
      '{{$1}}',
    )
    if (!headers.some((header) => header.name.toLowerCase() === 'content-type')) {
      headers.push({ name: 'Content-Type', valueTemplate: 'application/json' })
    }
  }

  if (Object.keys(properties).length > 32) throw new Error('operation 参数超过 32 个，无法导入')
  const inputSchema: CustomToolInputSchema = {
    type: 'object',
    properties,
    ...(required.size > 0 ? { required: [...required] } : {}),
  }
  const upperMethod = method.toUpperCase() as HttpMethod
  const id = toolId(asString(operation.operationId) ?? `${method}_${path}`, usedIds)
  const editor = createCustomToolEditorDraft('http')
  const query =
    queryParts.length > 0 ? `${resolvedPath.includes('?') ? '&' : '?'}${queryParts.join('&')}` : ''
  const title =
    asString(operation.summary) ?? asString(operation.operationId) ?? `${upperMethod} ${path}`
  const description =
    asString(operation.description) ?? `调用 ${title} 接口，并把结构化响应返回给 Agent 使用`
  return {
    draft: {
      ...editor,
      id,
      title: title.slice(0, 120),
      description: description.length >= 10 ? description : `${description}，并返回接口响应结果`,
      method: upperMethod,
      urlTemplate: `${baseUrl}${resolvedPath}${query}`,
      inputSchemaJson: JSON.stringify(inputSchema, null, 2),
      headersJson: JSON.stringify(headers, null, 2),
      bodyJsonTemplate,
      testInputJson: JSON.stringify(
        Object.fromEntries(
          Object.entries(properties).map(([name, param]) => [name, testDefaultValue(param)]),
        ),
        null,
        2,
      ),
    },
    warnings,
  }
}

/**
 * 生成导入后测试面板的默认输入：优先用 schema default，否则按类型给可直接运行的值，
 * 避免数字/布尔参数默认为空串导致测试一跑就卡在 Schema 校验。
 */
function testDefaultValue(param: CustomToolParam): string | number | boolean | unknown[] {
  if (param.default != null) return param.default
  switch (param.type) {
    case 'number':
    case 'integer':
      return 0
    case 'boolean':
      return false
    case 'array':
      return []
    default:
      return ''
  }
}

export function parseOpenApiToEditorDrafts(source: string): OpenApiImportResult {
  let parsed: unknown
  try {
    parsed = parseYaml(source)
  } catch (error) {
    throw new Error(
      `OpenAPI JSON / YAML 解析失败：${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    )
  }
  const root = asObject(parsed, 'OpenAPI 文档')
  const swagger2 = root.swagger === '2.0'
  const version = swagger2 ? 'Swagger 2.0' : (asString(root.openapi) ?? '')
  if (!swagger2 && !/^3\.(0|1)\./u.test(version)) {
    throw new Error('仅支持 OpenAPI 3.0 / 3.1 或 Swagger 2.0 规范')
  }
  const paths = asObject(root.paths, 'paths')
  const usedIds = new Set<string>()
  const operations: OpenApiOperationImport[] = []
  for (const [path, rawPathItem] of Object.entries(paths)) {
    const pathItem = resolveLocalRef(root, rawPathItem, `路径 ${path}`)
    for (const method of HTTP_METHODS) {
      if (pathItem[method] == null) continue
      const operation = resolveLocalRef(root, pathItem[method], `${method.toUpperCase()} ${path}`)
      const title =
        asString(operation.summary) ??
        asString(operation.operationId) ??
        `${method.toUpperCase()} ${path}`
      try {
        const { draft, warnings } = buildOperation(
          root,
          path,
          pathItem,
          method,
          operation,
          swagger2,
          usedIds,
        )
        operations.push({
          key: `${method}:${path}`,
          method: method.toUpperCase() as HttpMethod,
          path,
          title,
          editor: draft,
          diagnostics: [],
          warnings,
        })
      } catch (error) {
        operations.push({
          key: `${method}:${path}`,
          method: method.toUpperCase() as HttpMethod,
          path,
          title,
          editor: null,
          diagnostics: [error instanceof Error ? error.message : String(error)],
          warnings: [],
        })
      }
    }
  }
  if (operations.length === 0) throw new Error('规范中没有可识别的 HTTP operation')
  const info = isObject(root.info) ? root.info : {}
  return { title: asString(info.title) ?? 'OpenAPI', version, operations }
}
