import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const readSource = (relativePath: string) =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8')

describe('canvas audio toolbar overflow styles', () => {
  it('lets selected audio chrome escape both canvas theme content clips', () => {
    for (const relativePath of ['./uiux-v4/nodes.less', './cinematic/nodes.less']) {
      const source = readSource(relativePath)
      expect(source).toMatch(
        /\.canvas-node-core-audio\s*,\s*\.canvas-node-body-audio\s*\{[\s\S]*?overflow:\s*visible\s*!important\s*;/,
      )
    }
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

  it('anchors the toolbar ten pixels above the node with an opaque surface', () => {
    const styles = readSource('./CanvasWorkspaceView.less')
    const presentation = readSource('./audioNode/CanvasAudioNodePresentation.tsx')

    expect(styles).toMatch(
      /\.canvas-node-toolbar-surface\s*\{[\s\S]*?border-radius:\s*999px\s*;[\s\S]*?background:\s*var\(--panel-elev/,
    )
    expect(styles).toMatch(
      /\.canvas-node-audio-chips\s*\{[\s\S]*?bottom:\s*calc\(100%\s*\+\s*10px\)\s*;/,
    )
    expect(presentation).toContain(
      'canvas-node-toolbar-surface canvas-node-audio-chips nodrag nopan',
    )
  })
})
