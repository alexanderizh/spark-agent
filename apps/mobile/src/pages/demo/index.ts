/**
 * 界面预览（演示数据）
 *
 * 为什么存在：本小程序的功能数据全部来自「用户自己电脑上运行的桌面端」。
 * 审核员在没有桌面端在线时，首页只能是「还没有接入的电脑」空态，容易被判定
 * 「功能不完整/无法使用」。本页用纯静态示例数据把真实界面一次性展示出来：
 *   - 不发起任何网络请求，不读 token，不改任何存储
 *   - 全部文案标注「示例」，避免被误认为真实数据
 * 入口：首页空态里的「看看界面长什么样」。
 */

import { syncPageTheme } from '../../utils/theme'

Page({
  data: {
    themeClass: 'theme-light',
    /** 示例设备 */
    device: {
      name: 'MacBook Pro（示例）',
      meta: '在线 · SparkWork 0.15.29 · macOS',
    },
    /** 示例会话 */
    sessions: [
      {
        id: 's1',
        title: '整理移动端发布清单',
        project: 'Spark Agent',
        time: '刚刚',
        badge: '运行中',
        badgeClass: 'badge-success',
        pinned: true,
      },
      {
        id: 's2',
        title: '修复筛选浮层溢出',
        project: 'Spark Agent',
        time: '今天 11:20',
        badge: '待审查',
        badgeClass: 'badge-warning',
        pinned: false,
      },
      {
        id: 's3',
        title: '小程序深色模式配色校对',
        project: '官网',
        time: '昨天',
        badge: '已完成',
        badgeClass: 'badge-neutral',
        pinned: false,
      },
    ],
    /** 示例对话 */
    messages: [
      { role: 'user', text: '帮我看看首页设备列表为什么一直空着' },
      {
        role: 'assistant',
        text: '桌面端没连上中继。我先看一下连接状态和接口返回：',
        code: 'GET /v1/catalog → 404\nws /ws/bridge/client → 未握手',
        tool: '已执行 2 个命令',
        tail: '结论：线上 edu-server 还是旧版，缺 relay 模块。部署后即可恢复。',
      },
    ],
  },

  onShow() {
    syncPageTheme(this)
  },

  onBack() {
    wx.navigateBack({
      delta: 1,
      fail: () => wx.reLaunch({ url: '/pages/home/index' }),
    })
  },

  onBlocked() {
    wx.showToast({ title: '示例数据，不可操作', icon: 'none' })
  },
})
