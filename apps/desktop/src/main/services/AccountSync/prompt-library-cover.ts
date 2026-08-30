/**
 * 提示词库封面压缩工具（账号同步专用）
 *
 * 封面在本地有三种形态：data:（内嵌 base64）、http(s)://（远程）、safe-file:// 或
 * 绝对路径（本地文件）。同步时除远程 URL 原样保留外，其余统一压缩为
 * dataUrl 内嵌快照，避免把本机文件路径上传到云端，也让另一台设备可直接显示。
 *
 * 安全：本地文件读取复用 SafeFileProtocol 的允许目录白名单，杜绝任意路径读取；
 * 原图超过 SOURCE_MAX_BYTES 或压缩结果超过 COVER_MAX_BASE64_BYTES 时放弃封面
 * （条目本身仍正常同步，只是封面置空）。
 */

import { readFile } from 'node:fs/promises'
import sharp from 'sharp'
import { isSafeFilePathAllowed } from '../SafeFileProtocol.js'

const SOURCE_MAX_BYTES = 8 * 1024 * 1024
const COVER_MAX_EDGE = 512
const COVER_MAX_BASE64_BYTES = 240 * 1024
const COVER_QUALITY_STEPS = [80, 60, 40]

export interface PromptCoverCompressed {
  dataUrl: string
  mimeType: string
}

function isAbsolutePath(value: string): boolean {
  return /^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(value)
}

function decodeSafeFileUrl(value: string): string | null {
  if (!value.startsWith('safe-file://')) return null
  try {
    const rest = value.slice('safe-file://'.length)
    const slashIndex = rest.indexOf('/')
    if (slashIndex < 0) return null
    const encoded = rest.slice(slashIndex + 1)
    if (!encoded) return null
    const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/')
    const padding = base64.length % 4 === 0 ? '' : '='.repeat(4 - (base64.length % 4))
    const decoded = Buffer.from(base64 + padding, 'base64').toString('utf8')
    return isAbsolutePath(decoded) ? decoded : null
  } catch {
    return null
  }
}

/** data: 封面在体积允许时直接原样使用；过大则压缩。 */
async function normalizeDataUrlCover(
  value: string,
  mimeType: string | null,
): Promise<PromptCoverCompressed | null> {
  if (value.length <= COVER_MAX_BASE64_BYTES) {
    return { dataUrl: value, mimeType: mimeType ?? 'image/png' }
  }
  const buffer = Buffer.from(value.slice(value.indexOf(',') + 1), 'base64')
  return compressImageBuffer(buffer)
}

async function compressImageBuffer(buffer: Buffer): Promise<PromptCoverCompressed | null> {
  if (buffer.length === 0 || buffer.length > SOURCE_MAX_BYTES) return null
  try {
    const image = sharp(buffer, { limitInputPixels: 50_000_000, sequentialRead: true })
    for (const quality of COVER_QUALITY_STEPS) {
      const output = await image
        .rotate()
        .resize({
          width: COVER_MAX_EDGE,
          height: COVER_MAX_EDGE,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .jpeg({ quality, mozjpeg: true })
        .toBuffer()
      const dataUrl = `data:image/jpeg;base64,${output.toString('base64')}`
      if (dataUrl.length <= COVER_MAX_BASE64_BYTES) {
        return { dataUrl, mimeType: 'image/jpeg' }
      }
    }
    return null
  } catch {
    return null
  }
}

/**
 * 把封面源压缩为可同步的 dataUrl。
 * - http(s) 远程 URL：原样保留（另一台设备可直接加载，不做下载）
 * - data: 内嵌：体积允许则原样，过大则压缩
 * - safe-file:// / 绝对路径：读取本地文件并压缩
 * 无法读取或压缩失败返回 null（调用方将该条目封面置空）。
 */
export async function compressPromptCoverToDataUrl(
  source: string,
  mimeType: string | null,
): Promise<PromptCoverCompressed | null> {
  const trimmed = source.trim()
  if (!trimmed) return null
  if (/^https?:\/\//i.test(trimmed)) {
    return { dataUrl: trimmed, mimeType: mimeType ?? 'image/png' }
  }
  if (trimmed.startsWith('data:')) {
    if (!/^data:image\//i.test(trimmed)) return null
    return normalizeDataUrlCover(trimmed, mimeType)
  }
  const decodedPath = decodeSafeFileUrl(trimmed) ?? (isAbsolutePath(trimmed) ? trimmed : null)
  if (!decodedPath) return null
  if (!isSafeFilePathAllowed(decodedPath)) return null
  try {
    const buffer = await readFile(decodedPath)
    return await compressImageBuffer(buffer)
  } catch {
    return null
  }
}
