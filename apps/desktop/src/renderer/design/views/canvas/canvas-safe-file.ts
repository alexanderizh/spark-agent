/**
 * safe-file:// 协议的 renderer 侧编码工具。
 *
 * 与 main 进程的 `toSafeFileUrl`（SafeFileProtocol.ts）和 FilePreviewPanel 的
 * `encodeToSafeFileUrl` 保持相同的 base64url 编码策略，保证渲染端构造的 URL
 * 能被 main 进程的 `protocol.handle('safe-file', ...)` 正确解码并返回磁盘文件。
 *
 * 用途：canvas 的 audio/video/image 节点持有 `.spark-artifacts/media/*` 下产物
 * 的绝对路径，渲染时需要把它编码成 `safe-file://x/<base64url>` 才能喂给
 * `<audio src>` / `<video src>` / `<img src>`（Electron webSecurity 下 file:// 被拦）。
 */

import { normalizeEduAssetUrl } from '@spark/shared'

const SAFE_FILE_SCHEME = 'safe-file'

export function encodeToSafeFileUrl(absolutePath: string): string {
  const encoded = btoa(unescape(encodeURIComponent(absolutePath)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
  return `${SAFE_FILE_SCHEME}://x/${encoded}`
}

/**
 * 把媒体产物的磁盘路径转成 renderer 可直接加载的 URL。
 *
 * 优先级：
 *   1. 有本地文件路径 → 编码成 safe-file:// 返回，避免把大段 base64 持久化进 localStorage。
 *   2. 已有 data: URL（仅在没有 filePath 时使用）→ 直接返回。
 *   3. 有 http(s) URL → 直接返回。
 *   4. 都没有 → 返回空串。
 */
export function resolveMediaDisplayUrl(opts: {
  url?: string | null | undefined
  dataUrl?: string | null | undefined
  filePath?: string | null | undefined
}): string {
  if (opts.filePath) return encodeToSafeFileUrl(opts.filePath)
  if (opts.dataUrl) return opts.dataUrl
  if (opts.url && /^(data:|https?:)/i.test(opts.url)) return normalizeEduAssetUrl(opts.url)
  return ''
}

/** 读 File 为 dataURL（base64） */
export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'))
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.readAsDataURL(file)
  })
}

/** 读 dataURL 图像尺寸 */
export function readImageDimensions(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const image = new Image()
    image.onload = () =>
      resolve({ width: image.naturalWidth || 0, height: image.naturalHeight || 0 })
    image.onerror = () => resolve({ width: 0, height: 0 })
    image.src = src
  })
}
