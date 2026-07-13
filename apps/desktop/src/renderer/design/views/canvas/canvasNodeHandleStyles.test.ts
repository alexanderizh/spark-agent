import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

describe('canvas node handle styles', () => {
  it('lets handles escape node shells while keeping node content clipped', () => {
    const stylesheet = readFileSync(
      fileURLToPath(new URL('./CanvasWorkspaceView.less', import.meta.url)),
      'utf8',
    )
    const v4NodeStyles = readFileSync(
      fileURLToPath(new URL('./uiux-v4/nodes.less', import.meta.url)),
      'utf8',
    )
    const v4StageStyles = readFileSync(
      fileURLToPath(new URL('./uiux-v4/stage.less', import.meta.url)),
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
    const flowNodeRule = stylesheet.match(/\.canvas-stage \.react-flow__node\s*\{([^}]*)\}/)?.[1]
    const shellRule = stylesheet.match(/\.canvas-node-shell\s*\{([^}]*)\}/)?.[1]
    const coreRule = stylesheet.match(/\.canvas-node-core\s*\{([^}]*)\}/)?.[1]
    const handleRule = stylesheet.match(/\.canvas-node-handle\s*\{([^}]*)\}/)?.[1]

    expect(flowNodeRule).toMatch(/overflow:\s*visible\s*!important\s*;/)
    expect(shellRule).toMatch(/overflow:\s*visible\s*!important\s*;/)
    expect(coreRule).toMatch(/overflow:\s*hidden\s*;/)
    expect(handleRule).toBeDefined()
    expect(handleRule).toMatch(/z-index:\s*8\s*;/)
    expect(v4NodeStyles).toMatch(/\.canvas-node\s*\{[\s\S]*?overflow:\s*visible\s*;/)
    expect(v4NodeStyles).toMatch(/\.canvas-node-handle\s*\{[\s\S]*?width:\s*28px\s*;/)
    expect(v4NodeStyles).toMatch(/&::after\s*\{[\s\S]*?width:\s*10px\s*;/)
    expect(nodeSource).toContain(
      'const showResizer = !locked && (selected || resizeHovered || resizing)',
    )
    expect(nodeSource).toContain('onPointerEnter={() => setResizeHovered(true)}')
    expect(nodeSource).toContain('onResizeStart={() => setResizing(true)}')
    expect(stageSource).toContain('interactionWidth: 36')
    expect(v4StageStyles).toMatch(
      /\.react-flow__edge-interaction\s*\{[\s\S]*?stroke-width:\s*36px\s*;/,
    )
  })
})
