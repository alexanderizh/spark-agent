/**
 * 远程会话主区：历史 + 实时流 + 附件 + 审批 + 问答 + 发送。
 *
 * 事件归并交给 remoteEventMerge（去重 / delta 抑制 / seq 排序）；
 * 富文本渲染复用桌面端 ChatMarkdown；审批/问答复用桌面端卡片组件与样式，
 * 只把「决策提交」换成远程转发。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  MobileBridgeCommandItem,
  MobileBridgeEvent,
  UserQuestionPrompt,
} from '@spark/protocol'
import { Icons } from '../../Icons'
import { useIpcInvoke } from '../../hooks/useIpc'
import { UserQuestionDock } from '../chat/UserQuestionDock'
import {
  RemoteApprovalCard,
  toApprovalRequest,
  type RemoteApprovalDecision,
} from './RemoteApprovalCard'
import { RemoteComposer } from './RemoteComposer'
import { RemoteMessageList } from './RemoteMessageList'
import type { RemoteAttachmentRef } from './RemoteAttachmentStrip'
import { buildRemoteTimeline, mergeRemoteEvents } from './remoteEventMerge'
import { useRemoteCall, useRemoteSessionStream } from './useRemoteBridge'
import { useRemoteComposerConfig } from './useRemoteComposerConfig'

interface RemoteApproval {
  requestId: string
  sessionId: string
  toolName: string
  action: string
  toolInput?: Record<string, unknown>
  riskLevel: 'low' | 'medium' | 'high'
  createdAt?: string
  defaultToNo?: boolean
}

interface RemoteQuestion {
  questionId: string
  sessionId: string
  questions: UserQuestionPrompt[]
}

interface RemoteInteractions {
  approvals?: RemoteApproval[]
  questions?: RemoteQuestion[]
}

/** 纯附件消息：目标端 /turns 的 text 必填，空串会 400，用零宽占位（与小程序端一致） */
const ATTACHMENT_ONLY_TEXT = '\u200B请查看附件'

export interface RemoteChatPaneProps {
  deviceId: string
  sessionId: string | null
  /** 侧栏缓存里的会话标题；改名后由 store 直接回流 */
  sessionTitle?: string | null
  deviceName: string
}

