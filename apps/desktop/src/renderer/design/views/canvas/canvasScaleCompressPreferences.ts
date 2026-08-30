/**
 * canvasScaleCompressPreferences — 画布「尺寸与压缩」弹窗的全局参数偏好。
 *
 * 用户在图片/视频「尺寸与压缩」弹窗里选择的尺寸百分比与压缩百分比会被记住，
 * 下次打开同一类型弹窗直接使用上次参数，避免每次重新拖滑杆。
 *
 * 图片与视频各自独立记忆；范围沿用弹窗/主进程 math 模块的约定：
 * - scalePercent（10~200）：等比缩放百分比，100% 表示不改尺寸；
 * - compressPercent（10~90）：目标体积 ≈ 原始字节数 × N%。
 *
 * 存储位置：localStorage（与 canvasModelParameterPreferences 同级偏好），
 * key 带 v1 版本号；读取时对数值做范围钳制，非法数据回退默认值。
 */

export const CANVAS_SCALE_COMPRESS_PREFERENCES_KEY = 'spark-canvas:scale-compress-preferences:v1'

/** 弹窗类型：图片与视频分别记忆各自的参数 */
export type CanvasScaleCompressKind = 'image' | 'video'

export interface CanvasScaleCompressPreferences {
  scalePercent: number
  compressPercent: number
}

export const DEFAULT_SCALE_PERCENT = 100
export const DEFAULT_COMPRESS_PERCENT = 50

/** 与弹窗/主进程 math 模块保持一致的范围 */
const SCALE_MIN_PERCENT = 10
const SCALE_MAX_PERCENT = 200
const COMPRESS_MIN_PERCENT = 10
const COMPRESS_MAX_PERCENT = 90

type ScaleCompressPreferenceStorage = Pick<Storage, 'getItem' | 'setItem'>

function defaultStorage(): ScaleCompressPreferenceStorage | null {
  try {
    return typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage
  } catch {
    return null
  }
}

function clampPercent(value: unknown, min: number, max: number, fallback: number): number {
  // Number(null) === 0，会把缺失值钳成下限；显式拒绝 null/undefined/空串后仍兼容数字字符串
  if (value == null || value === '') return fallback
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}

export function defaultScaleCompressPreferences(): CanvasScaleCompressPreferences {
  return { scalePercent: DEFAULT_SCALE_PERCENT, compressPercent: DEFAULT_COMPRESS_PERCENT }
}

/** 读取某类弹窗上次记忆的参数；无记录或数据非法时返回默认值（100% / 50%）。 */
export function readCanvasScaleCompressPreferences(
  kind: CanvasScaleCompressKind,
  storage: ScaleCompressPreferenceStorage | null = defaultStorage(),
): CanvasScaleCompressPreferences {
  const defaults = defaultScaleCompressPreferences()
  try {
    const raw = storage?.getItem(CANVAS_SCALE_COMPRESS_PREFERENCES_KEY)
    if (!raw) return defaults
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const entry = parsed?.[kind]
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return defaults
    const candidate = entry as Record<string, unknown>
    return {
      scalePercent: clampPercent(
        candidate.scalePercent,
        SCALE_MIN_PERCENT,
        SCALE_MAX_PERCENT,
        defaults.scalePercent,
      ),
      compressPercent: clampPercent(
        candidate.compressPercent,
        COMPRESS_MIN_PERCENT,
        COMPRESS_MAX_PERCENT,
        defaults.compressPercent,
      ),
    }
  } catch {
    return defaults
  }
}

/** 记忆某类弹窗的参数；写入前同样做范围钳制，偏好不可用时静默失败。 */
export function writeCanvasScaleCompressPreferences(
  kind: CanvasScaleCompressKind,
  prefs: CanvasScaleCompressPreferences,
  storage: ScaleCompressPreferenceStorage | null = defaultStorage(),
): void {
  try {
    if (!storage) return
    const defaults = defaultScaleCompressPreferences()
    const raw = storage.getItem(CANVAS_SCALE_COMPRESS_PREFERENCES_KEY)
    const store = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
    store[kind] = {
      scalePercent: clampPercent(
        prefs.scalePercent,
        SCALE_MIN_PERCENT,
        SCALE_MAX_PERCENT,
        defaults.scalePercent,
      ),
      compressPercent: clampPercent(
        prefs.compressPercent,
        COMPRESS_MIN_PERCENT,
        COMPRESS_MAX_PERCENT,
        defaults.compressPercent,
      ),
    }
    storage.setItem(CANVAS_SCALE_COMPRESS_PREFERENCES_KEY, JSON.stringify(store))
  } catch {
    // 本地偏好不可用时静默失败，不阻断压缩流程。
  }
}
