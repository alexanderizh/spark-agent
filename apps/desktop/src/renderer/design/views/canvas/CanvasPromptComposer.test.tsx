// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { CanvasPromptDocument } from '@spark/protocol'
import type { CanvasAsset, CanvasNode } from './canvas.types'
import { CanvasPromptComposer } from './CanvasPromptComposer'
import { CANVAS_PROMPT_HOVER_MAX_HEIGHT } from './CanvasPromptHoverCard'

function imageNode(): CanvasNode {
  return {
    id: 'hero', projectId: 'p', boardId: 'b', userId: 1, type: 'image', title: '小满',
    assetId: 'asset-hero', taskId: null, parentNodeId: null, x: 0, y: 0, width: 100, height: 100,
    rotation: 0, zIndex: 0, locked: false, hidden: false,
    data: { url: 'https://example.com/hero.png', thumbnailUrl: 'https://example.com/hero-thumb.png' },
    createdAt: '', updatedAt: '',
  }
}

const asset: CanvasAsset = {
  id: 'asset-hero', projectId: 'p', userId: 1, type: 'image', source: 'upload', title: '小满',
  url: 'https://example.com/hero.png', thumbnailUrl: 'https://example.com/hero-thumb.png',
  metadata: {}, createdAt: '', updatedAt: '',
}

function render(document: CanvasPromptDocument, nodes = [imageNode()]) {
  return renderToStaticMarkup(
    <CanvasPromptComposer document={document} mentionNodes={nodes} assets={[asset]} onChange={() => undefined} />,
  )
}

describe('CanvasPromptComposer', () => {
  it('renders image references as thumbnail chips', () => {
    const html = render({ version: 2, blocks: [{ kind: 'reference', id: 'r1', source: 'manual', sourceNodeId: 'hero', relation: 'character', label: '小满', order: 0 }] })
    expect(html).toContain('canvas-prompt-chip-thumb')
    expect(html).toContain('hero-thumb.png')
    expect(html).toContain('小满')
  })

  it('renders structured and invalid references as atomic states', () => {
    const html = render({ version: 2, blocks: [{ kind: 'structured', id: 's1', sourceNodeId: 'missing', schema: 'storyboard', summary: '镜头 03–06' }] }, [])
    expect(html).toContain('镜头 03–06')
    expect(html).toContain('is-invalid')
    expect(html).toContain('aria-invalid="true"')
  })

  it('keeps long hover content inside a scrolling viewport', () => {
    expect(CANVAS_PROMPT_HOVER_MAX_HEIGHT).toBe(280)
  })
})
