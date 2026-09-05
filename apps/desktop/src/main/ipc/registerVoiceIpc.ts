import { ipcMain, webContents } from 'electron'
import { pushStreamEvent, typedIpcHandle } from './typed-ipc.js'
import { checkVoiceIntegrity, installVoicePack } from '../services/VoiceIntegrityService.js'
import {
  feedVoiceAudio,
  setVoiceEventEmitter,
  startVoiceSession,
  stopVoiceSession,
  resetVoiceEngineCache,
} from '../services/VoiceRecognitionService.js'
import { requestVoiceMicrophonePermission } from '../services/VoiceCapturePermissionService.js'
import { VOICE_AUDIO_CHUNK_CHANNEL, isVoiceAudioChunkPayload } from '@spark/protocol/voice'

let emitterInstalled = false

export function registerVoiceIpc(): void {
  // 识别事件 -> 渲染进程流式推送（仅安装一次）
  if (!emitterInstalled) {
    setVoiceEventEmitter((event, ownerId) => {
      const target = webContents.fromId(ownerId)
      if (target && !target.isDestroyed()) {
        target.send('stream:voice:recognition', event)
      }
    })
    emitterInstalled = true
  }

  // 音频 chunk 流：渲染进程 fire-and-forget 推送，不走 invoke/response（高频）
  ipcMain.removeAllListeners(VOICE_AUDIO_CHUNK_CHANNEL)
  ipcMain.on(VOICE_AUDIO_CHUNK_CHANNEL, (event, payload: unknown) => {
    if (!isVoiceAudioChunkPayload(payload)) return
    feedVoiceAudio(payload.sessionId, payload.samples, event.sender.id)
  })

  typedIpcHandle('voice:check-integrity', async (request) => {
    const status = await checkVoiceIntegrity(request.checkLatest ?? false)
    return { status }
  })

  typedIpcHandle('voice:install', async (request) => {
    const result = await installVoicePack(request.force ?? false, (progress) => {
      pushStreamEvent('stream:voice:install-progress', progress)
    })
    if (result.success) resetVoiceEngineCache()
    // 安装结束（成功或失败）推送最新状态，让设置页 / 首次使用弹窗刷新
    pushStreamEvent('stream:voice:status', result.status)
    return { success: result.success, message: result.message, status: result.status }
  })

  typedIpcHandle('voice:request-microphone-permission', async () => {
    return requestVoiceMicrophonePermission()
  })

  typedIpcHandle('voice:start', async (request, event) => {
    const handle = startVoiceSession(request, event.sender.id)
    return {
      success: handle.success,
      message: handle.success ? '语音识别已启动' : (handle.error ?? '语音识别启动失败'),
      sessionId: handle.sessionId,
    }
  })

  typedIpcHandle('voice:stop', async (request, event) => {
    // 用户主动停止：流式收尾后尝试离线精修（模型未安装时自动回退纯流式）
    const refining = stopVoiceSession(request.sessionId, event.sender.id, 'refine')
    return {
      success: true,
      message: refining ? '正在优化识别结果' : '语音识别已停止',
      refining,
    }
  })
}
