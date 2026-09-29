/**
 * voice-assistant 协议设置解析测试
 *
 * 重点：新增字段（browserDenoise / voiceFocus）的旧数据兼容与脏数据收敛。
 */

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_VOICE_ASSISTANT_SETTINGS,
  normalizeVoiceAssistantSettings,
} from './voice-assistant'

describe('normalizeVoiceAssistantSettings', () => {
  it('空输入收敛为默认值（含新增噪音过滤字段）', () => {
    const normalized = normalizeVoiceAssistantSettings({})
    expect(normalized).toEqual(DEFAULT_VOICE_ASSISTANT_SETTINGS)
    expect(normalized.browserDenoise).toBe(true)
    expect(normalized.voiceFocus).toBe('standard')
  })

  it('旧版本数据（缺新字段）回落默认值，既有字段保留', () => {
    const normalized = normalizeVoiceAssistantSettings({
      enabled: true,
      wakeShortcut: 'CommandOrControl+Shift+V',
      utteranceConfirmMs: 2000,
    })
    expect(normalized.wakeShortcut).toBe('CommandOrControl+Shift+V')
    expect(normalized.utteranceConfirmMs).toBe(2000)
    expect(normalized.browserDenoise).toBe(true)
    expect(normalized.voiceFocus).toBe('standard')
  })

  it('显式关闭/严格档位保留', () => {
    const normalized = normalizeVoiceAssistantSettings({
      browserDenoise: false,
      voiceFocus: 'strict',
    })
    expect(normalized.browserDenoise).toBe(false)
    expect(normalized.voiceFocus).toBe('strict')
  })

  it('非法 voiceFocus 收敛为 standard', () => {
    const normalized = normalizeVoiceAssistantSettings({ voiceFocus: 'ultra' })
    expect(normalized.voiceFocus).toBe('standard')
  })

  it('非布尔 browserDenoise（脏数据）收敛为默认 true', () => {
    const normalized = normalizeVoiceAssistantSettings({ browserDenoise: 'yes' })
    expect(normalized.browserDenoise).toBe(true)
  })
})
