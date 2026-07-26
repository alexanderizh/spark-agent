/**
 * 多媒体产物落盘服务：把 url / base64 / 文本写入本地 .spark-artifacts/media/<kind>。
 * 见 design doc §8 step 6。
 */

import { mkdir, writeFile, readFile } from 'node:fs/promises'
import path from 'node:path'
import { createLogger } from '@spark/shared'
import { MediaProviderError } from './media-adapter.types.js'
import type { MediaGeneratedAsset, MediaArtifactType } from './media-adapter.types.js'
import { describeNetworkError, sanitizeRequestUrl } from './media-http.util.js'
import type { ExtractedImage } from './media-http.util.js'

const log = createLogger('media:artifact')

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

export interface MediaArtifactServiceOptions {
  /**
   * 瞬时错误重试退避基数（ms），默认 1000，每次 ×2、上限 8s。
   * 测试场景传 1 以加速；生产由默认值控制，调用方无需显式传入。
   */
  retryDelayMs?: number | undefined
}

/** 单次产物下载的最大尝试次数（初始请求 + 两次重试）。 */
const MAX_DOWNLOAD_ATTEMPTS = 3
/** 产物下载重试退避上限（ms）。 */
const MAX_DOWNLOAD_BACKOFF_MS = 8_000

export class MediaArtifactService {
  private readonly retryDelayMs: number

  constructor(options: MediaArtifactServiceOptions = {}) {
    this.retryDelayMs = Math.max(1, options.retryDelayMs ?? 1_000)
  }

  /** 把图片（url 或 base64）落盘，返回 asset 元信息 */
  async writeImage(
    image: ExtractedImage,
    outputDir: string,
    filename: string,
    fetchImpl?: typeof fetch,
    timeoutMs?: number,
  ): Promise<MediaGeneratedAsset> {
    const dir = path.join(outputDir, 'images')
    await mkdir(dir, { recursive: true })
    const buffer =
      image.kind === 'url'
        ? await this.downloadBuffer(image.value, fetchImpl, timeoutMs)
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
    timeoutMs?: number,
  ): Promise<MediaGeneratedAsset> {
    const buffer = await this.downloadBuffer(url, fetchImpl, timeoutMs)
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

  /**
   * 下载远程 url 为 Buffer。瞬时网络错误与 HTTP 408/425/429/5xx 在总时限内退避重试，
   * 最多 MAX_DOWNLOAD_ATTEMPTS 次；确定性 4xx、超时、用尽重试后立即抛
   * artifact_download_failed。错误消息含底层 cause 与尝试次数，但不带签名 URL。
   * timeoutMs 为整轮下载（所有尝试 + 退避等待）的总时限。
   */
  private async downloadBuffer(
    url: string,
    fetchImpl?: typeof fetch,
    timeoutMs?: number,
  ): Promise<Buffer> {
    const impl = fetchImpl ?? fetch
    const deadline = timeoutMs != null ? Date.now() + timeoutMs : undefined
    let attempt = 0
    let nextBackoffMs = this.retryDelayMs

    for (;;) {
      attempt += 1
      // 总时限耗尽：不再尝试，直接判超时
      if (deadline != null && Date.now() >= deadline) {
        throw new MediaProviderError(
          'artifact_download_failed',
          `Download timed out after ${timeoutMs}ms`,
        )
      }
      const budgetMs = deadline != null ? Math.max(1, deadline - Date.now()) : undefined
      log.info(
        `event=download-attempt attempt=${attempt}/${MAX_DOWNLOAD_ATTEMPTS} url=${JSON.stringify(sanitizeRequestUrl(url))} budgetMs=${budgetMs ?? '(unlimited)'}`,
      )
      const result = await this.attemptDownload(url, impl, budgetMs)
      if (result.kind === 'ok') return result.buffer

      log.warn(
        `event=download-attempt-failed attempt=${attempt}/${MAX_DOWNLOAD_ATTEMPTS} url=${JSON.stringify(sanitizeRequestUrl(url))} timedOut=${result.timedOut} error=${JSON.stringify(describeError(result.error))}`,
      )

      // 超时统一以配置的总时限表述，避免单次预算随尝试次数漂移
      const error =
        result.timedOut && timeoutMs != null
          ? new MediaProviderError(
              'artifact_download_failed',
              `Download timed out after ${timeoutMs}ms`,
            )
          : result.error

      const canRetry =
        attempt < MAX_DOWNLOAD_ATTEMPTS &&
        (deadline == null || Date.now() < deadline) &&
        isRetryableDownloadError(error)
      if (!canRetry) throw enrichDownloadError(error, attempt)

      const backoff = Math.min(nextBackoffMs, MAX_DOWNLOAD_BACKOFF_MS)
      nextBackoffMs = Math.min(nextBackoffMs * 2, MAX_DOWNLOAD_BACKOFF_MS)
      const waitMs =
        deadline != null ? Math.min(backoff, Math.max(0, deadline - Date.now())) : backoff
      if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs))
    }
  }

  /** 单次下载尝试；不决策重试，把结果（含是否超时）交回外层。 */
  private async attemptDownload(
    url: string,
    impl: typeof fetch,
    budgetMs: number | undefined,
  ): Promise<DownloadAttemptResult> {
    const controller = budgetMs != null ? new AbortController() : undefined
    let timedOut = false
    const timer =
      controller && budgetMs != null
        ? setTimeout(() => {
            timedOut = true
            controller.abort()
          }, budgetMs)
        : undefined
    try {
      let res: Response
      try {
        res = await impl(url, controller ? { signal: controller.signal } : undefined)
      } catch (err) {
        if (timedOut) {
          log.warn(
            `event=download-fetch-timeout url=${JSON.stringify(sanitizeRequestUrl(url))} error=${JSON.stringify(describeError(err))}`,
          )
          return { kind: 'error', timedOut: true, error: TIMED_OUT_PLACEHOLDER }
        }
        log.warn(
          `event=download-fetch-failed url=${JSON.stringify(sanitizeRequestUrl(url))} error=${JSON.stringify(describeError(err))}`,
        )
        return { kind: 'error', timedOut: false, error: toDownloadNetworkError(err, url) }
      }
      if (!res.ok) {
        log.warn(
          `event=download-response-failed url=${JSON.stringify(sanitizeRequestUrl(url))} status=${res.status}`,
        )
        return {
          kind: 'error',
          timedOut: false,
          error: new MediaProviderError(
            'artifact_download_failed',
            `Download failed HTTP ${res.status}: ${sanitizeRequestUrl(url)}`,
            res.status,
          ),
        }
      }
      const responseHeaders =
        res.headers != null && typeof res.headers.get === 'function' ? res.headers : null
      log.info(
        `event=download-response-ok url=${JSON.stringify(sanitizeRequestUrl(url))} status=${res.status} contentType=${JSON.stringify(responseHeaders?.get('content-type') ?? '(none)')} contentLength=${JSON.stringify(responseHeaders?.get('content-length') ?? '(unknown)')}`,
      )
      try {
        const buffer = Buffer.from(await res.arrayBuffer())
        log.info(
          `event=download-body-read-ok url=${JSON.stringify(sanitizeRequestUrl(url))} bytes=${buffer.byteLength}`,
        )
        return { kind: 'ok', buffer }
      } catch (err) {
        log.warn(
          `event=download-body-read-failed url=${JSON.stringify(sanitizeRequestUrl(url))} error=${JSON.stringify(describeError(err))}`,
        )
        throw err
      }
    } finally {
      if (timer !== undefined) clearTimeout(timer)
    }
  }
}

