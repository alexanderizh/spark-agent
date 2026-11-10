/**
 * 附件菜单底部弹层（对齐设计稿）。
 *
 * 取代 wx.showActionSheet：原生菜单只能纯文本，设计稿要「图标 + 标题 + 副标题」的分组卡片。
 * 条目由页面给定（key/label/sub/icon），点选后 triggerEvent('pick', { key })，
 * 具体选择与上传仍归页面（新建会话尚未建会话，上传链路与已建会话不同）。
 */

interface AttachSheetItem {
  key: string
  label: string
  sub?: string
  /** app.wxss 里的图标类名（如 icon-photo） */
  icon: string
}

Component({
  properties: {
    show: { type: Boolean, value: false },
    items: { type: Array, value: [] as AttachSheetItem[] },
  },

  methods: {
    noop() {
      /* 阻止蒙层点击冒泡 / 背景滚动穿透 */
    },

    onClose() {
      this.triggerEvent('close')
    },

    onPick(e: WechatMiniprogram.BaseEvent) {
      const key = e.currentTarget.dataset.key as string | undefined
      if (key == null) return
      this.triggerEvent('pick', { key })
    },
  },
})
