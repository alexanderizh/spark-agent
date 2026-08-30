import { createLogger } from '@spark/shared'
import sharp, { type Metadata } from 'sharp'

/**
 * 粘贴图片最长边像素上限。
 *
 * Claude Agent SDK 内置的 read_file 工具在读取图片时，若像素尺寸超过 2000x2000 会尝试
 * 自行 resize，处理失败则抛 "Unable to resize image - dimensions exceed the 2000x2000px
 * limit and image processing failed." 该限制来自 SDK 二进制，非本应用逻辑。
 *
 * 粘贴落盘（file:save-pasted-image）原本只做 base64 解码 + 原样落盘，agent 后续 read_file
 * 读到的就是剪贴板原图（截图普遍 > 2000px），从而撞上 SDK 限制。这里在落盘前把像素尺寸
 * 收敛到 2000px 以内，从源头规避。
 */
export const PASTED_IMAGE_MAX_EDGE = 2000

/** sharp 输入像素上限，防止超大图 OOM。与 SessionImageOptimizer 保持一致。 */
const MAX_INPUT_PIXELS = 100_000_000

/** 单张图 resize 超时，防止 sharp 卡死阻塞落盘流程。 */
const RESIZE_TIMEOUT_SECONDS = 3

const logger = createLogger('pasted-image-resizer')

export interface ResizePastedImageOptions {
  /** 最长边像素上限，超过则等比缩小。默认 {@link PASTED_IMAGE_MAX_EDGE}。 */
  maxEdge?: number
}

export interface ResizePastedImageResult {
  /** 最终用于落盘的 buffer：resize 成功为压缩后 buffer，否则为原 buffer。 */
  buffer: Buffer
  /** 是否实际发生了 resize（小图或降级时为 false）。 */
  resized: boolean
  /** 原图宽度；读取失败为 0。 */
  originalWidth: number
  /** 原图高度；读取失败为 0。 */
  originalHeight: number
  /** 输出宽度；未 resize 时等于原图宽度，降级时为 0 或原图宽度。 */
  outputWidth: number
  /** 输出高度；未 resize 时等于原图高度，降级时为 0 或原图高度。 */
  outputHeight: number
}

/**
 * 将粘贴的图片 buffer 收敛到最长边 <= maxEdge。
 *
 * 行为约定（重要）：
 * - 已经 <= maxEdge 的图直接返回原 buffer，不做任何重编码，避免无谓的有损压缩。
 * - 超限的图用 sharp 等比缩小，保持原格式输出（png->png / jpeg->jpeg / webp->webp），
 *   不主动转格式，因此调用方无需调整扩展名与 mimeType。
 * - 任何环节失败（buffer 损坏、metadata 读取失败、resize/编码失败、超时）都降级返回原
 *   buffer，绝不抛错——以保证落盘流程不被阻断，退化为旧行为（落盘原图）。
 *
 * 这条降级保证是函数契约的一部分：调用方无需 try/catch 包裹，resize 失败不影响落盘。
 */
export async function resizePastedImageBuffer(
  input: Buffer,
  options: ResizePastedImageOptions = {},
): Promise<ResizePastedImageResult> {
  const maxEdge = options.maxEdge ?? PASTED_IMAGE_MAX_EDGE

  if (input.length === 0) {
    return {
      buffer: input,
      resized: false,
      originalWidth: 0,
      originalHeight: 0,
      outputWidth: 0,
      outputHeight: 0,
    }
  }

  let metadata: Metadata
  try {
    metadata = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS }).metadata()
  } catch (err) {
    logger.warn(
      `event=pasted_image_resize status=metadata_failed bytes=${input.length} error=${safeError(err)}`,
    )
    return {
      buffer: input,
      resized: false,
      originalWidth: 0,
      originalHeight: 0,
      outputWidth: 0,
      outputHeight: 0,
    }
  }

  const originalWidth = metadata.width ?? 0
  const originalHeight = metadata.height ?? 0
  if (originalWidth === 0 || originalHeight === 0) {
    logger.warn(
      `event=pasted_image_resize status=unknown_dimensions format=${metadata.format ?? 'unknown'} bytes=${input.length}`,
    )
    return {
      buffer: input,
      resized: false,
      originalWidth,
      originalHeight,
      outputWidth: originalWidth,
      outputHeight: originalHeight,
    }
  }

  // 小图无需 resize：直接返回原 buffer，避免重编码带来的质量损失与体积波动。
  if (originalWidth <= maxEdge && originalHeight <= maxEdge) {
    return {
      buffer: input,
      resized: false,
      originalWidth,
      originalHeight,
      outputWidth: originalWidth,
      outputHeight: originalHeight,
    }
  }

  try {
    const encoded = await sharp(input, {
      limitInputPixels: MAX_INPUT_PIXELS,
      sequentialRead: true,
    })
      .rotate() // 依据 EXIF 自动正向旋转，与 SessionImageOptimizer 一致
      .resize({
        width: maxEdge,
        height: maxEdge,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .timeout({ seconds: RESIZE_TIMEOUT_SECONDS })
      .toBuffer({ resolveWithObject: true })

    logger.info(
      `event=pasted_image_resize status=resized format=${metadata.format ?? 'unknown'} ${originalWidth}x${originalHeight} -> ${encoded.info.width}x${encoded.info.height} bytes=${input.length} -> ${encoded.data.length}`,
    )
    return {
      buffer: encoded.data,
      resized: true,
      originalWidth,
      originalHeight,
      outputWidth: encoded.info.width,
      outputHeight: encoded.info.height,
    }
  } catch (err) {
    // 降级：返回原 buffer 落盘，退化为旧行为。不阻断任务。
    logger.warn(
      `event=pasted_image_resize status=resize_failed format=${metadata.format ?? 'unknown'} ${originalWidth}x${originalHeight} error=${safeError(err)}`,
    )
    return {
      buffer: input,
      resized: false,
      originalWidth,
      originalHeight,
      outputWidth: originalWidth,
      outputHeight: originalHeight,
    }
  }
}

function safeError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err)
  return JSON.stringify(message.replace(/[\r\n]+/g, ' ').slice(0, 300))
}
