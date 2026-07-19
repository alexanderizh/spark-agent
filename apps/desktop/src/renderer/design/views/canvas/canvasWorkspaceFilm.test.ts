import { describe, expect, it } from 'vitest'
import type { CanvasAsset } from './canvas.types'
import { buildFilmAssetReferencePrompt } from './canvasWorkspaceFilm'

describe('buildFilmAssetReferencePrompt', () => {
  it('场景图提示词强制为无人物的纯场景', () => {
    const asset: CanvasAsset = {
      id: 'scene-1',
      projectId: 'project-1',
      userId: 0,
      type: 'text',
      source: 'manual',
      title: '雨夜茶馆',
      contentText: '木质柜台与暖色吊灯。',
      metadata: { kind: 'scene' },
      createdAt: '2026-07-19T00:00:00.000Z',
      updatedAt: '2026-07-19T00:00:00.000Z',
    }

    const prompt = buildFilmAssetReferencePrompt(asset)

    expect(prompt).toContain('【不要存在人物】')
    expect(prompt).toContain('只呈现纯粹的场景')
    expect(prompt).toContain('不得出现任何人物')
  })
})
