/**
 * imageProcessHandler — 图片处理操作分派器（sharp 实现）
 *
 * 把 ImageProcessRequest 按 operation 分派，与 videoProcessHandler 平行：
 * - probe：读 sharp metadata + 文件大小，供弹窗展示原始尺寸/体积
 * - scaleCompress：等比缩放 + 按目标体积百分比迭代逼近压缩，产物落盘后返回路径
 *
 * 安全：与 videoProcessHandler 相同的白名单模式——读路径必须在
 * SafeFileProtocol 允许的根目录内（userData/temp/workspace/canvas），
 * 写路径强制限定在图片产物目录，防止任意文件读写。
 */

import { randomUUID } from 'node:crypto'
import { mkdir, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import { app } from 'electron'
import type { ImageProcessRequest, ImageProcessResponse, ImageProbeInfo } from '@spark/protocol'
import sharp, { type SharpOptions } from 'sharp'
import {
  COMPRESS_MAX_PERCENT,
  COMPRESS_MIN_PERCENT,
  MAX_IMAGE_PIXELS,
  MAX_QUALITY_SEARCH_ROUNDS,
  SCALE_MAX_PERCENT,
  SCALE_MIN_PERCENT,
  computeScaledImageSize,
  computeTargetBytes,
  initialQualityBounds,
  nextQualityToProbe,
  outputExtensionFor,
  pickBetterCandidate,
  qualityBoundsExhausted,
  refineQualityBounds,
  resolveOutputFormat,
  type ImageScaleCompressOutputFormat,
  type QualitySearchBounds,
} from './imageScaleCompressMath.js'
import { isSafeFilePathAllowed } from './SafeFileProtocol.js'
import { createLogger } from '@spark/shared'

const log = createLogger('image-process')
const IMAGE_ENCODE_TIMEOUT_SECONDS = 20
const IMAGE_INPUT_OPTIONS: SharpOptions = {
  limitInputPixels: MAX_IMAGE_PIXELS,
  sequentialRead: true,
}

/** 图片产物落盘根目录：{userData}/.spark-artifacts/media/image-process/ */
function getImageArtifactDir(): string {
  return join(app.getPath('userData'), '.spark-artifacts', 'media', 'image-process')
}

/** 校验输入图片位于 safe-file 白名单内，并复用其中的符号链接逃逸防护。 */
function assertInputPathAllowed(p: string): void {
  if (!p || typeof p !== 'string') {
    throw new Error(`Invalid path: ${String(p)}`)
  }
  if (!isAbsolute(p)) {
    throw new Error(`Path must be absolute: ${p}`)
  }
  if (!isSafeFilePathAllowed(p)) {
    throw new Error(`Path outside allowed roots: ${p}`)
  }
}

/** 生成产物绝对路径（uuid + 扩展名） */
function makeOutputPath(ext: string): string {
  return join(getImageArtifactDir(), `${randomUUID()}.${ext}`)
}

/** 已完成的编码候选：quality、实际字节数与产物 Buffer（避免落盘前二次编码） */
interface EncodedCandidateWithBuffer {
  quality: number
  bytes: number
  buffer: Buffer
}

/** 单次编码管线：解码 → 缩放 → 按格式与 quality 编码为 Buffer */
async function encodeScaled(
  inputPath: string,
  targetWidth: number,
  targetHeight: number,
  format: ImageScaleCompressOutputFormat,
  quality: number,
): Promise<Buffer> {
  let pipeline = sharp(inputPath, IMAGE_INPUT_OPTIONS).autoOrient().resize({
    width: targetWidth,
    height: targetHeight,
    fit: 'fill',
    kernel: 'lanczos3',
  })
  if (format === 'jpeg') {
    pipeline = pipeline.jpeg({ quality, mozjpeg: true, chromaSubsampling: '4:2:0' })
  } else if (format === 'webp') {
    pipeline = pipeline.webp({ quality })
  } else {
    // png 无损，quality 配合 palette 量化才有压缩空间（有损色彩，TinyPNG 同思路）
    pipeline = pipeline.png({
      quality,
      palette: true,
      compressionLevel: 9,
    })
  }
  return pipeline.timeout({ seconds: IMAGE_ENCODE_TIMEOUT_SECONDS }).toBuffer()
}

/**
 * 处理一个 ImageProcessRequest。
 *
 * @param req 操作请求
 * @param onProgress 可选进度回调（probe 操作不会触发）
 */
export async function handleImageProcess(
  req: ImageProcessRequest,
  onProgress?: (p: { percent: number; stage: string }) => void,
): Promise<ImageProcessResponse> {
  try {
    const result = await dispatch(req, onProgress)
    return { success: true, result }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.error(`handleImageProcess failed: ${message}`)
    return { success: false, error: message }
  }
}

async function dispatch(
  req: ImageProcessRequest,
  onProgress?: (p: { percent: number; stage: string }) => void,
): Promise<unknown> {
  const { operation, input, params } = req
  log.debug(
    `dispatch operation=${operation} inputLength=${input.length} paramKeys=${Object.keys(params).join(',')}`,
  )

  // 统一输入校验：路径白名单（读）
  assertInputPathAllowed(input)

  switch (operation) {
    case 'probe': {
      const meta = await sharp(input, IMAGE_INPUT_OPTIONS).metadata()
      const fileSize = await stat(input).then(
        (s) => s.size,
        () => 0,
      )
      const width = meta.autoOrient?.width ?? meta.width
      const height = meta.autoOrient?.height ?? meta.height
      if (typeof width !== 'number' || typeof height !== 'number' || width <= 0 || height <= 0) {
        throw new Error(`无法读取图片尺寸: ${input}`)
      }
      const pages = Math.max(1, meta.pages ?? 1)
      const info: ImageProbeInfo = {
        width,
        height,
        format: meta.format ?? 'unknown',
        fileSize,
        hasAlpha: meta.hasAlpha === true,
        pages,
        animated: pages > 1 && (meta.format === 'gif' || meta.format === 'webp'),
      }
      return info
    }

    // ── 尺寸压缩（等比缩放 + 按目标体积迭代逼近）──────────────────
    case 'scaleCompress': {
      const scalePercent = asNumber(params.scalePercent)
      const compressPercent = asNumber(params.compressPercent)
      if (
        scalePercent == null ||
        scalePercent < SCALE_MIN_PERCENT ||
        scalePercent > SCALE_MAX_PERCENT
      ) {
        throw new Error(
          `尺寸缩放比例超出允许范围 [${SCALE_MIN_PERCENT}, ${SCALE_MAX_PERCENT}]: ${String(params.scalePercent)}`,
        )
      }
      if (
        compressPercent == null ||
        compressPercent < COMPRESS_MIN_PERCENT ||
        compressPercent > COMPRESS_MAX_PERCENT
      ) {
        throw new Error(
          `压缩比例超出允许范围 [${COMPRESS_MIN_PERCENT}, ${COMPRESS_MAX_PERCENT}]: ${String(params.compressPercent)}`,
        )
      }

      const meta = await sharp(input, IMAGE_INPUT_OPTIONS).metadata()
      const width = meta.autoOrient?.width ?? meta.width
      const height = meta.autoOrient?.height ?? meta.height
      if (typeof width !== 'number' || typeof height !== 'number') {
        throw new Error(`无法读取图片尺寸，无法缩放: ${input}`)
      }
      if ((meta.pages ?? 1) > 1) {
        throw new Error('暂不支持多页图片或动图尺寸压缩，以免处理后丢失页面或动画帧')
      }
      const fileSize = await stat(input).then(
        (s) => s.size,
        () => 0,
      )
      if (fileSize <= 0) {
        throw new Error(`无法读取图片文件大小: ${input}`)
      }

      const size = computeScaledImageSize(width, height, scalePercent)
      if (!size) {
        throw new Error(`缩放后无法得到有效尺寸: ${width}x${height} @ ${scalePercent}%`)
      }
      const outputFormat = resolveOutputFormat(meta.format ?? '')
      const targetBytes = computeTargetBytes(fileSize, compressPercent)

      // quality 二分迭代逼近目标体积：图片编码快（远低于视频转码），8 轮内可接受
      let bounds: QualitySearchBounds = initialQualityBounds()
      let best: EncodedCandidateWithBuffer | null = null
      let round = 0
      while (round < MAX_QUALITY_SEARCH_ROUNDS && !qualityBoundsExhausted(bounds)) {
        round += 1
        const quality = nextQualityToProbe(bounds)
        const buffer = await encodeScaled(input, size.width, size.height, outputFormat, quality)
        const candidate: EncodedCandidateWithBuffer = {
          quality,
          bytes: buffer.byteLength,
          buffer,
        }
        best =
          best == null || pickBetterCandidate(best, candidate, targetBytes) === candidate
            ? candidate
            : best
        if (candidate.bytes === targetBytes) break
        bounds = refineQualityBounds(bounds, quality, buffer.byteLength, targetBytes)
        onProgress?.({
          percent: Math.min(95, Math.round((round / MAX_QUALITY_SEARCH_ROUNDS) * 90)),
          stage: `质量迭代 ${round}/${MAX_QUALITY_SEARCH_ROUNDS}`,
        })
      }

      // 兜底：一轮都没跑（理论不可达）时按中值编码，保证总有产物
      if (!best) {
        const quality = nextQualityToProbe(initialQualityBounds())
        const buffer = await encodeScaled(input, size.width, size.height, outputFormat, quality)
        best = { quality, bytes: buffer.byteLength, buffer }
      }

      onProgress?.({ percent: 98, stage: '写入文件' })
      const outputPath = makeOutputPath(outputExtensionFor(outputFormat))
      await mkdir(dirname(outputPath), { recursive: true })
      await writeFile(outputPath, best.buffer)
      onProgress?.({ percent: 100, stage: '处理完成' })

      return {
        path: outputPath,
        width: size.width,
        height: size.height,
        format: outputFormat,
        sourceBytes: fileSize,
        outputBytes: best.bytes,
        quality: best.quality,
      }
    }

    default:
      throw new Error(`未知的图片操作: ${String(operation)}`)
  }
}

/** 宽松数值读取：非法/缺失返回 null */
function asNumber(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}
