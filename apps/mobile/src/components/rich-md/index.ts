/**
 * AI 回复 Markdown 渲染组件。
 *
 * Cursor 式「AI = 文档排版」：无气泡、全宽，支持标题/列表/任务列表/代码块（横向滚动+复制）/
 * 引用/表格（列对齐+列宽自适应+斑马纹）/图片（点击全屏预览）/链接（点击复制）。
 * 流式输入下每次 content 变化全量重解析（几 KB 文本无压力）。
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

    /** 链接点击：小程序无法直接打开外链，复制链接交给用户（系统自带「已复制」提示） */
    onLinkTap(this: unknown, e: WechatMiniprogram.TouchEvent) {
      const url = (e.currentTarget.dataset.url as string) ?? ''
      if (!url) return
      wx.setClipboardData({ data: url })
    },

    /** 块级图片点击：全屏预览 */
    onImageTap(this: unknown, e: WechatMiniprogram.TouchEvent) {
      const url = (e.currentTarget.dataset.url as string) ?? ''
      if (!url) return
      wx.previewImage({ urls: [url] })
    },
  },
})
