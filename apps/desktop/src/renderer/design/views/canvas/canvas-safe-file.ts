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

/**
 * 把 `data:` URL 解析成 Blob —— **不经过 `fetch()`**。
 *
 * 渲染端 CSP 的 `connect-src 'self' safe-file:` 不含 `data:`，因此 `fetch(dataUrl)`
 * 会被拦成 `TypeError: Failed to fetch`（`img-src`/`media-src` 含 data: 只让图能显示）。
 * 凡是要把 canvas 截图 / 粘贴图的 dataURL 转成 Blob/File 的地方都必须走这里。
 */
export function dataUrlToBlob(dataUrl: string): Blob {
  const match = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(dataUrl)
  if (!match) throw new Error('Invalid data URL')
  const mimeType = match[1] || 'application/octet-stream'
  const isBase64 = Boolean(match[2])
  const raw = match[3] ?? ''
  if (isBase64) {
    const binary = atob(raw)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
    return new Blob([bytes], { type: mimeType })
  }
  return new Blob([decodeURIComponent(raw)], { type: mimeType })
}

/** 把 `data:` URL 转成 File（复用 {@link dataUrlToBlob}，不经过 fetch）。 */
export function dataUrlToFile(dataUrl: string, fileName: string): File {
  const blob = dataUrlToBlob(dataUrl)
  return new File([blob], fileName, { type: blob.type || 'image/png' })
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

/**
 * 读视频源尺寸与时长。
 *
 * 用于拖入视频生成节点时取宽高（决定节点卡片大小）。
 * 加载失败（格式不支持 / 文件损坏）时返回 0，由调用方回退到默认尺寸，
 * 不会阻塞节点创建流程。
 */
export function readVideoDimensions(
  src: string,
): Promise<{ width: number; height: number; durationMs?: number }> {
  return new Promise((resolve) => {
    const video = document.createElement('video')
    video.preload = 'metadata'
    const cleanup = () => {
      video.removeAttribute('src')
      video.load()
    }
    video.onloadedmetadata = () => {
      const result = {
        width: video.videoWidth || 0,
        height: video.videoHeight || 0,
        ...(Number.isFinite(video.duration) && video.duration > 0
          ? { durationMs: Math.round(video.duration * 1000) }
          : {}),
      }
      cleanup()
      resolve(result)
    }
    video.onerror = () => {
      cleanup()
      resolve({ width: 0, height: 0 })
    }
    video.src = src
  })
}
