// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { act, useState } from 'react'
import { createRoot } from 'react-dom/client'
import type { CanvasPromptDocument } from '@spark/protocol'
import type { CanvasNode } from './canvas.types'
import { CanvasPromptMentionTextArea } from './CanvasPromptMentionTextArea'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const node: CanvasNode = {
  id: 'hero', projectId: 'p', boardId: 'b', userId: 1, type: 'image', title: '小满', assetId: null,
  taskId: null, parentNodeId: null, x: 0, y: 0, width: 100, height: 100, rotation: 0, zIndex: 0,
  locked: false, hidden: false, data: { url: 'https://example.com/hero.png' }, createdAt: '', updatedAt: '',
}

describe('CanvasPromptMentionTextArea', () => {
  it('renders the persisted prompt document instead of remigrating the legacy value', async () => {
    const document: CanvasPromptDocument = {
      version: 2,
      blocks: [{ kind: 'reference', id: 'r1', source: 'manual', sourceNodeId: 'hero', relation: 'character', label: '主角小满', order: 0 }],
    }
    const container = window.document.createElement('div')
    const root = createRoot(container)
    await act(async () => root.render(
      <CanvasPromptMentionTextArea
        value="旧字符串"
        document={document}
        rows={4}
        mentionNodes={[node]}
        assets={[]}
        onChange={() => undefined}
      />,
    ))
    expect(container.textContent).toContain('主角小满')
    expect(container.textContent).not.toContain('旧字符串')
    await act(async () => root.unmount())
  })

  it('clears the disconnected state when the physical connection is restored', async () => {
    const document: CanvasPromptDocument = {
      version: 2,
      blocks: [{ kind: 'reference', id: 'connection-hero', source: 'connection', sourceNodeId: 'hero', relation: 'character', connectionRelation: 'reference_image', disconnected: true, label: '主角小满', order: 0 }],
    }
    const container = window.document.createElement('div')
    const root = createRoot(container)
    const Harness = ({ connectionNodes }: { connectionNodes: CanvasNode[] }) => {
      const [currentDocument, setCurrentDocument] = useState(document)
      return (
        <CanvasPromptMentionTextArea
          value=""
          document={currentDocument}
          rows={4}
          mentionNodes={[node]}
          connectionNodes={connectionNodes}
          assets={[]}
          onChange={() => undefined}
          onDocumentChange={setCurrentDocument}
        />
      )
    }
    await act(async () => root.render(<Harness connectionNodes={[]} />))
    expect(container.querySelector('.is-invalid')).not.toBeNull()
    await act(async () => root.render(<Harness connectionNodes={[node]} />))
    expect(container.querySelector('.is-invalid')).toBeNull()
    await act(async () => root.unmount())
  })

  it('does not restore a connected tag that the user suppressed', async () => {
    const document: CanvasPromptDocument = {
      version: 2,
      blocks: [{ kind: 'reference', id: 'connection-hero', source: 'connection', sourceNodeId: 'hero', relation: 'character', connectionRelation: 'character', suppressed: true, label: '主角小满', order: 0 }],
    }
    const container = window.document.createElement('div')
    const root = createRoot(container)
    await act(async () => root.render(
      <CanvasPromptMentionTextArea
        value=""
        document={document}
        rows={4}
        mentionNodes={[node]}
        connectionNodes={[node]}
        assets={[]}
        onChange={() => undefined}
      />,
    ))
    expect(container.textContent).not.toContain('主角小满')
    await act(async () => root.unmount())
  })
})
