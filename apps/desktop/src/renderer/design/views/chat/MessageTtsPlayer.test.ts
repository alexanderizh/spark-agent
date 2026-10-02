// @vitest-environment jsdom

/**
 * MessageTtsPlayer 单测（mock IPC / fetch / AudioContext）
 *
 * 覆盖：整段正文切句逐句合成、播完自动归位 off、同条再点即停、切换消息打断
 * 旧播报（不再为旧消息合成后续句）、stopIfActive 只停活跃消息、无正文不触发合成。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getMessageTtsPlayer } from './MessageTtsPlayer'

class FakeBufferSource {
  buffer: unknown = null
  onended: (() => void) | null = null
  started = false
  finished = false
  connect = vi.fn()
  start = vi.fn(() => {
    this.started = true
  })
  stop = vi.fn(() => {
    // 模拟浏览器行为：stop() 之后异步触发 onended（播打断路径依赖它落定挂起 Promise）
    queueMicrotask(() => this.fireEnded())
  })
  fireEnded(): void {
    if (this.finished) return
    this.finished = true
    const handler = this.onended
    this.onended = null
    handler?.()
  }
}

class FakeAudioContext {
  state: AudioContextState = 'running'
  createdSources: FakeBufferSource[] = []
  decodeAudioData = vi.fn(async () => ({ duration: 0.5 }) as unknown as AudioBuffer)
  resume = vi.fn(async () => undefined)
  createBufferSource(): FakeBufferSource {
    const source = new FakeBufferSource()
    this.createdSources.push(source)
    return source
  }
  /** 最近一个已启动且未播完的 source（当前在播的一句） */
  get playing(): FakeBufferSource | null {
    return [...this.createdSources].reverse().find((s) => s.started && !s.finished) ?? null
  }
  /** 测试驱动：手动结束当前在播的一句 */
  finishCurrent(): void {
    this.playing?.fireEnded()
  }
}

/**
 * player 是模块级单例且 ensureContext 只构造一次 AudioContext：用工厂捕获
 * 真正被 player 持有的实例，测试断言一律走 activeContext。
 */
let activeContext: FakeAudioContext
const synthesizeMock = vi.hoisted(() => vi.fn())
const cleanupMock = vi.hoisted(() => vi.fn(async (_request?: unknown) => ({ ok: true })))
const fetchMock = vi.hoisted(() => vi.fn())

;(window as unknown as { spark: unknown }).spark = {
  invoke: (channel: string, request?: unknown) => {
    if (channel === 'voice-assistant:tts-synthesize') return synthesizeMock(request)
    if (channel === 'voice-assistant:tts-cleanup') return cleanupMock(request)
    throw new Error(`unexpected channel: ${channel}`)
  },
}
window.AudioContext = class {
  constructor() {
    activeContext = new FakeAudioContext()
    return activeContext
  }
} as unknown as typeof AudioContext
vi.stubGlobal('fetch', fetchMock)

