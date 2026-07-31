import { describe, expect, it, vi } from 'vitest'
import { DepthFrameEstimator } from './DepthFrameEstimator'

describe('DepthFrameEstimator', () => {
  it('loads only the installed local INT8 model and returns its inverse-depth tensor', async () => {
    const infer = vi.fn(async () => ({
      predicted_depth: {
        data: new Float32Array([1, 2, 3, 4]),
        dims: [1, 2, 2],
      },
    }))
    const pipelineFactory = vi.fn(async () => infer)
    const imageFactory = vi.fn(() => ({ local: 'rgb-image' }))
    const estimator = new DepthFrameEstimator({
      modelDir: '/managed/models/depth-anything-v2-small-int8',
      pipelineFactory,
      imageFactory,
    })

    const result = await estimator.estimate({
      rgb: new Uint8Array(12),
      width: 2,
      height: 2,
    })

    expect(pipelineFactory).toHaveBeenCalledWith(
      'depth-estimation',
      '/managed/models/depth-anything-v2-small-int8',
      expect.objectContaining({ local_files_only: true, dtype: 'int8' }),
    )
    expect(imageFactory).toHaveBeenCalledWith(expect.objectContaining({ width: 2, height: 2 }))
    expect(infer).toHaveBeenCalledWith({ local: 'rgb-image' })
    expect(result).toEqual({ values: expect.any(Float32Array), width: 2, height: 2 })
  })
})
