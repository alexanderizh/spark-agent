/**
 * 胶囊输入框（Cursor 式全局输入）。
 *
 * mode=float  fixed 悬浮胶囊（首页快速发起，页面内容从其后滚过）
 * mode=dock   流式停靠（聊天页底部正常文档流，配合键盘 adjust-position）
 *
 * 右侧圆形按钮：running 时为「停止」，否则输入非空时为「发送」。
 */

interface CapsuleComposerData {
  focus: boolean
}

Component({
  properties: {
    value: { type: String, value: '' },
    mode: { type: String, value: 'float' },
    placeholder: { type: String, value: '问点什么…' },
    /** 回合运行中：右侧按钮变为停止 */
    running: { type: Boolean, value: false },
    disabled: { type: Boolean, value: false },
  },

  data: {
    focus: false,
  } as CapsuleComposerData,

  methods: {
    onInput(e: WechatMiniprogram.TextareaInput) {
      this.triggerEvent('input', { value: e.detail.value })
    },

    onFocus() {
      this.setData({ focus: true })
    },
    onBlur() {
      this.setData({ focus: false })
    },

    onSend() {
      const value = (
        this as unknown as { properties: { value: string; running: boolean; disabled: boolean } }
      ).properties
      if (value.running) {
        this.triggerEvent('stop')
        return
      }
      if (!value.value.trim() || value.disabled) return
      this.triggerEvent('send', { value: value.value.trim() })
    },
  },
})
