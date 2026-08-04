import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const stylesheet = readFileSync(
  fileURLToPath(new URL('./canvas-prompt-library.less', import.meta.url)),
  'utf8',
)

describe('canvas prompt library layout', () => {
  it('keeps quick-use cards measurable before the modal settles its height', () => {
    expect(stylesheet).toMatch(
      /\.canvas-prompt-library-panel\.canvas-prompt-quick-use-panel \.canvas-prompt-library-entry\s*\{[\s\S]*?min-height:\s*(?:clamp\([^;]+\)|\d+px)\s*;/,
    )
  })

  it('keeps compact popover entries at a stable height to avoid grid overlap', () => {
    // compact 变体（节点编辑弹层 hover Popover）必须有稳定 min-height，
    // 否则会被上面的 .canvas-prompt-library-panel .canvas-prompt-library-entry 撤成 0，
    // 在 grid-auto-rows: auto 下卡片溢出轨道彼此重叠。
    expect(stylesheet).toMatch(
      /\.canvas-prompt-library-panel\.canvas-node-edit-prompt-library-compact \.canvas-prompt-library-entry\s*\{[\s\S]*?min-height:\s*\d+px\s*;/,
    )
    expect(stylesheet).toMatch(
      /\.canvas-prompt-library-panel\.canvas-node-edit-prompt-library-compact \.canvas-prompt-library-list\s*\{[\s\S]*?grid-auto-rows:\s*max-content\s*;/,
    )
  })

  it('aligns compact popover cards to equal height in a row', () => {
    // list 基础定义（CanvasWorkspaceView.less）设了 align-items: start，叠加 entry height:auto，
    // 同行卡片不会拉伸等高、各自按 content 高度渲染，底部参差。compact 必须用 stretch 覆盖。
    expect(stylesheet).toMatch(
      /\.canvas-prompt-library-panel\.canvas-node-edit-prompt-library-compact \.canvas-prompt-library-list\s*\{[\s\S]*?align-items:\s*stretch\s*;/,
    )
  })

  it('keeps compact popover cards flat without heavy borders or hover lift', () => {
    // 扁平风格：去掉卡片静态边框、hover 不上浮（transform: none）。
    expect(stylesheet).toMatch(
      /\.canvas-prompt-library-panel\.canvas-node-edit-prompt-library-compact \.canvas-prompt-library-entry\s*\{[\s\S]*?border:\s*0\s*;/,
    )
    expect(stylesheet).toMatch(
      /\.canvas-prompt-library-panel\.canvas-node-edit-prompt-library-compact \.canvas-prompt-library-entry:hover\s*\{[\s\S]*?transform:\s*none\s*;/,
    )
  })
})
