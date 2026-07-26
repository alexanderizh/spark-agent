import { fileURLToPath } from 'node:url'
import { createLogger } from '@spark/shared'
import { isSafeFilePathAllowed } from './SafeFileProtocol.js'

const log = createLogger('external-url-policy')

/**
 * 画布和调试浏览器需要兼容大量自定义协议，因此这里采用明确拒绝危险协议的策略，
 * 而不是脆弱的 http(s) 白名单。file: 仍受已登记 workspace / canvas 根目录约束。
 */
const BLOCKED_EXTERNAL_PROTOCOLS = new Set([
  'about:',
  'blob:',
  'chrome:',
  'chrome-extension:',
  'data:',
  'devtools:',
  'filesystem:',
  'javascript:',
  'safe-file:',
  'view-source:',
])

export interface ExternalUrlDecision {
  allowed: boolean
  reason?: string
}

export function evaluateExternalUrl(
  rawUrl: string,
  isFileAllowed: (filePath: string) => boolean = isSafeFilePathAllowed,
): ExternalUrlDecision {
  const candidate = rawUrl.trim()
  if (candidate.length === 0 || candidate.length > 32_768) {
    return { allowed: false, reason: 'empty or oversized URL' }
  }

  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    return { allowed: false, reason: 'invalid URL' }
  }

  const protocol = url.protocol.toLowerCase()
  if (BLOCKED_EXTERNAL_PROTOCOLS.has(protocol)) {
    return { allowed: false, reason: `blocked protocol ${protocol}` }
  }
  if (protocol === 'file:') {
    try {
      return isFileAllowed(fileURLToPath(url))
        ? { allowed: true }
        : { allowed: false, reason: 'file is outside registered roots' }
    } catch {
      return { allowed: false, reason: 'invalid file URL' }
    }
  }

  // 允许 http(s)、mailto、IDE 链接和其它合法自定义协议，保留无限画布扩展能力。
  return { allowed: true }
}

export async function openExternalUrlSafely(
  rawUrl: string,
  openExternal: (url: string) => Promise<unknown>,
): Promise<boolean> {
  const decision = evaluateExternalUrl(rawUrl)
  if (!decision.allowed) {
    log.warn(`Blocked external URL (${decision.reason ?? 'policy'})`)
    return false
  }
  try {
    await openExternal(rawUrl)
    return true
  } catch (error) {
    log.warn(`Failed to open external URL: ${String(error)}`)
    return false
  }
}

export function isWebviewSourceAllowed(rawUrl: string): boolean {
  const candidate = rawUrl.trim()
  if (candidate.length === 0) return true
  try {
    return !BLOCKED_EXTERNAL_PROTOCOLS.has(new URL(candidate).protocol.toLowerCase())
  } catch {
    return false
  }
}
