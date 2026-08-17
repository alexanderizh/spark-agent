import { createLogger } from '@spark/shared'

/**
 * 子应用沙箱文档内存注册表。
 *
 * 为什么不用 iframe srcdoc：srcdoc 文档按 CSP 规范继承父文档（renderer）的
 * 策略容器，而 renderer 的 CSP 是 `script-src 'self' capability-asset:`，
 * 会拦掉子应用的内联脚本。改为把合成文档登记到主进程内存，用
 * `capability-asset://subapp-runtime/<token>` 导航加载——自定义 scheme 的
 * 文档有独立（空）策略容器，只受文档自带 meta CSP 约束，且 renderer CSP
 * 的 frame-src 已放行 capability-asset:。
 *
 * 生命周期：renderer 在挂载/重载时 put-doc，卸载时 release-doc；
 * 兜底用容量上限 + TTL 防止渲染进程崩溃后的残留。
 */

const log = createLogger('sub-app-runtime-docs')

const MAX_DOCS = 64
const DOC_TTL_MS = 10 * 60 * 1000

export const SUB_APP_RUNTIME_HOST = 'subapp-runtime'

export interface SubAppRuntimeDocPutRequest {
  token: string
  document: string
}
export interface SubAppRuntimeDocReleaseRequest {
  token: string
}
export interface SubAppRuntimeDocAck {
  ok: true
}

interface DocEntry {
  html: string
  expiresAt: number
}

const docs = new Map<string, DocEntry>()

const TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{7,79}$/

function isValidToken(token: string): boolean {
  return TOKEN_PATTERN.test(token)
}

function evictExpiredLocked(now: number): void {
  for (const [key, entry] of docs) {
    if (entry.expiresAt <= now) docs.delete(key)
  }
}

export function putSubAppRuntimeDoc(request: SubAppRuntimeDocPutRequest): SubAppRuntimeDocAck {
  if (!isValidToken(request.token)) throw new Error('Invalid sub-app runtime doc token')
  const now = Date.now()
  evictExpiredLocked(now)
  // 覆盖同 token（reload 复用 instanceId 的场景）不额外占用容量。
  if (!docs.has(request.token) && docs.size >= MAX_DOCS) {
    const oldest = [...docs.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt)[0]
    if (oldest != null) {
      docs.delete(oldest[0])
      log.warn(`Sub-app runtime docs reached ${MAX_DOCS}, evicted oldest token`)
    }
  }
  docs.set(request.token, { html: request.document, expiresAt: now + DOC_TTL_MS })
  return { ok: true }
}

export function releaseSubAppRuntimeDoc(
  request: SubAppRuntimeDocReleaseRequest,
): SubAppRuntimeDocAck {
  if (!isValidToken(request.token)) throw new Error('Invalid sub-app runtime doc token')
  docs.delete(request.token)
  return { ok: true }
}

/** 供协议 handler 查询；命中即续期，未命中返回 null（404）。 */
export function takeSubAppRuntimeDoc(token: string): string | null {
  if (!isValidToken(token)) return null
  const entry = docs.get(token)
  if (entry == null) return null
  entry.expiresAt = Date.now() + DOC_TTL_MS
  return entry.html
}
