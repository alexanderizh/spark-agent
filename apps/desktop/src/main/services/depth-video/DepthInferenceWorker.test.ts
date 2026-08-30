import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { DepthInferenceWorker } from './DepthInferenceWorker.js'

class FakeWorker extends EventEmitter {
  readonly postMessage = vi.fn((message: { id: number }) => {
    queueMicrotask(() => {
      this.emit('message', { id: message.id, depth: new Uint8Array([1, 2]).buffer })
    })
  })
  readonly terminate = vi.fn(async () => 0)
}

class LazyWorker extends EventEmitter {
  private readonly requests: { id: number }[] = []
  readonly postMessage = vi.fn((message: { id: number }) => {
    this.requests.push(message)
  })
  readonly terminate = vi.fn(async () => 0)

  respond(): void {
    const request = this.requests.shift()
    if (request) this.emit('message', { id: request.id, depth: new Uint8Array([1, 2]).buffer })
  }
}

describe('DepthInferenceWorker', () => {
  it('transfers RGB frames to a worker and returns processed gray frames', async () => {
    const worker = new FakeWorker()
    const createWorker = vi.fn(() => worker as never)
    const processor = new DepthInferenceWorker({
      modelDir: '/managed/model',
      runtimeEntryPath: '/managed/runtime/transformers.js',
      createWorker,
    })

    await expect(
      processor.process({ rgb: new Uint8Array([4, 5, 6]), width: 1, height: 1 }),
    ).resolves.toEqual(new Uint8Array([1, 2]))
    expect(worker.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ width: 1, height: 1 }),
      expect.any(Array),
    )
    expect(createWorker).toHaveBeenCalledWith('/managed/model', '/managed/runtime/transformers.js')

    await processor.dispose()
    expect(worker.terminate).toHaveBeenCalled()
  })

  it('rejects requests immediately after the worker has already failed', async () => {
    const worker = new FakeWorker()
    const processor = new DepthInferenceWorker({
      modelDir: '/managed/model',
      runtimeEntryPath: '/managed/runtime/transformers.js',
      createWorker: () => worker as never,
    })
    worker.emit('error', new Error('worker entry is missing'))

    await expect(
      Promise.race([
        processor.process({ rgb: new Uint8Array([4, 5, 6]), width: 1, height: 1 }),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('request remained pending')), 50),
        ),
      ]),
    ).rejects.toThrow('worker entry is missing')
  })

  it('defers terminate while an inference request is still running in the worker', async () => {
    vi.useFakeTimers()
    try {
      const worker = new LazyWorker()
      const processor = new DepthInferenceWorker({
        modelDir: '/managed/model',
        runtimeEntryPath: '/managed/runtime/transformers.js',
        createWorker: () => worker as never,
      })
      // 模拟取消时序：原生推理仍在 worker 内执行（无响应），主线程先 dispose。
      const estimate = processor.process({ rgb: new Uint8Array([4, 5, 6]), width: 1, height: 1 })
      const disposing = processor.dispose()
      await expect(estimate).rejects.toThrow('深度推理 worker 已关闭')
      expect(worker.terminate).not.toHaveBeenCalled()

      worker.respond()
      await disposing
      expect(worker.terminate).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('force-terminates after the drain timeout when the worker never responds', async () => {
    vi.useFakeTimers()
    try {
      const worker = new LazyWorker()
      const processor = new DepthInferenceWorker({
        modelDir: '/managed/model',
        runtimeEntryPath: '/managed/runtime/transformers.js',
        createWorker: () => worker as never,
      })
      void processor
        .process({ rgb: new Uint8Array([4, 5, 6]), width: 1, height: 1 })
        .catch(() => undefined)
      const disposing = processor.dispose()
      await vi.advanceTimersByTimeAsync(15_000)
      await disposing
      expect(worker.terminate).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('terminates without waiting when the worker thread has already died', async () => {
    vi.useFakeTimers()
    try {
      const worker = new LazyWorker()
      const processor = new DepthInferenceWorker({
        modelDir: '/managed/model',
        runtimeEntryPath: '/managed/runtime/transformers.js',
        createWorker: () => worker as never,
      })
      void processor
        .process({ rgb: new Uint8Array([4, 5, 6]), width: 1, height: 1 })
        .catch(() => undefined)
      const disposing = processor.dispose()
      worker.emit('exit', 1)
      await disposing
      expect(worker.terminate).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
})
