import { ipcMain } from 'electron'
import { pushStreamEvent, typedIpcHandle } from './typed-ipc.js'
import {
  checkVoiceIntegrity,
  installVoicePack,
} from '../services/VoiceIntegrityService.js'
import {
  feedVoiceAudio,
  setVoiceEventEmitter,
  startVoiceSession,
  stopVoiceSession,
} from '../services/VoiceRecognitionService.js'
import { VOICE_AUDIO_CHUNK_CHANNEL, type VoiceAudioChunkPayload } from '@spark/protocol'

let emitterInstalled = false

export function registerVoiceIpc(): void {
  // 识别事件 -> 渲染进程流式推送（仅安装一次）
  if (!emitterInstalled) {
    setVoiceEventEmitter((event) => {
      pushStreamEvent('stream:voice:recognition', event)
    })
    emitterInstalled = true
  }

  // 音频 chunk 流：渲染进程 fire-and-forget 推送，不走 invoke/response（高频）
  ipcMain.removeAllListeners(VOICE_AUDIO_CHUNK_CHANNEL)
  ipcMain.on(VOICE_AUDIO_CHUNK_CHANNEL, (_event, payload: unknown) => {
    if (!payload || typeof payload !== 'object') return
    const { sessionId, samples } = payload as Partial<VoiceAudioChunkPayload>
    if (!sessionId || typeof sessionId !== 'string') return
    if (!(samples instanceof Int16Array)) return
    feedVoiceAudio(sessionId, samples)
  })

  typedIpcHandle('voice:check-integrity', async (request) => {
    const status = await checkVoiceIntegrity(request.checkLatest ?? false)
    return { status }
  })

  typedIpcHandle('voice:install', async (request) => {
    const result = await installVoicePack(request.force ?? false, (progress) => {
      pushStreamEvent('stream:voice:install-progress', progress)
    })
    // 安装结束（成功或失败）推送最新状态，让设置页 / 首次使用弹窗刷新
    pushStreamEvent('stream:voice:status', result.status)
    return { success: result.success, message: result.message, status: result.status }
  })

  typedIpcHandle('voice:start', async (request) => {
    const handle = startVoiceSession(request)
    return {
      success: handle.success,
      message: handle.success ? '语音识别已启动' : '语音识别启动失败',
      sessionId: handle.sessionId,
    }
  })

  typedIpcHandle('voice:stop', async (request) => {
    stopVoiceSession(request.sessionId)
    return { success: true, message: '语音识别已停止' }
  })
}
