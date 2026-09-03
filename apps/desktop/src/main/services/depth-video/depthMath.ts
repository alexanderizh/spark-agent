export type DepthColormapName = 'turbo' | 'viridis'

/**
 * 对比度参数即归一化时的分位裁剪百分比：
 * 0 = 全量程线性映射（雾感），越大 = 裁掉越多极端分位、中间层次拉开（高对比剪影感）。
 */
export const DEFAULT_DEPTH_CONTRAST_CLIP_PERCENT = 2
export const DEFAULT_DEPTH_SMOOTH_STRENGTH = 0.25

export function normalizeInverseDepth(
  values: Float32Array,
  clipPercent = DEFAULT_DEPTH_CONTRAST_CLIP_PERCENT,
): Uint8Array {
  if (values.length === 0) return new Uint8Array()
  const finite = Array.from(values)
    .filter(Number.isFinite)
    .sort((left, right) => left - right)
  if (finite.length === 0) return new Uint8Array(values.length)
  const clip = Math.min(49.9, Math.max(0, clipPercent)) / 100
  const low = percentile(finite, clip)
  const high = percentile(finite, 1 - clip)
  if (high <= low) return new Uint8Array(values.length)
  const scale = 255 / (high - low)
  return Uint8Array.from(values, (value) => {
    if (!Number.isFinite(value)) return 0
    return Math.round(Math.min(255, Math.max(0, (value - low) * scale)))
  })
}

export function smoothDepthFrame(
  current: Uint8Array,
  previous: Uint8Array | null,
  historyWeight = DEFAULT_DEPTH_SMOOTH_STRENGTH,
  sceneCut = false,
): Uint8Array {
  if (sceneCut || previous == null || previous.length !== current.length) return current
  const weight = Math.min(1, Math.max(0, historyWeight))
  if (weight <= 0) return current
  return Uint8Array.from(current, (value, index) =>
    Math.round(value * (1 - weight) + (previous[index] ?? value) * weight),
  )
}

/** 反相：255-v，得到「近暗远亮」的经典 depth map 观感。返回新数组，不修改入参。 */
export function invertGrayValues(frame: Uint8Array): Uint8Array {
  return Uint8Array.from(frame, (value) => 255 - value)
}

// 锚点取自 d3-scale-chromatic（turbo 为 Google 官方多项式实现、viridis 为 matplotlib
// 256 级色谱）的 17 点等距采样；运行时线性插值生成 LUT，避免主进程依赖 d3。
const VIRIDIS_ANCHORS: ReadonlyArray<readonly [t: number, r: number, g: number, b: number]> = [
  [0.0, 68, 1, 84],
  [0.0625, 72, 24, 106],
  [0.125, 71, 45, 123],
  [0.1875, 66, 64, 134],
  [0.25, 59, 82, 139],
  [0.3125, 51, 99, 141],
  [0.375, 44, 114, 142],
  [0.4375, 38, 130, 142],
  [0.5, 33, 145, 140],
  [0.5625, 31, 160, 136],
  [0.625, 40, 174, 128],
  [0.6875, 63, 188, 115],
  [0.75, 94, 201, 98],
  [0.8125, 132, 212, 75],
  [0.875, 173, 220, 48],
  [0.9375, 216, 226, 25],
  [1.0, 253, 231, 37],
]

const TURBO_ANCHORS: ReadonlyArray<readonly [t: number, r: number, g: number, b: number]> = [
  [0.0, 35, 23, 27],
  [0.0625, 73, 62, 174],
  [0.125, 69, 105, 238],
  [0.1875, 50, 149, 247],
  [0.25, 38, 188, 225],
  [0.3125, 41, 220, 188],
  [0.375, 63, 243, 147],
  [0.4375, 101, 253, 110],
  [0.5, 149, 251, 81],
  [0.5625, 197, 236, 60],
  [0.625, 236, 209, 46],
  [0.6875, 255, 173, 36],
  [0.75, 255, 130, 29],
  [0.8125, 240, 86, 22],
  [0.875, 203, 47, 13],
  [0.9375, 163, 19, 2],
  [1.0, 144, 12, 0],
]

const colormapLutCache = new Map<DepthColormapName, Uint8Array>()

/** 生成 256×3 的伪彩色查找表（带缓存）。 */
export function buildDepthColormapLut(colormap: DepthColormapName): Uint8Array {
  const cached = colormapLutCache.get(colormap)
  if (cached) return cached
  const anchors = colormap === 'viridis' ? VIRIDIS_ANCHORS : TURBO_ANCHORS
  const lut = new Uint8Array(256 * 3)
  for (let index = 0; index < 256; index += 1) {
    const scaled = (index / 255) * (anchors.length - 1)
    const lower = Math.min(anchors.length - 2, Math.floor(scaled))
    const fraction = scaled - lower
    for (let channel = 0; channel < 3; channel += 1) {
      const from = anchors[lower]![channel + 1]!
      const to = anchors[lower + 1]![channel + 1]!
      lut[index * 3 + channel] = Math.round(from + (to - from) * fraction)
    }
  }
  colormapLutCache.set(colormap, lut)
  return lut
}

/** 灰度深度帧 → 伪彩色 RGB 帧（长度 ×3）。返回新数组，不修改入参。 */
export function applyDepthColormap(frame: Uint8Array, colormap: DepthColormapName): Uint8Array {
  const lut = buildDepthColormapLut(colormap)
  const output = new Uint8Array(frame.length * 3)
  for (let index = 0; index < frame.length; index += 1) {
    const lutOffset = frame[index]! * 3
    output[index * 3] = lut[lutOffset]!
    output[index * 3 + 1] = lut[lutOffset + 1]!
    output[index * 3 + 2] = lut[lutOffset + 2]!
  }
  return output
}

export function detectRgbSceneCut(
  current: Uint8Array,
  previous: Uint8Array | null,
  threshold = 0.35,
): boolean {
  if (previous == null || previous.length !== current.length || current.length === 0) return false
  const stride = Math.max(3, Math.floor(current.length / 12_000 / 3) * 3)
  let totalDifference = 0
  let samples = 0
  for (let index = 0; index < current.length; index += stride) {
    totalDifference += Math.abs(current[index]! - previous[index]!)
    samples += 1
  }
  return samples > 0 && totalDifference / samples / 255 >= threshold
}

export function resizeGrayFrame(
  source: Uint8Array,
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
): Uint8Array {
  if (sourceWidth === targetWidth && sourceHeight === targetHeight) return source
  if (
    sourceWidth <= 0 ||
    sourceHeight <= 0 ||
    targetWidth <= 0 ||
    targetHeight <= 0 ||
    source.length !== sourceWidth * sourceHeight
  ) {
    throw new Error('深度帧尺寸无效')
  }
  const output = new Uint8Array(targetWidth * targetHeight)
  for (let y = 0; y < targetHeight; y += 1) {
    const sourceY = Math.min(sourceHeight - 1, Math.floor((y * sourceHeight) / targetHeight))
    for (let x = 0; x < targetWidth; x += 1) {
      const sourceX = Math.min(sourceWidth - 1, Math.floor((x * sourceWidth) / targetWidth))
      output[y * targetWidth + x] = source[sourceY * sourceWidth + sourceX]!
    }
  }
  return output
}

function percentile(sorted: number[], ratio: number): number {
  if (sorted.length === 1) return sorted[0]!
  const position = ratio * (sorted.length - 1)
  const lowerIndex = Math.floor(position)
  const upperIndex = Math.ceil(position)
  const lower = sorted[lowerIndex]!
  const upper = sorted[upperIndex]!
  return lower + (upper - lower) * (position - lowerIndex)
}
