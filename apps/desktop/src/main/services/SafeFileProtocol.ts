/**
 * SafeFileProtocol — 自定义协议 `safe-file://`，让渲染进程能安全读取本地图片等文件
 *
 * 为什么需要这个
 * ────────────
 * - Electron 渲染进程默认无法直接访问本地 file:// 资源（contextIsolation + webSecurity），
 *   而我们生成的图片存放在 userData 目录下（`~/Library/Application Support/@spark/...`），
 *   markdown 里写 `![alt](file:///.../image.png)` 会被浏览器拦截，显示破图。
 * - 方案：注册一个 `safe-file` 自定义协议，把 `safe-file://<encoded-absolute-path>`
 *   解析回磁盘文件返回给渲染端。渲染端拿到 `safe-file://...` 后可以直接给 `<img src>` 用。
 *
 * 安全约束
 * ────────
 * - 协议 URL 必须是 base64 编码的绝对路径，避免编码歧义。
 * - 路径必须落在白名单目录（userData、临时工作区）下，防止越权读系统盘。
 * - 协议在 `registerSafeFileSchemes()` 阶段被声明为 `standard/secure/supportFetchAPI`，
 *   与 `file://` 同等安全等级。
 *
 * 调用流程
 * ────────
 * 1. 应用启动时（`app.whenReady()` 之前）调用 `registerSafeFileSchemes()`
 * 2. 启动后调用 `registerSafeFileProtocol()` 接管所有 `safe-file://` 请求
 * 3. 渲染进程拿到路径后，构造 `safe-file://<base64(path)>` 给 `<img src>` 使用
 */

import { app, protocol, net } from 'electron'
import { pathToFileURL } from 'node:url'
import { createLogger } from '@spark/shared'
import { existsSync } from 'node:fs'
import { resolve as resolvePath, isAbsolute, sep } from 'node:path'

const log = createLogger('safe-file')

/** 自定义协议 scheme 名 */
export const SAFE_FILE_SCHEME = 'safe-file'

/**
 * 路径白名单根目录集合。
 *
 * 渲染进程通过 `safe-file://...` 只能读取以下目录下的文件：
 *   - userData（应用数据目录，包含 .spark-artifacts 等生成的图片）
 *   - 系统临时目录（agent 临时工作区可能落在 /tmp 下）
 *
 * 任何落在白名单之外的请求都会被拒绝（返回 403）。
 */
function getAllowedRoots(): string[] {
  const roots: string[] = []
  try {
    roots.push(resolvePath(app.getPath('userData')))
  } catch (err) {
    log.warn(`Failed to resolve userData path: ${String(err)}`)
  }
  try {
    roots.push(resolvePath(app.getPath('temp')))
  } catch (err) {
    log.warn(`Failed to resolve temp path: ${String(err)}`)
  }
  return roots
}

/**
 * 在 `app.whenReady()` 之前调用，告知 Electron 把 `safe-file` 视为
 * 与 `file://` 等价的特权协议（支持 fetch API、绕过 CSP/CORS）。
 */
export function registerSafeFileSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SAFE_FILE_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        // 不需要 bypassCSP — 我们的 CSP 允许 safe-file: 资源
        // 不需要 stream — Node.js fs 一次性读取足够
        // 不需要 codeCache — 静态图片资源
      },
    },
  ])
}

/**
 * 把绝对路径编码成 `safe-file://` URL。
 * 渲染端拿到这个字符串后可以直接当 `<img src>` 用。
 *
 * 编码策略：base64url 编码绝对路径，避免 URL 转义带来的歧义。
 * 路径必须已经是绝对路径（isAbsolute 校验），否则抛错。
 */
export function toSafeFileUrl(absolutePath: string): string {
  if (!isAbsolute(absolutePath)) {
    throw new Error(`toSafeFileUrl requires absolute path, got: ${absolutePath}`)
  }
  // 用 base64url 编码（不带 padding），URL 友好
  const encoded = Buffer.from(absolutePath, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
  return `${SAFE_FILE_SCHEME}://x/${encoded}`
}

/**
 * 检查一个绝对路径是否落在白名单根目录下。
 * 防止渲染进程通过协议读取 /etc/passwd、~/.ssh 等敏感文件。
 */
function isPathAllowed(absolutePath: string): boolean {
  const resolved = resolvePath(absolutePath)
  const allowedRoots = getAllowedRoots()
  for (const root of allowedRoots) {
    if (resolved === root) return true
    // resolved 必须以 root + sep 开头才算在该目录下
    if (resolved.startsWith(root + sep)) return true
  }
  return false
}

/**
 * 把 `safe-file://...` URL 解码回绝对路径。
 * 失败时返回 null（让 protocol handler 返回 404）。
 */
function decodeSafeFileUrl(url: string): string | null {
  try {
    // URL 形如 safe-file://x/<base64>
    // 用 split 拿到 path 部分再 base64 解码，比 new URL() 容错性更好
    const prefix = `${SAFE_FILE_SCHEME}://`
    if (!url.startsWith(prefix)) return null
    const rest = url.slice(prefix.length)
    // 去掉 host 段（我们用 "x" 作为 host 占位）
    const slashIdx = rest.indexOf('/')
    if (slashIdx < 0) return null
    const encoded = rest.slice(slashIdx + 1)
    if (!encoded) return null
    // 还原 base64url -> base64
    const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/')
    const padding = base64.length % 4 === 0 ? '' : '='.repeat(4 - (base64.length % 4))
    const decoded = Buffer.from(base64 + padding, 'base64').toString('utf8')
    if (!decoded || !isAbsolute(decoded)) return null
    return decoded
  } catch (err) {
    log.warn(`Failed to decode safe-file URL: ${String(err)}`)
    return null
  }
}

/**
 * 在 `app.whenReady()` 之后调用，注册 `safe-file://` 协议 handler。
 * 处理逻辑：
 *   1. 解析 URL -> 绝对路径
 *   2. 校验路径在白名单内
 *   3. 用 net.fetch 读取本地文件（复用 Electron 内部 HTTP 缓存与 mime 推断）
 */
export function registerSafeFileProtocol(): void {
  protocol.handle(SAFE_FILE_SCHEME, async (request) => {
    const url = request.url
    const absolutePath = decodeSafeFileUrl(url)

    if (absolutePath == null) {
      log.warn(`safe-file: invalid URL: ${url}`)
      return new Response('Invalid safe-file URL', { status: 400 })
    }

    if (!isPathAllowed(absolutePath)) {
      log.warn(`safe-file: path not allowed: ${absolutePath}`)
      return new Response('Forbidden', { status: 403 })
    }

    if (!existsSync(absolutePath)) {
      log.warn(`safe-file: file not found: ${absolutePath}`)
      return new Response('Not Found', { status: 404 })
    }

    try {
      // pathToFileURL 把本地路径转成 file:// URL，net.fetch 内部走 file 协议，
      // 仍然受 webSecurity 保护（与之前的 file:// 行为不同——这里是因为我们通过
      // 自定义 scheme 走，且 scheme 已被声明为 secure）
      const fileUrl = pathToFileURL(absolutePath).toString()
      return await net.fetch(fileUrl)
    } catch (err) {
      log.error(`safe-file: failed to fetch ${absolutePath}: ${String(err)}`)
      return new Response('Internal Error', { status: 500 })
    }
  })

  log.info(`safe-file:// protocol registered (allowed roots: ${getAllowedRoots().length})`)
}
