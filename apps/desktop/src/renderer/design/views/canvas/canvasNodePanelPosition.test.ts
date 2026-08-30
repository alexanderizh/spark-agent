import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const workspaceStyles = readFileSync(
  fileURLToPath(new URL('./CanvasWorkspaceView.less', import.meta.url)),
  'utf8',
)

describe('canvas node panel position', () => {
  it('keeps node panels near the bottom edge without reserving bottom toolbar space', () => {
    const panelRule = workspaceStyles.match(/\.canvas-node-bottom-editor\s*\{([^}]*)\}/)?.[1]

    expect(panelRule).toBeDefined()
    expect(panelRule).toMatch(/bottom:\s*var\(--canvas-float-bottom\);/)
    expect(panelRule).not.toMatch(/bottom:[^;]*58px/)
  })
})
