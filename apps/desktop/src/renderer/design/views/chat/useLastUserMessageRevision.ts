import { useEffect, useRef } from 'react'
import type { SessionId } from '@spark/protocol'
import { useIpcInvoke } from '../../hooks/useIpc'
import { getFileNameFromPath } from '../../services/composer-attachments'
import type {
  ComposerAttachment,
  ComposerDraftSnapshot,
  ComposerRevisionPayload,
  ComposerSessionReference,
  ReplyToState,
} from './ChatComposerTypes'
import type { SubmitGate } from './submit-gate'

type RevisionDispatch = (
  text: string,
  attachments: ComposerAttachment[],
  reply?: ReplyToState | null,
  sentDraft?: ComposerDraftSnapshot,
  options?: {
    sessionReferences?: ComposerSessionReference[]
    preserveDraft?: boolean
    resumePausedQueue?: boolean
    mentionAgentId?: string
    skipCommandHandling?: boolean
  },
) => Promise<void>

export function useLastUserMessageRevision(params: {
  request: { requestId: number; payload: ComposerRevisionPayload } | null
  sessionId: SessionId | null
  providerAvailable: boolean
  submitGate: SubmitGate
  setSending: (sending: boolean) => void
  dispatchMessage: RevisionDispatch
  onConsumed?: () => void
  onApplied?: (result: {
    sessionId: string
    turnId: string
    turnCount: number
    logicalMessageCount: number
  }) => void
  restoreDraft: (draft: ComposerDraftSnapshot) => void
  toast: { info: (message: string) => void; error: (message: string) => void }
}): void {
  const consumedIdRef = useRef<number | null>(null)
  const { invoke: rewindLastTurn } = useIpcInvoke('session:rewind-last-turn')

  useEffect(() => {
    const current = params.request
    if (current == null || consumedIdRef.current === current.requestId) return
    consumedIdRef.current = current.requestId
    params.onConsumed?.()

    const { payload } = current
    const references = payload.sessionReferences ?? []
    const stamp = Date.now()
    const attachments: ComposerAttachment[] = payload.attachments.map((attachment, index) => ({
      id: `revision-${stamp}-${index}-${attachment.path}`,
      type: attachment.type,
      path: attachment.path,
      name: attachment.name ?? getFileNameFromPath(attachment.path),
    }))
    const text =
      payload.text.trim() ||
      (attachments.length > 0
        ? '请查看附件。'
        : references.length > 0
          ? '请结合已添加的会话参考。'
          : '')
    const draft: ComposerDraftSnapshot = {
      value: payload.text,
      attachments,
      sessionReferences: references,
      manualExpanded: true,
    }

    if (!params.submitGate.tryEnter()) {
      params.restoreDraft(draft)
      params.toast.info('当前有消息正在提交，请稍后再试。')
      return
    }

    void (async () => {
      params.setSending(true)
      try {
        if (params.sessionId !== payload.sessionId) {
          throw new Error('会话已经切换，未执行消息编辑')
        }
        if (!params.providerAvailable) {
          throw new Error('请先配置可用的 Provider，再编辑并重新发送')
        }
        if (text.length === 0) throw new Error('消息内容不能为空')
        const result = await rewindLastTurn({
          sessionId: payload.sessionId,
          turnId: payload.turnId,
        })
        params.onApplied?.({
          sessionId: payload.sessionId,
          turnId: payload.turnId,
          turnCount: result.turnCount,
          logicalMessageCount: result.logicalMessageCount,
        })
        await params.dispatchMessage(text, attachments, null, draft, {
          sessionReferences: references,
          ...(payload.mentionAgentId != null ? { mentionAgentId: payload.mentionAgentId } : {}),
          skipCommandHandling: true,
        })
      } catch (error) {
        console.error('编辑并重新发送失败', error)
        params.restoreDraft(draft)
        params.toast.error(error instanceof Error ? error.message : '编辑并重新发送失败')
      } finally {
        params.setSending(false)
        params.submitGate.leave()
      }
    })()
  }, [params, rewindLastTurn])
}
