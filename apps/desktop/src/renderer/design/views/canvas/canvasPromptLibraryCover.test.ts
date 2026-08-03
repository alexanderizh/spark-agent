import { describe, expect, it } from 'vitest'
import type { CanvasAsset, CanvasAssetType } from './canvas.types'
import { isPromptCoverAsset, isPromptCoverNode } from './canvasPromptLibraryCover'

function asset(type: CanvasAssetType): CanvasAsset {
  return {
    id: `asset-${type}`,
    projectId: 'project-1',
    userId: 1,
    type,
    source: 'manual',
    title: type,
    url: 'safe-file://project/media/asset.bin',
    metadata: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

describe('canvas prompt library cover assets', () => {
  it('accepts image assets only', () => {
    expect(isPromptCoverAsset(asset('image'))).toBe(true)
    expect(isPromptCoverAsset(asset('video'))).toBe(false)
    expect(isPromptCoverAsset(asset('audio'))).toBe(false)
    expect(isPromptCoverAsset(asset('file'))).toBe(false)
    expect(isPromptCoverAsset(asset('text'))).toBe(false)
    expect(isPromptCoverAsset(asset('prompt'))).toBe(false)
  })

  it('does not infer image eligibility from a non-image URL', () => {
    expect(isPromptCoverAsset(asset('video'))).toBe(false)
  })

  it('accepts only image nodes as canvas cover sources', () => {
    expect(isPromptCoverNode({ type: 'image' }, asset('image'))).toBe(true)
    expect(isPromptCoverNode({ type: 'text' }, asset('image'))).toBe(false)
    expect(isPromptCoverNode({ type: 'image' }, asset('video'))).toBe(false)
  })
})
