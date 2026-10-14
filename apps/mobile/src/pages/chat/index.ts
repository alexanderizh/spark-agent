/**
 * 远程对话页。
 *
 * 接替桌面端会话：进入即拉全量历史，随后 WebSocket 增量跟流；
 * 发送消息走 submitTurn（与桌面端发送同一会话同一回合机制）。
 *
 * 渲染分层：BridgeEvent → chat-reducer(消息列表) → chat-view(渲染项+时间分界) → setData。
 * 流式期间 setData 做了 100ms 合并节流，避免高频 delta 卡顿。
 */

import * as bridge from '../../api/bridge'
import { applyEvents, emptyTimeline, type ChatTimeline } from '../../utils/chat-reducer'
import { buildTimelineItems } from '../../utils/chat-view'
import { formatRelativeTime } from '../../utils/format'

interface ChatPageData {
  sessionId: string
  title: string
  updatedAtLabel: string
  items: ReturnType<typeof buildTimelineItems>
  running: boolean
  inputText: string
  loading: boolean
  connected: boolean
  /** scroll-into-view 目标（固定锚点 id） */
  scrollToId: string
}

const FLUSH_INTERVAL_MS = 100

Page({
  data: {
    sessionId: '',
    title: '对话',
    updatedAtLabel: '',
    items: [],
    running: false,
    inputText: '',
    loading: true,
    connected: false,
    scrollToId: '',
  } as ChatPageData,

  /** 最近一次渲染的消息快照（节流合并的基准） */
  latestTimeline: null as ChatTimeline | null,
  flushTimer: 0 as ReturnType<typeof setTimeout> | 0,
  closeStream: null as (() => void) | null,

  onLoad(options: Record<string, string | undefined>) {
    const sessionId = options.sessionId ?? ''
    if (!sessionId) {
      wx.showToast({ title: '缺少会话 ID', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 600)
      return
    }
    this.setData({
      sessionId,
      title: options.title ? decodeURIComponent(options.title) : '对话',
    })
  },

  onShow() {
    void this.init()
  },

  onUnload() {
    if (this.flushTimer) clearTimeout(this.flushTimer)
    this.closeStream?.()
    this.closeStream = null
  },

  async init() {
    const { sessionId } = this.data
    if (!sessionId) return
    this.setData({ loading: true })
    try {
      const history = await bridge.getMessages(sessionId, 200)
      const timeline = applyEvents(emptyTimeline(), history.events)
      this.latestTimeline = timeline
      this.flushTimeline(true)
      this.connectStream()
    } catch (error) {
      wx.showToast({ title: (error as Error).message || '历史加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  connectStream() {
    this.closeStream?.()
    this.closeStream = bridge.connectStream(this.data.sessionId, {
      onEvent: (events) => {
        const base = this.latestTimeline ?? emptyTimeline()
        this.latestTimeline = applyEvents(base, events)
        this.flushTimeline()
      },
      onError: () => {
        this.setData({ connected: false })
        // 断流不打断对话：历史/下次进入会重新拉全量，这里仅弱提示
      },
      onClose: () => {
        this.setData({ connected: false })
      },
    })
    this.setData({ connected: true })
  },

  /** 渲染节流：高频流式事件合并为每 100ms 一次 setData；force 立即刷 */
  flushTimeline(force = false) {
    const paint = () => {
      this.flushTimer = 0
      const timeline = this.latestTimeline
      if (!timeline) return
      this.setData({
        items: buildTimelineItems(timeline.messages),
        running: timeline.running,
      })
      this.scrollToBottom()
    }
    if (force) {
      if (this.flushTimer) clearTimeout(this.flushTimer)
      paint()
      return
    }
    if (this.flushTimer) return
    this.flushTimer = setTimeout(paint, FLUSH_INTERVAL_MS)
  },

  scrollToBottom() {
    setTimeout(() => {
      this.setData({ scrollToId: 'chat-anchor' })
    }, 60)
  },

  // ─── 输入 ───────────────────────────────────────────────────────────────────

  onInput(e: WechatMiniprogram.CustomEvent<{ value: string }>) {
    this.setData({ inputText: e.detail.value })
  },

  async onSend(e: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const text = (e.detail.value ?? this.data.inputText).trim()
    if (!text || this.data.running) return
    this.setData({ inputText: '' })
    try {
      await bridge.submitTurn(this.data.sessionId, text)
      // 用户消息会经流回来；若流未连上，本地先乐观渲染
      if (!this.data.connected) {
        const base = this.latestTimeline ?? emptyTimeline()
        this.latestTimeline = applyEvents(base, [
          {
            id: `local-${Date.now()}`,
            seq: -1,
            turnId: 'local',
            type: 'user_message',
            timestamp: new Date().toISOString(),
            content: text,
          },
        ])
        this.flushTimeline(true)
      }
    } catch (error) {
      this.setData({ inputText: text })
      wx.showToast({ title: (error as Error).message || '发送失败', icon: 'none' })
    }
  },

  async onCancel() {
    try {
      await bridge.cancelTurn(this.data.sessionId)
      wx.showToast({ title: '已请求停止', icon: 'success' })
    } catch (error) {
      wx.showToast({ title: (error as Error).message || '取消失败', icon: 'none' })
    }
  },

  // ─── 会话操作（导航栏 ··· 菜单） ─────────────────────────────────────────────

  onMore() {
    const { title } = this.data
    wx.showActionSheet({
      itemList: ['重命名', '删除会话'],
      itemColor: '#1a1a1a',
      success: (res) => {
        if (res.tapIndex === 0) void this.onRename()
        if (res.tapIndex === 1) void this.onDelete()
      },
      fail: () => {
        /* 用户取消 */
      },
    })
    void title
  },

  async onRename() {
    wx.showModal({
      title: '重命名会话',
      editable: true,
      placeholderText: this.data.title,
      success: async (res) => {
        if (!res.confirm) return
        const name = (res.content ?? '').trim()
        if (!name) return
        try {
          await bridge.renameSession(this.data.sessionId, name)
          this.setData({ title: name })
          wx.showToast({ title: '已重命名', icon: 'success' })
        } catch (error) {
          wx.showToast({ title: (error as Error).message || '重命名失败', icon: 'none' })
        }
      },
    })
  },

  async onDelete() {
    wx.showModal({
      title: '删除会话',
      content: '删除后桌面端该会话将移入回收站，无法在移动端恢复。',
      confirmColor: '#dc2626',
      success: async (res) => {
        if (!res.confirm) return
        try {
          await bridge.deleteSession(this.data.sessionId)
          wx.showToast({ title: '已删除', icon: 'success' })
          setTimeout(
            () => wx.navigateBack({ fail: () => wx.reLaunch({ url: '/pages/home/index' }) }),
            500,
          )
        } catch (error) {
          wx.showToast({ title: (error as Error).message || '删除失败', icon: 'none' })
        }
      },
    })
  },

  // WXML 未直接调用，但保留给列表页跳转来源展示
  updatedAtLabelView: formatRelativeTime,
})
