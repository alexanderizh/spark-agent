/**
 * recognitionBridge — VoiceRecognitionService 内部会话事件的语音助手桥
 *
 * VoiceRecognitionService 只有一个全局事件分发器（setVoiceEventEmitter，
 * 由 registerVoiceIpc 安装）。语音助手的「内部会话」（ownerId =
 * VOICE_ASSISTANT_INTERNAL_OWNER_ID）识别结果不应推 webContents，而是回调给
 * VoiceAssistantService。本模块提供注册点，避免 registerVoiceIpc 与
 * VoiceAssistantService 相互 import 形成环。
 */

import type { VoiceRecognitionEvent } from '@spark/protocol'

let handler: ((event: VoiceRecognitionEvent) => void) | null = null

export function setVoiceAssistantRecognitionHandler(fn: ((event: VoiceRecognitionEvent) => void) | null): void {
  handler = fn
}

/** registerVoiceIpc 的事件分发器按 ownerId 路由时调用 */
export function routeVoiceAssistantRecognitionEvent(event: VoiceRecognitionEvent): void {
  try {
    handler?.(event)
  } catch {
    // 桥接回调异常不影响识别主流程
  }
}
