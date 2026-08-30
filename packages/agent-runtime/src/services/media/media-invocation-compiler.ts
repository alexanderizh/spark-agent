import { readFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import type {
  MediaInvocationAuth,
  MediaInvocationBody,
  MediaInvocationRequest,
  MediaUploadSpec,
} from '@spark/protocol'
import type { MediaInputFile } from './media-adapter.types.js'
import { MediaProviderError } from './media-adapter.types.js'
import { fetchJson } from './media-http.util.js'
import { logMediaDiag } from './media-debug-log.js'

export interface CompiledInvocationRequest {
  method: string
  url: string
  headers: Record<string, string>
  body?: string | Buffer | Uint8Array
  binaryResponse?: boolean
}

export interface InvocationCompilerContext {
  apiEndpoint: string
  apiKey: string
  variables: Record<string, unknown>
  inputFiles?: MediaInputFile[] | undefined
  /** Optional fetch override used to download remote http(s) input files for multipart/binary bodies. */
  fetchImpl?: typeof fetch | undefined
  /** Legacy flat invocation defaults to bearer API key auth. */
  defaultAuth?: MediaInvocationAuth | undefined
  /** Keep legacy custom Authorization/header overrides readable without allowing them in V2. */
  allowReservedHeaders?: boolean | undefined
}

export interface MediaUploadExecutionContext {
  apiEndpoint: string
  apiKey: string
  fetchImpl?: typeof fetch | undefined
  variables: Record<string, unknown>
}

export async function executeMediaUploads(
  specs: MediaUploadSpec[] | undefined,
  inputFiles: MediaInputFile[] | undefined,
  context: MediaUploadExecutionContext,
): Promise<Record<string, { urls: string[]; responses: unknown[] }>> {
  const result: Record<string, { urls: string[]; responses: unknown[] }> = {}
  for (const spec of specs ?? []) {
    const files = selectUploadFiles(spec.input.variable, inputFiles ?? [])
    validateUploadFiles(spec, files)
    const urls: string[] = []
    const responses: unknown[] = []
    const batches = spec.input.mode === 'batch' ? [files] : files.map((file) => [file])
    if (spec.constraints?.maxBytes != null) {
      for (const file of files) {
        const buffer = await valueToBuffer(
          file.path ?? file.dataUrl ?? file.url ?? '',
          [file],
          context.fetchImpl,
        )
        if (buffer.byteLength > spec.constraints.maxBytes) {
          throw new MediaProviderError(
            'invalid_input',
            `Upload ${spec.name} file exceeds ${spec.constraints.maxBytes} bytes`,
          )
        }
      }
    }
    logMediaDiag('template-upload-started', {
      upload: spec.name,
      input: spec.input.variable,
      mode: spec.input.mode,
      count: files.length,
    })
    for (const batch of batches) {
      const batchVariables = {
        ...context.variables,
        upload: {
          item: batch[0]?.path ?? batch[0]?.dataUrl ?? batch[0]?.url ?? '',
          items: batch.map((file) => file.path ?? file.dataUrl ?? file.url ?? ''),
        },
      }
      const request = await compileInvocationRequest(spec.request, {
        apiEndpoint: context.apiEndpoint,
        apiKey: context.apiKey,
        variables: batchVariables,
        inputFiles: batch,
        defaultAuth:
          spec.request.auth?.kind === 'inherit'
            ? { kind: 'bearer', credentialRef: 'apiKey' }
            : spec.request.auth,
      })
      try {
        const response = await fetchJson(request.url, {
          method: request.method,
          headers: request.headers,
          ...(request.body !== undefined ? { body: request.body } : {}),
          fetchImpl: context.fetchImpl,
        })
        responses.push(response)
        const extracted = extractStringPaths(response, spec.result.urlPaths)
        urls.push(...extracted)
        if (extracted.length === 0) {
          throw new MediaProviderError(
            'provider_http_error',
            `Upload ${spec.name} succeeded but no URL matched ${spec.result.urlPaths.join(', ')}`,
          )
        }
      } catch (error) {
        logMediaDiag('template-upload-failed', {
          upload: spec.name,
          count: batch.length,
          error: error instanceof Error ? error.message : String(error),
        })
        throw error
      }
    }
    result[spec.name] = { urls, responses }
    if (spec.cleanup?.enabled) {
      try {
        const cleanupRequest = await compileInvocationRequest(spec.cleanup.request, {
          apiEndpoint: context.apiEndpoint,
          apiKey: context.apiKey,
          variables: {
            ...context.variables,
            uploads: result,
            upload: { urls, responses },
          },
          inputFiles: [],
          defaultAuth:
            spec.cleanup.request.auth?.kind === 'inherit'
              ? { kind: 'bearer', credentialRef: 'apiKey' }
              : spec.cleanup.request.auth,
        })
        await fetchJson(cleanupRequest.url, {
          method: cleanupRequest.method,
          headers: cleanupRequest.headers,
          ...(cleanupRequest.body !== undefined ? { body: cleanupRequest.body } : {}),
          fetchImpl: context.fetchImpl,
        })
        logMediaDiag('template-upload-cleanup-finished', { upload: spec.name })
      } catch (error) {
        // 上传已经成功，清理失败不应让主生成任务误报失败；保留结构化诊断供排查。
        logMediaDiag('template-upload-cleanup-failed', {
          upload: spec.name,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
    logMediaDiag('template-upload-finished', { upload: spec.name, urls: urls.length })
  }
  return result
}

const RESERVED_HEADERS = new Set(['authorization', 'cookie', 'set-cookie', 'x-api-key', 'api-key'])

export async function compileInvocationRequest(
  request: MediaInvocationRequest,
  context: InvocationCompilerContext,
): Promise<CompiledInvocationRequest> {
  const method = request.method.toUpperCase()
  const endpoint = renderString(request.endpoint, context.variables)
  let url = appendQuery(resolveUrl(context.apiEndpoint, endpoint), request.query, context.variables)
  assertHttpUrl(url)
  const headers = renderHeaders(
    request.headers,
    context.variables,
    context.allowReservedHeaders === true,
  )
  const auth = request.auth?.kind === 'inherit' ? context.defaultAuth : request.auth
  url = applyAuth(
    headers,
    url,
    auth ?? context.defaultAuth,
    context.apiKey,
    context.allowReservedHeaders === true,
  )

  const body = await compileBody(request.body, context)
  if (method === 'GET' && body.body !== undefined) {
    throw new Error('GET invocation cannot contain a request body')
  }
  if (body.contentType && !hasHeader(headers, 'content-type')) {
    headers['content-type'] = body.contentType
  }
  return {
    method,
    url,
    headers,
    ...(body.body !== undefined ? { body: body.body } : {}),
    ...(body.binaryResponse ? { binaryResponse: true } : {}),
  }
}

export function legacyInvocationRequest(input: {
  endpoint: string
  method: MediaInvocationRequest['method']
  headers?: Record<string, unknown> | undefined
  requestTemplate: Record<string, unknown>
  contentType: 'json' | 'multipart' | 'binary'
}): MediaInvocationRequest {
  return {
    method: input.method,
    endpoint: input.endpoint,
    ...(input.headers ? { headers: input.headers } : {}),
    auth: { kind: 'bearer', credentialRef: 'apiKey' },
    body:
      input.method === 'GET'
        ? { kind: 'none' }
        : input.contentType === 'json'
          ? { kind: 'json', template: input.requestTemplate }
          : input.contentType === 'multipart'
            ? {
                kind: 'multipart',
                parts: Object.entries(input.requestTemplate).map(([name, value]) => ({
                  name,
                  kind: 'text' as const,
                  value,
                })),
              }
            : { kind: 'binary', variable: '{{inputFiles}}' },
  }
}

function applyAuth(
  headers: Record<string, string>,
  url: string,
  auth: MediaInvocationAuth | undefined,
  apiKey: string,
  allowReservedHeaders: boolean,
): string {
  const kind = auth?.kind ?? 'none'
  if (kind === 'none' || kind === 'inherit') return url
  if (kind === 'bearer') {
    if (!allowReservedHeaders || !hasHeader(headers, 'authorization'))
      headers.authorization = `Bearer ${apiKey}`
    return url
  }
  if (auth?.kind === 'api_key_header') {
    if (!allowReservedHeaders || !hasHeader(headers, auth.name)) headers[auth.name] = apiKey
    return url
  }
  if (auth?.kind === 'api_key_query') {
    const parsed = new URL(url)
    parsed.searchParams.set(auth.name, apiKey)
    return parsed.toString()
  }
  throw new Error('basic auth is not supported by the current Provider credential profile')
}

function renderHeaders(
  headers: Record<string, unknown> | undefined,
  variables: Record<string, unknown>,
  allowReservedHeaders: boolean,
): Record<string, string> {
  const rendered: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (/[\r\n]/.test(key)) throw new Error('Invocation header name cannot contain CR/LF')
    const normalized = key.toLowerCase()
    if (!allowReservedHeaders && RESERVED_HEADERS.has(normalized)) continue
    const next = renderValue(value, variables)
    if (next === undefined || next === null || next === '') continue
    const text = typeof next === 'string' ? next : JSON.stringify(next)
    if (/[\r\n]/.test(text)) throw new Error(`Invocation header ${key} cannot contain CR/LF`)
    rendered[key] = text
  }
  return rendered
}

async function compileBody(
  body: MediaInvocationBody | undefined,
  context: InvocationCompilerContext,
): Promise<{
  body?: string | Buffer | Uint8Array
  contentType?: string
  binaryResponse?: boolean
}> {
  if (!body || body.kind === 'none') return {}
  if (body.kind === 'json') {
    const rendered = renderValue(body.template, context.variables)
    return {
      body: JSON.stringify(rendered ?? {}),
      contentType: 'application/json',
    }
  }
  if (body.kind === 'binary') {
    const value = resolveVariable(body.variable, context.variables)
    const buffer = await valueToBuffer(value, context.inputFiles, context.fetchImpl)
    return { body: buffer, contentType: 'application/octet-stream' }
  }
  const boundary = `----spark-media-${cryptoRandomId()}`
  const chunks: Buffer[] = []
  for (const part of body.parts) {
    const rendered = renderValue(part.value, context.variables)
    if (rendered === undefined || rendered === null || rendered === '') continue
    if (part.kind === 'file') {
      const fileValues = Array.isArray(rendered) ? rendered : [rendered]
      for (const fileValue of fileValues) {
        const buffer = await valueToBuffer(fileValue, context.inputFiles, context.fetchImpl)
        const filename = part.filename ?? fileNameForValue(fileValue, context.inputFiles)
        chunks.push(Buffer.from(`--${boundary}\r\n`))
        chunks.push(
          Buffer.from(
            `Content-Disposition: form-data; name="${escapeHeader(part.name)}"; filename="${escapeHeader(filename)}"\r\n`,
          ),
        )
        chunks.push(
          Buffer.from(`Content-Type: ${part.contentType ?? 'application/octet-stream'}\r\n\r\n`),
        )
        chunks.push(buffer)
        chunks.push(Buffer.from('\r\n'))
      }
      continue
    }
    chunks.push(Buffer.from(`--${boundary}\r\n`))
    chunks.push(
      Buffer.from(`Content-Disposition: form-data; name="${escapeHeader(part.name)}"\r\n`),
    )
    if (part.contentType) chunks.push(Buffer.from(`Content-Type: ${part.contentType}\r\n`))
    chunks.push(Buffer.from('\r\n'))
    const text = part.kind === 'json' ? JSON.stringify(rendered) : String(rendered)
    chunks.push(Buffer.from(text))
    chunks.push(Buffer.from('\r\n'))
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`))
  return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` }
}

function renderValue(value: unknown, variables: Record<string, unknown>): unknown {
  if (typeof value === 'string') {
    const exact = value.match(/^{{\s*([^}]+?)\s*}}$/)
    if (exact) return resolveVariable(exact[1]?.trim() ?? '', variables)
    return renderString(value, variables)
  }
  if (Array.isArray(value)) {
    const rendered = value
      .map((item) => renderValue(item, variables))
      .filter((item) => item !== undefined)
    return rendered.length > 0 ? rendered : undefined
  }
  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const next = renderValue(child, variables)
      if (next !== undefined && next !== '') output[key] = next
    }
    return output
  }
  return value
}

function renderString(value: string, variables: Record<string, unknown>): string {
  return value.replace(/{{\s*([^}]+?)\s*}}/g, (_match, key: string) => {
    const result = resolveVariable(key.trim(), variables)
    return result == null ? '' : String(result)
  })
}

