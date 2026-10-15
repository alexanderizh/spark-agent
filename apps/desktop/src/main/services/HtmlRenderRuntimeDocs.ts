import { lstat, realpath, stat } from 'node:fs/promises'
import { isAbsolute, resolve, sep } from 'node:path'
import { createRuntimeDocRegistry } from './RuntimeDocRegistry.js'

/**
 * 内容区 HTML 渲染块（mcp__spark_ui__render_html）的沙箱文档注册表。
 *
 * 与子应用共用 capability-asset 沙箱文档机制（见 RuntimeDocRegistry.ts），
 * 但独立存储：会话内容区可能同时展示大量 HTML 块，不能挤占子应用的
 * 容量。token 由 renderer 从 block 派生（见 renderer 的 render-html.ts），
 * inline / 侧面板 / 全屏多个展示入口共用同一 token，put 幂等覆盖。
 *
 * 文件预览多文件支持：put 可携带 assetRoot（预览 HTML 文件所在目录）。
 * 文档 URL 以 `<token>/` 目录形式加载后，文档内相对引用（style.css、
 * js/*.js 等）解析为 `<token>/<相对路径>`，协议层经 resolveHtmlRenderAsset
 * 按该目录从磁盘解析（安全约束与 SubAppPackageRuntime 一致：段校验 +
 * resolve 前缀 + realpath 符号链接双重防逃逸，仅普通文件）。
 */

export const HTML_RENDER_RUNTIME_HOST = 'html-render'

export interface HtmlRuntimeDocPutRequest {
  token: string
  document: string
  /** 预览文件所在目录（绝对路径）；登记后启用文档内相对资源的磁盘解析。 */
  assetRoot?: string
}
export interface HtmlRuntimeDocReleaseRequest {
  token: string
}
export interface HtmlRuntimeDocAck {
  ok: true
}

interface HtmlRenderDocMeta {
  assetRoot: string
}

const registry = createRuntimeDocRegistry<HtmlRenderDocMeta>({
  label: 'HTML render runtime doc',
  maxDocs: 256,
  ttlMs: 10 * 60 * 1000,
})

export async function putHtmlRenderRuntimeDoc(
  request: HtmlRuntimeDocPutRequest,
): Promise<HtmlRuntimeDocAck> {
  let meta: HtmlRenderDocMeta | null = null
  if (request.assetRoot != null) {
    const root = resolve(request.assetRoot)
    if (!isAbsolute(root)) throw new Error('HTML render asset root must be absolute')
    const stats = await stat(root)
    if (!stats.isDirectory()) throw new Error('HTML render asset root must be a directory')
    meta = { assetRoot: root }
  }
  registry.put(request.token, request.document, meta)
  return { ok: true }
}

export function releaseHtmlRenderRuntimeDoc(
  request: HtmlRuntimeDocReleaseRequest,
): HtmlRuntimeDocAck {
  registry.release(request.token)
  return { ok: true }
}

/** 供协议 handler 查询；命中即续期，未命中返回 null（404）。 */
export function takeHtmlRenderRuntimeDoc(token: string): string | null {
  return registry.take(token)
}

/**
 * 解析预览文档的相对资源请求（`<token>/<相对路径>`）为磁盘绝对路径。
 * 命中即续期文档 TTL；未登记 assetRoot、路径逃逸或目标非普通文件返回 null（404）。
 */
export async function resolveHtmlRenderAsset(
  token: string,
  segments: string[],
): Promise<string | null> {
  const meta = registry.takeMeta(token)
  if (meta == null) return null
  if (segments.length === 0) return null
  for (const segment of segments) {
    if (
      !segment ||
      segment === '.' ||
      segment === '..' ||
      segment.includes('/') ||
      segment.includes('\\')
    ) {
      return null
    }
  }
  const root = resolve(meta.assetRoot)
  const target = resolve(root, ...segments)
  if (!target.startsWith(`${root}${sep}`)) return null
  const [rootReal, targetReal] = await Promise.all([realpath(root), realpath(target)])
  if (!targetReal.startsWith(`${rootReal}${sep}`)) return null
  const stats = await lstat(targetReal)
  if (!stats.isFile() || stats.isSymbolicLink()) return null
  return targetReal
}
