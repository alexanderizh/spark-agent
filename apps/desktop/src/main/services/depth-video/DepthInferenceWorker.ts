import { Worker } from 'node:worker_threads'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

type WorkerRequest = {
  id: number
  rgb: ArrayBuffer
  width: number
  height: number
}

type WorkerResponse = { id: number; depth: ArrayBuffer } | { id: number; error: string }

type WorkerLike = Pick<Worker, 'on' | 'postMessage' | 'terminate'>

export type DepthInferenceWorkerOptions = {
  modelDir: string
  runtimeEntryPath: string
  createWorker?: (modelDir: string, runtimeEntryPath: string) => WorkerLike
}

export class DepthInferenceWorker {
  private readonly worker: WorkerLike
  private readonly pending = new Map<
    number,
    { resolve: (depth: Uint8Array) => void; reject: (error: Error) => void }
  >()
  private nextId = 1
  private disposed = false
  private fatalError: Error | null = null

  constructor(options: DepthInferenceWorkerOptions) {
    this.worker =
      options.createWorker?.(options.modelDir, options.runtimeEntryPath) ??
      new Worker(resolveDepthWorkerPath(), {
        workerData: {
          modelDir: options.modelDir,
          runtimeEntryPath: options.runtimeEntryPath,
        },
      })
    this.worker.on('message', (message: WorkerResponse) => this.handleMessage(message))
    this.worker.on('error', (error: Error) => this.fail(error))
    this.worker.on('exit', (code: number) => {
      if (!this.disposed) {
        this.fail(new Error(`深度推理 worker 意外退出：${code}`))
      }
    })
  }

  process(frame: { rgb: Uint8Array; width: number; height: number }): Promise<Uint8Array> {
    if (this.disposed) return Promise.reject(new Error('深度推理 worker 已关闭'))
    if (this.fatalError) return Promise.reject(this.fatalError)
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

  private fail(error: Error): void {
    this.fatalError ??= error
    this.failAll(this.fatalError)
  }
}

function resolveDepthWorkerPath(): string {
  const candidates = [
    join(__dirname, 'depth-inference-worker.js'),
    join(process.cwd(), 'out', 'main', 'depth-inference-worker.js'),
    join(process.cwd(), 'apps', 'desktop', 'out', 'main', 'depth-inference-worker.js'),
  ] as const
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]
}
