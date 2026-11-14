/**
 * 轮次轨道（turn rail）：会话右侧的竖排轮次刻度。
 *
 * 桌面端对应物是 ChatTurnNavigator；移动端没有 hover，交互换成：
 *   - 点一刻度 → 滚到该轮（事件冒泡给页面，页面量位置后跳）
 *   - 长按一刻度 → 弹出该轮预览（用户提问 + 助手答复摘要）
 *   - 当前轮刻度自动加长高亮，并借助 scroll-into-view 保持可见
 *
 * 少于两轮整体不渲染：只有一轮时轨道纯属噪音。
 * 组件自己管预览卡的显隐与定位；「怎么跳、跳完要不要贴底」全部在页面侧。
 */

import type { TurnRailItem } from '../../utils/turn-rail'

/** SelectorQuery.exec 的回参元素（typings 里是 any[]，这里自己收窄） */
interface MeasuredRect {
  top?: number
  height?: number
  scrollTop?: number
}

/** 预览卡预估高度（px）：用来判断贴底时要不要向上翻转 */
const PREVIEW_ESTIMATED_HEIGHT = 150

Component({
  properties: {
    /** 轮次列表（时间正序）；来自 utils/turn-rail 的 buildTurnRail */
    turns: { type: Array, value: [] as TurnRailItem[] },
    /** 当前轮次 key；由页面按滚动位置算出后回传 */
    activeKey: { type: String, value: '' },
  },

  data: {
    /** 当前轮的锚点 id：内层 scroll-view 的 scroll-into-view 目标 */
    activeAnchorId: '',
    /** 展开预览的轮次 key（空串 = 收起） */
    previewKey: '',
    /** 预览的轮次本体；previewKey 变化时同步，模板直接取字段 */
    previewTurn: null as TurnRailItem | null,
    /** 预览卡距轨道内容顶部的偏移（px），长按时量出来的 */
    previewTop: 0,
    /** 预览卡是否向上翻转（贴底时改放到刻度上方，避免溢出屏幕） */
    previewFlip: false,
  },

  observers: {
    turns() {
      this.syncActiveAnchor()
      this.syncPreviewTurn()
    },
    activeKey() {
      this.syncActiveAnchor()
    },
    previewKey() {
      this.syncPreviewTurn()
    },
  },

  methods: {
    syncActiveAnchor() {
      const { turns, activeKey } = this.properties
      const found = (turns as TurnRailItem[]).find((turn) => turn.key === activeKey)
      const anchorId = found?.anchorId ?? ''
      if (anchorId !== this.data.activeAnchorId) this.setData({ activeAnchorId: anchorId })
    },

    /** 预览卡内容跟随 previewKey；turns 变化时也要重算（轮次列表会随流式增长） */
    syncPreviewTurn() {
      const turns = this.properties.turns as TurnRailItem[]
      const found = turns.find((turn) => turn.key === this.data.previewKey) ?? null
      if ((found?.key ?? null) === (this.data.previewTurn?.key ?? null)) return
      this.setData({ previewTurn: found })
    },

    onMarkerTap(e: WechatMiniprogram.TouchEvent) {
      const { key } = e.currentTarget.dataset as { key?: string }
      if (key == null) return
      this.triggerEvent('jump', { key })
    },

    /**
     * 长按刻度 → 展开该轮预览。
     *
     * 预览卡是滚动轨道的兄弟节点（不能放进 scroll-view，否则会被 overflow 裁掉），
     * 所以位置要按「刻度相对轨道内容的位置」现量：一次 query 拿刻度矩形、轨道矩形、
     * 轨道滚动量三个值算出来。
     */
    onMarkerLongPress(e: WechatMiniprogram.TouchEvent) {
      const { key } = e.currentTarget.dataset as { key?: string }
      if (key == null) return
      const turn = (this.properties.turns as TurnRailItem[]).find((item) => item.key === key)
      if (turn == null) return
      // 再长按同一下：收起
      if (this.data.previewKey === key) {
        this.closePreview()
        return
      }

      wx.createSelectorQuery()
        .in(this)
        .select(`#${turn.anchorId}`)
        .boundingClientRect()
        .select('.rail-track')
        .boundingClientRect()
        .select('.rail-track')
        .scrollOffset()
        .exec((res: Array<MeasuredRect | null | undefined>) => {
          const marker = res[0]
          const track = res[1]
          const offset = res[2]
          // 取成局部常量：属性上的收窄不会传进这个回调
          const markerTop = marker?.top
          const trackTop = track?.top
          const trackHeight = track?.height
          const trackScrollTop = offset?.scrollTop
          if (
            markerTop == null ||
            trackTop == null ||
            trackHeight == null ||
            trackScrollTop == null
          ) {
            return
          }
          const top = markerTop - trackTop + trackScrollTop
          this.setData({
            previewKey: key,
            previewTop: Math.max(0, top),
            previewFlip: top + PREVIEW_ESTIMATED_HEIGHT > trackHeight,
          })
        })
    },

    /** 页面在聊天区滚动 / 点击消息时调用，收起预览 */
    closePreview() {
      if (this.data.previewKey === '') return
      this.setData({ previewKey: '' })
    },

    /** 轨道自身滚动时收起预览：刻度都移走了，预览还挂在老位置会很违和 */
    onTrackScroll() {
      this.closePreview()
    },

    /** 预览卡不响应手势，但要把事件吃掉，别透传到下层消息 */
    onPreviewCatch() {
      // intentionally empty
    },
  },
})