function resolveVariable(pathName: string, variables: Record<string, unknown>): unknown {
  return pathName
    .split('.')
    .filter(Boolean)
    .reduce<unknown>((current, key) => {
      if (!current || typeof current !== 'object' || Array.isArray(current)) return undefined
      return (current as Record<string, unknown>)[key]
    }, variables)
}

function appendQuery(
  url: string,
  query: Record<string, unknown> | undefined,
  variables: Record<string, unknown>,
): string {
  const parsed = new URL(url)
  for (const [key, value] of Object.entries(query ?? {})) {
    const rendered = renderValue(value, variables)
    if (rendered === undefined || rendered === null || rendered === '') continue
    if (Array.isArray(rendered)) {
      for (const item of rendered) parsed.searchParams.append(key, String(item))
    } else {
      parsed.searchParams.set(
        key,
        typeof rendered === 'object' ? JSON.stringify(rendered) : String(rendered),
      )
    }
  }
  return parsed.toString()
}

function resolveUrl(base: string, endpoint: string): string {
  if (/^https?:\/\//i.test(endpoint)) return endpoint
  return `${base.replace(/\/+$/, '')}/${endpoint.replace(/^\/+/, '')}`
}

function assertHttpUrl(url: string): void {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error(`Invocation endpoint is not a valid absolute URL: ${url.slice(0, 200)}`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Invocation endpoint protocol ${parsed.protocol} is not allowed`)
  }
  if (parsed.username || parsed.password) {
    throw new Error('Invocation endpoint cannot contain embedded credentials')
  }
}

async function valueToBuffer(
  value: unknown,
  inputFiles: MediaInputFile[] | undefined,
  fetchImpl?: typeof fetch,
): Promise<Buffer> {
  if (Buffer.isBuffer(value)) return value
  if (value instanceof Uint8Array) return Buffer.from(value)
  if (typeof value === 'string') {
    if (value.startsWith('data:')) {
      const comma = value.indexOf(',')
      if (comma >= 0) return Buffer.from(value.slice(comma + 1), 'base64')
    }
    const file = findInputFile(value, inputFiles)
    if (file?.path) return readFile(file.path)
    if (file?.url?.startsWith('safe-file://') && file.path) return readFile(file.path)
  }
  const file = findInputFile(value, inputFiles)
  if (file?.path) return readFile(file.path)
  // Canvas/agent inputs frequently arrive as remote asset URLs (e.g. prior
  // generation artifacts). Multipart/binary providers cannot accept a URL, so
  // mirror the official openai-images adapter: download the bytes here.
  const remoteUrl = resolveRemoteInputUrl(value, file)
  if (remoteUrl) return downloadInputUrl(remoteUrl, fetchImpl)
  throw new Error('multipart/binary body requires a readable local input file or data URL')
}

function resolveRemoteInputUrl(value: unknown, file: MediaInputFile | undefined): string {
  if (typeof value === 'string' && /^https?:\/\//i.test(value)) return value
  const url = file?.url ?? ''
  return /^https?:\/\//i.test(url) ? url : ''
}

async function downloadInputUrl(url: string, fetchImpl?: typeof fetch): Promise<Buffer> {
  const doFetch = fetchImpl ?? fetch
  const response = await doFetch(url)
  if (!response.ok) {
    throw new MediaProviderError(
      'artifact_download_failed',
      `Failed to download input file ${url.slice(0, 120)}: HTTP ${response.status}`,
    )
  }
  return Buffer.from(await response.arrayBuffer())
}

function selectUploadFiles(variable: string, inputFiles: MediaInputFile[]): MediaInputFile[] {
  if (variable === 'inputFiles' || variable === 'file') return inputFiles
  if (variable === 'mask') return inputFiles.filter((file) => file.role === 'mask')
  if (variable === 'video') return inputFiles.filter((file) => file.type === 'video')
  if (variable === 'audio') return inputFiles.filter((file) => file.type === 'audio')
  if (variable === 'image' || variable === 'images')
    return inputFiles.filter((file) => file.type === 'image')
  if (variable === 'referenceImages' || variable === 'referenceImageUrls') {
    const refs = inputFiles.filter((file) => file.role === 'reference')
    return refs.length > 0 ? refs : inputFiles.filter((file) => file.type === 'image')
  }
  return inputFiles.filter((file) => file.role === variable || file.type === variable)
}

function validateUploadFiles(spec: MediaUploadSpec, files: MediaInputFile[]): void {
  const maxCount = spec.constraints?.maxCount
  if (maxCount != null && files.length > maxCount) {
    throw new MediaProviderError(
      'invalid_input',
      `Upload ${spec.name} accepts at most ${maxCount} files`,
    )
  }
  const allowed = spec.constraints?.allowedMimeTypes
  if (allowed && allowed.length > 0) {
    for (const file of files) {
      if (!file.mimeType || !allowed.includes(file.mimeType)) {
        throw new MediaProviderError(
          'invalid_input',
          `Upload ${spec.name} does not accept MIME type ${file.mimeType ?? '(unknown)'}`,
        )
      }
    }
  }
}

function extractStringPaths(value: unknown, paths: string[]): string[] {
  const values = paths.flatMap((pathName) => {
    let current: unknown[] = [value]
    for (const part of pathName.split('.').filter(Boolean)) {
      const array = part.endsWith('[]')
      const key = array ? part.slice(0, -2) : part
      current = current.flatMap((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return []
        const next = (item as Record<string, unknown>)[key]
        if (array) return Array.isArray(next) ? next : []
        return next === undefined ? [] : [next]
      })
    }
    return current
  })
  return Array.from(
    new Set(values.filter((item): item is string => typeof item === 'string' && item.length > 0)),
  )
}

function findInputFile(
  value: unknown,
  inputFiles: MediaInputFile[] | undefined,
): MediaInputFile | undefined {
  if (!inputFiles || inputFiles.length === 0) return undefined
  if (Array.isArray(value)) return inputFiles[0]
  if (typeof value !== 'string') return inputFiles[0]
  return inputFiles.find(
    (file) => file.path === value || file.url === value || file.dataUrl === value,
  )
}

function fileNameForValue(value: unknown, inputFiles: MediaInputFile[] | undefined): string {
  const file = findInputFile(value, inputFiles)
  if (file?.path) return path.basename(file.path)
  // Providers like gpt-image identify the upload format from the file name
  // extension; a bare "upload.bin" is rejected. Derive a real name from the
  // remote URL path, falling back to the declared MIME type.
  const remoteUrl = resolveRemoteInputUrl(value, file)
  if (remoteUrl) {
    try {
      const name = decodeURIComponent(new URL(remoteUrl).pathname.split('/').pop() ?? '')
      if (name && /\.[A-Za-z0-9]{2,5}$/.test(name)) return name
    } catch {
      // fall through to the MIME-based fallback below
    }
  }
  const extension = file?.mimeType ? extensionForInputMime(file.mimeType) : ''
  return extension ? `upload.${extension}` : 'upload.bin'
}

function extensionForInputMime(mimeType: string): string {
  const normalized = mimeType.split(';')[0]?.trim().toLowerCase() ?? ''
  if (normalized.includes('jpeg')) return 'jpg'
  if (normalized.includes('png')) return 'png'
  if (normalized.includes('webp')) return 'webp'
  if (normalized.includes('gif')) return 'gif'
  return ''
}

function escapeHeader(value: string): string {
  return value.replace(/["\\\r\n]/g, '_')
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  return Object.keys(headers).some((key) => key.toLowerCase() === name.toLowerCase())
}

function cryptoRandomId(): string {
  return randomUUID().replace(/-/g, '').slice(0, 12)
}
