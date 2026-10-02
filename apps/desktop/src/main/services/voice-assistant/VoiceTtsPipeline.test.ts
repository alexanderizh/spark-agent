/**
 * VoiceTtsPipeline 单元测试
 *
 * 聚焦整轮 TTS 合成失败的用户提示链路：
 * 1. classifyTtsFailureReason 三类「无渠道」特征串归类 + 其他错误归 other
 * 2. buildTtsFailureNoticeMessage 两分支文案（引导去设置 vs 错误要点摘要）
 * 3. 整轮全失败（成功 0 句）→ onAllPlayed 后触发一次 onTurnSynthesisFailed
 * 4. 部分成功（≥1 句成功）→ 只回 onAllPlayed，不触发失败提示
 * 5. 相同原因 5 分钟节流；跨过窗口或原因变化后恢复提示
 * 6. beginTurn 重置轮内失败/成功计数：上一轮部分成功不吞掉下一轮的整轮失败
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { VoiceAssistantPlayCommand } from '@spark/protocol'

vi.mock('node:fs/promises', () => ({
  unlink: vi.fn(async () => undefined),
}))

import {
  VoiceTtsPipeline,
  buildTtsFailureNoticeMessage,
  classifyTtsFailureReason,
} from './VoiceTtsPipeline.js'
import type { VoiceTtsPipelineDeps } from './VoiceTtsPipeline.js'

function createDeps(overrides: Partial<VoiceTtsPipelineDeps> = {}): VoiceTtsPipelineDeps & {
  synthesize: ReturnType<typeof vi.fn>
  sendPlay: ReturnType<typeof vi.fn>
  onAllPlayed: ReturnType<typeof vi.fn>
  shouldPlayCues: ReturnType<typeof vi.fn>
  onTurnSynthesisFailed: ReturnType<typeof vi.fn>
} {
  return {
    synthesize: vi.fn(async () => ({ filePath: '/virtual/va-tts/seg.mp3' })),
    sendPlay: vi.fn(),
    onAllPlayed: vi.fn(),
    shouldPlayCues: vi.fn(() => false),
    onTurnSynthesisFailed: vi.fn(),
    ...overrides,
  } as never
}

/** 等待串行合成队列排空（全链 microtask，flush 若干轮即可） */
async function flushSynthesisQueue(): Promise<void> {
  for (let i = 0; i < 8; i += 1) {
    await Promise.resolve()
  }
}

/** 从 sendPlay 记录里取第一个 play 指令的 sentenceId */
function firstPlaySentenceId(deps: ReturnType<typeof createDeps>): string {
  const play = deps.sendPlay.mock.calls
    .map((call) => call[0] as VoiceAssistantPlayCommand)
    .find((command) => command.kind === 'play')
  expect(play, 'expected at least one play command').toBeDefined()
  return (play as Extract<VoiceAssistantPlayCommand, { kind: 'play' }>).sentenceId
}

describe('classifyTtsFailureReason', () => {
  it('media-router 无候选渠道特征串归为 no-channel', () => {
    expect(classifyTtsFailureReason('No provider supports capability audio.speech')).toBe(
      'no-channel',
    )
  })

  it('渠道列表为空的特征串归为 no-channel', () => {
    expect(classifyTtsFailureReason('未配置支持语音合成的多媒体渠道')).toBe('no-channel')
  })

  it('适配器能力不匹配特征串归为 no-channel', () => {
    expect(
      classifyTtsFailureReason('request failed: capability_not_supported (audio.speech)'),
    ).toBe('no-channel')
  })

  it('其余运行错误归为 other', () => {
    expect(classifyTtsFailureReason('connect ETIMEDOUT 1.2.3.4:443')).toBe('other')
    expect(classifyTtsFailureReason('tts synthesis timed out after 30000ms')).toBe('other')
  })
})

describe('buildTtsFailureNoticeMessage', () => {
  it('no-channel 给出去设置的配置引导文案', () => {
    const message = buildTtsFailureNoticeMessage('no-channel', '任意错误细节')
    expect(message).toBe(
      '本轮语音播报失败：没有可用的语音合成渠道，请在 设置 → 语音助手 中配置播报渠道或模型。',
    )
  })

  it('other 展示压缩后的错误要点', () => {
    expect(buildTtsFailureNoticeMessage('other', 'a   b\nc')).toBe('本轮语音播报失败：a b c')
  })

  it('other 超长错误截断到 80 字符并加省略号', () => {
    const long = 'x'.repeat(120)
    const message = buildTtsFailureNoticeMessage('other', long)
    expect(message).toBe(`本轮语音播报失败：${'x'.repeat(80)}…`)
  })
})

