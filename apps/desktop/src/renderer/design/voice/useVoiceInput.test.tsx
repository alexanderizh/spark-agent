// @vitest-environment jsdom

import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useVoiceInput, type UseVoiceInputOptions, type UseVoiceInputResult } from './useVoiceInput'

vi.mock('./voiceCaptureWorklet', () => ({
  getVoiceWorkletUrl: () => 'blob:voice-worklet',
  VOICE_WORKLET_PROCESSOR_NAME: 'voice-capture-processor',
}))

let root: Root | null = null
let container: HTMLDivElement | null = null
let latest: UseVoiceInputResult | null = null

const trackStop = vi.fn()
const sourceConnect = vi.fn()
const sourceDisconnect = vi.fn()
const nodeConnect = vi.fn()
const nodeDisconnect = vi.fn()
const contextClose = vi.fn()
const contextResume = vi.fn()
const addModule = vi.fn()
const getUserMedia = vi.fn()
const enumerateDevices = vi.fn()
const invoke = vi.fn()
const offRecognition = vi.fn()
const trackAddEventListener = vi.fn()
const trackRemoveEventListener = vi.fn()

const audioTrack = {
  readyState: 'live',
  stop: trackStop,
  addEventListener: trackAddEventListener,
  removeEventListener: trackRemoveEventListener,
} as unknown as MediaStreamTrack

const mediaStream = {
  getTracks: () => [audioTrack],
  getAudioTracks: () => [audioTrack],
} as unknown as MediaStream

const defaultAudioInput = {
  kind: 'audioinput',
  deviceId: 'default',
  groupId: 'default-group',
  label: '',
  toJSON: () => ({}),
} as MediaDeviceInfo

const sourceNode = {
  connect: sourceConnect,
  disconnect: sourceDisconnect,
} as unknown as MediaStreamAudioSourceNode

const destination = {} as AudioDestinationNode

class MockAudioContext {
  state: AudioContextState = 'running'
  destination = destination
  audioWorklet = { addModule }
  createMediaStreamSource = vi.fn(() => sourceNode)
  close = contextClose
  resume = contextResume
}

class MockAudioWorkletNode {
  port = { onmessage: null as ((event: MessageEvent<Int16Array>) => void) | null }
  connect = nodeConnect
  disconnect = nodeDisconnect
}

function Harness({ options }: { options?: UseVoiceInputOptions } = {}): null {
  const current = useVoiceInput(options)
  useEffect(() => {
    latest = current
  }, [current])
  return null
}

function voice(): UseVoiceInputResult {
  if (!latest) throw new Error('voice hook not mounted')
  return latest
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true
  latest = null
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)

  getUserMedia.mockResolvedValue(mediaStream)
  enumerateDevices.mockResolvedValue([defaultAudioInput])
  addModule.mockResolvedValue(undefined)
  contextClose.mockResolvedValue(undefined)
  contextResume.mockResolvedValue(undefined)
  invoke.mockImplementation(async (channel: string) => {
    if (channel === 'voice:request-microphone-permission') {
      return { granted: true, status: 'granted', message: null }
    }
    if (channel === 'voice:start') {
      return { success: true, message: 'ok', sessionId: 'voice-123-1' }
    }
    return { success: true, message: 'ok' }
  })

  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { enumerateDevices, getUserMedia },
  })
  Object.defineProperty(window, 'AudioContext', {
    configurable: true,
    value: MockAudioContext,
  })
  Object.defineProperty(window, 'spark', {
    configurable: true,
    value: {
      invoke,
      on: vi.fn(() => offRecognition),
      platform: 'darwin',
      sendVoiceAudioChunk: vi.fn(),
    },
  })
  vi.stubGlobal('AudioWorkletNode', MockAudioWorkletNode)

  act(() => root?.render(<Harness />))
})

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = null
  container = null
  vi.unstubAllGlobals()
})

