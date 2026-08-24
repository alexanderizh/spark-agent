import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync, unlinkSync, utimesSync } from 'node:fs'
import {
  resolveContentAddressedWorkspaceFile,
  resolveTrustedWorkspaceDirectory,
  writeContentAddressedWorkspaceFile,
} from './workspace-content-store.mjs'

export const TOOL_RESULT_INLINE_CHAR_LIMIT = 24_000
export const TOOL_RESULT_PREVIEW_CHAR_LIMIT = 8_000
export const TOOL_RESULT_READ_CHAR_LIMIT = 40_000
export const TOOL_RESULT_ARTIFACT_MAX_BYTES = 64 * 1024 * 1024

const TOOL_RESULT_DIRECTORY = ['.spark-agent', 'tool-results']
const TOOL_RESULT_EXTENSIONS = ['.txt', '.json']
const TOOL_RESULT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000
const TOOL_RESULT_TOTAL_BYTES = 512 * 1024 * 1024
const ERROR_LINE_PATTERN =
  /(?:^|\b)(?:error|failed|failure|fatal|exception|traceback|panic|caused by|assertion|segmentation fault|syntaxerror|typeerror|referenceerror|ts\d{3,5}|npm err|\u2009err_|✗|×)(?:\b|:)/i

export function governMcpToolResult(result, options) {
  const serialized = serializeToolResult(result)
  if (serialized.content.length <= TOOL_RESULT_INLINE_CHAR_LIMIT) return result
  const envelope = createToolResultEnvelope(serialized, {
    ...options,
    status: result?.isError === true ? 'error' : 'success',
  })
  return {
    ...(result?._meta != null ? { _meta: result._meta } : {}),
    ...(result?.isError === true ? { isError: true } : {}),
    content: [{ type: 'text', text: JSON.stringify(envelope, null, 2) }],
    structuredContent: envelope,
  }
}

export function governAgentToolResultEvent(event, workspaceRoot) {
  if (event == null || event.type !== 'tool_result') return event
  const payload =
    event.output !== undefined && event.error !== undefined
      ? event.output === event.error
        ? event.output
        : { output: event.output, error: event.error }
      : event.output !== undefined
        ? event.output
        : (event.error ?? '')
  const serialized = serializeToolResult(payload)
  if (serialized.content.length <= TOOL_RESULT_INLINE_CHAR_LIMIT) return event
  const envelope = createToolResultEnvelope(serialized, {
    workspaceRoot,
    toolName: event.toolName,
    toolCallId: event.toolCallId,
    status: event.status,
  })
  return {
    ...event,
    output: envelope,
    ...(event.status === 'error' || event.status === 'denied'
      ? { error: envelope.preview.text }
      : {}),
  }
}

export function readToolResultArtifact(workspaceRoot, artifactId, options = {}) {
  const artifact = requireArtifact(workspaceRoot, artifactId)
  const content = artifact.content
  const offset = clampInteger(options.offset, 0, content.length, 0)
  const limit = clampInteger(options.limit, 1, TOOL_RESULT_READ_CHAR_LIMIT, 8_000)
  const chunk = content.slice(offset, offset + limit)
  const nextOffset = offset + chunk.length
  return {
    artifactId,
    format: artifact.extension === '.json' ? 'json' : 'text',
    offset,
    limit,
    content: chunk,
    nextOffset: nextOffset < content.length ? nextOffset : null,
    totalCharacters: content.length,
    bytes: artifact.bytes,
    eof: nextOffset >= content.length,
  }
}

export function searchToolResultArtifact(workspaceRoot, artifactId, query, options = {}) {
  if (typeof query !== 'string' || query.length === 0 || query.length > 500) {
    throw new Error('query 必须是 1-500 字符的普通文本。')
  }
  const artifact = requireArtifact(workspaceRoot, artifactId)
  const content = artifact.content
  const caseSensitive = options.caseSensitive === true
  const haystack = caseSensitive ? content : content.toLowerCase()
  const needle = caseSensitive ? query : query.toLowerCase()
  const maxMatches = clampInteger(options.maxMatches, 1, 50, 10)
  const contextChars = clampInteger(options.contextChars, 0, 2_000, 240)
  const matches = []
  let cursor = 0
  let totalMatches = 0

  while (cursor <= haystack.length - needle.length) {
    const index = haystack.indexOf(needle, cursor)
    if (index < 0) break
    totalMatches += 1
    if (matches.length < maxMatches) {
      const start = Math.max(0, index - contextChars)
      const end = Math.min(content.length, index + query.length + contextChars)
      matches.push({ offset: index, start, end, snippet: content.slice(start, end) })
    }
    cursor = index + Math.max(needle.length, 1)
  }

  return {
    artifactId,
    query,
    caseSensitive,
    matches,
    totalMatches,
    truncated: totalMatches > matches.length,
  }
}

