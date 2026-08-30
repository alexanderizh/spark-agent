import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const readSource = (relativePath: string) =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8')

describe('operation workbench media layout', () => {
  it('固定每层工作台头部行高，避免预览媒体挤压导航', () => {
    const styles = readSource('./CanvasOperationWorkbench.less')

    expect(styles).toMatch(
      /\.canvas-operation-workbench-head\s*\{[\s\S]*?grid-auto-rows:\s*40px[\s\S]*?flex:\s*0 0 auto/,
    )
    expect(styles).toMatch(
      /\.canvas-operation-workbench-tabs,\s*\.canvas-operation-workbench-context,\s*\.canvas-operation-workbench-actions\s*\{[^}]*height:\s*40px[^}]*min-height:\s*40px/s,
    )
    expect(styles).toMatch(
      /\.canvas-operation-workbench:not\(\.is-fullscreen\):has\(\s*\.canvas-operation-workbench-preview \.canvas-operation-output-media\.is-detail\s*\)\s*\{[^}]*min-height:\s*0/s,
    )
  })

  it('详情图片默认填满可用预览空间，不改变外层面板宽度断点', () => {
    const source = readSource('./CanvasOperationWorkbench.tsx')
    const previewStyles = readSource('./CanvasOperationOutputPreview.less')
    const workspaceStyles = readSource('./CanvasWorkspaceView.less')

    expect(source).toContain(
      "className={`canvas-operation-workbench${fullscreen ? ' is-fullscreen' : ''}`}",
    )
    expect(source).toContain(
      '<CanvasOperationOutputPreview output={activeOutput} variant="detail" />',
    )
    expect(previewStyles).toMatch(
      /\.canvas-operation-output-image-preview\.is-detail\s*\{[^}]*width:\s*100%[^}]*height:\s*100%/s,
    )
    expect(previewStyles).not.toContain('max-width: min(640px, 100%)')
    expect(previewStyles).not.toContain('max-height: min(360px, 100%)')
    expect(workspaceStyles).not.toMatch(
      /\.canvas-node-bottom-editor:not\(\.is-fullscreen\)[\s\S]*?:has\(\s*\.canvas-operation-workbench-preview \.canvas-operation-output-media\.is-detail\s*\)\s*\{[^}]*width:/s,
    )
  })

  it('详情预览沿用面板底色并为长文本保留滚动高度', () => {
    const workbenchStyles = readSource('./CanvasOperationWorkbench.less')
    const previewStyles = readSource('./CanvasOperationOutputPreview.less')

    expect(workbenchStyles).toMatch(
      /\.canvas-operation-workbench-preview\s*\{[\s\S]*?background:\s*var\(--canvas-edit-bg, var\(--panel\)\)/,
    )
    expect(previewStyles).toMatch(
      /\.canvas-operation-workbench-preview\s*>[\s\S]*?\.canvas-operation-output-text\.is-detail[\s\S]*?align-self:\s*stretch[\s\S]*?flex:\s*1 1 auto/,
    )
  })
})
