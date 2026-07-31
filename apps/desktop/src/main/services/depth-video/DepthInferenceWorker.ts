import { Worker } from 'node:worker_threads'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

type WorkerRequest = {
  id: number
  rgb: ArrayBuffer
  width: number
  height: number
}

type WorkerResponse =
  | { id: number; depth: ArrayBuffer }
  | { id: number; error: string }

type WorkerLike = Pick<Worker, 'on' | 'postMessage' | 'terminate'>

export type DepthInferenceWorkerOptions = {
  modelDir: string
  createWorker?: (modelDir: string) => WorkerLike
}

export class DepthInferenceWorker {
  private readonly worker: WorkerLike
  private readonly pending = new Map<
    number,
    { resolve: (depth: Uint8Array) => void; reject: (error: Error) => void }
  >()
  private nextId = 1
  private disposed = false

  constructor(options: DepthInferenceWorkerOptions) {
    this.worker =
      options.createWorker?.(options.modelDir) ??
      new Worker(resolveDepthWorkerPath(), {
        workerData: { modelDir: options.modelDir },
      })
    this.worker.on('message', (message: WorkerResponse) => this.handleMessage(message))
    this.worker.on('error', (error: Error) => this.failAll(error))
    this.worker.on('exit', (code: number) => {
      if (!this.disposed && code !== 0) {
        this.failAll(new Error(`深度推理 worker 异常退出：${code}`))
      }
    })
  }

  process(frame: { rgb: Uint8Array; width: number; height: number }): Promise<Uint8Array> {
    if (this.disposed) return Promise.reject(new Error('深度推理 worker 已关闭'))
    const id = this.nextId++
    const rgb = frame.rgb.slice().buffer
    return new Promise<Uint8Array>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      const request: WorkerRequest = { id, rgb, width: frame.width, height: frame.height }
      this.worker.postMessage(request, [rgb])
    })
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    this.failAll(new Error('深度推理 worker 已关闭'))
    await this.worker.terminate()
  }

  private handleMessage(message: WorkerResponse): void {
    const pending = this.pending.get(message.id)
    if (!pending) return
    this.pending.delete(message.id)
    if ('error' in message) pending.reject(new Error(message.error))
    else pending.resolve(new Uint8Array(message.depth))
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error)
    this.pending.clear()
  }
}

function resolveDepthWorkerPath(): string {
  const bundled = join(__dirname, 'depth-inference-worker.js')
  if (existsSync(bundled)) return bundled
  return join(process.cwd(), 'out', 'main', 'depth-inference-worker.js')
}
