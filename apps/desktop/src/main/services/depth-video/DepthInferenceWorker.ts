import { Worker } from 'node:worker_threads'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { DepthVideoRenderOptions } from './depthRenderOptions.js'

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
  renderOptions?: DepthVideoRenderOptions
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
  private inFlightRequests = 0
  private drainWaiter: (() => void) | null = null

  constructor(options: DepthInferenceWorkerOptions) {
    this.worker =
      options.createWorker?.(options.modelDir, options.runtimeEntryPath) ??
      new Worker(resolveDepthWorkerPath(), {
        workerData: {
          modelDir: options.modelDir,
          runtimeEntryPath: options.runtimeEntryPath,
          renderOptions: options.renderOptions,
        },
      })
    this.worker.on('message', (message: WorkerResponse) => this.handleMessage(message))
    this.worker.on('error', (error: Error) => this.fail(error))
    this.worker.on('exit', (code: number) => {
      if (!this.disposed) {
        this.fail(new Error(`深度推理 worker 意外退出：${code}`))
        return
      }
      // dispose 进行中 worker 才退出：在途请求不会再有响应，直接放行 terminate。
      this.notifyDrained()
    })
  }

  process(frame: { rgb: Uint8Array; width: number; height: number }): Promise<Uint8Array> {
    if (this.disposed) return Promise.reject(new Error('深度推理 worker 已关闭'))
    if (this.fatalError) return Promise.reject(this.fatalError)
    const id = this.nextId++
    const rgb = frame.rgb.slice().buffer
    this.inFlightRequests += 1
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
    // terminate() 打断正在执行的 onnxruntime 原生调用时，NAPI 环境在原生栈展开
    // 过程中抛出的 C++ 异常无人捕获，std::terminate 会以 SIGABRT 终止整个主进程
    // （崩溃报告表现为 WorkerThread 线程 abort）。pending 已全部 reject，取消路径
    // 不被阻塞；这里等在途推理返回后再终止 worker。
    await this.waitForInFlightRequestsToDrain(15_000)
    await this.worker.terminate()
  }

  private waitForInFlightRequestsToDrain(timeoutMs: number): Promise<void> {
    if (this.inFlightRequests === 0) return Promise.resolve()
    return new Promise<void>((resolve) => {
      const finish = () => {
        clearTimeout(timer)
        this.drainWaiter = null
        resolve()
      }
      const timer = setTimeout(finish, timeoutMs)
      timer.unref?.()
      this.drainWaiter = finish
    })
  }

  private handleMessage(message: WorkerResponse): void {
    this.inFlightRequests = Math.max(0, this.inFlightRequests - 1)
    if (this.inFlightRequests === 0) this.notifyDrained()
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
    // worker 已死亡，在途请求永远不会有响应，直接放行 terminate。
    this.notifyDrained()
  }

  private notifyDrained(): void {
    const waiter = this.drainWaiter
    this.drainWaiter = null
    waiter?.()
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