export function listToolResultArtifacts(workspaceRoot, options = {}) {
  const resolved = resolveTrustedWorkspaceDirectory(workspaceRoot, TOOL_RESULT_DIRECTORY)
  if (resolved == null) return []
  const limit = clampInteger(options.limit, 1, 100, 20)
  return readdirSync(resolved.directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^[a-f0-9]{64}\.(?:txt|json)$/.test(entry.name))
    .map((entry) => {
      const file = `${resolved.directory}/${entry.name}`
      const info = statSync(file)
      const extension = entry.name.endsWith('.json') ? '.json' : '.txt'
      return {
        artifactId: entry.name.slice(0, 64),
        format: extension === '.json' ? 'json' : 'text',
        bytes: info.size,
        updatedAt: info.mtime.toISOString(),
      }
    })
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, limit)
}

function createToolResultEnvelope(serialized, options) {
  const previewSource = createPreviewSource(serialized)
  let artifact
  try {
    const stored = writeContentAddressedWorkspaceFile({
      workspaceRoot: options.workspaceRoot,
      directorySegments: TOOL_RESULT_DIRECTORY,
      content: serialized.content,
      extension: serialized.extension,
      maxBytes: TOOL_RESULT_ARTIFACT_MAX_BYTES,
      label: '工具结果制品',
    })
    touchArtifact(stored.path)
    pruneToolResultArtifacts(options.workspaceRoot, stored.path)
    artifact = {
      available: true,
      artifactId: stored.sha256,
      sha256: stored.sha256,
      format: serialized.format,
      mimeType: serialized.mimeType,
      bytes: stored.bytes,
      characters: serialized.content.length,
      relativePath: stored.relativePath,
      reused: stored.reused,
    }
  } catch (error) {
    artifact = {
      available: false,
      reason: error instanceof Error ? error.message : String(error),
      format: serialized.format,
      mimeType: serialized.mimeType,
      bytes: Buffer.byteLength(serialized.content, 'utf8'),
      characters: serialized.content.length,
    }
  }
  const preview = createToolAwarePreview(previewSource.content, {
    toolName: options.toolName,
    status: options.status,
    originalCharacters: serialized.content.length,
    sanitized: previewSource.sanitized,
    archiveAvailable: artifact.available,
  })

  return {
    kind: 'spark.tool_result_envelope',
    version: 1,
    toolName: options.toolName,
    ...(options.toolCallId ? { toolCallId: options.toolCallId } : {}),
    status: options.status,
    preview,
    artifact,
    continuation: artifact.available
      ? {
          listTool: 'mcp__spark_tool_results__list',
          readTool: 'mcp__spark_tool_results__read',
          searchTool: 'mcp__spark_tool_results__search',
        }
      : null,
  }
}

function serializeToolResult(value) {
  if (typeof value === 'string') {
    return { content: value, extension: '.txt', format: 'text', mimeType: 'text/plain' }
  }
  const seen = new WeakSet()
  const content =
    JSON.stringify(
      value,
      (_key, nested) => {
        if (typeof nested === 'bigint') return nested.toString()
        if (nested != null && typeof nested === 'object') {
          if (seen.has(nested)) return '[circular]'
          seen.add(nested)
        }
        return nested
      },
      2,
    ) ?? String(value)
  return { content, extension: '.json', format: 'json', mimeType: 'application/json' }
}

function createPreviewSource(serialized) {
  if (serialized.format !== 'json') return { content: serialized.content, sanitized: false }
  let sanitized = false
  try {
    const parsed = JSON.parse(serialized.content)
    const content = JSON.stringify(
      parsed,
      function previewReplacer(key, value) {
        if (!shouldOmitBinaryPreviewValue(this, key, value)) return value
        sanitized = true
        return `[binary payload omitted from preview: ${value.length} characters]`
      },
      2,
    )
    return { content, sanitized }
  } catch {
    return { content: serialized.content, sanitized: false }
  }
}