describe('MessageTtsPlayer', () => {
  let player: ReturnType<typeof getMessageTtsPlayer>

  beforeEach(() => {
    vi.clearAllMocks()
    fetchMock.mockImplementation(async () => ({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(8),
    }))
    synthesizeMock.mockImplementation(async (request?: { text?: string }) => ({
      filePath: `/virtual/tts/${encodeURIComponent(request?.text ?? 'x')}.wav`,
      cached: false,
    }))
    cleanupMock.mockResolvedValue({ ok: true })
    player = getMessageTtsPlayer()
    player.stop()
  })

  afterEach(() => {
    player.stop()
  })

  it('整段正文切句逐句合成、顺序播放、播完自动归位 off', async () => {
    player.toggle('m1', '第一句。第二句。')
    expect(player.getStatusFor('m1')).toBe('loading')

    await vi.waitFor(() => expect(player.getStatusFor('m1')).toBe('playing'))
    expect(synthesizeMock).toHaveBeenNthCalledWith(1, { text: '第一句。' })

    // 第一句播完 → 立即合成第二句（边合边播）
    activeContext.finishCurrent()
    await vi.waitFor(() => {
      expect(synthesizeMock).toHaveBeenNthCalledWith(2, { text: '第二句。' })
    })

    // 全部播完 → 归位 off，两个产物文件都已清理
    activeContext.finishCurrent()
    await vi.waitFor(() => expect(player.getStatusFor('m1')).toBe('off'))
    expect(cleanupMock).toHaveBeenCalledWith({
      filePath: '/virtual/tts/%E7%AC%AC%E4%B8%80%E5%8F%A5%E3%80%82.wav',
    })
    expect(cleanupMock).toHaveBeenCalledWith({
      filePath: '/virtual/tts/%E7%AC%AC%E4%BA%8C%E5%8F%A5%E3%80%82.wav',
    })
    const started = activeContext.createdSources.filter((s) => s.started)
    expect(started).toHaveLength(2)
    expect(started[0]?.start).toHaveBeenCalledOnce()
    expect(started[1]?.start).toHaveBeenCalledOnce()
  })

  it('播报中再点同一条即停止：source 被 stop、状态归位 off', async () => {
    player.toggle('m1', '第一句。第二句。')
    await vi.waitFor(() => expect(player.getStatusFor('m1')).toBe('playing'))
    const playingSource = activeContext.playing
    expect(playingSource).not.toBeNull()

    player.toggle('m1', '第一句。第二句。')
    expect(player.getStatusFor('m1')).toBe('off')
    expect(playingSource?.stop).toHaveBeenCalledOnce()
  })

  it('切换消息播报：旧消息不再合成后续句，新消息接管', async () => {
    player.toggle('m1', '第一句。第二句。')
    await vi.waitFor(() => expect(player.getStatusFor('m1')).toBe('playing'))

    player.toggle('m2', '另一条。')
    expect(player.getStatusFor('m1')).toBe('off')
    await vi.waitFor(() => expect(player.getStatusFor('m2')).toBe('playing'))

    // m1 的第二句永远不会被合成
    const synthesizedTexts = synthesizeMock.mock.calls.map(
      (call) => (call[0] as { text: string }).text,
    )
    expect(synthesizedTexts).toEqual(['第一句。', '另一条。'])
  })

  it('stopIfActive：只停正在播报的消息，不动其他状态', async () => {
    player.toggle('m1', '第一句。第二句。')
    await vi.waitFor(() => expect(player.getStatusFor('m1')).toBe('playing'))

    player.stopIfActive('m2')
    expect(player.getStatusFor('m1')).toBe('playing')

    player.stopIfActive('m1')
    expect(player.getStatusFor('m1')).toBe('off')
  })

  it('无有效正文（纯标点）不触发合成，保持 off', async () => {
    player.toggle('m1', '！！！？？？')
    await vi.waitFor(() => expect(player.getStatusFor('m1')).toBe('off'))
    expect(synthesizeMock).not.toHaveBeenCalled()
  })

  it('缓存命中（cached=true）：播完不 cleanup，文件留给主进程 LRU', async () => {
    synthesizeMock.mockResolvedValue({
      filePath: '/virtual/cache/hit.wav',
      cached: true,
    })
    player.toggle('m1', '缓存句子。')
    await vi.waitFor(() => expect(player.getStatusFor('m1')).toBe('playing'))

    activeContext.finishCurrent()
    await vi.waitFor(() => expect(player.getStatusFor('m1')).toBe('off'))
    expect(cleanupMock).not.toHaveBeenCalled()
  })

  it('缓存命中被打断：stop 补删不波及缓存文件', async () => {
    synthesizeMock.mockResolvedValue({
      filePath: '/virtual/cache/hit.wav',
      cached: true,
    })
    player.toggle('m1', '缓存句子。')
    await vi.waitFor(() => expect(player.getStatusFor('m1')).toBe('playing'))

    player.stop()
    expect(player.getStatusFor('m1')).toBe('off')
    expect(cleanupMock).not.toHaveBeenCalled()
  })

  it('混合缓存：只清理新合成产物，缓存文件原样保留', async () => {
    synthesizeMock
      .mockResolvedValueOnce({ filePath: '/virtual/tts/fresh.wav', cached: false })
      .mockResolvedValueOnce({ filePath: '/virtual/cache/hit.wav', cached: true })
    player.toggle('m1', '新合成句。缓存句。')

    await vi.waitFor(() => expect(player.getStatusFor('m1')).toBe('playing'))
    activeContext.finishCurrent()
    await vi.waitFor(() => expect(synthesizeMock).toHaveBeenCalledTimes(2))
    activeContext.finishCurrent()
    await vi.waitFor(() => expect(player.getStatusFor('m1')).toBe('off'))

    expect(cleanupMock).toHaveBeenCalledTimes(1)
    expect(cleanupMock).toHaveBeenCalledWith({ filePath: '/virtual/tts/fresh.wav' })
  })
})
