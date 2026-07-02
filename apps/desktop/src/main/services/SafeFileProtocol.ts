/**
 * SafeFileProtocol — 自定义协议 `safe-file://`，让渲染进程能安全读取本地图片等文件
 *
 * 为什么需要这个
 * ────────────
 * - Electron 渲染进程默认无法直接访问本地 file:// 资源（contextIsolation + webSecurity），
 *   而我们生成的图片可能存放在 userData 或 workspace 的 `.spark-artifacts` 下，
 *   markdown 里写 `![alt](file:///.../image.png)` 会被浏览器拦截，显示破图。
 * - 方案：注册一个 `safe-file` 自定义协议，把 `safe-file://<encoded-absolute-path>`
 *   解析回磁盘文件返回给渲染端。渲染端拿到 `safe-file://...` 后可以直接给 `<img src>` 用。
 *
 * 安全约束
 * ────────
 * - 协议 URL 必须是 base64 编码的绝对路径，避免编码歧义。
 * - 路径必须落在白名单目录（userData、临时目录、已登记 workspace / canvas 项目根目录）下，
 *   防止越权读用户项目之外的 home/系统盘文件。
 * - 协议在 `registerSafeFileSchemes()` 阶段被声明为 `standard/secure/supportFetchAPI`，
 *   与 `file://` 同等安全等级。
 *
 * 调用流程
 * ────────
 * 1. 应用启动时（`app.whenReady()` 之前）调用 `registerSafeFileSchemes()`
 * 2. 启动后调用 `registerSafeFileProtocol()` 接管所有 `safe-file://` 请求
 * 3. 渲染进程拿到路径后，构造 `safe-file://<base64(path)>` 给 `<img src>` 使用
 */

import { app, protocol } from 'electron'
import { createLogger } from '@spark/shared'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { resolve as resolvePath, isAbsolute, sep, extname } from 'node:path'
import { Readable } from 'node:stream'
import { getDatabase } from '../db.js'

const log = createLogger('safe-file')

/** 自定义协议 scheme 名 */
export const SAFE_FILE_SCHEME = 'safe-file'

const MIME_BY_EXT: Record<string, string> = {
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.gif': 'image/gif',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.m4a': 'audio/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/opus',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.wav': 'audio/wav',
  '.webm': 'video/webm',
  '.webp': 'image/webp',
}

/**
 * 路径白名单根目录集合。
 *
 * 渲染进程通过 `safe-file://...` 只能读取以下目录下的文件：
 *   - userData（应用数据目录，包含 no-project 的 .spark-artifacts 等生成图片）
 *   - 系统临时目录（粘贴图片、预览副本等）
 *   - 已登记 workspace 根目录（项目里的任意文件，供内置文档/图片预览读取；
 *     .spark-artifacts 生成图片作为子目录天然包含在内）
 *   - canvas 项目根目录
 *
 * 任何落在白名单之外的请求都会被拒绝（返回 403）。
 */
export function getSafeFileAllowedRoots(): string[] {
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
  roots.push(...getWorkspaceRoots())
  roots.push(...getCanvasProjectRoots())
  return [...new Set(roots)]
}

/**
 * 已登记（未归档）workspace 的根目录集合。
 *
 * 内置文档/图片预览需要读取项目里的任意文件（PDF、docx、图片等），因此整体放行
 * workspace 根目录，而非只放行 .spark-artifacts 子目录。workspace 是用户主动登记的
 * 项目目录，agent 本就对其有完整读写权限，预览暴露给渲染进程不构成额外越权面；
 * 项目之外的 home/系统盘文件仍被拦截。
 */
function getWorkspaceRoots(): string[] {
  try {
    const rows = getDatabase().raw
      .prepare('SELECT root_path FROM workspaces WHERE archived_at IS NULL')
      .all() as Array<{ root_path?: unknown }>
    return rows
      .map((row) => (typeof row.root_path === 'string' ? row.root_path : ''))
      .filter((rootPath) => rootPath.length > 0)
      .map((rootPath) => resolvePath(rootPath))
  } catch {
    // The protocol is registered before DB initialization; workspace roots become
    // available on later requests after the database is ready.
    return []
  }
}

