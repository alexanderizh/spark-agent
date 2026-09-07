import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const readCanvasSource = (relativePath: string) =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8')

describe('canvas stage media persistence', () => {
  it('keeps media nodes mounted without repeatedly promoting the full viewport layer', () => {
    const stage = readCanvasSource('./CanvasStage.tsx')
    const styles = readCanvasSource('./CanvasWorkspaceView.less')

    expect(stage).not.toMatch(/\bonlyRenderVisibleElements(?:=|\s|>)/)
    expect(stage).not.toContain('data-viewport-moving')
    expect(styles).not.toContain("data-viewport-moving='true'")
    expect(styles).not.toMatch(/\.react-flow__viewport\s*\{[\s\S]*?will-change:\s*transform;/)
  })
})
