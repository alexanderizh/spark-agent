import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const modalSource = readFileSync(fileURLToPath(new URL('./CanvasNodeEditModal.tsx', import.meta.url)), 'utf8')

describe('CanvasNodeEditModal media preview tabs', () => {
  it('keeps preview tabs limited to image and video resource nodes', () => {
    expect(modalSource).toContain("const isPreviewableMediaNode = node?.type === 'image' || node?.type === 'video'")
    expect(modalSource).toContain('className="canvas-node-media-edit-tabs"')
    expect(modalSource).toContain("key: 'edit'")
    expect(modalSource).toContain("key: 'preview'")
    expect(modalSource).toContain('<CanvasNodeMediaPreview')
    expect(modalSource).toContain("node.type === 'audio'")
  })

  it('uses the draft URL for preview and preserves the existing save field', () => {
    expect(modalSource).toContain('url={url}')
    expect(modalSource).toContain('nextData.url = url.trim()')
    expect(modalSource).toContain("setMediaEditTab('edit')")
  })
})
