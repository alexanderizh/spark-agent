/**
 * AI 回复 Markdown 渲染组件。
 *
 * Cursor 式「AI = 文档排版」：无气泡、全宽，支持标题/列表/任务列表/代码块（横向滚动+复制）/
 * 引用/表格（列对齐+列宽自适应+斑马纹）/图片（点击全屏预览）/链接（点击复制）。
 * 流式输入下每次 content 变化全量重解析（几 KB 文本无压力）。
 *
 * 图片本地化（2026-10-16）：markdown 引用的桌面端本地路径图片经 image-cache
 * 解析为缓存文件后回填渲染（重复查看零中继重传）；http(s)/data: 直接放行。
 */

import { parseMarkdown, type MdBlock } from '../../utils/markdown'
import { cachedImagePath, resolveImagePath } from '../../api/image-cache'
import { getSelectedDeviceId } from '../../api/relay'

interface RichMdData {
  blocks: MdBlock[]
}

/** 桌面端本地路径（非 http/data/小程序协议）才需要经缓存层解析 */
function isDesktopPath(url: string): boolean {
  return url.startsWith('/') || /^[a-zA-Z]:[/\\]/.test(url)
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
    /** 定向桌面端 deviceId（图片经中继拉取；空 = 用全局选中设备） */
    deviceId: {
      type: String,
      value: '',
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
    parse(
      this: {
        setData: (d: Partial<RichMdData>) => void
        resolveDesktopImages: (blocks: MdBlock[]) => void
        data: { blocks: MdBlock[] }
      },
      value: string,
    ) {
      const blocks = value ? parseMarkdown(value) : []
      this.setData({ blocks })
      this.resolveDesktopImages(blocks)
    },

    /**
     * 桌面端路径图片 → 本地缓存回填。
     * 命中缓存同步回填；未命中异步拉取（并发去重共享请求），回填前校验
     * 当前 block 仍是同一 url（流式重渲染后 blocks 已换代，防止错位）。
     */
    resolveDesktopImages(
      this: {
        setData: (d: Record<string, unknown>) => void
        data: { blocks: MdBlock[]; deviceId: string }
      },
      blocks: MdBlock[],
    ) {
      for (let i = 0; i < blocks.length; i += 1) {
        const block = blocks[i]
        if (block.type !== 'image') continue
        const url = block.url
        if (!url || !isDesktopPath(url)) continue
        const cached = cachedImagePath(url)
        if (cached != null) {
          this.setData({ [`blocks[${i}].url`]: cached })
          continue
        }
        const target = i
        const deviceId = this.data.deviceId || getSelectedDeviceId()
        void resolveImagePath(url, deviceId).then((local) => {
          const current = this.data.blocks[target]
          if (local == null || current == null || current.type !== 'image' || current.url !== url) {
            return
          }
          this.setData({ [`blocks[${target}].url`]: local })
        })
      }
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

    /** 块级图片点击：全屏预览（桌面路径图片已被回填为本地缓存路径） */
    onImageTap(this: unknown, e: WechatMiniprogram.TouchEvent) {
      const url = (e.currentTarget.dataset.url as string) ?? ''
      if (!url) return
      wx.previewImage({ urls: [url] })
    },
  },
})
