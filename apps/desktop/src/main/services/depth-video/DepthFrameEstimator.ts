type RgbFrame = {
  rgb: Uint8Array
  width: number
  height: number
}

type DepthTensor = {
  data: Float32Array | ArrayLike<number>
  dims: number[]
}

type DepthPipelineResult = {
  predicted_depth: DepthTensor
}

type DepthPipeline = (image: unknown) => Promise<DepthPipelineResult>

type PipelineFactory = (
  task: 'depth-estimation',
  modelDir: string,
  options: { local_files_only: true; dtype: 'int8' },
) => Promise<DepthPipeline>

type ImageFactory = (frame: RgbFrame) => unknown | Promise<unknown>

export type DepthEstimate = {
  values: Float32Array
  width: number
  height: number
}

export type DepthFrameEstimatorOptions = {
  modelDir: string
  pipelineFactory?: PipelineFactory
  imageFactory?: ImageFactory
}

export class DepthFrameEstimator {
  private pipelinePromise: Promise<DepthPipeline> | null = null
  private readonly pipelineFactory: PipelineFactory
  private readonly imageFactory: ImageFactory

  constructor(private readonly options: DepthFrameEstimatorOptions) {
    this.pipelineFactory = options.pipelineFactory ?? createLocalDepthPipeline
    this.imageFactory = options.imageFactory ?? createRawRgbImage
  }

  async estimate(frame: RgbFrame): Promise<DepthEstimate> {
    const pipeline = await this.loadPipeline()
    const image = await this.imageFactory(frame)
    const output = await pipeline(image)
    const dims = output.predicted_depth.dims
    const height = dims.at(-2)
    const width = dims.at(-1)
    if (!height || !width || height * width !== output.predicted_depth.data.length) {
      throw new Error(`深度模型返回了无效尺寸：${dims.join('x')}`)
    }
    return {
      values: Float32Array.from(output.predicted_depth.data),
      width,
      height,
    }
  }

  private loadPipeline(): Promise<DepthPipeline> {
    this.pipelinePromise ??= this.pipelineFactory('depth-estimation', this.options.modelDir, {
      local_files_only: true,
      dtype: 'int8',
    })
    return this.pipelinePromise
  }
}

async function createLocalDepthPipeline(
  task: 'depth-estimation',
  modelDir: string,
  options: { local_files_only: true; dtype: 'int8' },
): Promise<DepthPipeline> {
  const { env, pipeline } = await import('@huggingface/transformers')
  env.allowRemoteModels = false
  return (await pipeline(task, modelDir, options)) as unknown as DepthPipeline
}

async function createRawRgbImage(frame: RgbFrame): Promise<unknown> {
  const { RawImage } = await import('@huggingface/transformers')
  return new RawImage(frame.rgb, frame.width, frame.height, 3)
}
