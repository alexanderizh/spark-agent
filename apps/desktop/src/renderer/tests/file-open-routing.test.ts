// 路由判定矩阵单测：预览优先策略（md/html/office/图片/音视频 → 预览面板；
// txt/log/csv 纯文本与代码/配置类 → 代码 tab）。
// 见 design/components/fileOpenRouting.ts。

import { describe, expect, it } from 'vitest'
import {
  canOpenInEditor,
  canOpenPreview,
  shouldPreviewFirst,
} from '../design/components/fileOpenRouting'

describe('fileOpenRouting', () => {
  describe('shouldPreviewFirst（点击默认路由）', () => {
    it('富文档类预览优先：md / html', () => {
      expect(shouldPreviewFirst('docs/readme.md')).toBe(true)
      expect(shouldPreviewFirst('docs/report.markdown')).toBe(true)
      expect(shouldPreviewFirst('docs/notes.mdx')).toBe(true)
      expect(shouldPreviewFirst('web/index.html')).toBe(true)
      expect(shouldPreviewFirst('web/index.htm')).toBe(true)
    })

    it('图片 / office / 音视频仍预览优先', () => {
      expect(shouldPreviewFirst('assets/logo.png')).toBe(true)
      expect(shouldPreviewFirst('assets/icon.svg')).toBe(true)
      expect(shouldPreviewFirst('docs/report.docx')).toBe(true)
      expect(shouldPreviewFirst('docs/slides.pptx')).toBe(true)
      expect(shouldPreviewFirst('media/demo.mp4')).toBe(true)
    })

    it('纯文本类保持代码 tab：txt / log / csv', () => {
      expect(shouldPreviewFirst('README.txt')).toBe(false)
      expect(shouldPreviewFirst('logs/app.log')).toBe(false)
      expect(shouldPreviewFirst('data/table.csv')).toBe(false)
    })

    it('代码 / 配置类保持代码 tab', () => {
      expect(shouldPreviewFirst('src/app.ts')).toBe(false)
      expect(shouldPreviewFirst('src/index.test.tsx')).toBe(false)
      expect(shouldPreviewFirst('package.json')).toBe(false)
      expect(shouldPreviewFirst('Dockerfile')).toBe(false)
    })
  })

  describe('右键菜单可用性', () => {
    it('预览项：富预览类型可用，纯文本/代码不可用', () => {
      expect(canOpenPreview('docs/readme.md')).toBe(true)
      expect(canOpenPreview('web/index.html')).toBe(true)
      expect(canOpenPreview('logs/app.log')).toBe(false)
      expect(canOpenPreview('src/app.ts')).toBe(false)
    })

    it('csv 默认进代码 tab，但右键仍可显式预览（Flyfish 表格）；tsv 无预览', () => {
      expect(shouldPreviewFirst('data/table.csv')).toBe(false)
      expect(shouldPreviewFirst('data/table.tsv')).toBe(false)
      // csv 在 FLYFISH_VIEWER_EXTENSIONS（universal）→ 右键给显式预览入口
      expect(canOpenPreview('data/table.csv')).toBe(true)
      // tsv 不在 Flyfish 白名单 → 无预览项，仅「编辑」
      expect(canOpenPreview('data/table.tsv')).toBe(false)
      expect(canOpenInEditor('data/table.csv')).toBe(true)
    })

    it('编辑项：代码/markup/纯文本可用，office/图片不可用', () => {
      expect(canOpenInEditor('src/app.ts')).toBe(true)
      expect(canOpenInEditor('docs/readme.md')).toBe(true)
      expect(canOpenInEditor('web/index.html')).toBe(true)
      expect(canOpenInEditor('logs/app.log')).toBe(true)
      expect(canOpenInEditor('docs/report.docx')).toBe(false)
      expect(canOpenInEditor('assets/logo.png')).toBe(false)
    })
  })
})
