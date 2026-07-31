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
    const processor = new DepthInferenceWorker({
      modelDir: '/managed/model',
      createWorker: () => worker as never,
    })

    await expect(
      processor.process({ rgb: new Uint8Array([4, 5, 6]), width: 1, height: 1 }),
    ).resolves.toEqual(new Uint8Array([1, 2]))
    expect(worker.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ width: 1, height: 1 }),
      expect.any(Array),
    )

    await processor.dispose()
    expect(worker.terminate).toHaveBeenCalled()
  })
})
