// 路由判定矩阵单测：
// - shouldPreviewFirst：聊天消息文件链接的预览优先策略（md/html/office/图片/音视频 → 预览面板；
//   txt/log/csv 纯文本与代码/配置类 → 代码 tab）。
// - shouldOpenInEditorByDefault：文件树单击的默认路由（编辑器优先，仅二进制富媒体走预览）。
// 见 design/components/fileOpenRouting.ts。

import { describe, expect, it } from 'vitest'
import {
  canOpenInEditor,
  canOpenPreview,
  shouldOpenInEditorByDefault,
  shouldPreviewFirst,
} from '../design/components/fileOpenRouting'

describe('fileOpenRouting', () => {
  describe('shouldOpenInEditorByDefault（文件树单击：编辑器优先）', () => {
    it('代码/配置/文本/未知扩展一律编辑器（含 dotfile）', () => {
      expect(shouldOpenInEditorByDefault('/repo/src/a.ts')).toBe(true)
      expect(shouldOpenInEditorByDefault('/repo/.gitignore')).toBe(true)
      expect(shouldOpenInEditorByDefault('/repo/a.txt')).toBe(true)
      expect(shouldOpenInEditorByDefault('/repo/a.unknownext')).toBe(true)
    })

    it('md/html/svg 富预览类型默认编辑器（预览走右键菜单显式入口）', () => {
      expect(shouldOpenInEditorByDefault('/repo/README.md')).toBe(true)
      expect(shouldOpenInEditorByDefault('/repo/index.html')).toBe(true)
      expect(shouldOpenInEditorByDefault('/repo/logo.svg')).toBe(true)
    })

    it('csv/tsv 属 universal 表格预览但默认编辑器（与纯文本路由一致）', () => {
      expect(shouldOpenInEditorByDefault('/repo/data.csv')).toBe(true)
      expect(shouldOpenInEditorByDefault('/repo/data.tsv')).toBe(true)
    })

    it('图片/音视频/office 等二进制富媒体走预览面板', () => {
      expect(shouldOpenInEditorByDefault('/repo/a.png')).toBe(false)
      expect(shouldOpenInEditorByDefault('/repo/a.mp4')).toBe(false)
      expect(shouldOpenInEditorByDefault('/repo/a.mp3')).toBe(false)
      expect(shouldOpenInEditorByDefault('/repo/a.docx')).toBe(false)
    })
  })

  describe('shouldPreviewFirst（聊天消息链接：预览优先）', () => {
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

    it('编辑项：代码/markup/纯文本/dotfile 可用，office/图片不可用', () => {
      expect(canOpenInEditor('src/app.ts')).toBe(true)
      expect(canOpenInEditor('docs/readme.md')).toBe(true)
      expect(canOpenInEditor('web/index.html')).toBe(true)
      expect(canOpenInEditor('logs/app.log')).toBe(true)
      expect(canOpenInEditor('.gitignore')).toBe(true)
      expect(canOpenInEditor('.env.local')).toBe(true)
      expect(canOpenInEditor('docs/report.docx')).toBe(false)
      expect(canOpenInEditor('assets/logo.png')).toBe(false)
    })
  })
})