export function RemoteChatPane({
  deviceId,
  sessionId,
  sessionTitle,
  deviceName,
}: RemoteChatPaneProps) {
  const call = useRemoteCall()
  const { invoke: openFileDialog } = useIpcInvoke('dialog:open-file')
  const { invoke: uploadAttachments } = useIpcInvoke('remote-agent:attachment:upload')

  const [events, setEvents] = useState<MobileBridgeEvent[]>([])
  const [running, setRunning] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [pendingAttachments, setPendingAttachments] = useState<RemoteAttachmentRef[]>([])
  const [approvals, setApprovals] = useState<RemoteApproval[]>([])
  const [questions, setQuestions] = useState<RemoteQuestion[]>([])
  const [approvalBusy, setApprovalBusy] = useState(false)
  const [commands, setCommands] = useState<MobileBridgeCommandItem[]>([])

  // 运行时配置（助手 / 模型 / 权限）：目录按设备缓存，运行时按会话拉一次
  const config = useRemoteComposerConfig(deviceId, sessionId)

  const scrollRef = useRef<HTMLDivElement | null>(null)
  const stickToBottomRef = useRef(true)

  useEffect(() => {
    if (!sessionId) {
      setEvents([])
      setRunning(false)
      setError(null)
      setPendingAttachments([])
      setApprovals([])
      setQuestions([])
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    setEvents([])
    setPendingAttachments([])
    setApprovals([])
    setQuestions([])
    stickToBottomRef.current = true
    call<{ events: MobileBridgeEvent[]; running: boolean }>(
      deviceId,
      'GET',
      `/v1/sessions/${encodeURIComponent(sessionId)}/messages?limit=200`,
    )
      .then((response) => {
        if (cancelled) return
        setEvents(Array.isArray(response.events) ? response.events : [])
        setRunning(Boolean(response.running))
      })
      .catch((cause: unknown) => {
        if (cancelled) return
        setError(cause instanceof Error ? cause.message : String(cause))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [call, deviceId, sessionId])

  const handleStreamEvents = useCallback((incoming: MobileBridgeEvent[]) => {
    setEvents((previous) => mergeRemoteEvents(previous, incoming))
    for (const event of incoming) {
      if (event.type !== 'agent_status') continue
      if (event.status === 'running') setRunning(true)
      else if (
        event.status === 'idle' ||
        event.status === 'completed' ||
        event.status === 'cancelled' ||
        event.status === 'error'
      ) {
        setRunning(false)
      }
    }
  }, [])

  useRemoteSessionStream(deviceId, sessionId, handleStreamEvents)

  /**
   * 挂起交互：打开会话先拉一次（遥控端可能在别处已经停住等审批），
   * 运行中再每 4s 拉一次。旧版目标端没有该端点，失败静默。
   */
  useEffect(() => {
    if (!sessionId) return
    let cancelled = false
    const tick = () => {
      call<RemoteInteractions>(
        deviceId,
        'GET',
        `/v1/sessions/${encodeURIComponent(sessionId)}/interactions`,
      )
        .then((data) => {
          if (cancelled) return
          setApprovals(Array.isArray(data.approvals) ? data.approvals : [])
          setQuestions(Array.isArray(data.questions) ? data.questions : [])
        })
        .catch(() => {
          /* 目标端未提供该端点：按无挂起交互处理 */
        })
    }
    void tick()
    if (!running) {
      return () => {
        cancelled = true
      }
    }
    const timer = window.setInterval(tick, 4000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [call, deviceId, running, sessionId])

  /**
   * 斜杠命令目录：按会话拉一次（会话级技能会随工作区变化）。
   * 旧版目标端没有该端点 → 空数组，输入区不弹补全，但手打 /xxx 仍按普通消息发。
   */
  useEffect(() => {
    // 没有会话时不渲染输入区，也就没人读 commands，不必在这里回清
    if (!sessionId) return
    let cancelled = false
    call<{ commands: MobileBridgeCommandItem[] }>(
      deviceId,
      'GET',
      `/v1/commands?sessionId=${encodeURIComponent(sessionId)}`,
    )
      .then((response) => {
        if (!cancelled) setCommands(Array.isArray(response.commands) ? response.commands : [])
      })
      .catch(() => {
        if (!cancelled) setCommands([])
      })
    return () => {
      cancelled = true
    }
  }, [call, deviceId, sessionId])

  const items = useMemo(() => buildRemoteTimeline(events), [events])

  useEffect(() => {
    const node = scrollRef.current
    if (node == null || !stickToBottomRef.current) return
    node.scrollTop = node.scrollHeight
  }, [items])

  const handleScroll = useCallback(() => {
    const node = scrollRef.current
    if (node == null) return
    stickToBottomRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 120
  }, [])

  const resolveApproval = useCallback(
    async (requestId: string, decision: RemoteApprovalDecision) => {
      if (!sessionId) return
      setApprovalBusy(true)
      try {
        await call(
          deviceId,
          'POST',
          `/v1/sessions/${encodeURIComponent(sessionId)}/approvals/${encodeURIComponent(requestId)}/resolve`,
          { decision },
        )
        setApprovals((previous) => previous.filter((item) => item.requestId !== requestId))
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        setApprovalBusy(false)
      }
    },
    [call, deviceId, sessionId],
  )

  const answerQuestion = useCallback(
    async (questionId: string, answers: Record<string, unknown>) => {
      if (!sessionId) return
      try {
        await call(
          deviceId,
          'POST',
          `/v1/sessions/${encodeURIComponent(sessionId)}/questions/${encodeURIComponent(questionId)}/answer`,
          { answers },
        )
        setQuestions((previous) => previous.filter((item) => item.questionId !== questionId))
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
      }
    },
    [call, deviceId, sessionId],
  )

  const handlePickFiles = useCallback(async () => {
    if (!sessionId) return
    try {
      const selected = await openFileDialog({
        title: '添加附件',
        multiple: true,
        filters: [
          {
            name: '图片与文件',
            extensions: [
              'png',
              'jpg',
              'jpeg',
              'webp',
              'gif',
              'bmp',
              'pdf',
              'txt',
              'md',
              'json',
              'csv',
              'zip',
              'docx',
              'xlsx',
            ],
          },
        ],
      })
      const paths = selected.filePaths ?? (selected.filePath != null ? [selected.filePath] : [])
      if (selected.canceled || paths.length === 0) return
      setUploading(true)
      const result = await uploadAttachments({ deviceId, sessionId, paths })
      setPendingAttachments((previous) => {
        const seen = new Set(previous.map((item) => item.path))
        return [
          ...previous,
          ...result.attachments
            .filter((item) => !seen.has(item.path))
            .map((item) => ({
              type: item.type,
              path: item.path,
              ...(item.name != null ? { name: item.name } : {}),
            })),
        ]
      })
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setUploading(false)
    }
  }, [deviceId, openFileDialog, sessionId, uploadAttachments])

  const handleRemoveAttachment = useCallback((path: string) => {
    setPendingAttachments((previous) => previous.filter((item) => item.path !== path))
  }, [])

  const handleSend = useCallback(async () => {
    if (!sessionId || sending) return
    const text = draft.trim()
    if (text.length === 0 && pendingAttachments.length === 0) return
    setSending(true)
    stickToBottomRef.current = true
    try {
      // 斜杠命令走目标端的命令执行路由：/clear 这类本地命令不产生回合，
      // 技能命令则由目标端转给 agent（随后事件经流推送）。
      if (text.startsWith('/') && pendingAttachments.length === 0) {
        const result = await call<{ isCommand: boolean; forwardToAgent: boolean }>(
          deviceId,
          'POST',
          `/v1/sessions/${encodeURIComponent(sessionId)}/commands`,
          { raw: text },
        )
        if (result.isCommand) {
          setDraft('')
          if (result.forwardToAgent) setRunning(true)
          setError(null)
          return
        }
        // 不是已注册命令：按普通消息继续走下面的 /turns
      }
      await call(deviceId, 'POST', `/v1/sessions/${encodeURIComponent(sessionId)}/turns`, {
        text: text.length > 0 ? text : ATTACHMENT_ONLY_TEXT,
        ...(pendingAttachments.length > 0
          ? { attachmentPaths: pendingAttachments.map((item) => item.path) }
          : {}),
        clientMessageId: `desktop-remote-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      })
      setDraft('')
      setPendingAttachments([])
      setRunning(true)
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSending(false)
    }
  }, [call, deviceId, draft, pendingAttachments, sending, sessionId])

  const handleStop = useCallback(async () => {
    if (!sessionId) return
    try {
      await call(deviceId, 'POST', `/v1/sessions/${encodeURIComponent(sessionId)}/cancel`)
      setRunning(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [call, deviceId, sessionId])

  if (sessionId == null) {
    return (
      <section className="rc-chat-pane rc-chat-empty">
        <div className="rc-state">
          <Icons.Chat size={26} />
          <h3>选择左侧的一个会话</h3>
          <p>正在查看 {deviceName || '远程电脑'}，消息会实时同步到这台电脑。</p>
        </div>
      </section>
    )
  }

  const activeQuestion = questions[0] ?? null

  return (
    <section className="rc-chat-pane">
      <div className="rc-chat-head">
        <span className="rc-chat-title" title={sessionTitle ?? undefined}>
          {sessionTitle ?? '远程会话'}
        </span>
        {running && (
          <span className="rc-running">
            <span className="rc-running-dot" />
            运行中
          </span>
        )}
      </div>

      <div className="rc-chat-scroll" ref={scrollRef} onScroll={handleScroll}>
        {loading && <div className="rc-pane-hint">正在读取会话内容…</div>}
        {!loading && items.length === 0 && <div className="rc-pane-hint">这个会话还没有消息</div>}
        <RemoteMessageList items={items} deviceId={deviceId} />
      </div>

      {error != null && (
        <div className="rc-chat-error">
          <Icons.AlertTriangle size={12} />
          <span>{error}</span>
          <button type="button" className="rc-link-btn" onClick={() => setError(null)}>
            知道了
          </button>
        </div>
      )}

      {approvals.map((approval) => (
        <RemoteApprovalCard
          key={approval.requestId}
          request={toApprovalRequest(approval)}
          busy={approvalBusy}
          onDecide={(decision) => void resolveApproval(approval.requestId, decision)}
        />
      ))}

      {activeQuestion != null && (
        <UserQuestionDock
          data={{
            sessionId: activeQuestion.sessionId,
            questionId: activeQuestion.questionId,
            questions: activeQuestion.questions,
          }}
          onAnswer={(answers) => void answerQuestion(activeQuestion.questionId, answers)}
          onCancel={() =>
            setQuestions((previous) =>
              previous.filter((item) => item.questionId !== activeQuestion.questionId),
            )
          }
        />
      )}

      <RemoteComposer
        deviceId={deviceId}
        draft={draft}
        onChangeDraft={setDraft}
        attachments={pendingAttachments}
        onRemoveAttachment={handleRemoveAttachment}
        onPickFiles={() => void handlePickFiles()}
        running={running}
        sending={sending}
        uploading={uploading}
        onSend={() => void handleSend()}
        onStop={() => void handleStop()}
        config={config}
        commands={commands}
      />
    </section>
  )
}
