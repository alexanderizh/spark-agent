import { describe, expect, it } from 'vitest'
import type { CanvasMediaModelSummary } from '@spark/protocol'
import { channelSupportsAudioSpeech } from './voiceCatalogAvailability'

/** 只关心能力 id 的最小模型摘要；其余字段与本判定无关。 */
function model(manifestId: string, capabilityIds: string[]): CanvasMediaModelSummary {
  return {
    manifestId,
    providerKind: 'custom',
    modelId: manifestId,
    effectiveModelId: manifestId,
    displayName: manifestId,
    domains: ['audio'],
    invocationMode: 'sync',
    capabilities: capabilityIds.map((id) => ({
      id,
      label: id,
      input: { required: [] },
      output: { types: ['audio'] },
      paramSchema: {},
    })),
    sourceUrls: [],
    enabled: true,
  }
}

describe('channelSupportsAudioSpeech', () => {
  it('候选为空（新建渠道 / 目录未加载）时保留入口，不靠猜测隐藏', () => {
    expect(channelSupportsAudioSpeech([])).toBe(true)
  })

  it('声明了 audio.speech 才展示', () => {
    expect(channelSupportsAudioSpeech([model('minimax:speech-2.8-hd', ['audio.speech'])])).toBe(
      true,
    )
    // 语音播报渠道常见的「合成 + 识别」双能力，只要有一个是合成就算
    expect(
      channelSupportsAudioSpeech([
        model('minimax:asr-1.0', ['audio.transcription']),
        model('minimax:speech-2.8-hd', ['audio.speech']),
      ]),
    ).toBe(true)
  })

  it('纯 ASR / 音乐生成 / 视频渠道不展示（候选无处可落）', () => {
    expect(channelSupportsAudioSpeech([model('minimax:asr-1.0', ['audio.transcription'])])).toBe(
      false,
    )
    expect(channelSupportsAudioSpeech([model('seed-audio-1.0', ['audio.music'])])).toBe(false)
    expect(channelSupportsAudioSpeech([model('minimax:v2-h3', ['video.generate'])])).toBe(false)
  })
})
