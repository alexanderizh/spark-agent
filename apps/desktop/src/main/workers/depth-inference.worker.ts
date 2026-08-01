import { parentPort, workerData } from 'node:worker_threads'
import { DepthFrameEstimator } from '../services/depth-video/DepthFrameEstimator.js'
import {
  detectRgbSceneCut,
  normalizeInverseDepth,
  resizeGrayFrame,
  smoothDepthFrame,
} from '../services/depth-video/depthMath.js'

type WorkerData = { modelDir: string; runtimeEntryPath: string }
type WorkerRequest = { id: number; rgb: ArrayBuffer; width: number; height: number }

const data = workerData as WorkerData
const estimator = new DepthFrameEstimator({
  modelDir: data.modelDir,
  runtimeEntryPath: data.runtimeEntryPath,
})
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
      normalizeInverseDepth(estimate.values),
      estimate.width,
      estimate.height,
      request.width,
      request.height,
    )
    const sceneCut = detectRgbSceneCut(rgb, previousRgb)
    const depth = smoothDepthFrame(normalized, previousDepth, 0.25, sceneCut)
    previousRgb = rgb
    previousDepth = depth
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
