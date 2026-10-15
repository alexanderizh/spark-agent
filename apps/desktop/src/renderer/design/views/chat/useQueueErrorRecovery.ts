import { useMemo, useState } from 'react'
import type { SessionId, SessionQueuePauseState } from '@spark/protocol'
import type { UIMessage } from '../../services/event-mapper'
import { useIpcInvoke } from '../../hooks/useIpc'
import type {
  ComposerAttachment,
  ComposerSessionReference,
  MessageAttachment,
  SessionRuntimePatch,
} from './ChatComposerTypes'
import { buildErrorContinuePayload, buildTurnRetryPayload } from './ChatErrorRetry'

type RetryDispatchPayload = {
  text: string
  attachments: ComposerAttachment[]
  sessionReferences: ComposerSessionReference[]
}

type QueueErrorRecoveryParams = {
  sessionId: SessionId | null | undefined
  pause: SessionQueuePauseState | null
  messages: readonly UIMessage[]
  getCurrentRuntimePatch: () => SessionRuntimePatch
  dispatchRetry: (payload: RetryDispatchPayload) => Promise<void>
  refreshQueueState: (sessionId: SessionId) => Promise<void>
  onPauseCleared: () => void
  showWarning: (message: string) => void
  showError: (message: string) => void
}

type RecoveryTask = {
  sessionId: SessionId
  action: 'retry' | 'resume'
}

function currentQueueRuntimeSelection(runtime: SessionRuntimePatch) {
  return {
    ...(runtime.providerProfileId !== undefined
      ? { providerProfileId: runtime.providerProfileId }
      : {}),
    ...(runtime.modelId !== undefined ? { modelId: runtime.modelId } : {}),
    ...(runtime.cliSparkOverride !== undefined
      ? { cliSparkOverride: runtime.cliSparkOverride }
      : {}),
  }
}

function toRetryAttachments(attachments: readonly MessageAttachment[]): ComposerAttachment[] {
  const stamp = Date.now()
  return attachments.map((attachment, index) => ({
    id: `queue-retry-${stamp}-${index}-${attachment.path}`,
    type: attachment.type,
    path: attachment.path,
    name: attachment.name ?? attachment.path.split(/[\\/]/).pop() ?? attachment.path,
    ...(attachment.previewPath != null ? { previewPath: attachment.previewPath } : {}),
    ...(attachment.previewUrl != null ? { previewUrl: attachment.previewUrl } : {}),
  }))
}

export function useQueueErrorRecovery({
  sessionId,
  pause,
  messages,
  getCurrentRuntimePatch,
  dispatchRetry,
  refreshQueueState,
  onPauseCleared,
  showWarning,
  showError,
}: QueueErrorRecoveryParams) {
  const { invoke: resumeQueue } = useIpcInvoke('session:resume-queue')
  const [recoveryTask, setRecoveryTask] = useState<RecoveryTask | null>(null)
  const recovering =
    recoveryTask != null && recoveryTask.sessionId === sessionId ? recoveryTask.action : null
  const retryPayload = useMemo(
    () => buildTurnRetryPayload(messages, pause?.failedTurnId),
    [messages, pause?.failedTurnId],
  )
  // 智能重试：失败轮已有实质产出（文本/工具调用/文件变更）时优先发继续指令，
  // 让模型基于会话历史中的半截产出从中断处续跑；无产出回落原消息重发。
  const continuePayload = useMemo(
    () => buildErrorContinuePayload(messages, pause?.failedTurnId),
    [messages, pause?.failedTurnId],
  )

  const retry = async (): Promise<void> => {
    if (sessionId == null || pause == null || recovering != null) return
    // 继续指令与原消息重发共用同一条 dispatchRetry 通道（resumePausedQueue 在
    // 主进程侧统一按队首插入），失败轮续跑恒先于其后排队的消息。
    const payload = continuePayload ?? retryPayload
    if (payload == null) {
      showWarning('失败消息无法安全还原，请选择“跳过继续”或手动发送。')
      return
    }
    const task: RecoveryTask = { sessionId, action: 'retry' }
    setRecoveryTask(task)
    try {
      await dispatchRetry({
        text: payload.text,
        attachments: toRetryAttachments(payload.attachments),
        sessionReferences: payload.sessionReferences ?? [],
      })
      await refreshQueueState(sessionId)
    } catch (error) {
      showError(`重试失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setRecoveryTask((current) => (current === task ? null : current))
    }
  }

  const resume = async (): Promise<void> => {
    if (sessionId == null || pause == null || recovering != null) return
    const task: RecoveryTask = { sessionId, action: 'resume' }
    setRecoveryTask(task)
    try {
      const result = await resumeQueue({
        sessionId,
        runtimePatch: currentQueueRuntimeSelection(getCurrentRuntimePatch()),
      })
      await refreshQueueState(sessionId)
      if (result.resumed) {
        onPauseCleared()
      }
    } catch (error) {
      showError(`继续队列失败：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setRecoveryTask((current) => (current === task ? null : current))
    }
  }

  return {
    // 继续指令与原消息重发任一可用即可重试（放宽：原消息不可还原但已有产出时，
    // 继续指令仍能安全续跑）。
    canRetry: continuePayload != null || retryPayload != null,
    recovering,
    retry,
    resume,
  }
}
