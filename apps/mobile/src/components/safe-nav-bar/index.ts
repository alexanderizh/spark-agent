/**
 * 自定义导航栏（navigationStyle: custom 页面统一使用）。
 *
 * 顶部安全区处理：
 *   statusBarHeight  系统状态栏高度（wx.getWindowInfo）
 *   navHeight        胶囊按钮上下留白推导的导航栏内容高度（与微信胶囊垂直居中）
 *   navClearance     右侧让位：标题与按钮止步于微信胶囊左缘，不与其重叠
 * 页面内容需让出 statusBarHeight + navHeight。
 */

interface SafeNavBarData {
  statusBarHeight: number
  navHeight: number
  /** 右侧让位宽度：窗口宽 - 胶囊左缘 + 间距，避免标题/按钮压到微信胶囊下 */
  navClearance: number
}

/** 页面头部总高度（状态栏 + 导航栏），列表页 padding 用 */
export function pageHeaderHeight(): number {
  try {
    const win = wx.getWindowInfo()
    const menu = wx.getMenuButtonBoundingClientRect()
    const gap = menu.top - win.statusBarHeight
    return win.statusBarHeight + gap * 2 + menu.height
  } catch {
    return 88
  }
}

Component({
  properties: {
    title: { type: String, value: '' },
    showBack: { type: Boolean, value: true },
    /** 右侧是否显示更多按钮（触发 bindmore 事件） */
    showMore: { type: Boolean, value: false },
  },

  data: {
    statusBarHeight: 44,
    navHeight: 44,
    navClearance: 100,
  } as SafeNavBarData,

  lifetimes: {
    attached() {
      try {
        const win = wx.getWindowInfo()
        const menu = wx.getMenuButtonBoundingClientRect()
        const gap = Math.max(menu.top - win.statusBarHeight, 4)
        this.setData({
          statusBarHeight: win.statusBarHeight,
          navHeight: gap * 2 + menu.height,
          navClearance: Math.max(win.windowWidth - menu.left + 8, 100),
        })
      } catch {
        // 非 App 环境（开发者工具异常）兜底
        this.setData({ statusBarHeight: 44, navHeight: 44, navClearance: 100 })
      }
    },
  },

  methods: {
    onBack() {
      wx.navigateBack({ fail: () => wx.reLaunch({ url: '/pages/home/index' }) })
    },
    onMore() {
      this.triggerEvent('more')
    },
  },
})
