/**
 * voice-assistant 协议设置解析测试
 *
 * 重点：噪音管线字段（browserDenoise / voiceFocus / noisePipelineMigrated）的
 * 旧数据兼容、脏数据收敛与 v1→v2 一次性迁移（v1 默认降噪+门控实测伤识别率，
 * v2 起识别率优先默认关闭，未迁移的 v1 默认组合自动回退）；识别精修
 * （refineTranscript，v1 无 UI 死字段默认 false）的一次性翻回默认开。
 */

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_VOICE_ASSISTANT_SETTINGS,
  normalizeVoiceAssistantSettings,
} from './voice-assistant'

describe('normalizeVoiceAssistantSettings', () => {
  it('空输入收敛为默认值（噪音管线识别率优先 + 迁移标记就位）', () => {
    const normalized = normalizeVoiceAssistantSettings({})
    expect(normalized).toEqual({
      ...DEFAULT_VOICE_ASSISTANT_SETTINGS,
      noisePipelineMigrated: true,
      refineTranscriptMigrated: true,
    })
    expect(normalized.browserDenoise).toBe(false)
    expect(normalized.voiceFocus).toBe('off')
    expect(normalized.refineTranscript).toBe(true)
    expect(normalized.sessionThinkingEnabled).toBe(true)
    expect(normalized.sessionThinkingEffort).toBe('minimal')
  })

  it('语音会话思考：缺省开 + minimal；旧版轻量思考布尔一次性迁移；档位白名单', () => {
    // 缺省：开 + minimal（与旧版轻量思考默认行为一致）
    expect(normalizeVoiceAssistantSettings({}).sessionThinkingEnabled).toBe(true)
    expect(normalizeVoiceAssistantSettings({}).sessionThinkingEffort).toBe('minimal')
    // 旧版显式关闭轻量思考（= 想跟随 Agent 档位）→ 迁移为思考开关关闭
    expect(
      normalizeVoiceAssistantSettings({ lightweightThinking: false }).sessionThinkingEnabled,
    ).toBe(false)
    // 旧版开启/非布尔脏数据 → 保持新默认（开）
    expect(
      normalizeVoiceAssistantSettings({ lightweightThinking: true }).sessionThinkingEnabled,
    ).toBe(true)
    expect(
      normalizeVoiceAssistantSettings({ lightweightThinking: 'off' }).sessionThinkingEnabled,
    ).toBe(true)
    // 新字段显式设置优先于旧字段迁移
    expect(
      normalizeVoiceAssistantSettings({
        sessionThinkingEnabled: false,
        lightweightThinking: true,
      }).sessionThinkingEnabled,
    ).toBe(false)
    // 档位白名单：非法值回落默认，合法档位透传
    expect(
      normalizeVoiceAssistantSettings({ sessionThinkingEffort: 'ultra' }).sessionThinkingEffort,
    ).toBe('minimal')
    expect(
      normalizeVoiceAssistantSettings({ sessionThinkingEffort: 'high' }).sessionThinkingEffort,
    ).toBe('high')
  })

  it('旧版本数据（缺新字段）回落默认值，既有字段保留', () => {
    const normalized = normalizeVoiceAssistantSettings({
      enabled: true,
      wakeShortcut: 'CommandOrControl+Shift+V',
      utteranceConfirmMs: 2000,
    })
    expect(normalized.wakeShortcut).toBe('CommandOrControl+Shift+V')
    expect(normalized.utteranceConfirmMs).toBe(2000)
    expect(normalized.browserDenoise).toBe(false)
    expect(normalized.voiceFocus).toBe('off')
  })

  it('云端识别渠道/模型：缺省回落 null（自动选路），合法值透传，脏数据收敛', () => {
    // 旧版本设置无 stt 字段：回落 null = 自动选第一个可用转写渠道 + 渠道默认模型
    expect(normalizeVoiceAssistantSettings({}).sttProviderProfileId).toBeNull()
    expect(normalizeVoiceAssistantSettings({}).sttModelId).toBeNull()
    // 合法值透传
    const explicit = normalizeVoiceAssistantSettings({
      sttProviderProfileId: 'provider-asr-1',
      sttModelId: 'whisper-large-v3',
    })
    expect(explicit.sttProviderProfileId).toBe('provider-asr-1')
    expect(explicit.sttModelId).toBe('whisper-large-v3')
    // 空串/非字符串脏数据收敛为 null
    expect(
      normalizeVoiceAssistantSettings({ sttProviderProfileId: '  ', sttModelId: 42 })
        .sttProviderProfileId,
    ).toBeNull()
    expect(
      normalizeVoiceAssistantSettings({ sttProviderProfileId: '  ', sttModelId: 42 }).sttModelId,
    ).toBeNull()
  })

  it('v1 存量默认组合（denoise+standard 且无标记）一次性迁移回新默认', () => {
    const normalized = normalizeVoiceAssistantSettings({
      browserDenoise: true,
      voiceFocus: 'standard',
    })
    expect(normalized.browserDenoise).toBe(false)
    expect(normalized.voiceFocus).toBe('off')
    expect(normalized.noisePipelineMigrated).toBe(true)
  })

  it('v1 存量但用户显式组合不回退（只置迁移标记）', () => {
    const onlyDenoise = normalizeVoiceAssistantSettings({
      browserDenoise: true,
      voiceFocus: 'off',
    })
    expect(onlyDenoise.browserDenoise).toBe(true)
    expect(onlyDenoise.voiceFocus).toBe('off')
    expect(onlyDenoise.noisePipelineMigrated).toBe(true)

    const withStrict = normalizeVoiceAssistantSettings({
      browserDenoise: true,
      voiceFocus: 'strict',
    })
    expect(withStrict.browserDenoise).toBe(true)
    expect(withStrict.voiceFocus).toBe('strict')
  })

  it('已迁移的显式开启不再被重置', () => {
    const normalized = normalizeVoiceAssistantSettings({
      browserDenoise: true,
      voiceFocus: 'standard',
      noisePipelineMigrated: true,
    })
    expect(normalized.browserDenoise).toBe(true)
    expect(normalized.voiceFocus).toBe('standard')
    expect(normalized.noisePipelineMigrated).toBe(true)
  })

  it('显式关闭/严格档位保留', () => {
    const normalized = normalizeVoiceAssistantSettings({
      browserDenoise: false,
      voiceFocus: 'strict',
    })
    expect(normalized.browserDenoise).toBe(false)
    expect(normalized.voiceFocus).toBe('strict')
  })

  it('识别精修：v1 死字段持久化的 false 一次性迁移回默认开', () => {
    // v1 时代 refineTranscript 是无 UI 的死字段（默认 false，整体保存时被持久化），
    // 存量 false 不是用户显式选择 → 首次经过 normalize 统一翻回开
    const migrated = normalizeVoiceAssistantSettings({ refineTranscript: false })
    expect(migrated.refineTranscript).toBe(true)
    expect(migrated.refineTranscriptMigrated).toBe(true)
  })

  it('识别精修：已迁移后用户显式关闭被尊重，不再重置', () => {
    const respected = normalizeVoiceAssistantSettings({
      refineTranscript: false,
      refineTranscriptMigrated: true,
    })
    expect(respected.refineTranscript).toBe(false)
    expect(respected.refineTranscriptMigrated).toBe(true)
  })

  it('识别精修：存量 true 只置标记不改值', () => {
    const kept = normalizeVoiceAssistantSettings({ refineTranscript: true })
    expect(kept.refineTranscript).toBe(true)
    expect(kept.refineTranscriptMigrated).toBe(true)
  })

  it('非法 voiceFocus 收敛为 off（新默认）', () => {
    const normalized = normalizeVoiceAssistantSettings({ voiceFocus: 'ultra' })
    expect(normalized.voiceFocus).toBe('off')
  })

  it('非布尔 browserDenoise（脏数据）收敛为默认 false', () => {
    const normalized = normalizeVoiceAssistantSettings({ browserDenoise: 'yes' })
    expect(normalized.browserDenoise).toBe(false)
  })

  it('出字模式：缺省/旧持久化无字段走默认 sentence（句级精修出字）', () => {
    expect(normalizeVoiceAssistantSettings({}).transcriptMode).toBe('sentence')
    // 旧版本持久化（v1/v2 均无该字段）整体送入 normalize：缺字段回落默认
    const legacy = normalizeVoiceAssistantSettings({
      enabled: true,
      wakeShortcut: 'Alt+Space',
      refineTranscript: true,
    })
    expect(legacy.transcriptMode).toBe('sentence')
  })

  it('出字模式：显式 streaming 透传，非法值收敛为 sentence', () => {
    expect(normalizeVoiceAssistantSettings({ transcriptMode: 'streaming' }).transcriptMode).toBe(
      'streaming',
    )
    expect(normalizeVoiceAssistantSettings({ transcriptMode: 'hybrid' }).transcriptMode).toBe(
      'sentence',
    )
    expect(normalizeVoiceAssistantSettings({ transcriptMode: 42 }).transcriptMode).toBe('sentence')
  })
})
