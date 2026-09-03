import { DEFAULT_DEPTH_CONTRAST_CLIP_PERCENT, DEFAULT_DEPTH_SMOOTH_STRENGTH } from './depthMath.js'

export type DepthVideoColormap = 'none' | 'turbo' | 'viridis'

/**
 * 深度视频渲染选项（图像处理阶段，全部字段有默认值，缺省时保持历史行为）：
 * - invert：反相，255-v，得到「近暗远亮」的经典 depth map 观感
 * - colormap：伪彩色映射，none=灰度输出；turbo/viridis 输出 RGB
 * - smoothStrength：时序平滑强度 0-1，0=逐帧原始深度（闪烁感），越大越平滑（拖影）
 * - contrast：对比度增强 0-10，即归一化分位裁剪百分比，越大明暗对比越强
 */
export type DepthVideoRenderOptions = {
  invert: boolean
  colormap: DepthVideoColormap
  smoothStrength: number
  contrast: number
}

export const DEPTH_COLORMAP_VALUES = ['none', 'turbo', 'viridis'] as const

export const MAX_DEPTH_CONTRAST = 10

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return fallback
  return Math.min(max, Math.max(min, numeric))
}

function resolveColormap(value: unknown): DepthVideoColormap {
  return DEPTH_COLORMAP_VALUES.includes(value as DepthVideoColormap)
    ? (value as DepthVideoColormap)
    : 'none'
}

/** 归一化渲染选项：字段缺省或越界时回退到历史默认值（保持向后兼容）。 */
export function resolveDepthVideoRenderOptions(
  options?: Partial<DepthVideoRenderOptions> | null,
): DepthVideoRenderOptions {
  return {
    invert: options?.invert === true,
    colormap: resolveColormap(options?.colormap),
    smoothStrength: clampNumber(options?.smoothStrength, 0, 1, DEFAULT_DEPTH_SMOOTH_STRENGTH),
    contrast: clampNumber(
      options?.contrast,
      0,
      MAX_DEPTH_CONTRAST,
      DEFAULT_DEPTH_CONTRAST_CLIP_PERCENT,
    ),
  }
}

/** 伪彩色输出 RGB 帧时，编码器 stdin 的 rawvideo 像素格式。 */
export function depthEncoderInputPixelFormat(options: DepthVideoRenderOptions): 'gray' | 'rgb24' {
  return options.colormap === 'none' ? 'gray' : 'rgb24'
}