function getCanvasProjectRoots(): string[] {
  const roots: string[] = []
  try {
    const settingsRows = getDatabase().raw
      .prepare(`SELECT value FROM app_settings WHERE category = 'canvas' AND key = 'data'`)
      .all() as Array<{ value?: unknown }>
    for (const row of settingsRows) {
      try {
        const parsed = typeof row.value === 'string' ? JSON.parse(row.value) as { projectsRootPath?: unknown } : null
        if (typeof parsed?.projectsRootPath === 'string' && parsed.projectsRootPath.trim().length > 0) {
          roots.push(resolvePath(parsed.projectsRootPath))
        }
      } catch {
        // Ignore malformed user settings; userData remains allowed.
      }
    }
  } catch {
    // app_settings may not exist during early startup/migration.
  }
  try {
    const rows = getDatabase().raw
      .prepare('SELECT root_path FROM canvas_projects WHERE root_path IS NOT NULL AND status != ?')
      .all('deleted') as Array<{ root_path?: unknown }>
    roots.push(
      ...rows
        .map((row) => (typeof row.root_path === 'string' ? row.root_path : ''))
        .filter((rootPath) => rootPath.length > 0)
        .map((rootPath) => resolvePath(rootPath)),
    )
  } catch {
    // canvas_projects/root_path may not exist until migrations complete.
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
export function isSafeFilePathAllowed(absolutePath: string): boolean {
  const resolved = resolvePath(absolutePath)
  const allowedRoots = getSafeFileAllowedRoots()
  for (const root of allowedRoots) {
    if (isSamePathOrChild(resolved, root)) return true
  }
  return false
}

function isSamePathOrChild(targetPath: string, rootPath: string): boolean {
  const resolvedTarget = normalizePathForCompare(resolvePath(targetPath))
  const resolvedRoot = normalizePathForCompare(resolvePath(rootPath))
  if (resolvedTarget === resolvedRoot) return true
  return resolvedTarget.startsWith(resolvedRoot + sep)
}

function normalizePathForCompare(filePath: string): string {
  return process.platform === 'win32' ? filePath.toLowerCase() : filePath
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
 *   3. 返回带 Content-Type/Content-Length/Accept-Ranges 的文件响应。
 *      音视频元素会发 Range 请求读取 metadata 和拖动播放，因此这里显式支持 206。
 */
export function registerSafeFileProtocol(): void {
  protocol.handle(SAFE_FILE_SCHEME, async (request) => {
    const url = request.url
    const absolutePath = decodeSafeFileUrl(url)

    if (absolutePath == null) {
      log.warn(`safe-file: invalid URL: ${url}`)
      return new Response('Invalid safe-file URL', { status: 400 })
    }

    if (!isSafeFilePathAllowed(absolutePath)) {
      log.warn(`safe-file: path not allowed: ${absolutePath}`)
      return new Response('Forbidden', { status: 403 })
    }

    if (!existsSync(absolutePath)) {
      log.warn(`safe-file: file not found: ${absolutePath}`)
      return new Response('Not Found', { status: 404 })
    }

    try {
      return createSafeFileResponse(absolutePath, request)
    } catch (err) {
      log.error(`safe-file: failed to fetch ${absolutePath}: ${String(err)}`)
      return new Response('Internal Error', { status: 500 })
    }
  })

  log.info(`safe-file:// protocol registered (allowed roots: ${getSafeFileAllowedRoots().length})`)
}

export function createSafeFileResponse(absolutePath: string, request: Request): Response {
  const stat = statSync(absolutePath)
  if (!stat.isFile()) return new Response('Not Found', { status: 404 })

  const size = stat.size
  const mimeType = mimeTypeForPath(absolutePath)
  const baseHeaders = {
    'accept-ranges': 'bytes',
    'content-type': mimeType,
    // safe-file:// 已按白名单根目录校验来源，附带 ACAO 不扩大攻击面；
    // 有此头后 CORS 图片加载干净，WebGL 贴图不被跨域污染（截图 toDataURL 可用）。
    'access-control-allow-origin': '*',
  }

  if (size === 0) {
    return new Response(request.method === 'HEAD' ? null : new Uint8Array(), {
      status: 200,
      headers: { ...baseHeaders, 'content-length': '0' },
    })
  }

  const range = parseRangeHeader(request.headers.get('range'), size)
  if (range === 'invalid') {
    return new Response(null, {
      status: 416,
      headers: {
        ...baseHeaders,
        'content-range': `bytes */${size}`,
      },
    })
  }

  const start = range?.start ?? 0
  const end = range?.end ?? size - 1
  const contentLength = end - start + 1
  const headers: Record<string, string> = {
    ...baseHeaders,
    'content-length': String(contentLength),
  }
  if (range) headers['content-range'] = `bytes ${start}-${end}/${size}`

  const body = request.method === 'HEAD'
    ? null
    : Readable.toWeb(createReadStream(absolutePath, { start, end })) as unknown as ConstructorParameters<typeof Response>[0]

  return new Response(body, {
    status: range ? 206 : 200,
    headers,
  })
}

function mimeTypeForPath(filePath: string): string {
  return MIME_BY_EXT[extname(filePath).toLowerCase()] ?? 'application/octet-stream'
}

function parseRangeHeader(
  rangeHeader: string | null,
  size: number,
): { start: number; end: number } | 'invalid' | null {
  if (!rangeHeader) return null
  const match = rangeHeader.match(/^bytes=(\d*)-(\d*)$/)
  if (!match) return 'invalid'
  const startRaw = match[1] ?? ''
  const endRaw = match[2] ?? ''
  if (!startRaw && !endRaw) return 'invalid'

  let start: number
  let end: number

  if (!startRaw) {
    const suffixLength = Number.parseInt(endRaw, 10)
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return 'invalid'
    start = Math.max(0, size - suffixLength)
    end = size - 1
  } else {
    start = Number.parseInt(startRaw, 10)
    end = endRaw ? Number.parseInt(endRaw, 10) : size - 1
    if (!Number.isFinite(start) || !Number.isFinite(end)) return 'invalid'
    if (end >= size) end = size - 1
  }

  if (start < 0 || end < start || start >= size) return 'invalid'
  return { start, end }
}
