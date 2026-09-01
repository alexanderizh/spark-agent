import { describe, expect, it } from 'vitest'
import type { CanvasInputBinding } from '@spark/protocol'
import {
  activeCanvasInputBindings,
  activeCanvasInputNodeIds,
  addCanvasInputBinding,
  createCanvasInputBinding,
  materializeCanvasInputBindingReferences,
  moveCanvasMediaInput,
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

  it('does not layer a generic reference over an explicit connected frame role', () => {
    const image = canvasNode('image-1', 'image')
    const firstFrame = binding({
      id: 'connection:image-1:first_frame',
      origin: 'connection',
      relation: 'first_frame',
      role: 'first_frame',
    })

    const result = reconcileCanvasInputBindings({
      bindings: [firstFrame],
      nodes: [image],
      connectionNodeIds: ['image-1'],
      document: { version: 2, blocks: [] },
    })

    expect(result).toEqual([firstFrame])
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

  it('materializes a legacy picker binding as a visible removable tag', () => {
    const image = canvasNode('image-1', 'image')
    const document = materializeCanvasInputBindingReferences({
      document: { version: 2, blocks: [] },
      bindings: [
        binding({
          id: 'legacy-first-frame',
          origin: 'picker',
          role: 'first_frame',
          relation: 'first_frame',
        }),
      ],
      nodes: [image],
    })

    expect(document.blocks).toContainEqual(
      expect.objectContaining({
        kind: 'reference',
        source: 'manual',
        sourceNodeId: 'image-1',
        relation: 'reference_image',
      }),
    )
  })

  it('links expanded child bindings to their visible group owner tag', () => {
    const image = canvasNode('image-1', 'image')
    const owners = new Map<string, readonly string[]>([['image-1', ['group-1']]])
    const groupBlock = {
      kind: 'reference' as const,
      id: 'connection-group',
      source: 'connection' as const,
      sourceNodeId: 'group-1',
      relation: 'generic' as const,
      label: '图片组',
      order: 0,
    }
    const activeDocument = {
      version: 2 as const,
      blocks: [groupBlock],
    }
    const linked = reconcileCanvasInputBindings({
      bindings: [
        binding({
          id: 'child-first-frame',
          origin: 'picker',
          role: 'first_frame',
          relation: 'first_frame',
        }),
      ],
      nodes: [image],
      connectionNodeIds: [],
      document: activeDocument,
      promptOwnerNodeIdsBySourceNodeId: owners,
    })
    expect(linked).toEqual([
      expect.objectContaining({
        id: 'child-first-frame',
        promptBlockId: 'connection-group',
        enabled: true,
      }),
    ])

    expect(
      reconcileCanvasInputBindings({
        bindings: linked,
        nodes: [image],
        connectionNodeIds: [],
        document: {
          ...activeDocument,
          blocks: [{ ...groupBlock, suppressed: true }],
        },
        promptOwnerNodeIdsBySourceNodeId: owners,
      }),
    ).toEqual([])
  })

  it('does not re-add an operation owner when its materialized output owns the same prompt tag', () => {
    const operation = canvasNode('operation-1', 'text_to_image')
    const image = canvasNode('image-1', 'image')
    const owners = new Map<string, readonly string[]>([['image-1', ['operation-1']]])
    const promptBlock = {
      kind: 'reference' as const,
      id: 'connection-operation',
      source: 'connection' as const,
      sourceNodeId: operation.id,
      relation: 'generic' as const,
      label: '角色图任务',
      order: 0,
    }

    const result = reconcileCanvasInputBindings({
      bindings: [
        binding({
          id: 'connection:image-1:first_frame',
          sourceNodeId: image.id,
          origin: 'connection',
          role: 'first_frame',
          relation: 'first_frame',
          promptBlockId: promptBlock.id,
        }),
        binding({
          id: 'connection:operation-1:input',
          sourceNodeId: operation.id,
          origin: 'connection',
          kind: 'file',
          role: 'input',
          relation: 'generic',
          promptBlockId: promptBlock.id,
          order: 1,
        }),
      ],
      nodes: [operation, image],
      connectionNodeIds: [image.id],
      document: { version: 2, blocks: [promptBlock] },
      promptOwnerNodeIdsBySourceNodeId: owners,
    })

    expect(activeCanvasInputBindings(result).map((item) => item.sourceNodeId)).toEqual([image.id])
    expect(result).toContainEqual(
      expect.objectContaining({ sourceNodeId: operation.id, enabled: false }),
    )
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

describe('canvasInputBindings order normalization', () => {
  it('renumbers stale media binding orders to follow the prompt document block order', () => {
    // 复现任务面板顺序脱节：夜景先插入（order 小）、人物立绘后插入（order 为时间戳），
    // 用户随后在输入区把人物立绘的引用块挪到夜景前面（文档块顺序已变）。
    const character = canvasNode('image-character', 'image')
    const scene = canvasNode('image-scene', 'image')
    const staleTime = 1750000000000
    const result = reconcileCanvasInputBindings({
      bindings: [
        binding({
          id: 'manual:image-scene:reference',
          sourceNodeId: 'image-scene',
          order: 0,
          promptBlockId: 'block-scene',
        }),
        binding({
          id: 'manual:image-character:reference',
          sourceNodeId: 'image-character',
          order: staleTime,
          promptBlockId: 'block-character',
        }),
      ],
      nodes: [character, scene],
      connectionNodeIds: [],
      document: {
        version: 2,
        blocks: [
          { kind: 'text', id: 'text-1', text: '使用<Picture 1>的人物和<Picture 2>的场景' },
          {
            kind: 'reference',
            id: 'block-character',
            source: 'manual',
            sourceNodeId: 'image-character',
            relation: 'reference_image',
            label: '人物立绘',
            order: staleTime,
          },
          {
            kind: 'reference',
            id: 'block-scene',
            source: 'manual',
            sourceNodeId: 'image-scene',
            relation: 'reference_image',
            label: '夜景',
            order: 0,
          },
        ],
      },
    })

    // 归一化后：人物立绘（文档块在前）排在夜景之前 —— 编排区序号 = 发送顺序。
    const orderByNode = new Map(result.map((item) => [item.sourceNodeId, item.order]))
    expect(orderByNode.get('image-character')).toBeLessThan(orderByNode.get('image-scene')!)
    expect(activeCanvasInputNodeIds(result)).toEqual(['image-character', 'image-scene'])
  })

  it('moves a media input and reorders both prompt blocks and binding orders', () => {
    const character = canvasNode('image-character', 'image')
    const scene = canvasNode('image-scene', 'image')
    const video = canvasNode('video-source', 'video')
    const document = {
      version: 2 as const,
      blocks: [
        { kind: 'text' as const, id: 'text-1', text: '提示词正文' },
        {
          kind: 'reference' as const,
          id: 'block-character',
          source: 'manual' as const,
          sourceNodeId: 'image-character',
          relation: 'reference_image' as const,
          label: '人物立绘',
          order: 0,
        },
        {
          kind: 'reference' as const,
          id: 'block-scene',
          source: 'manual' as const,
          sourceNodeId: 'image-scene',
          relation: 'reference_image' as const,
          label: '夜景',
          order: 1,
        },
        {
          kind: 'reference' as const,
          id: 'block-video',
          source: 'manual' as const,
          sourceNodeId: 'video-source',
          relation: 'reference_video' as const,
          label: '参考视频',
          order: 2,
        },
      ],
    }
    const bindings = [
      binding({
        id: 'manual:image-character:reference',
        sourceNodeId: 'image-character',
        order: 0,
        promptBlockId: 'block-character',
      }),
      binding({
        id: 'manual:image-scene:reference',
        sourceNodeId: 'image-scene',
        order: 1,
        promptBlockId: 'block-scene',
      }),
      binding({
        id: 'manual:video-source:input',
        sourceNodeId: 'video-source',
        kind: 'video',
        relation: 'reference_video',
        role: 'input',
        order: 2,
        promptBlockId: 'block-video',
      }),
    ]

    // 夜景前移一位：输入区 chips、绑定顺序都应变为 人物 → 夜景 → 视频 之前的 夜景 → 人物 → 视频。
    const moved = moveCanvasMediaInput({ bindings, document }, 'image-scene', -1)

    expect(moved.document.blocks.map((block) => block.id)).toEqual([
      'text-1',
      'block-scene',
      'block-character',
      'block-video',
    ])
    expect(activeCanvasInputNodeIds(moved.bindings)).toEqual([
      'image-scene',
      'image-character',
      'video-source',
    ])

    // 再前移一次越界：保持不变。
    const boundary = moveCanvasMediaInput(moved, 'image-scene', -1)
    expect(boundary.document.blocks.map((block) => block.id)).toEqual(
      moved.document.blocks.map((block) => block.id),
    )
    expect(activeCanvasInputNodeIds(boundary.bindings)).toEqual(
      activeCanvasInputNodeIds(moved.bindings),
    )
  })

  it('keeps binding-only media appended after document-referenced media when moving', () => {
    const document = {
      version: 2 as const,
      blocks: [
        {
          kind: 'reference' as const,
          id: 'block-referenced',
          source: 'manual' as const,
          sourceNodeId: 'image-referenced',
          relation: 'reference_image' as const,
          label: '文档内引用',
          order: 0,
        },
      ],
    }
    const bindings = [
      binding({
        id: 'manual:image-referenced:reference',
        sourceNodeId: 'image-referenced',
        order: 0,
        promptBlockId: 'block-referenced',
      }),
      binding({
        id: 'picker:image-loose:reference',
        sourceNodeId: 'image-loose',
        origin: 'picker',
        order: 1,
      }),
    ]

    // 无文档块的素材（如历史 picker 引用）尝试越过文档内引用时保持追加在后：
    // 文档顺序是唯一权威，归一化会把它收敛回文档内引用之后。
    const unchanged = moveCanvasMediaInput({ bindings, document }, 'image-loose', -1)
    expect(activeCanvasInputNodeIds(unchanged.bindings)).toEqual([
      'image-referenced',
      'image-loose',
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
