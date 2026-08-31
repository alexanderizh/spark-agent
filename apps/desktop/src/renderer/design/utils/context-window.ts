/**
 * 上下文窗口下拉预设。
 * - 0：默认（未配置，运行时回落 256K 或 supportsMillionContext=true 时 1M）
 * - -1：自定义（显示数字输入框）
 */
export const CONTEXT_WINDOW_PRESETS: Array<{ value: number; label: string }> = [
  { value: 0, label: '默认 (256K)' },
  { value: 200_000, label: '200K' },
  { value: 256_000, label: '256K' },
  { value: 400_000, label: '400K' },
  { value: 1_000_000, label: '1M' },
  { value: -1, label: '自定义…' },
]

export function resolveContextWindowSelectValue(contextWindow: number): number {
  if (contextWindow <= 0) return 0
  if (CONTEXT_WINDOW_PRESETS.some((preset) => preset.value === contextWindow)) return contextWindow
  return -1
}

export function isCustomContextWindowValue(contextWindow: number): boolean {
  return contextWindow > 0 && resolveContextWindowSelectValue(contextWindow) === -1
}
