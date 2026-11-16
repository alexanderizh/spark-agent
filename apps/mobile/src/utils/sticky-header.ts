/**
 * 列表页吸顶工具（搜索 / 筛选区随页面滚动吸附在顶部）。
 *
 * 分工：
 *   吸附本身由 WXSS 的 position: sticky 完成，页面只把 top 设成状态栏高度；
 *   本模块负责两件 JS 才能做的事：
 *     1. statusBarTop()  取状态栏高度（px）。sticky 的 top、顶部遮罩高度都取它，
 *        这样导航栏滚出屏幕后，吸顶区停在状态栏下方而不是被系统状态栏压住；
 *     2. observeStuck()  用哨兵节点判断「是否已吸附」，供页面切换阴影 / 发丝线。
 *
 * 哨兵：吸顶区前放一个 1rpx 高的空 view，它越过状态栏下沿即代表吸顶区已贴顶。
 */

/** 状态栏高度（px）。取不到时给 20px 兜底（列表页顶多留一点空白，不会压字） */
export function statusBarTop(): number {
  try {
    const info = wx.getWindowInfo()
    return Math.max(0, Math.round(info.statusBarHeight ?? 0)) || 20
  } catch {
    return 20
  }
}

/**
 * 监听哨兵是否越过顶部边界（= 吸顶区已吸附）。
 * 返回观察器供页面 onUnload 断开；创建失败（低版本基础库）时返回 null，页面退回无阴影的静态吸顶。
 */
export function observeStuck(
  host: unknown,
  sentinelSelector: string,
  topPx: number,
  onChange: (stuck: boolean) => void,
): WechatMiniprogram.IntersectionObserver | null {
  try {
    const observer = wx.createIntersectionObserver(
      host as WechatMiniprogram.Component.TrivialInstance,
      { thresholds: [0] },
    )
    observer.relativeToViewport({ top: -Math.max(0, topPx) }).observe(sentinelSelector, (res) => {
      onChange(res.intersectionRatio <= 0)
    })
    return observer
  } catch {
    return null
  }
}
