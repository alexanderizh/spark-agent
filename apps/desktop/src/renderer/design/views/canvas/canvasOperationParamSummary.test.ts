import { describe, expect, it } from 'vitest'
import { buildCanvasOperationParamSummary } from './canvasOperationParamSummary'

describe('canvas operation parameter summary', () => {
  it('prioritizes common visual parameters and caps the result at four items', () => {
    expect(
      buildCanvasOperationParamSummary({
        seed: 42,
        fps: 24,
        quality: 'high',
        duration_seconds: 5,
        resolution: '2k',
        aspect_ratio: '16:9',
      }),
    ).toEqual([
      { key: 'aspect_ratio', label: '比例', value: '16:9' },
      { key: 'resolution', label: '分辨率', value: '2k' },
      { key: 'duration_seconds', label: '时长', value: '5秒' },
      { key: 'quality', label: '质量', value: 'high' },
    ])
  })

  it('ignores nested workflow configuration and normalizes aliases', () => {
    expect(
      buildCanvasOperationParamSummary({
        workflow: { nodes: [] },
        aspectRatio: '2:1',
        frameRate: 30,
        output_format: 'mp4',
      }),
    ).toEqual([
      { key: 'aspectRatio', label: '比例', value: '2:1' },
      { key: 'frameRate', label: '帧率', value: '30fps' },
      { key: 'output_format', label: '格式', value: 'mp4' },
    ])
  })
})
