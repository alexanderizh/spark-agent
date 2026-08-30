import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

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

type DepthRuntimeModule = {
  env: { allowRemoteModels: boolean }
  pipeline: PipelineFactory
  RawImage: new (data: Uint8Array, width: number, height: number, channels: number) => unknown
}

type RuntimeLoader = (runtimeEntryPath: string) => Promise<DepthRuntimeModule>

export type DepthEstimate = {
  values: Float32Array
  width: number
  height: number
}

export type DepthFrameEstimatorOptions = {
  modelDir: string
  runtimeEntryPath?: string
  runtimeLoader?: RuntimeLoader
  pipelineFactory?: PipelineFactory
  imageFactory?: ImageFactory
}

export class DepthFrameEstimator {
  private pipelinePromise: Promise<DepthPipeline> | null = null
  private readonly pipelineFactory: PipelineFactory
  private readonly imageFactory: ImageFactory

  constructor(private readonly options: DepthFrameEstimatorOptions) {
    let runtimePromise: Promise<DepthRuntimeModule> | null = null
    const runtimeEntryPath = options.runtimeEntryPath
    const getRuntime = runtimeEntryPath
      ? () => {
          runtimePromise ??= (options.runtimeLoader ?? loadDepthRuntime)(runtimeEntryPath).then(
            (runtime) => {
              runtime.env.allowRemoteModels = false
              return runtime
            },
          )
          return runtimePromise
        }
      : null
    this.pipelineFactory =
      options.pipelineFactory ??
      (getRuntime
        ? async (task, modelDir, pipelineOptions) =>
            (await getRuntime()).pipeline(task, modelDir, pipelineOptions)
        : missingRuntime)
    this.imageFactory =
      options.imageFactory ??
      (getRuntime
        ? async (frame) => {
            const { RawImage } = await getRuntime()
            return new RawImage(frame.rgb, frame.width, frame.height, 3)
          }
        : missingRuntime)
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

async function loadDepthRuntime(runtimeEntryPath: string): Promise<DepthRuntimeModule> {
  if (!runtimeEntryPath) throw new Error('本地深度 Runtime 入口为空，请在完整性页修复组件')
  const runtimeUrl = pathToFileURL(resolve(runtimeEntryPath)).href
  return import(/* @vite-ignore */ runtimeUrl) as Promise<DepthRuntimeModule>
}

function missingRuntime(): never {
  throw new Error('本地深度 Runtime 未安装或已损坏，请在“设置 → 完整性”中安装或修复')
}