describe('useVoiceInput', () => {
  it('connects the silent worklet to the destination and releases resources on stop', async () => {
    await act(async () => voice().start())

    expect(voice().status).toBe('recording')
    expect(sourceConnect).toHaveBeenCalledTimes(1)
    expect(nodeConnect).toHaveBeenCalledWith(destination)

    await act(async () => voice().stop())

    expect(voice().status).toBe('idle')
    expect(trackStop).toHaveBeenCalledTimes(1)
    expect(nodeDisconnect).toHaveBeenCalledTimes(1)
    expect(sourceDisconnect).toHaveBeenCalledTimes(1)
    expect(contextClose).toHaveBeenCalledTimes(1)
    expect(invoke).toHaveBeenCalledWith('voice:stop', { sessionId: 'voice-123-1' })
    const stopCallIndex = invoke.mock.calls.findIndex(([channel]) => channel === 'voice:stop')
    expect(offRecognition.mock.invocationCallOrder[0]).toBeGreaterThan(
      invoke.mock.invocationCallOrder[stopCallIndex] ?? 0,
    )
    expect(trackRemoveEventListener).toHaveBeenCalledWith('ended', expect.any(Function))
  })

  it('cancels pending recognition initialization and releases the microphone', async () => {
    let resolveStart!: (value: { success: true; message: string; sessionId: string }) => void
    invoke.mockImplementation((channel: string) => {
      if (channel === 'voice:request-microphone-permission') {
        return Promise.resolve({ granted: true, status: 'granted', message: null })
      }
      if (channel === 'voice:start') {
        return new Promise((resolve) => {
          resolveStart = resolve
        })
      }
      return Promise.resolve({ success: true, message: 'ok' })
    })

    let startPromise: Promise<void> | null = null
    await act(async () => {
      startPromise = voice().start()
      await vi.waitFor(() => expect(resolveStart).toBeTypeOf('function'))
    })
    await act(async () => voice().stop())
    resolveStart({ success: true, message: 'ok', sessionId: 'voice-123-2' })
    await act(async () => startPromise)

    expect(voice().status).toBe('idle')
    expect(getUserMedia).toHaveBeenCalledTimes(1)
    expect(trackStop).toHaveBeenCalledTimes(1)
    expect(invoke).toHaveBeenCalledWith('voice:stop', { sessionId: 'voice-123-2' })
  })

  it('does not start recognition when no audio input device is available', async () => {
    enumerateDevices.mockResolvedValue([])

    await act(async () => voice().start())

    expect(voice().status).toBe('error')
    expect(voice().error).toBe('未检测到可用的麦克风，请连接或启用语音采集设备后重试。')
    expect(getUserMedia).not.toHaveBeenCalled()
    expect(invoke).not.toHaveBeenCalled()
  })

  it('reports system permission guidance before opening the microphone', async () => {
    invoke.mockImplementation(async (channel: string) => {
      if (channel === 'voice:request-microphone-permission') {
        return {
          granted: false,
          status: 'denied',
          message: '请在系统设置中允许麦克风访问。',
        }
      }
      return { success: true, message: 'ok', sessionId: 'voice-should-not-start' }
    })

    await act(async () => voice().start())

    expect(voice().status).toBe('idle')
    expect(voice().error).toBe('请在系统设置中允许麦克风访问。')
    expect(getUserMedia).not.toHaveBeenCalled()
    expect(invoke).not.toHaveBeenCalledWith('voice:start', expect.anything())
  })

  it('does not expose a raw AbortError when the worklet cannot load', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    addModule.mockRejectedValue(new DOMException('The user aborted a request.', 'AbortError'))

    await act(async () => voice().start())

    expect(voice().status).toBe('error')
    expect(voice().error).toBe('麦克风启动被系统中止。请确认设备已连接且未被其他应用占用后重试。')
    expect(voice().error).not.toContain('The user aborted')
    expect(invoke).not.toHaveBeenCalledWith('voice:start', expect.anything())
    expect(consoleError).toHaveBeenCalledWith(
      '[voice-input] 加载语音采集组件失败',
      expect.any(DOMException),
    )
    consoleError.mockRestore()
  })

  it('stops the session and reports when the active microphone disconnects', async () => {
    await act(async () => voice().start())
    expect(trackAddEventListener).toHaveBeenCalledWith('ended', expect.any(Function))
    const endedListener = trackAddEventListener.mock.calls.find(([type]) => type === 'ended')?.[1]
    expect(endedListener).toBeTypeOf('function')

    await act(async () => {
      ;(endedListener as () => void)()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(voice().status).toBe('idle')
    expect(voice().error).toBe('麦克风已断开或停止工作，请检查输入设备后重试。')
    expect(invoke).toHaveBeenCalledWith('voice:stop', { sessionId: 'voice-123-1' })
  })

  it('waits in refining state and forwards the offline refined replacement after stop', async () => {
    const onFinal = vi.fn()
    const onRefined = vi.fn()
    await act(async () => {
      root?.render(<Harness options={{ onFinal, onRefined }} />)
    })
    await act(async () => voice().start())
    expect(voice().status).toBe('recording')

    const onMock = (window.spark as unknown as { on: ReturnType<typeof vi.fn> }).on
    const handler = onMock.mock.calls.at(-1)?.[1] as (event: {
      sessionId: string
      type: string
      text?: string
    }) => void

    await act(async () => {
      handler({ sessionId: 'voice-123-1', type: 'final', text: '你好世界' })
    })
    expect(onFinal).toHaveBeenCalledWith('你好世界')

    invoke.mockImplementation(async (channel: string) => {
      if (channel === 'voice:stop') return { success: true, message: 'ok', refining: true }
      return { success: true, message: 'ok' }
    })

    await act(async () => voice().stop())
    expect(voice().status).toBe('refining')

    await act(async () => {
      handler({ sessionId: 'voice-123-1', type: 'refined', text: '你好，世界。' })
    })
    expect(onRefined).toHaveBeenCalledWith({ previous: '你好世界', text: '你好，世界。' })

    await act(async () => {
      handler({ sessionId: 'voice-123-1', type: 'session-stopped' })
    })
    expect(voice().status).toBe('idle')
    expect(offRecognition).toHaveBeenCalled()
  })

  it('finishes immediately when the main process reports no offline refining', async () => {
    invoke.mockImplementation(async (channel: string) => {
      if (channel === 'voice:request-microphone-permission') {
        return { granted: true, status: 'granted', message: null }
      }
      if (channel === 'voice:start') {
        return { success: true, message: 'ok', sessionId: 'voice-123-1' }
      }
      if (channel === 'voice:stop') return { success: true, message: 'ok', refining: false }
      return { success: true, message: 'ok' }
    })

    await act(async () => voice().start())
    await act(async () => voice().stop())

    expect(voice().status).toBe('idle')
    expect(offRecognition).toHaveBeenCalled()
  })
})
