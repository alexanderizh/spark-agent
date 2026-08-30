// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { CanvasPromptInputSnapshot } from '@spark/protocol'
import { CanvasTaskInputSnapshotList } from './CanvasTaskInputSnapshotList'

describe('CanvasTaskInputSnapshotList', () => {
  it('renders image thumbnails, relation metadata and scrollable structured content', () => {
    const snapshots: CanvasPromptInputSnapshot[] = [
      {
        blockId: 'r1',
        sourceNodeId: 'hero',
        relation: 'character',
        order: 0,
        label: '小满',
        kind: 'image',
        previewUrl: 'https://example.com/hero-thumb.png',
      },
      {
        blockId: 's1',
        sourceNodeId: 'shots',
        relation: 'storyboard',
        order: 1,
        label: '镜头表',
        kind: 'structured',
        schema: 'storyboard',
        contentText: '镜头 01\n'.repeat(30),
      },
    ]

    const html = renderToStaticMarkup(<CanvasTaskInputSnapshotList snapshots={snapshots} />)
    expect(html).toContain('hero-thumb.png')
    expect(html).toContain('character')
    expect(html).toContain('镜头表')
    expect(html).toContain('canvas-task-input-snapshot-content')
    expect(html).toContain('overflow')
  })
})
