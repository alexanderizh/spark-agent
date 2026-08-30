import { describe, expect, it } from 'vitest'
import type { CanvasAsset } from '../canvas.types'
import { probeCanvasAcceptanceAssets } from './canvasAcceptanceAssetProbe'

function asset(overrides: Partial<CanvasAsset> = {}): CanvasAsset {
  return {
    id: 'asset-1',
    projectId: 'project-1',
    userId: 0,
    type: 'video',
    source: 'ai_generated',
    mimeType: 'video/mp4',
    storageKey: 'assets/videos/result.mp4',
    durationMs: 4_000,
    sizeBytes: 1_024,
    metadata: {},
    createdAt: '',
    updatedAt: '',
    ...overrides,
  }
}

describe('canvas acceptance asset probe', () => {
  it('passes queryable video metadata and records a structured probe', () => {
    const result = probeCanvasAcceptanceAssets('video', [asset()])
    expect(result.probes[0]).toMatchObject({
      assetId: 'asset-1',
      expectedKind: 'video',
      mimeType: 'video/mp4',
      durationMs: 4_000,
      issues: [],
    })
    expect(result.assertions.every((item) => item.status === 'passed')).toBe(true)
  })

  it('fails type and MIME mismatches but only warns for unavailable metadata', () => {
    const result = probeCanvasAcceptanceAssets('video', [
      asset({ type: 'image', mimeType: 'image/png', durationMs: null, sizeBytes: null }),
    ])
    expect(result.assertions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'media.probe.asset-1.kind', status: 'failed' }),
        expect.objectContaining({ id: 'media.probe.asset-1.mime', status: 'failed' }),
        expect.objectContaining({ id: 'media.probe.asset-1.duration', status: 'warned' }),
        expect.objectContaining({ id: 'media.probe.asset-1.size', status: 'warned' }),
      ]),
    )
  })
})
