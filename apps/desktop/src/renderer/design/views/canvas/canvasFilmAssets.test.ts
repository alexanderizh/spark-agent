import { describe, expect, it } from 'vitest'
import {
  FILM_ASSET_KIND_LABELS,
  FILM_REFERENCE_KIND_LABELS,
  migrateFilmAssetMetadata,
  readReferences,
  readTags,
  writeReferences,
  writeTags,
} from './canvasFilmAssets'
import {
  createCharacterSubviewDraft,
  readCharacterSubviews,
  resolveCharacterAssetForDesignCardImageAsset,
  resolveCharacterSourceImageAsset,
  writeCharacterSubviews,
} from './canvasCharacterLibrary'
import type { FilmReference } from './canvasFilmTypes'
import type { CanvasAsset, CanvasNode, CanvasTask } from './canvas.types'

describe('canvasFilmAssets v2', () => {
  describe('FilmAssetKind', () => {
    it('kind 包含 effect 类型', () => {
      expect(FILM_ASSET_KIND_LABELS.effect).toBe('特效')
    })
  })

  describe('FILM_REFERENCE_KIND_LABELS', () => {
    it('包含 8 个标准 kind 标签', () => {
      const kinds = Object.keys(FILM_REFERENCE_KIND_LABELS)
      expect(kinds).toEqual(
        expect.arrayContaining([
          'concept',
          'reference',
          'expression',
          'costume',
          'action',
          'storyboard',
          'angle',
          'other',
        ]),
      )
    })
  })

  describe('readReferences / writeReferences', () => {
    it('从 references 数组读 + 按 order 排序', () => {
      const refs: FilmReference[] = [
        { id: 'r2', kind: 'expression', assetId: 'a2', description: 'happy', order: 2 },
        { id: 'r0', kind: 'concept', assetId: 'a0', description: 'main', order: 0 },
        { id: 'r1', kind: 'costume', assetId: 'a1', description: 'suit', order: 1 },
      ]
      const meta = writeReferences({}, refs)
      const out = readReferences(meta)
      expect(out.map((r) => r.id)).toEqual(['r0', 'r1', 'r2'])
    })

    it('从旧 imageAssetId 字段自动迁移到 references[concept]', () => {
      const out = readReferences({ imageAssetId: 'old-asset-1' })
      expect(out).toHaveLength(1)
      expect(out[0]?.assetId).toBe('old-asset-1')
      expect(out[0]?.kind).toBe('concept')
    })

    it('空 metadata 返回空数组', () => {
      expect(readReferences(undefined)).toEqual([])
      expect(readReferences({})).toEqual([])
    })

    it('非法 references 元素被过滤', () => {
      const meta = {
        references: [
          { id: 'r1', kind: 'concept', assetId: 'a1', description: '', order: 0 },
          // 缺 id
          { kind: 'reference', assetId: 'a2' },
          // 缺 assetId
          { id: 'r3', kind: 'reference' },
          null,
          'string',
        ],
      }
      const out = readReferences(meta as Record<string, unknown>)
      expect(out.map((r) => r.id)).toEqual(['r1'])
    })

    it('非法 kind 回退到 other', () => {
      const meta = {
        references: [
          { id: 'r1', kind: 'unknown_kind_xxx', assetId: 'a1', description: '', order: 0 },
        ],
      }
      const out = readReferences(meta as Record<string, unknown>)
      expect(out[0]?.kind).toBe('other')
    })
  })

  describe('readTags / writeTags', () => {
    it('写读 round-trip + 去重 + 去空白', () => {
      const meta = writeTags({}, ['角色', ' 主角 ', '角色', '反派', ''])
      expect(readTags(meta)).toEqual(['角色', '主角', '反派'])
    })

    it('非字符串值被忽略', () => {
      const meta = { tags: ['a', 1, null, 'b', true] }
      expect(readTags(meta as unknown as Record<string, unknown>)).toEqual(['a', 'b'])
    })
  })

  describe('migrateFilmAssetMetadata', () => {
    it('老 imageAssetId + attributes -> references[concept] + tags', () => {
      const out = migrateFilmAssetMetadata({
        kind: 'character',
        imageAssetId: 'old-asset',
        attributes: { age: '青年', gender: '女' },
      })
      expect(Array.isArray(out['references'])).toBe(true)
      expect((out['references'] as unknown[]).length).toBe(1)
      expect((out['references'] as Array<{ assetId: string }>)[0]?.assetId).toBe('old-asset')
      expect(Array.isArray(out['tags'])).toBe(true)
    })

    it('已有 references 不再处理', () => {
      const refs = [{ id: 'r1', kind: 'concept', assetId: 'a1', description: '', order: 0 }]
      const out = migrateFilmAssetMetadata({
        kind: 'character',
        references: refs,
      })
      expect(out['references']).toBe(refs) // 同一引用
    })

    it('空 metadata 返回 {references: [], tags: []}', () => {
      const out = migrateFilmAssetMetadata({ kind: 'character' })
      expect(out['references']).toEqual([])
      expect(out['tags']).toEqual([])
    })

    it('undefined metadata 返回 {}', () => {
      const out = migrateFilmAssetMetadata(undefined)
      expect(out).toEqual({})
    })
  })
})

