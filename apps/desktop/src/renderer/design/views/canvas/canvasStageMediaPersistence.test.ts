import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const readCanvasSource = (relativePath: string) =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8')

describe('canvas stage media persistence', () => {
  it('keeps media nodes mounted and moves the viewport on a compositor layer', () => {
    const stage = readCanvasSource('./CanvasStage.tsx')
    const styles = readCanvasSource('./CanvasWorkspaceView.less')

    expect(stage).not.toMatch(/\bonlyRenderVisibleElements(?:=|\s|>)/)
    expect(stage).toContain("setAttribute('data-viewport-moving', 'true')")
    expect(stage).toContain("removeAttribute('data-viewport-moving')")
    expect(styles).toMatch(
      /\.canvas-stage\[data-viewport-moving='true'\] \.react-flow__viewport\s*\{[\s\S]*?will-change:\s*transform;/,
    )
  })
})
