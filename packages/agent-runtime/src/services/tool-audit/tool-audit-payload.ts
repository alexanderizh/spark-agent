/**
 * 工具审计载荷管道（设计方案 §4.3）：
 *   采集点捕获 input/output → redactToolPayload（复用 hook-redaction 的敏感键掩码
 *   与深度/条目/字符边界）→ canonical-json 规范化 → SHA-256 → 超内联阈值时
 *   内容寻址写入 `.spark-agent/audit/tool-payloads/{sha256}.json`。
 *
 * 明文永不落盘：归档的是脱敏表示；哈希作用于同一表示，链校验可稳定复算。
 * 与 storage 侧 canonicalJson（tool-invocation.repository）算法保持一致——
 * 稳定键序 + null/标量/数组/纯对象，undefined 键剔除。
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { redactValue } from '../hooks/hook-redaction.js'
import {
  writeContentAddressedWorkspaceFile,
  resolveContentAddressedWorkspaceFile,
  type ContentAddressedWorkspaceFile,
} from '../../tools/workspace-content-store.mjs'

/** 审计载荷独立归档目录（与 tool-results 的治理解耦，保留期见设计方案 §4.5）。 */
export const AUDIT_PAYLOAD_DIRECTORY = ['.spark-agent', 'audit', 'tool-payloads']

/** 单个审计载荷落盘上限（防病态载荷；脱敏边界生效后正常远达不到）。 */
export const AUDIT_PAYLOAD_MAX_BYTES = 64 * 1024 * 1024

export interface AuditedPayload {
  /** canonical-json 规范化序列化后的 SHA-256（hex）。载荷为 null/undefined 时为 null。 */
  sha256: string | null
  /** canonical-json 字节数。 */
  bytes: number | null
  /** 内容寻址归档 id（= sha256）；无工作区或写盘失败时为 null。 */
  artifactId: string | null
  /** 归档是否因超上限被截断（截断表示记 result_truncated / 尾注标注）。 */
  truncated: boolean
}

export function canonicalJsonStringify(value: unknown): string {
  if (value === null) return 'null'
  const type = typeof value
  if (type === 'string' || type === 'number' || type === 'boolean') return JSON.stringify(value)
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJsonStringify(item)).join(',')}]`
  }
  if (type === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJsonStringify(v)}`).join(',')}}`
  }
  return JSON.stringify(String(value))
}

/** 采集点入口：脱敏（有界）→ 规范化哈希。同步、无 IO，可在工具执行路径上直接调用。 */
export function redactToolPayload(value: unknown): unknown {
  return redactValue(value)
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex')
}

/**
 * flusher 侧归档：canonical-json 序列化 → 内容寻址写入（wx/0600/防逃逸原语复用）。
 * 任何失败都不得上抛——返回 artifactId=null 降级（哈希与字节数仍可入账本行）。
 */
export function archiveAuditedPayload(
  redacted: unknown,
  workspaceRoot: string | null | undefined,
): AuditedPayload {
  if (redacted == null) return { sha256: null, bytes: null, artifactId: null, truncated: false }
  const serialized = canonicalJsonStringify(redacted)
  const sha256 = sha256Hex(serialized)
  const bytes = Buffer.byteLength(serialized, 'utf8')
  let artifactId: string | null = null
  // 超单制品上限：不落盘、置 truncated（设计 §5.5：截断置 result_truncated，哈希仍可复算）。
  const truncated = bytes > AUDIT_PAYLOAD_MAX_BYTES
  if (!truncated && workspaceRoot != null && workspaceRoot !== '') {
    try {
      const written: ContentAddressedWorkspaceFile = writeContentAddressedWorkspaceFile({
        workspaceRoot,
        directorySegments: AUDIT_PAYLOAD_DIRECTORY,
        content: serialized,
        extension: '.json',
        maxBytes: AUDIT_PAYLOAD_MAX_BYTES,
        label: '工具审计载荷',
      })
      artifactId = written.sha256
    } catch {
      // 归档失败降级：账本行仍带 sha256/bytes，仅失去原文回看能力。
      artifactId = null
    }
  }
  return { sha256, bytes, artifactId, truncated }
}

/** detail 内联阈值：≤ 该字节数的归档载荷在 detail 响应中直接内联（脱敏表示）。 */
export const AUDIT_PAYLOAD_INLINE_MAX_BYTES = 64 * 1024

/** 归档载荷分页读取的单页上限（协议层 zod 同步限制 40k）。 */
export const AUDIT_PAYLOAD_READ_CHUNK_MAX = 40_000

export interface ReadAuditedPayloadChunkResult {
  /** 本页内容（utf-8 文本；归档是 canonical-json 序列化）。 */
  chunk: string
  nextOffset: number | null
  truncated: boolean
  bytes: number
}

/**
 * 查询层归档读取（IPC `tool-audit:read-payload` / detail 内联共用）：
 * 工作区根逐个尝试内容寻址定位 → 全量读入并重验 sha256（防篡改/防错位）→
 * 按offset/limit 切片返回。未命中任何工作区或校验失败返回 null。
 */
export function readAuditedPayloadChunk(params: {
  artifactId: string
  workspaceRoots: Array<string>
  offset?: number
  limit?: number
}): ReadAuditedPayloadChunkResult | null {
  const offset = Math.max(0, params.offset ?? 0)
  const limit = Math.min(
    AUDIT_PAYLOAD_READ_CHUNK_MAX,
    Math.max(1, params.limit ?? AUDIT_PAYLOAD_READ_CHUNK_MAX),
  )
  for (const workspaceRoot of params.workspaceRoots) {
    if (workspaceRoot == null || workspaceRoot === '') continue
    let resolved: ReturnType<typeof resolveContentAddressedWorkspaceFile>
    try {
      resolved = resolveContentAddressedWorkspaceFile({
        workspaceRoot,
        directorySegments: AUDIT_PAYLOAD_DIRECTORY,
        artifactId: params.artifactId,
        extensions: ['.json'],
      })
    } catch {
      continue
    }
    if (resolved == null) continue
    try {
      const content = readFileSync(resolved.path, 'utf8')
      // 重验：文件名 sha 必须 === 内容 sha（内容寻址防篡改语义）。
      if (sha256Hex(content) !== params.artifactId) continue
      const bytes = Buffer.byteLength(content, 'utf8')
      const end = Math.min(bytes, offset + limit)
      const chunk = content.slice(offset, end)
      return {
        chunk,
        nextOffset: end < bytes ? end : null,
        truncated: false,
        bytes,
      }
    } catch {
      continue
    }
  }
  return null
}

/** detail 内联读取：小载荷直出脱敏 JSON 值；超阈值/未命中返回 null（走 artifactId 模式）。 */
export function readAuditedPayloadInline(
  artifactId: string,
  workspaceRoots: Array<string>,
): unknown | null {
  const result = readAuditedPayloadChunk({ artifactId, workspaceRoots })
  if (result == null || result.bytes > AUDIT_PAYLOAD_INLINE_MAX_BYTES) return null
  try {
    return JSON.parse(result.chunk) as unknown
  } catch {
    return result.chunk
  }
}
