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
import type { FilmReference } from './canvasFilmTypes'

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
