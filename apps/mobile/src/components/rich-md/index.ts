/**
 * AI 回复 Markdown 渲染组件。
 *
 * Cursor 式「AI = 文档排版」：无气泡、全宽，支持标题/列表/代码块（横向滚动+复制）/
 * 引用/表格/行内样式。流式输入下每次 content 变化全量重解析（几 KB 文本无压力）。
 */

import { parseMarkdown, type MdBlock } from '../../utils/markdown'

interface RichMdData {
  blocks: MdBlock[]
}

Component({
  properties: {
    /** markdown 原文（流式中途也允许不完整） */
    content: {
      type: String,
      value: '',
      observer(this: { parse: (v: string) => void }, value: string) {
        this.parse(value)
      },
    },
  },

  data: {
    blocks: [],
  } as RichMdData,

  lifetimes: {
    attached(this: { parse: (v: string) => void }) {
      // properties observer 在初始赋值时不触发，attached 补一次
      this.parse((this as unknown as { data: { content: string } }).data.content)
    },
  },

  methods: {
    parse(this: { setData: (d: Partial<RichMdData>) => void }, value: string) {
      this.setData({ blocks: value ? parseMarkdown(value) : [] })
    },

    onCopyCode(this: unknown, e: WechatMiniprogram.TouchEvent) {
      const code = (e.currentTarget.dataset.code as string) ?? ''
      wx.setClipboardData({ data: code })
    },
  },
})
