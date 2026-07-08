/**
 * 多媒体产物落盘服务：把 url / base64 / 文本写入本地 .spark-artifacts/media/<kind>。
 * 见 design doc §8 step 6。
 */

import { mkdir, writeFile, readFile } from 'node:fs/promises'
import path from 'node:path'
import { MediaProviderError } from './media-adapter.types.js'
import type { MediaGeneratedAsset, MediaArtifactType } from './media-adapter.types.js'
import type { ExtractedImage } from './media-http.util.js'

const MIME_TO_EXT: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'audio/mpeg': '.mp3',
  'audio/mp3': '.mp3',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
  'audio/ogg': '.ogg',
  'audio/opus': '.opus',
  'audio/aac': '.aac',
  'audio/flac': '.flac',
  'audio/pcm': '.pcm',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
}

export function extFromMime(mime: string | undefined, fallback = '.bin'): string {
  if (!mime) return fallback
  const normalized = (mime.toLowerCase().split(';')[0] ?? '').trim()
  return MIME_TO_EXT[normalized] ?? fallback
}

export function mimeFromExt(filename: string): string | undefined {
  const ext = path.extname(filename).toLowerCase()
  for (const [mime, e] of Object.entries(MIME_TO_EXT)) {
    if (e === ext) return mime
  }
  return undefined
}

export class MediaArtifactService {
  /** 把图片（url 或 base64）落盘，返回 asset 元信息 */
  async writeImage(
    image: ExtractedImage,
    outputDir: string,
    filename: string,
    fetchImpl?: typeof fetch,
  ): Promise<MediaGeneratedAsset> {
    const dir = path.join(outputDir, 'images')
    await mkdir(dir, { recursive: true })
    const buffer = image.kind === 'url'
      ? await this.downloadBuffer(image.value, fetchImpl)
      : Buffer.from(image.value, 'base64')
    const mimeType = image.mimeType ?? 'image/png'
    const file = this.resolveUniquePath(dir, filename, extFromMime(mimeType))
    await writeFile(file, buffer)
    return {
      type: 'image',
      filePath: file,
      mimeType,
      raw: image.kind === 'url' ? { url: image.value } : undefined,
    }
  }

  /** 把二进制音频/视频（直接 buffer）落盘 */
  async writeBinaryAsset(
    kind: 'audio' | 'video',
    buffer: Buffer,
    outputDir: string,
    filename: string,
    mimeType?: string,
  ): Promise<MediaGeneratedAsset> {
    const dir = path.join(outputDir, kind === 'audio' ? 'audio' : 'videos')
    await mkdir(dir, { recursive: true })
    const ext = extFromMime(mimeType, kind === 'audio' ? '.mp3' : '.mp4')
    const file = this.resolveUniquePath(dir, filename, ext)
    await writeFile(file, buffer)
    return { type: kind, filePath: file, mimeType }
  }

  /** 把远程 url 的音频/视频下载落盘 */
  async downloadMediaAsset(
    kind: 'audio' | 'video',
    url: string,
    outputDir: string,
    filename: string,
    fetchImpl?: typeof fetch,
  ): Promise<MediaGeneratedAsset> {
    const buffer = await this.downloadBuffer(url, fetchImpl)
    // 从 url 后缀或 content-type 推断 mime
    const ext = path.extname(new URL(url).pathname).toLowerCase()
    const mimeType = mimeFromExt(`x${ext}`) ?? (kind === 'audio' ? 'audio/mpeg' : 'video/mp4')
    return this.writeBinaryAsset(kind, buffer, outputDir, filename, mimeType)
  }

  /** 把文本（语音转写）写成 text asset */
  async writeTextAsset(
    text: string,
    outputDir: string,
    filename: string,
  ): Promise<MediaGeneratedAsset> {
    const dir = path.join(outputDir, 'text')
    await mkdir(dir, { recursive: true })
    const file = this.resolveUniquePath(dir, filename, '.txt')
    await writeFile(file, text, 'utf8')
    return { type: 'text', filePath: file, contentText: text, mimeType: 'text/plain' }
  }

  /** 读取本地文件为 Buffer（用于 multipart / base64 上传） */
  async readLocalFile(filePath: string): Promise<Buffer> {
    try {
      return await readFile(filePath)
    } catch (err) {
      throw new MediaProviderError(
        'invalid_input',
        `Cannot read input file ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  private resolveUniquePath(dir: string, filename: string, ext: string): string {
    const parsed = path.parse(filename || `media_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`)
    const base = parsed.name || `media_${Date.now()}`
    const finalExt = parsed.ext || ext
    return path.join(dir, `${base}${finalExt}`)
  }

  private async downloadBuffer(url: string, fetchImpl?: typeof fetch): Promise<Buffer> {
    const impl = fetchImpl ?? fetch
    try {
      const res = await impl(url)
      if (!res.ok) {
        throw new MediaProviderError(
          'artifact_download_failed',
          `Download failed HTTP ${res.status}: ${url}`,
          res.status,
        )
      }
      return Buffer.from(await res.arrayBuffer())
    } catch (err) {
      if (err instanceof MediaProviderError) throw err
      throw new MediaProviderError(
        'artifact_download_failed',
        `Download failed: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }
}

export function defaultOutputDir(workspaceRootPath: string, kind: MediaArtifactType): string {
  return path.join(workspaceRootPath, '.spark-artifacts', 'media', kind === 'image' ? 'images' : kind === 'audio' ? 'audio' : kind === 'video' ? 'videos' : 'text')
}
