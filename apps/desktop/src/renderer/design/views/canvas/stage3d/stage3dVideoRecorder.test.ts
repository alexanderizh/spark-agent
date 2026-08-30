// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  recordStage3DVideo,
  Stage3DVideoCancelledError,
  stage3DVideoSizeForAspect,
} from './stage3dVideoRecorder'

/**
 * MediaRecorder / captureStream 均为 jsdom 不提供的浏览器能力，用最小 stub 模拟：
 * stop() 触发 onstop；start() 先推一个 dataavailable，保证成功路径有 chunk。
 */
class MockMediaRecorder {
  static instances: MockMediaRecorder[] = []
  state: 'inactive' | 'recording' = 'inactive'
  ondataavailable: ((event: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor(public stream: unknown) {
    MockMediaRecorder.instances.push(this)
  }
  static isTypeSupported(): boolean {
    return true
  }
  start(): void {
    this.state = 'recording'
    this.ondataavailable?.({ data: new Blob(['frame'], { type: 'video/webm' }) })
  }
  stop(): void {
    if (this.state === 'inactive') return
    this.state = 'inactive'
    this.onstop?.()
  }
}

const SIZE = { width: 640, height: 360 }

beforeEach(() => {
  MockMediaRecorder.instances = []
  vi.stubGlobal('MediaRecorder', MockMediaRecorder)
  Object.defineProperty(HTMLCanvasElement.prototype, 'captureStream', {
    configurable: true,
    value: () => ({
      getVideoTracks: () => [{ requestFrame() {}, stop() {} }],
      getTracks: () => [{ stop() {} }],
    }),
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete (HTMLCanvasElement.prototype as { captureStream?: unknown }).captureStream
})

describe('stage3dVideoRecorder', () => {
  it('sizes the recording canvas by aspect with even dimensions', () => {
    expect(stage3DVideoSizeForAspect(16 / 9)).toEqual({ width: 1280, height: 720 })
    expect(stage3DVideoSizeForAspect(1)).toEqual({ width: 1280, height: 1280 })
    expect(stage3DVideoSizeForAspect(9 / 16)).toEqual({ width: 720, height: 1280 })
  })

  it('rejects with the render error instead of hanging when renderFrame throws', async () => {
    await expect(
      recordStage3DVideo({
        size: SIZE,
        durationSec: 2,
        renderFrame: () => {
          throw new Error('boom')
        },
      }),
    ).rejects.toThrow('boom')

    // 失败路径也必须回收 recorder（stop 被调用）
    expect(MockMediaRecorder.instances[0]?.state).toBe('inactive')
  })

  it('aborts instead of producing a black video when the viewport stops rendering', async () => {
    await expect(
      recordStage3DVideo({
        size: SIZE,
        durationSec: 8,
        renderFrame: () => false,
      }),
    ).rejects.toThrow('视口不可用')

    expect(MockMediaRecorder.instances[0]?.state).toBe('inactive')
  })

  it('rejects with CancelledError when the signal is set', async () => {
    const signal = { cancelled: true }
    await expect(
      recordStage3DVideo({
        size: SIZE,
        durationSec: 5,
        renderFrame: () => true,
        signal,
      }),
    ).rejects.toBeInstanceOf(Stage3DVideoCancelledError)

    expect(MockMediaRecorder.instances[0]?.state).toBe('inactive')
  })

  it('resolves with a blob on the happy path', async () => {
    const result = await recordStage3DVideo({
      size: SIZE,
      durationSec: 0.25,
      renderFrame: () => true,
    })
    expect(result.blob).toBeInstanceOf(Blob)
    expect(result.mimeType).toContain('video/webm')
    expect(result.size).toEqual(SIZE)
  })
})
