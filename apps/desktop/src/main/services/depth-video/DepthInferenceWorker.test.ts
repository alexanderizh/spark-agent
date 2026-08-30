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
})
