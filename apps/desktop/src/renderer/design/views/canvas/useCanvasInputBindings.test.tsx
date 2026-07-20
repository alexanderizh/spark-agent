// @vitest-environment jsdom

import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import type { CanvasPromptDocument } from '@spark/protocol'
import type { CanvasNode, CanvasSnapshot } from './canvas.types'
import { buildCanvasPromptSubmission } from './canvasPromptSubmission'
import { useCanvasInputBindings } from './useCanvasInputBindings'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const roots: Array<ReturnType<typeof createRoot>> = []

afterEach(async () => {
  while (roots.length > 0) await act(async () => roots.pop()?.unmount())
})

describe('useCanvasInputBindings', () => {
  it('removes a manually mentioned image from every derived input when its tag is deleted', async () => {
    const image = canvasNode('image-1', 'image')
    const initialDocument: CanvasPromptDocument = {
      version: 2,
      blocks: [
        {
          kind: 'reference',
          id: 'manual-image',
          source: 'manual',
          sourceNodeId: image.id,
          relation: 'reference_image',
          label: '参考图',
          order: 0,
        },
      ],
    }
    const mounted = await mountHook({ initialDocument, nodes: [image], connectionNodeIds: [] })

    expect(mounted.current().selectedInputNodeIds).toEqual(['image-1'])
    expect(mounted.current().referenceFrameNodeIds).toEqual(['image-1'])
    await act(async () => mounted.current().setDocument({ version: 2, blocks: [] }))

    expect(mounted.current().bindings).toEqual([])
    expect(mounted.current().selectedInputNodeIds).toEqual([])
    expect(mounted.current().referenceFrameNodeIds).toEqual([])

    const submission = await buildCanvasPromptSubmission({
      document: mounted.current().document,
      snapshot: snapshotWith([image]),
      operation: 'text_to_image',
      inputBindings: mounted.current().bindings,
    })
    expect(submission.inputFiles).toBeUndefined()
    expect(submission.relationManifest).toEqual([])
  })

  it('suppresses a connected input in both the document and active binding projection', async () => {
    const image = canvasNode('image-1', 'image')
    const initialDocument: CanvasPromptDocument = {
      version: 2,
      blocks: [
        {
          kind: 'reference',
          id: 'connection-image',
          source: 'connection',
          sourceNodeId: image.id,
          relation: 'reference_image',
          label: '上游图',
          order: 0,
        },
      ],
    }
    const mounted = await mountHook({
      initialDocument,
      nodes: [image],
      connectionNodeIds: ['image-1'],
    })

    await act(async () => mounted.current().removeNode('image-1'))

    expect(mounted.current().selectedInputNodeIds).toEqual([])
    expect(mounted.current().bindings).toEqual([
      expect.objectContaining({ sourceNodeId: 'image-1', origin: 'connection', enabled: false }),
    ])
    expect(mounted.current().document.blocks).toEqual([
      expect.objectContaining({ id: 'connection-image', suppressed: true }),
    ])
  })

  it('tracks @ text references without treating them as media selections', async () => {
    const text = canvasNode('text-1', 'text')
    const mounted = await mountHook({
      initialDocument: { version: 2, blocks: [] },
      nodes: [text],
      connectionNodeIds: [],
    })

    await act(async () =>
      mounted.current().setDocument({
        version: 2,
        blocks: [
          {
            kind: 'reference',
            id: 'manual-text',
            source: 'manual',
            sourceNodeId: text.id,
            relation: 'generic',
            label: 'Text note',
            order: 0,
          },
        ],
      }),
    )

    expect(mounted.current().bindings).toEqual([
      expect.objectContaining({
        sourceNodeId: 'text-1',
        kind: 'text',
        promptBlockId: 'manual-text',
      }),
    ])
    expect(mounted.current().selectedInputNodeIds).toEqual([])

    const withText = await buildCanvasPromptSubmission({
      document: mounted.current().document,
      snapshot: snapshotWith([text]),
      operation: 'text_generate',
      inputBindings: mounted.current().bindings,
    })
    expect(withText.prompt).toContain('[文本引用 T1 开始]')
    expect(withText.prompt).toContain('text-1')

    await act(async () => mounted.current().removeNode(text.id))
    const withoutText = await buildCanvasPromptSubmission({
      document: mounted.current().document,
      snapshot: snapshotWith([text]),
      operation: 'text_generate',
      inputBindings: mounted.current().bindings,
    })
    expect(mounted.current().document.blocks).toEqual([])
    expect(mounted.current().bindings).toEqual([])
    expect(withoutText.prompt).not.toContain('text-1')
    expect(withoutText.relationManifest).toEqual([])
  })

  it('keeps separate frame roles for the same connected image', async () => {
    const image = canvasNode('image-1', 'image')
    const mounted = await mountHook({
      initialDocument: { version: 2, blocks: [] },
      nodes: [image],
      connectionNodeIds: ['image-1'],
    })

    await act(async () => {
      mounted.current().setFirstFrameNodeId('image-1')
      mounted.current().setLastFrameNodeId('image-1')
    })

    expect(mounted.current().firstFrameNodeId).toBe('image-1')
    expect(mounted.current().lastFrameNodeId).toBe('image-1')
    expect(mounted.current().referenceFrameNodeIds).toEqual(['image-1'])
    expect(mounted.current().bindings.filter((binding) => binding.enabled)).toHaveLength(3)
  })

  it('can remove a reference role without removing the same image first-frame role', async () => {
    const image = canvasNode('image-1', 'image')
    const mounted = await mountHook({
      initialDocument: {
        version: 2,
        blocks: [
          {
            kind: 'reference',
            id: 'connection-image',
            source: 'connection',
            sourceNodeId: image.id,
            relation: 'reference_image',
            label: '上游图',
            order: 0,
          },
        ],
      },
      nodes: [image],
      connectionNodeIds: ['image-1'],
    })

    await act(async () => mounted.current().setFirstFrameNodeId('image-1'))
    await act(async () => mounted.current().setReferenceFrameNodeIds([]))

    expect(mounted.current().firstFrameNodeId).toBe('image-1')
    expect(mounted.current().referenceFrameNodeIds).toEqual([])
    expect(mounted.current().document.blocks).toEqual([
      expect.not.objectContaining({ suppressed: true }),
    ])
    expect(mounted.current().bindings).toContainEqual(
      expect.objectContaining({ sourceNodeId: 'image-1', role: 'input', enabled: true }),
    )
  })

  it('removes linked frame roles when the visible source tag is deleted', async () => {
    const image = canvasNode('image-1', 'image')
    const mounted = await mountHook({
      initialDocument: {
        version: 2,
        blocks: [
          {
            kind: 'reference',
            id: 'connection-image',
            source: 'connection',
            sourceNodeId: image.id,
            relation: 'reference_image',
            label: '上游图',
            order: 0,
          },
        ],
      },
      nodes: [image],
      connectionNodeIds: ['image-1'],
    })

    await act(async () => mounted.current().setFirstFrameNodeId('image-1'))
    expect(mounted.current().bindings).toContainEqual(
      expect.objectContaining({
        sourceNodeId: 'image-1',
        role: 'first_frame',
        promptBlockId: 'connection-image',
      }),
    )

    await act(async () =>
      mounted.current().setDocument({
        version: 2,
        blocks: [
          {
            kind: 'reference',
            id: 'connection-image',
            source: 'connection',
            sourceNodeId: image.id,
            relation: 'reference_image',
            label: '上游图',
            order: 0,
            suppressed: true,
          },
        ],
      }),
    )

    expect(mounted.current().firstFrameNodeId).toBe('')
    expect(mounted.current().referenceFrameNodeIds).toEqual([])
    expect(mounted.current().bindings.filter((binding) => binding.enabled)).toEqual([])
  })

  it('re-enables a suppressed connected reference when it is selected again', async () => {
    const image = canvasNode('image-1', 'image')
    const mounted = await mountHook({
      initialDocument: {
        version: 2,
        blocks: [
          {
            kind: 'reference',
            id: 'connection-image',
            source: 'connection',
            sourceNodeId: image.id,
            relation: 'reference_image',
            label: '上游图',
            order: 0,
          },
        ],
      },
      nodes: [image],
      connectionNodeIds: ['image-1'],
    })

    await act(async () => mounted.current().setReferenceFrameNodeIds([]))
    await act(async () => mounted.current().setReferenceFrameNodeIds(['image-1']))

    expect(mounted.current().referenceFrameNodeIds).toEqual(['image-1'])
    expect(mounted.current().bindings).toEqual([
      expect.objectContaining({ sourceNodeId: 'image-1', enabled: true }),
    ])
    expect(mounted.current().document.blocks).toEqual([
      expect.not.objectContaining({ suppressed: true }),
    ])
  })

  it('adds a disconnected former connection as a picker binding', async () => {
    const image = canvasNode('image-1', 'image')
    const document: CanvasPromptDocument = {
      version: 2,
      blocks: [
        {
          kind: 'reference',
          id: 'connection-image',
          source: 'connection',
          sourceNodeId: image.id,
          relation: 'reference_image',
          label: '上游图',
          order: 0,
        },
      ],
    }
    const mounted = await mountHook({
      initialDocument: document,
      nodes: [image],
      connectionNodeIds: ['image-1'],
    })

    await mounted.render({
      initialDocument: document,
      nodes: [image],
      connectionNodeIds: [],
    })
    await act(async () => mounted.current().setReferenceFrameNodeIds(['image-1']))

    expect(mounted.current().referenceFrameNodeIds).toEqual(['image-1'])
    expect(mounted.current().bindings).toEqual([
      expect.objectContaining({ sourceNodeId: 'image-1', origin: 'picker', enabled: true }),
    ])
  })

  it('resets document and bindings when the operation node changes', async () => {
    const first = canvasNode('image-1', 'image')
    const second = canvasNode('image-2', 'image')
    const firstDocument: CanvasPromptDocument = {
      version: 2,
      blocks: [
        {
          kind: 'reference',
          id: 'manual-image-1',
          source: 'manual',
          sourceNodeId: first.id,
          relation: 'reference_image',
          label: 'First',
          order: 0,
        },
      ],
    }
    const secondDocument: CanvasPromptDocument = {
      version: 2,
      blocks: [
        {
          kind: 'reference',
          id: 'connection-image-2',
          source: 'connection',
          sourceNodeId: second.id,
          relation: 'reference_image',
          label: 'Second',
          order: 0,
        },
      ],
    }
    const mounted = await mountHook({
      resetKey: 'operation-1',
      initialDocument: firstDocument,
      nodes: [first, second],
      connectionNodeIds: [],
    })

    await mounted.render({
      resetKey: 'operation-2',
      initialDocument: secondDocument,
      nodes: [first, second],
      connectionNodeIds: ['image-2'],
    })

    expect(mounted.current().document).toEqual(secondDocument)
    expect(mounted.current().bindings).toEqual([
      expect.objectContaining({ sourceNodeId: 'image-2', enabled: true }),
    ])
  })
})

