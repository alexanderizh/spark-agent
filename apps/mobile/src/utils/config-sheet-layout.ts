/**
 * 模型配置弹层（components/config-sheet）里「模型列表」能占多高。
 *
 * 为什么必须算出来：WeChat 的 scroll-view 要竖向滚动，容器得有**确定高度**
 * （官方文档：给 scroll-view 一个固定高度）。只写 `flex: 1 1 auto; min-height: 0`
 * 靠 flex 分配在真机上不成立——列表会撑到内容高度、溢出 82vh 的 sheet 底部，
 * 把底部「推理强度 / 权限」整栏顶到屏幕外，表现就是「列表滚不动、底部看不到」。
 *
 * 所以按 sheet 的高度上限（82vh）减去头尾占位，给列表一个明确的 max-height：
 * 内容短时列表仍按内容收缩（sheet 自适应高度），内容长时才封顶滚动。
 */

/** 与 index.wxss 里 `.cs-sheet` 的 max-height（82vh）保持一致 */
export const CONFIG_SHEET_MAX_RATIO = 0.82

/** 头尾固定占位（rpx）：sheet 上下内边距 16 + 24、抓手 8 + 12、标题行 76 */
export const CONFIG_SHEET_CHROME_RPX = 136

/** rpx 换算基准宽度 */
export const CONFIG_SHEET_RPX_BASE = 750

/** 列表最小可用高度：空间实在不够时宁可列表矮一点，也不把底栏顶出屏幕 */
export const CONFIG_SHEET_BODY_MIN_PX = 160

export interface ConfigSheetMetrics {
  windowWidth: number
  windowHeight: number
  /** 底部安全区高度（px） */
  safeBottom?: number
  /** 固定底栏（推理强度 + 权限）实测高度（px）；没有底栏时传 0 */
  footerHeight?: number
}

/**
 * 返回列表的 max-height（px）。
 *
 * 结果 0 表示算不出可用空间（横屏等极端情况），调用方应当不设上限、
 * 交给样式表里的兜底值。
 */
export function computeConfigSheetBodyMax(metrics: ConfigSheetMetrics): number {
  const width = metrics.windowWidth > 0 ? metrics.windowWidth : 375
  const height = metrics.windowHeight > 0 ? metrics.windowHeight : 667
  const footerHeight = Math.max(metrics.footerHeight ?? 0, 0)
  const safeBottom = Math.max(metrics.safeBottom ?? 0, 0)
  // rpx 按屏幕宽度换算，和 WXSS 里的 rpx 同一套比例
  const chrome = CONFIG_SHEET_CHROME_RPX * (width / CONFIG_SHEET_RPX_BASE) + safeBottom
  const available = height * CONFIG_SHEET_MAX_RATIO - chrome - footerHeight
  if (available >= CONFIG_SHEET_BODY_MIN_PX) return Math.round(available)
  return Math.max(Math.round(available), 0)
}

/** 底部安全区高度（px）：safeArea.bottom 与窗口底边的距离 */
export function resolveSafeBottom(info: {
  windowHeight: number
  safeArea?: { bottom?: number } | null
}): number {
  const bottom = info.safeArea?.bottom
  if (typeof bottom !== 'number') return 0
  return Math.max(info.windowHeight - bottom, 0)
}