describe('VoiceTtsPipeline 整轮合成失败提示', () => {
  beforeEach(() => {
    vi.useRealTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('整轮全部句子合成失败：onAllPlayed 之后触发一次 onTurnSynthesisFailed', async () => {
    const deps = createDeps({
      synthesize: vi.fn(async () => {
        throw new Error('No provider supports capability audio.speech')
      }),
    })
    const pipeline = new VoiceTtsPipeline(deps)

    pipeline.beginTurn()
    pipeline.finalize('这是第一句播报内容。这是第二句播报内容。')
    await flushSynthesisQueue()

    expect(deps.onAllPlayed).toHaveBeenCalledTimes(1)
    expect(deps.onTurnSynthesisFailed).toHaveBeenCalledTimes(1)
    // onAllPlayed 之后才通知（状态机已回 idle/standby，可安全做同态 error 广播）
    const allPlayedOrder = deps.onAllPlayed.mock.invocationCallOrder[0] as number
    const noticeOrder = deps.onTurnSynthesisFailed.mock.invocationCallOrder[0] as number
    expect(allPlayedOrder).toBeLessThan(noticeOrder)
    // no-channel 原因 → 引导文案
    expect(deps.onTurnSynthesisFailed).toHaveBeenCalledWith(
      '本轮语音播报失败：没有可用的语音合成渠道，请在 设置 → 语音助手 中配置播报渠道或模型。',
    )
  })

  it('部分成功（≥1 句合成成功）：不触发 onTurnSynthesisFailed', async () => {
    let call = 0
    const deps = createDeps({
      synthesize: vi.fn(async () => {
        call += 1
        if (call === 1) return { filePath: '/virtual/va-tts/ok.mp3' }
        throw new Error('connect ETIMEDOUT')
      }),
    })
    const pipeline = new VoiceTtsPipeline(deps)

    pipeline.beginTurn()
    pipeline.finalize('这是第一句播报内容。这是第二句播报内容。')
    await flushSynthesisQueue()

    // 第一句成功并入播放队列；模拟渲染端播完
    pipeline.onPlaybackEnded(firstPlaySentenceId(deps))
    await flushSynthesisQueue()

    expect(deps.onAllPlayed).toHaveBeenCalledTimes(1)
    expect(deps.onTurnSynthesisFailed).not.toHaveBeenCalled()
  })

  it('相同原因 5 分钟内重复整轮失败被节流，跨窗口后恢复提示', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-02T10:00:00Z'))
    const deps = createDeps({
      synthesize: vi.fn(async () => {
        throw new Error('No provider supports capability audio.speech')
      }),
    })
    const pipeline = new VoiceTtsPipeline(deps)

    // 第 1 轮：全失败 → 提示一次
    pipeline.beginTurn()
    pipeline.finalize('这是第一句播报内容。')
    await vi.runAllTimersAsync()
    expect(deps.onTurnSynthesisFailed).toHaveBeenCalledTimes(1)

    // 第 2 轮（+1 分钟）：同原因 → 节流吞掉
    vi.setSystemTime(new Date('2026-10-02T10:01:00Z'))
    pipeline.beginTurn()
    pipeline.finalize('这是第二句播报内容。')
    await vi.runAllTimersAsync()
    expect(deps.onTurnSynthesisFailed).toHaveBeenCalledTimes(1)

    // 第 3 轮（+6 分钟）：跨过节流窗口 → 恢复提示
    vi.setSystemTime(new Date('2026-10-02T10:06:00Z'))
    pipeline.beginTurn()
    pipeline.finalize('这是第三句播报内容。')
    await vi.runAllTimersAsync()
    expect(deps.onTurnSynthesisFailed).toHaveBeenCalledTimes(2)
  })

  it('原因变化不受节流影响：other 失败后紧跟 no-channel 失败仍提示', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-02T10:00:00Z'))
    const deps = createDeps({
      synthesize: vi.fn(async () => {
        throw new Error('connect ETIMEDOUT')
      }),
    })
    const pipeline = new VoiceTtsPipeline(deps)

    pipeline.beginTurn()
    pipeline.finalize('这是第一句播报内容。')
    await vi.runAllTimersAsync()
    expect(deps.onTurnSynthesisFailed).toHaveBeenCalledWith('本轮语音播报失败：connect ETIMEDOUT')

    // +1 分钟，换成 no-channel 原因：不同原因不节流
    vi.setSystemTime(new Date('2026-10-02T10:01:00Z'))
    deps.synthesize.mockImplementation(async () => {
      throw new Error('No provider supports capability audio.speech')
    })
    pipeline.beginTurn()
    pipeline.finalize('这是第二句播报内容。')
    await vi.runAllTimersAsync()
    expect(deps.onTurnSynthesisFailed).toHaveBeenCalledTimes(2)
  })

  it('beginTurn 重置轮内计数：上一轮部分成功不吞掉下一轮整轮失败', async () => {
    let call = 0
    const deps = createDeps({
      synthesize: vi.fn(async () => {
        call += 1
        if (call === 1) return { filePath: '/virtual/va-tts/ok.mp3' }
        throw new Error('connect ETIMEDOUT')
      }),
    })
    const pipeline = new VoiceTtsPipeline(deps)

    // 第 1 轮：一成功一失败（部分成功）→ 不提示
    pipeline.beginTurn()
    pipeline.finalize('这是第一句播报内容。这是第二句播报内容。')
    await flushSynthesisQueue()
    pipeline.onPlaybackEnded(firstPlaySentenceId(deps))
    await flushSynthesisQueue()
    expect(deps.onTurnSynthesisFailed).not.toHaveBeenCalled()

    // 第 2 轮：全失败 → 计数已重置，正常提示一次
    pipeline.beginTurn()
    pipeline.finalize('这是第三句播报内容。')
    await flushSynthesisQueue()
    expect(deps.onTurnSynthesisFailed).toHaveBeenCalledTimes(1)
    expect(deps.onTurnSynthesisFailed).toHaveBeenCalledWith('本轮语音播报失败：connect ETIMEDOUT')
  })
})