async function mountHook(input: Parameters<typeof useCanvasInputBindings>[0]) {
  const container = document.createElement('div')
  const root = createRoot(container)
  roots.push(root)
  let current: ReturnType<typeof useCanvasInputBindings> | null = null
  let currentInput = input
  function Harness() {
    current = useCanvasInputBindings(currentInput)
    return null
  }
  await act(async () => root.render(<Harness />))
  return {
    current: () => {
      if (!current) throw new Error('Hook is not mounted')
      return current
    },
    render: async (nextInput: Parameters<typeof useCanvasInputBindings>[0]) => {
      currentInput = nextInput
      await act(async () => root.render(<Harness />))
    },
  }
}

function canvasNode(id: string, type: CanvasNode['type']): CanvasNode {
  return {
    id,
    projectId: 'p',
    boardId: 'b',
    userId: 1,
    type,
    title: id,
    assetId: null,
    taskId: null,
    parentNodeId: null,
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    zIndex: 0,
    locked: false,
    hidden: false,
    data: type === 'image' ? { url: `https://example.com/${id}.png` } : { text: id },
    createdAt: '',
    updatedAt: '',
  }
}

function snapshotWith(nodes: CanvasNode[]): CanvasSnapshot {
  return {
    project: {} as CanvasSnapshot['project'],
    board: {} as CanvasSnapshot['board'],
    nodes,
    edges: [],
    assets: [],
    tasks: [],
  }
}
