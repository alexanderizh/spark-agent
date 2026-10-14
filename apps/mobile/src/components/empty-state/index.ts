/**
 * 空态三件套（Cursor 式）：圆形图标位 + 标题 + 两行指引文案。
 */

Component({
  properties: {
    /** 图标名（icon-* 类后缀） */
    icon: { type: String, value: 'chat' },
    title: { type: String, value: '' },
    desc: { type: String, value: '' },
  },

  methods: {
    onAction() {
      this.triggerEvent('action')
    },
  },
})
