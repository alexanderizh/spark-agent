/**
 * 上下文窗口控件的公共刻度 / 格式化 / 吸附逻辑。
 *
 * 两个控件共用：
 * - 渠道级 `ProviderContextWindowSlider`（大滑块，200K–1M 对数刻度 + 自定义输入）
 * - 模型级 `ProviderModelContextWindowField`（紧凑行内控件，同一套刻度与合法边界）
 *
 * 抽成纯函数模块便于单测，也避免两处刻度口径漂移。
 */

/** 滑块承载范围（对数刻度）：200K → 1M，与预设 200K/256K/400K/1M 对齐 */
export const CONTEXT_WINDOW_SLIDER_MIN = 200_000
export const CONTEXT_WINDOW_SLIDER_MAX = 1_000_000
/** 未显式配置时的运行时回落值（与后端默认口径一致） */
export const CONTEXT_WINDOW_FALLBACK = 256_000
/** 自定义输入的硬边界，与后端 zod 校验保持一致 */
export const CONTEXT_WINDOW_HARD_MIN = 1024
export const CONTEXT_WINDOW_HARD_MAX = 10_000_000

/** 拖拽时的磁性预设：接近时吸附，保证 supportsMillionContext(=1M) 等关键值可精确命中 */
export const CONTEXT_WINDOW_MAGNET_PRESETS = [200_000, 256_000, 400_000, 1_000_000]
/** 与预设相对偏差在该比例内时吸附 */
export const CONTEXT_WINDOW_MAGNET_RATIO = 0.03

const LOG_SPAN = Math.log(CONTEXT_WINDOW_SLIDER_MAX / CONTEXT_WINDOW_SLIDER_MIN)

export function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** 值 → 对数刻度比例（0=200K，1=1M） */
export function contextWindowLogRatio(value: number): number {
  return Math.log(value / CONTEXT_WINDOW_SLIDER_MIN) / LOG_SPAN
}

/** 对数刻度比例 → 值 */
export function contextWindowRatioToValue(ratio: number): number {
  return CONTEXT_WINDOW_SLIDER_MIN * Math.exp(LOG_SPAN * ratio)
}

/**
 * 吸附取整：统一按 1K 取整；magnet=true（拖拽）时在预设附近磁性吸附，
 * 键盘步进传 false，避免小步长被吸附吞掉（如在 256K 附近按不动）。
 */
export function snapContextWindowValue(value: number, magnet = true): number {
  const snapped = Math.round(value / 1000) * 1000
  if (magnet) {
    for (const preset of CONTEXT_WINDOW_MAGNET_PRESETS) {
      if (Math.abs(snapped - preset) / preset <= CONTEXT_WINDOW_MAGNET_RATIO) return preset
    }
  }
  return clampNumber(snapped, CONTEXT_WINDOW_SLIDER_MIN, CONTEXT_WINDOW_SLIDER_MAX)
}

/** 200K → "200K"；1M/1.5M/10M → "1M"/"1.5M"/"10M" */
export function formatContextWindowTokens(value: number): string {
  if (value >= 1_000_000) {
    const millions = value / 1_000_000
    return Number.isInteger(millions) ? `${millions}M` : `${millions.toFixed(1)}M`
  }
  return `${Math.round(value / 1000)}K`
}

/** 数值是否落在模型级上下文窗口的合法区间（1024 – 10M，与后端 zod 一致） */
export function isContextWindowInRange(value: number): boolean {
  return Number.isFinite(value) && value >= CONTEXT_WINDOW_HARD_MIN && value <= CONTEXT_WINDOW_HARD_MAX
}

/** 合法则取整返回，否则 undefined（调用方据此决定「恢复默认」还是报错） */
export function normalizeContextWindowInput(value: number): number | undefined {
  return isContextWindowInRange(value) ? Math.floor(value) : undefined
}
