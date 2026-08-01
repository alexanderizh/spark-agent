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

  it('loads the estimator module from the installed runtime entry once', async () => {
    const infer = vi.fn(async () => ({
      predicted_depth: { data: new Float32Array([1]), dims: [1, 1, 1] },
    }))
    const pipeline = vi.fn(async () => infer)
    const RawImage = vi.fn(function RawImage() {})
    const runtimeLoader = vi.fn(async () => ({
      env: { allowRemoteModels: true },
      pipeline,
      RawImage,
    }))
    const estimator = new DepthFrameEstimator({
      modelDir: '/managed/model',
      runtimeEntryPath: '/managed/runtime/transformers.js',
      runtimeLoader,
    })

    expect(runtimeLoader).not.toHaveBeenCalled()
    await estimator.estimate({ rgb: new Uint8Array([1, 2, 3]), width: 1, height: 1 })

    expect(runtimeLoader).toHaveBeenCalledOnce()
    expect(runtimeLoader).toHaveBeenCalledWith('/managed/runtime/transformers.js')
    expect(pipeline).toHaveBeenCalledWith(
      'depth-estimation',
      '/managed/model',
      expect.objectContaining({ local_files_only: true }),
    )
  })
})
