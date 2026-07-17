import { describe, expect, it } from 'vitest'
import type { CanvasInputBinding } from '@spark/protocol'
import {
  activeCanvasInputBindings,
  activeCanvasInputNodeIds,
  addCanvasInputBinding,
  createCanvasInputBinding,
  removeCanvasInputBinding,
  replaceCanvasInputBindingRoles,
  reconcileCanvasInputBindings,
  removeCanvasInputNodeBindings,
  removeCanvasInputNodeFromPromptDocument,
} from './canvasInputBindings'
import type { CanvasNode } from './canvas.types'

function binding(overrides: Partial<CanvasInputBinding> = {}): CanvasInputBinding {
  return {
    id: 'binding-image-reference',
    sourceNodeId: 'image-1',
    origin: 'manual',
    kind: 'image',
    relation: 'reference_image',
    role: 'reference',
    enabled: true,
    order: 0,
    ...overrides,
  }
}

describe('canvasInputBindings', () => {
  it('deduplicates the same source and role while preserving the original order', () => {
    const first = binding({ id: 'first', order: 2, promptBlockId: 'prompt-a' })
    const duplicate = binding({ id: 'duplicate', order: 9, promptBlockId: 'prompt-b' })

    expect(addCanvasInputBinding([first], duplicate)).toEqual([first])
  })

  it('re-enables an existing disabled binding instead of adding a duplicate', () => {
    const disabled = binding({ id: 'connected', origin: 'connection', enabled: false })

    expect(addCanvasInputBinding([disabled], binding({ id: 'manual' }))).toEqual([
      expect.objectContaining({ id: 'connected', enabled: true }),
    ])
  })

  it('keeps the same source when it has different provider roles', () => {
    const reference = binding()
    const firstFrame = binding({ id: 'first-frame', role: 'first_frame', relation: 'first_frame' })

    expect(addCanvasInputBinding([reference], firstFrame)).toEqual([reference, firstFrame])
  })

  it('disables a connected binding but removes manual and picker bindings', () => {
    const connected = binding({ id: 'connected', origin: 'connection' })
    const manual = binding({ id: 'manual', sourceNodeId: 'image-2' })
    const picker = binding({ id: 'picker', sourceNodeId: 'image-3', origin: 'picker' })

    expect(removeCanvasInputBinding([connected, manual, picker], 'connected')).toEqual([
      expect.objectContaining({ id: 'connected', enabled: false }),
      manual,
      picker,
    ])
    expect(removeCanvasInputBinding([connected, manual, picker], 'manual')).toEqual([
      connected,
      picker,
    ])
    expect(removeCanvasInputBinding([connected, manual, picker], 'picker')).toEqual([
      connected,
      manual,
    ])
  })

  it('derives sorted active bindings and unique active node ids', () => {
    const bindings = [
      binding({ id: 'later', sourceNodeId: 'image-2', order: 8 }),
      binding({ id: 'disabled', sourceNodeId: 'image-3', enabled: false, order: 0 }),
      binding({ id: 'first-role', sourceNodeId: 'image-1', role: 'first_frame', order: 1 }),
      binding({ id: 'reference-role', sourceNodeId: 'image-1', role: 'reference', order: 2 }),
    ]

    expect(activeCanvasInputBindings(bindings).map((item) => item.id)).toEqual([
      'first-role',
      'reference-role',
      'later',
    ])
    expect(activeCanvasInputNodeIds(bindings)).toEqual(['image-1', 'image-2'])
  })

  it('replaces one binding with stable bindings for every selected role', () => {
    const current = binding({ id: 'connected', origin: 'connection', promptBlockId: 'block-1' })
    const next = replaceCanvasInputBindingRoles([current], 'connected', [
      'first_frame',
      'last_frame',
      'reference',
    ])

    expect(next).toHaveLength(3)
    expect(next.map((item) => item.role)).toEqual(['first_frame', 'last_frame', 'reference'])
    expect(next).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ origin: 'connection', sourceNodeId: 'image-1', enabled: true }),
      ]),
    )
  })

  it('creates deterministic bindings for the same source, origin and role', () => {
    expect(
      createCanvasInputBinding({
        sourceNodeId: 'image-1',
        origin: 'manual',
        kind: 'image',
        relation: 'reference_image',
        role: 'reference',
        order: 4,
      }),
    ).toEqual(
      expect.objectContaining({
        id: 'manual:image-1:reference',
        sourceNodeId: 'image-1',
        enabled: true,
        order: 4,
      }),
    )
  })

  it('reconciles physical connections and manual prompt references into one binding list', () => {
    const image = canvasNode('image-1', 'image')
    const text = canvasNode('text-1', 'text')
    const result = reconcileCanvasInputBindings({
      bindings: [],
      nodes: [image, text],
      connectionNodeIds: ['image-1'],
      document: {
        version: 2,
        blocks: [
          {
            kind: 'reference',
            id: 'manual-text',
            source: 'manual',
            sourceNodeId: 'text-1',
            relation: 'generic',
            label: 'Text note',
            order: 0,
          },
        ],
      },
    })

    expect(result).toEqual([
      expect.objectContaining({
        sourceNodeId: 'image-1',
        origin: 'connection',
        kind: 'image',
        role: 'reference',
      }),
      expect.objectContaining({
        sourceNodeId: 'text-1',
        origin: 'manual',
        kind: 'text',
        promptBlockId: 'manual-text',
      }),
    ])
  })

  it('removes a deleted manual tag binding and disables a suppressed connection binding', () => {
    const image = canvasNode('image-1', 'image')
    const manual = binding({ id: 'manual-tag', promptBlockId: 'manual-tag' })
    const connected = binding({
      id: 'connection-tag',
      origin: 'connection',
      promptBlockId: 'connection-tag',
    })

    const withoutManual = reconcileCanvasInputBindings({
      bindings: [manual],
      nodes: [image],
      connectionNodeIds: [],
      document: { version: 2, blocks: [] },
    })
    expect(withoutManual).toEqual([])

    const suppressed = reconcileCanvasInputBindings({
      bindings: [connected],
      nodes: [image],
      connectionNodeIds: ['image-1'],
      document: {
        version: 2,
        blocks: [
          {
            kind: 'reference',
            id: 'connection-tag',
            source: 'connection',
            sourceNodeId: 'image-1',
            relation: 'reference_image',
            label: '参考图',
            order: 0,
            suppressed: true,
          },
        ],
      },
    })
    expect(suppressed).toEqual([expect.objectContaining({ id: 'connection-tag', enabled: false })])
  })

  it('removes every provider role for a tile and cleans linked prompt blocks', () => {
    const bindings = [
      binding({ id: 'reference', origin: 'connection', promptBlockId: 'connection-tag' }),
      binding({ id: 'first', role: 'first_frame' }),
      binding({ id: 'manual', sourceNodeId: 'image-2', promptBlockId: 'manual-tag' }),
    ]
    const document = {
      version: 2 as const,
      blocks: [
        {
          kind: 'reference' as const,
          id: 'connection-tag',
          source: 'connection' as const,
          sourceNodeId: 'image-1',
          relation: 'reference_image' as const,
          label: '上游图',
          order: 0,
        },
        {
          kind: 'reference' as const,
          id: 'manual-tag',
          source: 'manual' as const,
          sourceNodeId: 'image-2',
          relation: 'reference_image' as const,
          label: '手动图',
          order: 1,
        },
      ],
    }

    expect(removeCanvasInputNodeBindings(bindings, 'image-1')).toEqual([
      expect.objectContaining({ id: 'reference', enabled: false }),
      bindings[2],
    ])
    expect(removeCanvasInputNodeFromPromptDocument(document, 'image-1').blocks).toEqual([
      expect.objectContaining({ id: 'connection-tag', suppressed: true }),
      document.blocks[1],
    ])
    expect(removeCanvasInputNodeFromPromptDocument(document, 'image-2').blocks).toEqual([
      document.blocks[0],
    ])
  })
})

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