type DownloadAttemptResult =
  | { kind: 'ok'; buffer: Buffer }
  | { kind: 'error'; timedOut: boolean; error: MediaProviderError }

/** 超时占位错误；外层会按 timeoutMs 重建消息，此处内容不对外暴露。 */
const TIMED_OUT_PLACEHOLDER = new MediaProviderError('artifact_download_failed', 'timed out')

/** 把底层网络错误转成带可读提示的 artifact 下载错误，命中特征时附带原因与排查方向。 */
function toDownloadNetworkError(err: unknown, url: string): MediaProviderError {
  const hint = describeNetworkError(err, 'GET', url)
  return new MediaProviderError(
    'artifact_download_failed',
    hint ?? `Download failed: ${err instanceof Error ? err.message : String(err)}`,
  )
}

/** 判断 artifact 下载错误是否可安全重试：网络错误或 408/425/429/5xx；其余 4xx 不重试。 */
function isRetryableDownloadError(error: MediaProviderError): boolean {
  if (error.statusCode === undefined) return true
  return (
    error.statusCode === 408 ||
    error.statusCode === 425 ||
    error.statusCode === 429 ||
    error.statusCode >= 500
  )
}

/** 用尽重试后追加尝试次数，便于排查；首次失败保持原始消息不变。 */
function enrichDownloadError(error: MediaProviderError, attempt: number): MediaProviderError {
  if (attempt <= 1) return error
  error.message = `${error.message}（已重试 ${attempt - 1} 次，共 ${MAX_DOWNLOAD_ATTEMPTS} 次尝试）`
  return error
}

function describeError(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) return { value: String(error) }
  const cause = (error as { cause?: unknown }).cause
  const code = (error as { code?: unknown }).code
  return {
    name: error.name,
    message: error.message,
    ...(typeof code === 'string' ? { code } : {}),
    ...(cause instanceof Error
      ? { cause: { name: cause.name, message: cause.message } }
      : typeof cause === 'string'
        ? { cause }
        : {}),
  }
}

export function defaultOutputDir(workspaceRootPath: string, kind: MediaArtifactType): string {
  return path.join(workspaceRootPath, '.spark-artifacts', 'media', kind === 'image' ? 'images' : kind === 'audio' ? 'audio' : kind === 'video' ? 'videos' : 'text')
}
