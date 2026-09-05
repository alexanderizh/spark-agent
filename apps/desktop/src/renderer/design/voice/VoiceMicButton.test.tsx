import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { VoiceMicButton } from './VoiceMicButton'
import type { VoiceAudioLevelStore } from './voiceAudioLevel'
import {
  VOICE_DOWNLOAD_CONFIRM_OPTIONS,
  confirmVoicePackDownload,
} from './voiceDownloadConfirmation'

describe('VoiceMicButton', () => {
  it('stays disabled while integrity checking prevents a false download prompt', () => {
    const html = renderToStaticMarkup(
      <VoiceMicButton
        status="idle"
        ready={false}
        checking
        downloading={false}
        unsupported={false}
        onClick={vi.fn()}
      />,
    )

    expect(html).toContain('disabled=""')
    expect(html).toContain('正在检查语音包')
  })

  it('describes the one-time package download before confirmation', () => {
    expect(VOICE_DOWNLOAD_CONFIRM_OPTIONS.title).toBe('下载语音包？')
    expect(VOICE_DOWNLOAD_CONFIRM_OPTIONS.description).toContain('一次性下载约 380 MB')
    expect(VOICE_DOWNLOAD_CONFIRM_OPTIONS.description).toContain('含离线精修模型')
    expect(VOICE_DOWNLOAD_CONFIRM_OPTIONS.description).toContain('后续无需重复下载')
  })

  it('keeps the pending state as a plain microphone without a download badge', () => {
    const html = renderToStaticMarkup(
      <VoiceMicButton
        status="idle"
        ready={false}
        checking={false}
        downloading={false}
        unsupported={false}
        onClick={vi.fn()}
      />,
    )

    expect(html).toContain('首次使用需下载语音包')
    expect(html).not.toContain('lucide-download')
    expect(html).toContain('aria-keyshortcuts="Control+Shift+D"')
    expect(html).toContain('composer-voice-shortcut-hint')
    expect(html).toContain('快捷键')
  })

  it('shows startup feedback and a compact live recording track', () => {
    const starting = renderToStaticMarkup(
      <VoiceMicButton
        status="starting"
        ready
        checking={false}
        downloading={false}
        unsupported={false}
        onClick={vi.fn()}
      />,
    )
    const recording = renderToStaticMarkup(
      <VoiceMicButton
        status="recording"
        audioLevelStore={staticLevelStore([0, 0.2, 0.55, 0.9])}
        ready
        checking={false}
        downloading={false}
        unsupported={false}
        onClick={vi.fn()}
      />,
    )

    expect(starting).toContain('启动中')
    expect(starting).toContain('is-starting')
    expect(recording).toContain('录入中')
    expect(recording).toContain('composer-voice-track')
    expect(recording).toContain('composer-voice-timer')
    expect(recording).toContain('composer-voice-stop')
    expect(recording).toContain('0:00')
  })

  it('starts downloading only after the user confirms', async () => {
    const install = vi.fn().mockResolvedValue({})

    expect(await confirmVoicePackDownload(vi.fn().mockResolvedValue(false), install)).toBe(false)
    expect(install).not.toHaveBeenCalled()

    expect(await confirmVoicePackDownload(vi.fn().mockResolvedValue(true), install)).toBe(true)
    expect(install).toHaveBeenCalledWith(false)
  })
})

function staticLevelStore(snapshot: readonly number[]): VoiceAudioLevelStore {
  return {
    getSnapshot: () => snapshot,
    subscribe: () => () => {},
  }
}
