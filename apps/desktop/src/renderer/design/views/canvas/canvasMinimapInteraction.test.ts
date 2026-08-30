import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const readCanvasSource = (relativePath: string) =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8')

describe('canvas minimap interaction', () => {
  it('lets users click or drag the minimap to move the canvas viewport', () => {
    const stage = readCanvasSource('./CanvasStage.tsx')
    const styles = readCanvasSource('./CanvasWorkspaceView.less')

    expect(stage).toMatch(/<MiniMap[\s\S]*?\bpannable\b[\s\S]*?\/>/)
    expect(stage).toContain('onClick={handleMinimapClick}')
    expect(stage).toContain('setCenter(position.x, position.y')
    expect(stage).toContain('ariaLabel="小地图：点击或拖动可视区域以移动画布"')
    expect(styles).toContain('.canvas-minimap .react-flow__minimap-svg')
    expect(styles).toContain('cursor: grab;')
    expect(styles).toContain('.canvas-minimap:active .react-flow__minimap-svg')
    expect(styles).toContain('cursor: grabbing;')
  })
})
