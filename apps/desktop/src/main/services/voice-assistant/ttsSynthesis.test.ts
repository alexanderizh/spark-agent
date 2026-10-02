/**
 * ttsSynthesis 共享内核单测
 *
 * 覆盖：渠道自动选路（mediaRouter.supports 同源口径）、显式渠道/模型透传、
 * MiniMax 专有参数仅对 minimax-hailuo 下发、超长文本兜底限长、产物清理的
 * ttsDir 路径逃逸防护。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MediaProviderProfile, MediaRouterService } from '@spark/agent-runtime'
import { DEFAULT_VOICE_ASSISTANT_SETTINGS } from '@spark/protocol'

vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn(async () => undefined),
  unlink: vi.fn(async () => undefined),
}))

import { unlink } from 'node:fs/promises'
import {
  TTS_SYNTHESIS_MAX_TEXT_CHARS,
  removeTtsArtifactWithin,
  synthesizeSpeechText,
} from './ttsSynthesis.js'

const unlinkMock = vi.mocked(unlink)

function makeProvider(overrides: Partial<MediaProviderProfile> = {}): MediaProviderProfile {
  return {
    id: 'provider-a',
    name: '渠道 A',
    defaultModel: 'speech-1',
    mediaProvider: null,
    mediaApiType: null,
    mediaCapabilities: [],
    ...overrides,
  } as MediaProviderProfile
}

interface Harness {
  mediaRouter: {
    invoke: ReturnType<typeof vi.fn>
    supports: ReturnType<typeof vi.fn>
  }
}

function makeHarness(output: {
  filePath?: string
  provider?: string
  assets?: Array<{ filePath?: string }>
}): Harness {
  const mediaRouter = {
    invoke: vi.fn(async () => ({
      output: {
        provider: output.provider ?? 'provider-a',
        assets: output.assets ?? (output.filePath != null ? [{ filePath: output.filePath }] : []),
      },
    })),
    supports: vi.fn(
      (provider: MediaProviderProfile, capability: string) =>
        provider.id === 'provider-tts' && capability === 'audio.speech',
    ),
  }
  return { mediaRouter }
}

function makeTarget(
  harness: Harness,
  settingsOverrides: Partial<typeof DEFAULT_VOICE_ASSISTANT_SETTINGS> = {},
  providers?: MediaProviderProfile[],
) {
  return {
    settings: { ...DEFAULT_VOICE_ASSISTANT_SETTINGS, ...settingsOverrides },
    resolveMediaProviders: async () => providers ?? [makeProvider({ id: 'provider-tts' })],
    mediaRouter: harness.mediaRouter as unknown as MediaRouterService,
    outputDir: '/virtual/tts',
  }
}

beforeEach(() => {
  unlinkMock.mockClear()
  unlinkMock.mockImplementation(async () => undefined)
})

describe('synthesizeSpeechText', () => {
  it('自动选路：未显式指定渠道时用 mediaRouter.supports 命中的渠道（与 invoke 同源）', async () => {
    const harness = makeHarness({ filePath: '/virtual/tts/a.wav' })
    await synthesizeSpeechText(makeTarget(harness), '你好。')
    // supports 只命中 provider-tts；invoke 收到的 providers 列表包含该渠道
    expect(harness.mediaRouter.supports).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'provider-tts' }),
      'audio.speech',
    )
    const [request, options] = harness.mediaRouter.invoke.mock.calls[0] as [
      Record<string, unknown>,
      Record<string, unknown>,
    ]
    expect(request.operation).toBe('text_to_audio')
    expect(request.capability).toBe('audio.speech')
    expect(request.prompt).toBe('你好。')
    expect(options.providers).toHaveLength(1)
    // 未显式指定时不锁定渠道与模型
    expect(options.providerProfileId).toBeUndefined()
    expect(options.modelId).toBeUndefined()
  })

  it('显式渠道/模型：ttsProviderProfileId 与 ttsModelId 原样透传', async () => {
    const harness = makeHarness({ filePath: '/virtual/tts/a.wav' })
    await synthesizeSpeechText(
      makeTarget(harness, { ttsProviderProfileId: 'provider-x', ttsModelId: 'speech-9' }),
      '你好。',
    )
    const [, options] = harness.mediaRouter.invoke.mock.calls[0] as [
      Record<string, unknown>,
      Record<string, unknown>,
    ]
    expect(options.providerProfileId).toBe('provider-x')
    expect(options.modelId).toBe('speech-9')
  })

  it('音色：ttsVoice 非空才进入 modelParams；语速始终下发', async () => {
    const harness = makeHarness({ filePath: '/virtual/tts/a.wav' })
    await synthesizeSpeechText(makeTarget(harness, { ttsVoice: '' }), '你好。')
    const [request] = harness.mediaRouter.invoke.mock.calls[0] as [Record<string, unknown>, unknown]
    expect(request.modelParams).toEqual({ speed: 1.0 })

    await synthesizeSpeechText(makeTarget(harness, { ttsVoice: 'female-shaonv' }), '你好。')
    const [request2] = harness.mediaRouter.invoke.mock.calls[1] as [
      Record<string, unknown>,
      unknown,
    ]
    expect(request2.modelParams).toEqual({ speed: 1.0, voice: 'female-shaonv' })
  })

  it('MiniMax 专有参数仅对 minimax-hailuo 渠道下发', async () => {
    const minimax = makeHarness({ filePath: '/virtual/tts/a.wav' })
    await synthesizeSpeechText(
      makeTarget(
        minimax,
        { ttsVol: 2, ttsPitch: 3, ttsEmotion: 'happy', ttsProviderProfileId: 'provider-minimax' },
        [makeProvider({ id: 'provider-minimax', mediaProvider: 'minimax-hailuo' })],
      ),
      '你好。',
    )
    const [requestMinimax] = minimax.mediaRouter.invoke.mock.calls[0] as [
      Record<string, unknown>,
      unknown,
    ]
    expect(requestMinimax.modelParams).toEqual({
      speed: 1.0,
      vol: 2,
      pitch: 3,
      emotion: 'happy',
    })

    const other = makeHarness({ filePath: '/virtual/tts/a.wav' })
    await synthesizeSpeechText(
      makeTarget(
        other,
        { ttsVol: 2, ttsPitch: 3, ttsEmotion: 'happy', ttsProviderProfileId: 'provider-x' },
        [makeProvider({ id: 'provider-x' })],
      ),
      '你好。',
    )
    const [requestOther] = other.mediaRouter.invoke.mock.calls[0] as [
      Record<string, unknown>,
      unknown,
    ]
    expect(requestOther.modelParams).toEqual({ speed: 1.0 })
  })

  it('超长文本兜底限长到 TTS_SYNTHESIS_MAX_TEXT_CHARS', async () => {
    const harness = makeHarness({ filePath: '/virtual/tts/a.wav' })
    const long = '字'.repeat(TTS_SYNTHESIS_MAX_TEXT_CHARS + 500)
    await synthesizeSpeechText(makeTarget(harness), long)
    const [request] = harness.mediaRouter.invoke.mock.calls[0] as [Record<string, unknown>, unknown]
    expect((request.prompt as string).length).toBe(TTS_SYNTHESIS_MAX_TEXT_CHARS)
  })

  it('未配置渠道抛错；无文件产物抛错', async () => {
    const empty = makeHarness({ filePath: '/virtual/tts/a.wav' })
    await expect(synthesizeSpeechText(makeTarget(empty, {}, []), '你好。')).rejects.toThrow(
      '未配置支持语音合成的多媒体渠道',
    )

    const noAsset = makeHarness({ provider: 'provider-a', assets: [] })
    await expect(synthesizeSpeechText(makeTarget(noAsset), '你好。')).rejects.toThrow(
      'TTS 无文件产物',
    )
  })
})

describe('removeTtsArtifactWithin', () => {
  it('ttsDir 内的文件正常删除', async () => {
    const ok = await removeTtsArtifactWithin('/tmp/fake-tts', '/tmp/fake-tts/a.wav')
    expect(ok).toBe(true)
    expect(unlinkMock).toHaveBeenCalledWith('/tmp/fake-tts/a.wav')
  })

  it('ttsDir 外的路径拒绝删除（含 ../ 逃逸形态）', async () => {
    expect(await removeTtsArtifactWithin('/tmp/fake-tts', '/tmp/other/a.wav')).toBe(false)
    expect(await removeTtsArtifactWithin('/tmp/fake-tts', '/tmp/fake-tts/../a.wav')).toBe(false)
    expect(unlinkMock).not.toHaveBeenCalled()
  })

  it('空路径与 ttsDir 本身拒绝删除', async () => {
    expect(await removeTtsArtifactWithin('', '/tmp/fake-tts/a.wav')).toBe(false)
    expect(await removeTtsArtifactWithin('/tmp/fake-tts', '')).toBe(false)
    expect(await removeTtsArtifactWithin('/tmp/fake-tts', '/tmp/fake-tts')).toBe(false)
    expect(unlinkMock).not.toHaveBeenCalled()
  })

  it('文件已不存在（unlink 抛错）返回 false 不抛出', async () => {
    unlinkMock.mockImplementation(async () => {
      throw new Error('ENOENT')
    })
    const ok = await removeTtsArtifactWithin('/tmp/fake-tts', '/tmp/fake-tts/gone.wav')
    expect(ok).toBe(false)
  })
})
