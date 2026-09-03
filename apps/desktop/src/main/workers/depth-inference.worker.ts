import { parentPort, workerData } from 'node:worker_threads'
import { DepthFrameEstimator } from '../services/depth-video/DepthFrameEstimator.js'
import {
  applyDepthColormap,
  detectRgbSceneCut,
  invertGrayValues,
  normalizeInverseDepth,
  resizeGrayFrame,
  smoothDepthFrame,
} from '../services/depth-video/depthMath.js'
import {
  resolveDepthVideoRenderOptions,
  type DepthVideoRenderOptions,
} from '../services/depth-video/depthRenderOptions.js'

type WorkerData = {
  modelDir: string
  runtimeEntryPath: string
  renderOptions?: Partial<DepthVideoRenderOptions>
}
type WorkerRequest = { id: number; rgb: ArrayBuffer; width: number; height: number }

const data = workerData as WorkerData
const estimator = new DepthFrameEstimator({
  modelDir: data.modelDir,
  runtimeEntryPath: data.runtimeEntryPath,
})
const render = resolveDepthVideoRenderOptions(data.renderOptions)
let previousRgb: Uint8Array | null = null
let previousDepth: Uint8Array | null = null

parentPort?.on('message', async (request: WorkerRequest) => {
  try {
    const rgb = new Uint8Array(request.rgb)
    const estimate = await estimator.estimate({
      rgb,
      width: request.width,
      height: request.height,
    })
    const normalized = resizeGrayFrame(
      normalizeInverseDepth(estimate.values, render.contrast),
      estimate.width,
      estimate.height,
      request.width,
      request.height,
    )
    const sceneCut = detectRgbSceneCut(rgb, previousRgb)
    // 平滑历史始终记录灰度帧；反相与伪彩色是纯映射，不影响后续帧的时序状态。
    const smoothed = smoothDepthFrame(normalized, previousDepth, render.smoothStrength, sceneCut)
    previousRgb = rgb
    previousDepth = smoothed
    let depth: Uint8Array = render.invert ? invertGrayValues(smoothed) : smoothed
    if (render.colormap !== 'none') depth = applyDepthColormap(depth, render.colormap)
    const outputBuffer = new ArrayBuffer(depth.byteLength)
    new Uint8Array(outputBuffer).set(depth)
    parentPort?.postMessage({ id: request.id, depth: outputBuffer }, [outputBuffer])
  } catch (error) {
    parentPort?.postMessage({
      id: request.id,
      error: error instanceof Error ? error.message : String(error),
    })
  }
})
