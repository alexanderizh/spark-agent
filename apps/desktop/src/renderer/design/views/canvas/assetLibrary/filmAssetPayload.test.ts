import { describe, expect, it } from 'vitest'
import { parseFilmAssetPayload, readFilmAssetPayload } from './filmAssetPayload'
import type { CanvasAsset } from '../canvas.types'

const at = '2026-08-29T00:00:00.000Z'

function assetWithMetadata(metadata: Record<string, unknown>): CanvasAsset {
  return {
    id: 'asset-1',
    projectId: 'project-1',
    userId: 0,
    type: 'prompt',
    source: 'manual',
    metadata,
    createdAt: at,
    updatedAt: at,
  }
}

describe('parseFilmAssetPayload', () => {
  it('无 kind / 非对象 metadata 返回 null，不抛错', () => {
    expect(parseFilmAssetPayload(undefined)).toBeNull()
    expect(parseFilmAssetPayload(null)).toBeNull()
    expect(parseFilmAssetPayload({})).toBeNull()
    expect(parseFilmAssetPayload({ kind: 42 })).toBeNull()
  })

  it('character 分支读取 attributes 与 subviews', () => {
    const payload = parseFilmAssetPayload({
      kind: 'character',
      attributes: { appearance: '银色长发', personality: '冷静' },
      characterSubviews: [
        {
          id: 'sv-1',
          label: '三视图',
          kind: 'turnaround',
          sourceAssetId: 'asset-9',
          cropPx: { x: 0, y: 0, width: 10, height: 10 },
          order: 0,
          createdAt: at,
          updatedAt: at,
        },
      ],
    })
    expect(payload).toEqual({
      kind: 'character',
      character: {
        appearance: '银色长发',
        personality: '冷静',
        subviewAssets: [{ view: '三视图', assetId: 'asset-9' }],
      },
    })
  })

  it('character 结构缺失时给安全缺省（不抛错、不降级 raw）', () => {
    const payload = parseFilmAssetPayload({ kind: 'character' })
    expect(payload).toEqual({ kind: 'character', character: { appearance: '' } })
  })

  it('scene / prop / effect 分支读取描述与时间', () => {
    expect(parseFilmAssetPayload({ kind: 'scene', attributes: { timeOfDay: '黄昏' } })).toEqual({
      kind: 'scene',
      scene: { description: '', timeOfDay: '黄昏' },
    })
    expect(parseFilmAssetPayload({ kind: 'prop', attributes: { description: '铜钥匙' } })).toEqual({
      kind: 'prop',
      prop: { description: '铜钥匙' },
    })
    expect(parseFilmAssetPayload({ kind: 'effect' })).toEqual({
      kind: 'effect',
      effect: { description: '' },
    })
  })

  it('文本类与未知 kind 回落 raw 分支', () => {
    const manuscript = parseFilmAssetPayload({ kind: 'manuscript', tags: ['x'] })
    expect(manuscript).toEqual({ kind: 'manuscript', raw: { kind: 'manuscript', tags: ['x'] } })

    const unknown = parseFilmAssetPayload({ kind: 'future_kind', foo: 1 })
    expect(unknown).toEqual({ kind: 'future_kind', raw: { kind: 'future_kind', foo: 1 } })
  })

  it('readFilmAssetPayload 从资产读取', () => {
    expect(readFilmAssetPayload(assetWithMetadata({ kind: 'prop', attributes: {} }))).toEqual({
      kind: 'prop',
      prop: { description: '' },
    })
    expect(readFilmAssetPayload(assetWithMetadata({}))).toBeNull()
  })
})
