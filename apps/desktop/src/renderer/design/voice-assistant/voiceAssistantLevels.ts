/**
 * 语音助手 HUD 声波条的电平数据源（渲染进程单例）。
 *
 * 两个独立 store，按状态互斥消费（主进程状态机保证 listening 与 speaking 不同时）：
 * - capture：AssistantCaptureController 的 worklet chunk.level（聆听态，随说话音量起伏）
 * - playback：VoicePlaybackController 的 AnalyserNode 采样（播报态，随 TTS 音频脉动）
 *
 * 复用 createVoiceAudioLevelStore（滚动历史 + release 平滑）；HUD 声波条只取最后一个
 * 采样（当前电平），历史窗口留给未来可能的波形回放。与 Composer 语音输入的用法一致，
 * 10Hz 更新经 useSyncExternalStore 只刷新声波条自身，不波及 HUD 其余内容。
 */

import {
  createVoiceAudioLevelStore,
  type MutableVoiceAudioLevelStore,
  type VoiceAudioLevelStore,
} from '../voice/voiceAudioLevel'

let captureStore: MutableVoiceAudioLevelStore | null = null
let playbackStore: MutableVoiceAudioLevelStore | null = null

/** 采集控制器写入侧（push/reset） */
export function getAssistantCaptureLevelSink(): MutableVoiceAudioLevelStore {
  if (captureStore == null) captureStore = createVoiceAudioLevelStore()
  return captureStore
}

/** 播放控制器写入侧（push/reset） */
export function getAssistantPlaybackLevelSink(): MutableVoiceAudioLevelStore {
  if (playbackStore == null) playbackStore = createVoiceAudioLevelStore()
  return playbackStore
}

/** HUD 声波条读取侧（仅订阅） */
export function getAssistantCaptureLevelStore(): VoiceAudioLevelStore {
  return getAssistantCaptureLevelSink()
}

/** HUD 声波条读取侧（仅订阅） */
export function getAssistantPlaybackLevelStore(): VoiceAudioLevelStore {
  return getAssistantPlaybackLevelSink()
}
