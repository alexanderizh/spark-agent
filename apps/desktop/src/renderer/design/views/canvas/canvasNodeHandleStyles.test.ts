import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

describe('canvas node handle styles', () => {
  it('lets handles escape node shells while keeping node content clipped', () => {
    const stylesheet = readFileSync(
      fileURLToPath(new URL('./CanvasWorkspaceView.less', import.meta.url)),
      'utf8',
    )
    const nodeSource = readFileSync(
      fileURLToPath(new URL('./CanvasNode.tsx', import.meta.url)),
      'utf8',
    )
    const stageSource = readFileSync(
      fileURLToPath(new URL('./CanvasStage.tsx', import.meta.url)),
      'utf8',
    )
    const cinematicNodeStyles = readFileSync(
      fileURLToPath(new URL('./cinematic/nodes.less', import.meta.url)),
      'utf8',
    )
    const flowNodeRule = stylesheet.match(/\.canvas-stage \.react-flow__node\s*\{([^}]*)\}/)?.[1]
    const shellRule = stylesheet.match(/\.canvas-node-shell\s*\{([^}]*)\}/)?.[1]
    const coreRule = stylesheet.match(/\.canvas-node-core\s*\{([^}]*)\}/)?.[1]
    const handleRule = stylesheet.match(/\.canvas-node-handle\s*\{([^}]*)\}/)?.[1]

    expect(flowNodeRule).toMatch(/overflow:\s*visible\s*!important\s*;/)
    expect(shellRule).toMatch(/overflow:\s*visible\s*!important\s*;/)
    expect(coreRule).toMatch(/overflow:\s*hidden\s*;/)
    expect(handleRule).toBeDefined()
    expect(handleRule).toMatch(/z-index:\s*8\s*;/)
    expect(nodeSource).toContain('const showResizer =')
    expect(nodeSource).toContain('!locked && !collapsedGroupPresentation')
    expect(nodeSource).toContain('onPointerEnter={() => setResizeHovered(true)}')
    expect(nodeSource).toContain('onResizeStart={() => setResizing(true)}')
    expect(stageSource).toContain('interactionWidth: 36')
    expect(stageSource).toContain('connectionRadius={32}')
    expect(stageSource).toContain("target.closest('.react-flow__pane')")
    expect(stageSource).toContain('handleAddTextFromPane')
    expect(cinematicNodeStyles).toMatch(
      /\.canvas-node-handle\s*\{[\s\S]*?width:\s*13px;[\s\S]*?min-width:\s*13px;[\s\S]*?box-sizing:\s*border-box;/,
    )
    expect(cinematicNodeStyles).toMatch(
      /\.canvas-node\.canvas-node-media-full-bleed\s*\{[^}]*overflow:\s*visible;/s,
    )
    expect(cinematicNodeStyles).toMatch(/\.canvas-node-handle::after\s*\{[\s\S]*?content:\s*none;/)
    expect(cinematicNodeStyles).toMatch(
      /\.canvas-node-handle\.react-flow__handle-left\s*\{[\s\S]*?transform:\s*translate\(-50%, -50%\) scale\(var\(--canvas-node-handle-scale\)\);/,
    )
    expect(cinematicNodeStyles).toMatch(
      /\.canvas-node-handle\.react-flow__handle-right\s*\{[\s\S]*?transform:\s*translate\(50%, -50%\) scale\(var\(--canvas-node-handle-scale\)\);/,
    )
    expect(cinematicNodeStyles).toContain('--canvas-node-handle-scale: 1;')
    expect(cinematicNodeStyles).toMatch(
      /\.canvas-node:hover \.canvas-node-handle,[\s\S]*?--canvas-node-handle-scale: 1\.35;/,
    )
    expect(cinematicNodeStyles).toContain('.canvas-node-selected .canvas-node-handle')
  })
})