function shouldOmitBinaryPreviewValue(parent, key, value) {
  if (typeof value !== 'string' || value.length <= 512) return false
  if (/^data:(?:(?:image|audio|video)\/|application\/octet-stream)/i.test(value)) return true
  if (key === 'blob') return true
  if (key !== 'data') return false
  const record = parent != null && typeof parent === 'object' ? parent : {}
  const mediaType = typeof record.type === 'string' ? record.type.toLowerCase() : ''
  const mimeType = typeof record.mimeType === 'string' ? record.mimeType.toLowerCase() : ''
  if (mediaType === 'image' || mediaType === 'audio' || mediaType === 'video') return true
  if (/^(?:image|audio|video)\//.test(mimeType)) return true
  return /^[a-z0-9+/_=-]+$/i.test(value.slice(0, 512))
}

function createToolAwarePreview(content, options) {
  if (content.length <= TOOL_RESULT_PREVIEW_CHAR_LIMIT && options.sanitized !== true) {
    return { strategy: 'full', truncated: false, text: content }
  }
  const errorFocused = shouldPreferErrors(options, content)
    ? collectErrorContext(content, Math.floor(TOOL_RESULT_PREVIEW_CHAR_LIMIT * 0.72))
    : ''
  const remaining = Math.max(800, TOOL_RESULT_PREVIEW_CHAR_LIMIT - errorFocused.length - 240)
  const boundary = clipHeadTail(content, remaining, 0.58)
  const archiveNotice = options.archiveAvailable
    ? `\n[完整工具结果已归档；原始长度 ${options.originalCharacters ?? content.length} 字符。请使用 spark_tool_results 的 read/search 继续读取。]`
    : `\n[工具结果过长，预览已截断；完整结果未能归档。原始长度 ${options.originalCharacters ?? content.length} 字符。]`
  return {
    strategy:
      errorFocused.length > 0
        ? 'error-context-and-boundaries'
        : options.sanitized === true
          ? 'sanitized-and-boundaries'
          : 'head-and-tail',
    truncated: true,
    text: [errorFocused, boundary, archiveNotice].filter(Boolean).join('\n\n'),
  }
}

function shouldPreferErrors(options, content) {
  if (options.status === 'error' || options.status === 'denied') return true
  if (/bash|shell|exec|build|test|lint|compile/i.test(options.toolName ?? '')) {
    return ERROR_LINE_PATTERN.test(content)
  }
  return false
}

function collectErrorContext(content, limit) {
  const lines = content.split(/\r?\n/)
  const selected = new Set()
  for (let index = 0; index < lines.length; index += 1) {
    if (!ERROR_LINE_PATTERN.test(lines[index] ?? '')) continue
    for (
      let nearby = Math.max(0, index - 2);
      nearby <= Math.min(lines.length - 1, index + 2);
      nearby += 1
    ) {
      selected.add(nearby)
    }
  }
  if (selected.size === 0) return ''
  let result = ''
  let previous = -2
  for (const index of [...selected].sort((left, right) => left - right)) {
    const prefix = index > previous + 1 ? '…\n' : ''
    const next = `${prefix}[L${index + 1}] ${lines[index] ?? ''}\n`
    if (result.length + next.length > limit) break
    result += next
    previous = index
  }
  return result.trimEnd()
}

function clipHeadTail(content, limit, headRatio) {
  if (content.length <= limit) return content
  const marker = '\n…[中间内容省略]…\n'
  const available = Math.max(0, limit - marker.length)
  const head = Math.floor(available * headRatio)
  return `${content.slice(0, head)}${marker}${content.slice(-(available - head))}`
}

function requireArtifact(workspaceRoot, artifactId) {
  const artifact = resolveContentAddressedWorkspaceFile({
    workspaceRoot,
    directorySegments: TOOL_RESULT_DIRECTORY,
    artifactId,
    extensions: TOOL_RESULT_EXTENSIONS,
  })
  if (artifact == null) throw new Error(`工具结果制品不存在：${artifactId}`)
  const content = readFileSync(artifact.path, 'utf8')
  const actualSha256 = createHash('sha256').update(content, 'utf8').digest('hex')
  if (actualSha256 !== artifactId) {
    throw new Error(`工具结果制品完整性校验失败：${artifactId}`)
  }
  touchArtifact(artifact.path)
  return { ...artifact, content }
}

function touchArtifact(file) {
  const now = new Date()
  try {
    utimesSync(file, now, now)
  } catch {
    // Reuse remains valid even if mtime cannot be refreshed.
  }
}

function pruneToolResultArtifacts(workspaceRoot, protectedPath) {
  try {
    const resolved = resolveTrustedWorkspaceDirectory(workspaceRoot, TOOL_RESULT_DIRECTORY)
    if (resolved == null) return
    const now = Date.now()
    const files = readdirSync(resolved.directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /^[a-f0-9]{64}\.(?:txt|json)$/.test(entry.name))
      .map((entry) => {
        const path = `${resolved.directory}/${entry.name}`
        return { path, ...statSync(path) }
      })
      .sort((left, right) => left.mtimeMs - right.mtimeMs)

    let totalBytes = files.reduce((sum, item) => sum + item.size, 0)
    for (const file of files) {
      if (file.path === protectedPath) continue
      if (now - file.mtimeMs <= TOOL_RESULT_RETENTION_MS && totalBytes <= TOOL_RESULT_TOTAL_BYTES) {
        continue
      }
      unlinkSync(file.path)
      totalBytes -= file.size
    }
  } catch {
    // Cache pruning is best-effort and must not change the tool result.
  }
}

function clampInteger(value, min, max, fallback) {
  return typeof value === 'number' && Number.isInteger(value)
    ? Math.min(max, Math.max(min, value))
    : fallback
}
