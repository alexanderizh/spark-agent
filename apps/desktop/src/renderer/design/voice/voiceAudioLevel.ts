const WAVEFORM_SAMPLE_COUNT = 18
const SILENT_WAVEFORM = Object.freeze([]) as readonly number[]

export interface VoiceAudioLevelStore {
  getSnapshot: () => readonly number[]
  subscribe: (listener: () => void) => () => void
}

export interface MutableVoiceAudioLevelStore extends VoiceAudioLevelStore {
  push: (level: number) => void
  reset: () => void
}

/**
 * AudioWorklet 的音量更新保持在独立 store 中，避免 10Hz 电平采样让整个 Composer 重渲染。
 * VoiceMicButton 通过 useSyncExternalStore 仅刷新自己的小型波形区域。
 */
export function createVoiceAudioLevelStore(): MutableVoiceAudioLevelStore {
  let snapshot = SILENT_WAVEFORM
  const listeners = new Set<() => void>()

  const publish = (next: readonly number[]): void => {
    snapshot = next
    for (const listener of listeners) listener()
  }

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    push: (level) => {
      const normalized = Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 0
      const previous = snapshot.at(-1) ?? 0
      // 轻微 release 平滑，避免相邻 100ms 采样跳变得过于生硬。
      const eased = Math.max(normalized, previous * 0.58)
      publish([...snapshot.slice(-(WAVEFORM_SAMPLE_COUNT - 1)), eased])
    },
    reset: () => {
      if (snapshot === SILENT_WAVEFORM) return
      publish(SILENT_WAVEFORM)
    },
  }
}

export const EMPTY_VOICE_WAVEFORM = SILENT_WAVEFORM
