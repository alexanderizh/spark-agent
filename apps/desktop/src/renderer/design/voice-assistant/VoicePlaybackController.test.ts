// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VoicePlaybackController } from './VoicePlaybackController.js'
import type { VoiceAssistantPlayCommand } from '@spark/protocol'

/**
 * VoicePlaybackController 播放顺序与停止代数守卫的聚焦测试。
 * WebAudio 以可控 mock 替代：decodeAudioData 的完成时机由测试逐句解锁。
 * play 到达序由主进程发送水位线保证有序（见 VoiceTtsPipeline.test），
 * 这里覆盖「到达有序、解码乱序完成」时渲染端的顺序保证。
 */

interface FakeSource {
  buffer: unknown
  onended: (() => void) | null
  connect: ReturnType<typeof vi.fn>
  start: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
}

function createFakeSource(): FakeSource {
  return {
    buffer: null,
    onended: null,
    connect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  }
}

/** 解码完成 resolver，按 play 到达序注册；测试自选顺序解锁（复现乱序完成） */
let decodeResolvers: Array<() => void> = []
const startedEvents: string[] = []
const rendererEvents: Array<Record<string, unknown>> = []
const audioSources: FakeSource[] = []

function installMocks(): void {
  decodeResolvers = []
  startedEvents.length = 0
  rendererEvents.length = 0
  audioSources.length = 0
  const context = {
    state: 'running',
    currentTime: 0,
    destination: { connect: vi.fn() },
    resume: vi.fn(() => Promise.resolve()),
    createGain: vi.fn(() => ({
      gain: {
        cancelScheduledValues: vi.fn(),
        setValueAtTime: vi.fn(),
        linearRampToValueAtTime: vi.fn(),
      },
      connect: vi.fn(),
    })),
    createAnalyser: vi.fn(() => ({ fftSize: 0, getByteTimeDomainData: vi.fn() })),
    createBufferSource: vi.fn(() => {
      const source = createFakeSource()
      audioSources.push(source)
      return source
    }),
    decodeAudioData: vi.fn(
      () =>
        new Promise((resolve) => {
          decodeResolvers.push(() => resolve({ duration: 1 }))
        }),
    ),
  }
  vi.stubGlobal(
    'AudioContext',
    vi.fn(() => context),
  )
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) })),
  )
  window.spark = {
    sendVoiceAssistantRendererEvent: vi.fn((event: Record<string, unknown>) => {
      rendererEvents.push(event)
      if (event.type === 'playback-started') startedEvents.push(event.sentenceId as string)
    }),
  } as unknown as typeof window.spark
}

async function flushMicrotasks(rounds = 6): Promise<void> {
  for (let i = 0; i < rounds; i += 1) await Promise.resolve()
}

function play(sequence: number): VoiceAssistantPlayCommand {
  return {
    kind: 'play',
    sentenceId: `s-${sequence}`,
    sequence,
    filePath: `/tmp/tts-${sequence}.mp3`,
  }
}

/** 解锁一个在途解码并等微任务收敛（index = play 到达序，非 sequence） */
async function resolveDecode(index: number): Promise<void> {
  decodeResolvers[index]?.()
  await flushMicrotasks()
}

describe('VoicePlaybackController 顺序与停止代数', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    installMocks()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    delete (window as { spark?: unknown }).spark
  })

  it('解码乱序完成时按 sequence 序开播（乱序合成不乱播，回归）', async () => {
    const controller = new VoicePlaybackController()
    // 两句按序到达（pipeline 水位线保证的到达序），解码完成序倒挂
    controller.handleCommand(play(1))
    controller.handleCommand(play(2))
    await flushMicrotasks()

    await resolveDecode(1) // seq2 先解码完成：队首等待 seq1
    expect(startedEvents).toEqual([])

    await resolveDecode(0) // seq1 完成：立即开播
    expect(startedEvents).toEqual(['s-1'])

    audioSources[0]?.onended?.() // seq1 播完 → seq2 接续
    await flushMicrotasks()
    expect(startedEvents).toEqual(['s-1', 's-2'])
  })

  it('低序句解码失败不阻塞队首：按 error 回传后放行高序句', async () => {
    const controller = new VoicePlaybackController()
    ;(window.fetch as ReturnType<typeof vi.fn>).mockImplementationOnce(
      vi.fn(async () => {
        throw new Error('io error')
      }),
    )
    controller.handleCommand(play(1)) // 这句 fetch 失败
    controller.handleCommand(play(2))
    await flushMicrotasks()
    await resolveDecode(0) // seq2 的解码（seq1 走的是 fetch 失败路径，未注册 resolver）
    expect(startedEvents).toEqual(['s-2'])
    expect(
      rendererEvents.find((e) => e.type === 'playback-error' && e.sentenceId === 's-1'),
    ).toBeDefined()
  })

  it('stop 清空在途集合：新轮 sequence 重排不被跨轮残留阻塞', async () => {
    const controller = new VoicePlaybackController()
    controller.handleCommand(play(3)) // 旧轮句进入解码
    await flushMicrotasks()
    controller.handleCommand({ kind: 'stop' }) // 硬停：清集合
    controller.handleCommand(play(1)) // 新轮低序句
    await flushMicrotasks()
    await resolveDecode(0) // 旧句解码完成：被停止代数拦截
    await resolveDecode(1) // 新句解码完成：正常开播
    expect(startedEvents).toEqual(['s-1'])
    expect(
      rendererEvents.find((e) => e.type === 'playback-error' && e.sentenceId === 's-3'),
    ).toBeDefined()
  })

  it('graceful 停止：未播队列逐条 playback-error 回传，当前句保留', async () => {
    const controller = new VoicePlaybackController()
    controller.handleCommand(play(1))
    await flushMicrotasks()
    await resolveDecode(0)
    expect(startedEvents).toEqual(['s-1'])
    controller.handleCommand(play(2))
    await flushMicrotasks()
    await resolveDecode(1) // seq2 已解码入队（未播）
    controller.handleCommand({ kind: 'stop', graceful: true })
    const dropped = rendererEvents.filter((e) => e.type === 'playback-error')
    expect(dropped.map((e) => e.sentenceId)).toEqual(['s-2'])
    expect(audioSources[0]?.stop).not.toHaveBeenCalled()
  })
})
