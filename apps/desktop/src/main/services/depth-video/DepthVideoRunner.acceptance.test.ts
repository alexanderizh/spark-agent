import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getPath: () => process.env.SPARK_DEPTH_ACCEPTANCE_USER_DATA ?? '/tmp/spark-depth-acceptance',
  },
}))
import { probeVideo } from '../FfmpegRunner.js'
import { DepthVideoRunner } from './DepthVideoRunner.js'

const modelDir = process.env.SPARK_DEPTH_ACCEPTANCE_MODEL_DIR
const inputPath = process.env.SPARK_DEPTH_ACCEPTANCE_INPUT
const outputPath = process.env.SPARK_DEPTH_ACCEPTANCE_OUTPUT
const acceptanceEnabled = Boolean(modelDir && inputPath && outputPath)

describe('DepthVideoRunner real-video acceptance', () => {
  it.runIf(acceptanceEnabled)(
    'runs the managed INT8 model and preserves video geometry without audio',
    async () => {
      const source = await probeVideo(inputPath!)
      const stages = new Set<string>()
      const result = await new DepthVideoRunner().run({
        inputPath: inputPath!,
        outputPath: outputPath!,
        modelDir: modelDir!,
        onProgress: (progress) => stages.add(progress.stage),
      })
      const output = await probeVideo(result.path)

      expect(output.videoCodec).toBe('h264')
      expect(output.width).toBe(source.width)
      expect(output.height).toBe(source.height)
      expect(output.fps).toBeCloseTo(source.fps, 3)
      expect(output.durationSec).toBeCloseTo(source.durationSec, 1)
      expect(output.hasAudio).toBe(false)
      expect(stages).toEqual(new Set(['decoding', 'estimating_depth', 'encoding']))
      console.log(
        JSON.stringify({ source, output, frameCount: result.frameCount, stages: [...stages] }),
      )
    },
    180_000,
  )
})
