import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const readSource = (relativePath: string) =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8')

describe('canvas audio toolbar overflow styles', () => {
  it('lets selected audio chrome escape both canvas theme content clips', () => {
    const source = readSource('./cinematic/nodes.less')
    expect(source).toMatch(
      /\.canvas-node-core-audio\s*,\s*\.canvas-node-body-audio\s*\{[\s\S]*?overflow:\s*visible\s*!important\s*;/,
    )
  })

  it('keeps audio body content paintable when cinematic uses content-visibility for other nodes', () => {
    const source = readSource('./cinematic/nodes.less')

    expect(source).not.toMatch(/\.canvas-node-body\s*\{[\s\S]*?content-visibility:\s*auto\s*;/)
  })

  it('keeps node footer actions visible at compact and overview zoom levels', () => {
    const source = readSource('./cinematic/nodes.less')

    expect(source).toMatch(
      /\.canvas-stage\[data-zoom-lod='overview'\][\s\S]*?\.canvas-node-quick-footer\s*\{[\s\S]*?display:\s*flex\s*;/,
    )
    expect(source).toMatch(
      /\.canvas-stage\[data-zoom-lod='overview'\][\s\S]*?\.canvas-node-image-overlay-footer button\s*\{[\s\S]*?display:\s*inline-flex\s*;/,
    )
  })

  it('uses the shared selection toolbar for audio actions', () => {
    const styles = readSource('./CanvasWorkspaceView.less')
    const presentation = readSource('./audioNode/CanvasAudioNodePresentation.tsx')
    const node = readSource('./CanvasNode.tsx')

    expect(styles).toMatch(
      /\.canvas-node-toolbar-surface\s*\{[\s\S]*?border-radius:\s*999px\s*;[\s\S]*?background:\s*var\(--panel-elev/,
    )
    expect(styles).not.toContain('.canvas-node-audio-chips')
    expect(presentation).not.toContain('canvas-node-audio-chips')
    expect(node).toContain("key: 'audio-trim'")
    expect(node).toContain("key: 'audio-speed'")
    expect(node).toContain("key: 'audio-download'")
  })
})