describe('FilmReference consistency fields', () => {
  it('保留主基准图、锁定、用途和参考强度', () => {
    const meta = writeReferences({}, [
      {
        id: 'r1',
        kind: 'concept',
        assetId: 'a1',
        description: 'hero face',
        order: 0,
        isPrimary: true,
        locked: true,
        usage: 'identity',
        strength: 1.5,
      },
    ])
    const out = readReferences(meta)
    expect(out[0]?.isPrimary).toBe(true)
    expect(out[0]?.locked).toBe(true)
    expect(out[0]?.usage).toBe('identity')
    expect(out[0]?.strength).toBe(1)
  })
})

describe('character subviews metadata', () => {
  it('write/read round-trip and sort by order', () => {
    const meta = writeCharacterSubviews({}, [
      createCharacterSubviewDraft('img-1', 2, { x: 20, y: 40, width: 300, height: 220 }, { label: '表情', kind: 'expression' }),
      createCharacterSubviewDraft('img-1', 0, { x: 0, y: 10, width: 180, height: 420 }, { label: '全身', kind: 'full_body' }),
    ])
    const out = readCharacterSubviews(meta)
    expect(out).toHaveLength(2)
    expect(out[0]?.label).toBe('全身')
    expect(out[0]?.order).toBe(0)
    expect(out[1]?.label).toBe('表情')
    expect(out[1]?.order).toBe(1)
  })

  it('非法子视图被过滤且 crop 会被归一化', () => {
    const out = readCharacterSubviews({
      characterSubviews: [
        {
          id: 'v1',
          label: '  脸部  ',
          kind: 'portrait',
          sourceAssetId: 'img-1',
          cropPx: { x: -12, y: 8.4, width: 0, height: 112.6 },
          order: 0,
          createdAt: '2026-07-02T00:00:00.000Z',
          updatedAt: '2026-07-02T00:00:00.000Z',
        },
        { id: 'broken' },
      ],
    } as Record<string, unknown>)
    expect(out).toHaveLength(1)
    expect(out[0]?.label).toBe('脸部')
    expect(out[0]?.cropPx).toEqual({ x: 0, y: 8, width: 1, height: 113 })
  })

  it('优先解析角色的 concept 参考图作为主图', () => {
    const imageAsset: CanvasAsset = {
      id: 'img-1',
      projectId: 'p1',
      userId: 1,
      type: 'image',
      source: 'upload',
      title: 'hero.png',
      url: 'safe-file://hero',
      thumbnailUrl: 'safe-file://hero',
      metadata: {},
      createdAt: '2026-07-02T00:00:00.000Z',
      updatedAt: '2026-07-02T00:00:00.000Z',
    }
    const characterAsset: CanvasAsset = {
      id: 'char-1',
      projectId: 'p1',
      userId: 1,
      type: 'prompt',
      source: 'manual',
      title: '女主',
      contentText: '现代青年，温柔',
      metadata: writeReferences(
        { kind: 'character' },
        [{ id: 'ref-1', kind: 'concept', assetId: 'img-1', description: '', order: 0 }],
      ),
      createdAt: '2026-07-02T00:00:00.000Z',
      updatedAt: '2026-07-02T00:00:00.000Z',
    }
    expect(resolveCharacterSourceImageAsset(characterAsset, [imageAsset])?.id).toBe('img-1')
  })

  it('有 design_card 任务产物时优先用最新设定图卡', () => {
    const referenceImageAsset: CanvasAsset = {
      id: 'img-ref',
      projectId: 'p1',
      userId: 1,
      type: 'image',
      source: 'upload',
      title: 'hero-ref.png',
      url: 'safe-file://hero-ref',
      thumbnailUrl: 'safe-file://hero-ref',
      metadata: {},
      createdAt: '2026-07-02T00:00:00.000Z',
      updatedAt: '2026-07-02T00:00:00.000Z',
    }
    const designCardAsset: CanvasAsset = {
      id: 'img-card',
      projectId: 'p1',
      userId: 1,
      type: 'image',
      source: 'ai_generated',
      title: 'hero-card.png',
      url: 'safe-file://hero-card',
      thumbnailUrl: 'safe-file://hero-card',
      metadata: { taskId: 'task-1' },
      createdAt: '2026-07-03T00:00:00.000Z',
      updatedAt: '2026-07-03T00:00:00.000Z',
    }
    const characterAsset: CanvasAsset = {
      id: 'char-1',
      projectId: 'p1',
      userId: 1,
      type: 'prompt',
      source: 'manual',
      title: '赵大姐',
      contentText: '热情、八卦、爱凑热闹',
      metadata: writeReferences(
        { kind: 'character' },
        [{ id: 'ref-1', kind: 'concept', assetId: 'img-ref', description: '', order: 0 }],
      ),
      createdAt: '2026-07-02T00:00:00.000Z',
      updatedAt: '2026-07-02T00:00:00.000Z',
    }
    const nodes: CanvasNode[] = [
      {
        id: 'node-card',
        projectId: 'p1',
        boardId: 'b1',
        userId: 1,
        type: 'image',
        title: '图片 #5',
        assetId: 'img-card',
        x: 0,
        y: 0,
        width: 800,
        height: 450,
        rotation: 0,
        zIndex: 1,
        locked: false,
        hidden: false,
        data: { pipelineRole: 'design_card', url: 'safe-file://hero-card' },
        createdAt: '2026-07-03T00:00:00.000Z',
        updatedAt: '2026-07-03T00:00:00.000Z',
      },
    ]
    const tasks: CanvasTask[] = [
      {
        id: 'task-1',
        projectId: 'p1',
        boardId: 'b1',
        userId: 1,
        operation: 'text_to_image',
        status: 'completed',
        progress: 1,
        title: '生成角色身份板',
        prompt: 'hero',
        negativePrompt: null,
        inputNodeIds: [],
        inputAssetIds: ['char-1'],
        outputNodeIds: ['node-card'],
        outputAssetIds: ['img-card'],
        modelParams: {},
        createdAt: '2026-07-03T00:00:00.000Z',
        updatedAt: '2026-07-03T00:00:00.000Z',
        completedAt: '2026-07-03T00:00:00.000Z',
      },
    ]
    expect(
      resolveCharacterSourceImageAsset(characterAsset, [referenceImageAsset, designCardAsset], {
        nodes,
        tasks,
      })?.id,
    ).toBe('img-card')
  })

  it('可以从设定图卡图片反查所属角色资产', () => {
    const designCardAsset: CanvasAsset = {
      id: 'img-card',
      projectId: 'p1',
      userId: 1,
      type: 'image',
      source: 'ai_generated',
      title: 'hero-card.png',
      url: 'safe-file://hero-card',
      thumbnailUrl: 'safe-file://hero-card',
      metadata: { taskId: 'task-1' },
      createdAt: '2026-07-03T00:00:00.000Z',
      updatedAt: '2026-07-03T00:00:00.000Z',
    }
    const characterAsset: CanvasAsset = {
      id: 'char-1',
      projectId: 'p1',
      userId: 1,
      type: 'prompt',
      source: 'manual',
      title: '赵大姐',
      contentText: '热情、八卦、爱凑热闹',
      metadata: { kind: 'character', references: [], tags: [] },
      createdAt: '2026-07-02T00:00:00.000Z',
      updatedAt: '2026-07-02T00:00:00.000Z',
    }
    const tasks: CanvasTask[] = [
      {
        id: 'task-1',
        projectId: 'p1',
        boardId: 'b1',
        userId: 1,
        operation: 'text_to_image',
        status: 'completed',
        progress: 1,
        title: '生成角色身份板',
        prompt: 'hero',
        negativePrompt: null,
        inputNodeIds: [],
        inputAssetIds: ['char-1'],
        outputNodeIds: ['node-card'],
        outputAssetIds: ['img-card'],
        modelParams: {},
        createdAt: '2026-07-03T00:00:00.000Z',
        updatedAt: '2026-07-03T00:00:00.000Z',
        completedAt: '2026-07-03T00:00:00.000Z',
      },
    ]
    expect(
      resolveCharacterAssetForDesignCardImageAsset(designCardAsset, [characterAsset, designCardAsset], tasks)
        ?.id,
    ).toBe('char-1')
  })
})
