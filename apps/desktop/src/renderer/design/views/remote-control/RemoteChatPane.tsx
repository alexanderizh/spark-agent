/**
 * 远程会话主区：历史 + 实时流 + 附件 + 审批 + 问答 + 发送。
 *
 * 事件归并交给 remoteEventMerge（去重 / delta 抑制 / seq 排序）；
 * 富文本渲染复用桌面端 ChatMarkdown；审批/问答复用桌面端卡片组件与样式，
 * 只把「决策提交」换成远程转发。
 *
 * 历史分页：首屏只取最近若干轮，往上滚到顶（或点顶部按钮）按 `beforeSeq` 继续取，
 * 前插后按「容器高度差」还原滚动位置，视觉上不跳。
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type {
  MobileBridgeCommandItem,
  MobileBridgeEvent,
  RemoteAgentAttachmentSummary,
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
import {
  HISTORY_LOAD_COOLDOWN_MS,
  HISTORY_MAX_PAGES_PER_GESTURE,
  HISTORY_TOP_THRESHOLD_PX,
  buildHistoryUrl,
  isHistoryCursorAdvancing,
  pickUnseenEvents,
  resolveHistoryCursor,
  resolveHistoryHasMore,
  type RemoteHistoryPage,
} from './remoteHistory'
import { remoteFileUrl } from './remoteFileCache'
import { clearRemoteDraft, readRemoteDraft, writeRemoteDraft } from './remoteDrafts'
import { toPastedImageSource } from './remotePaste'
import { useSmoothRemoteItems } from './remoteSmoothReveal'
import { useRemoteCall, useRemoteSessionStream, type RemoteCallError } from './useRemoteBridge'
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
  /** 记住的会话已经不存在（目标端 404）：宿主清掉选择并回到列表 */
  onSessionInvalid?: () => void
}

export function RemoteChatPane({
  deviceId,
  sessionId,
  sessionTitle,
  deviceName,
  onSessionInvalid,
}: RemoteChatPaneProps) {
  const call = useRemoteCall()
  const { invoke: openFileDialog } = useIpcInvoke('dialog:open-file')
  const { invoke: uploadAttachments } = useIpcInvoke('remote-agent:attachment:upload')
  const { invoke: savePastedImage } = useIpcInvoke('file:save-pasted-image')

  const [events, setEvents] = useState<MobileBridgeEvent[]>([])
  /**
   * 事件列表的同步镜像。
   *
   * 历史前插必须基于「此刻最新的列表」做去重与归并，而 setEvents 的函数式更新在
   * 异步回调里读不到结果；直接闭包捕获 events 又会拿到陈旧快照（流式期间尤其危险）。
   * 因此所有写入都走 applyEvents，ref 与 state 永远同值（与小程序端 allEvents 同一套路）。
   */
  const eventsRef = useRef<MobileBridgeEvent[]>([])
  const [history, setHistory] = useState<{
    hasMore: boolean
    cursor: number | null
    loading: boolean
  }>({ hasMore: false, cursor: null, loading: false })
  const historyRef = useRef(history)
  const lastTopLoadAtRef = useRef(0)
  /** 前插历史后待兑现的滚动锚点（容器旧高度 + 旧 scrollTop） */
  const pendingAnchorRef = useRef<{ height: number; top: number } | null>(null)
  const [running, setRunning] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [pendingAttachments, setPendingAttachments] = useState<RemoteAttachmentRef[]>([])
  /**
   * 草稿与待发附件按（设备, 会话）存档。
   *
   * 组件是长驻的：`sessionId` 变了只是换数据、不重建组件，草稿 state 不会自己重置，
   * 于是在会话 A 打的字切到 B 还留着、切回 A 又没了，待发附件也会被带过去。
   *
   * 这里用「渲染期按 prop 调整 state」而不是 effect 来切换：effect 里改会和下面
   * 清空待发附件的那段抢执行顺序（同一 commit 里后写的赢），渲染期处理则天然在前面。
   * 初值给哨兵，首帧必然不相等 —— 远程视图是 lazy 挂载的，切到别的页面再回来组件
   * 会重建，靠这一步把模块级缓存里的草稿取回来。
   */
  const [composeKey, setComposeKey] = useState<{ deviceId: string; sessionId: string | null }>({
    deviceId: '',
    sessionId: null,
  })
  if (composeKey.deviceId !== deviceId || composeKey.sessionId !== sessionId) {
    if (composeKey.sessionId != null) {
      writeRemoteDraft(composeKey.deviceId, composeKey.sessionId, {
        text: draft,
        attachments: pendingAttachments,
      })
    }
    setComposeKey({ deviceId, sessionId })
    const restored = sessionId != null ? readRemoteDraft(deviceId, sessionId) : null
    setDraft(restored?.text ?? '')
    setPendingAttachments(restored?.attachments ?? [])
  }
  const [approvals, setApprovals] = useState<RemoteApproval[]>([])
  const [questions, setQuestions] = useState<RemoteQuestion[]>([])
  const [approvalBusy, setApprovalBusy] = useState(false)
  const [commands, setCommands] = useState<MobileBridgeCommandItem[]>([])

  // 运行时配置（助手 / 模型 / 权限）：目录按设备缓存，运行时按会话拉一次
  const config = useRemoteComposerConfig(deviceId, sessionId)

  const scrollRef = useRef<HTMLDivElement | null>(null)
  const stickToBottomRef = useRef(true)

  const applyEvents = useCallback((next: MobileBridgeEvent[]) => {
    eventsRef.current = next
    setEvents(next)
  }, [])

  const applyHistory = useCallback(
    (next: { hasMore: boolean; cursor: number | null; loading: boolean }) => {
      historyRef.current = next
      setHistory(next)
    },
    [],
  )

  /**
   * 往上取更早的一页。
   *
   * 游标语义：`beforeSeq` 是排他下界，服务端按轮次倒序挑 turnLimit 个完整轮次。
   * 有些页可能只有内部事件（映射后全被丢弃），所以一次手势允许连补几页，
   * 但只要拿到新事件就停 —— 不做无界循环。
   */
  const loadEarlier = useCallback(async () => {
    const id = sessionId
    if (id == null) return
    const current = historyRef.current
    if (current.loading || !current.hasMore || current.cursor == null) return
    // 冷却：前插会改变容器高度并触发 scroll，不冷却会「加载→重排→又触发加载」
    if (Date.now() - lastTopLoadAtRef.current < HISTORY_LOAD_COOLDOWN_MS) return
    lastTopLoadAtRef.current = Date.now()
    applyHistory({ ...current, loading: true })
    // 顶部翻页绝不能落回底部
    stickToBottomRef.current = false
    const node = scrollRef.current
    const anchor = { height: node?.scrollHeight ?? 0, top: node?.scrollTop ?? 0 }
    try {
      let cursor: number | null = current.cursor
      // 显式标 boolean：上面 `!current.hasMore` 的守卫会把属性收窄成 true
      let hasMore: boolean = current.hasMore
      const collected: MobileBridgeEvent[] = []
      for (
        let page = 0;
        page < HISTORY_MAX_PAGES_PER_GESTURE && hasMore && cursor != null;
        page += 1
      ) {
        const response = await call<RemoteHistoryPage>(deviceId, 'GET', buildHistoryUrl(id, cursor))
        const batch = Array.isArray(response.events) ? response.events : []
        const known = [
          ...eventsRef.current.map((event) => event.id),
          ...collected.map((event) => event.id),
        ]
        collected.push(...pickUnseenEvents(known, batch))
        hasMore = resolveHistoryHasMore(response)
        const next = resolveHistoryCursor(response)
        if (hasMore && !isHistoryCursorAdvancing(next, cursor)) {
          // 游标没往更早推进：当成到底，避免原地打转刷请求
          hasMore = false
          break
        }
        if (next != null) cursor = next
        if (collected.length > 0) break
      }
      if (collected.length > 0) {
        pendingAnchorRef.current = anchor
        applyEvents(mergeRemoteEvents(eventsRef.current, collected))
      }
      applyHistory({ hasMore, cursor, loading: false })
    } catch (cause) {
      applyHistory({ ...current, loading: false })
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [applyEvents, applyHistory, call, deviceId, sessionId])

  useEffect(() => {
    if (!sessionId) {
      applyEvents([])
      applyHistory({ hasMore: false, cursor: null, loading: false })
      setRunning(false)
      setError(null)
      // 待发附件不在这里清：切会话时它由上面的草稿存档逻辑接管（切回还能接着发）
      setApprovals([])
      setQuestions([])
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    applyEvents([])
    applyHistory({ hasMore: false, cursor: null, loading: false })
    setApprovals([])
    setQuestions([])
    pendingAnchorRef.current = null
    stickToBottomRef.current = true
    call<RemoteHistoryPage>(deviceId, 'GET', buildHistoryUrl(sessionId))
      .then((response) => {
        if (cancelled) return
        applyEvents(Array.isArray(response.events) ? response.events : [])
        setRunning(Boolean(response.running))
        applyHistory({
          hasMore: resolveHistoryHasMore(response),
          cursor: resolveHistoryCursor(response),
          loading: false,
        })
      })
      .catch((cause: unknown) => {
        if (cancelled) return
        // 记住的会话在目标端已经不存在（换机/被删）：交给宿主回落，不弹红条
        if ((cause as RemoteCallError | null)?.status === 404) {
          onSessionInvalid?.()
          return
        }
        setError(cause instanceof Error ? cause.message : String(cause))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [applyEvents, applyHistory, call, deviceId, onSessionInvalid, sessionId])

  const handleStreamEvents = useCallback(
    (incoming: MobileBridgeEvent[]) => {
      applyEvents(mergeRemoteEvents(eventsRef.current, incoming))
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
    },
    [applyEvents],
  )

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
  // 目标端 500ms 一批推上来，短回答会「一次刷出来」；这里按帧揭示恢复流式手感
  const visibleItems = useSmoothRemoteItems(items)

  /**
   * 前插历史后还原视觉位置：新内容把上面撑高了 delta，scrollTop 同步加上 delta，
   * 用户盯着的那一行不动。必须用 layout effect —— 在浏览器绘制前改完，
   * 否则会先闪一下顶部再被拽回去。
   */
  useLayoutEffect(() => {
    const anchor = pendingAnchorRef.current
    if (anchor == null) return
    pendingAnchorRef.current = null
    const node = scrollRef.current
    if (node == null) return
    node.scrollTop = node.scrollHeight - anchor.height + anchor.top
  }, [visibleItems])

  useEffect(() => {
    const node = scrollRef.current
    if (node == null || !stickToBottomRef.current) return
    node.scrollTop = node.scrollHeight
  }, [visibleItems])

  const handleScroll = useCallback(() => {
    const node = scrollRef.current
    if (node == null) return
    stickToBottomRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 120
    // 贴到顶部且内容确实可滚动 → 自动补一页更早的（loadEarlier 自带冷却与幂等守卫）
    if (node.scrollTop < HISTORY_TOP_THRESHOLD_PX && node.scrollHeight > node.clientHeight + 200) {
      void loadEarlier()
    }
  }, [loadEarlier])

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

  /** 上传结果入待发条：同一路径不重复加；粘贴图片带上本机预览图，不用等远程回图 */
  const appendUploaded = useCallback(
    (uploaded: RemoteAgentAttachmentSummary[], previews?: Map<string, string>) => {
      setPendingAttachments((previous) => {
        const seen = new Set(previous.map((item) => item.path))
        const added = uploaded
          .filter((item) => !seen.has(item.path))
          .map((item) => {
            const previewUrl = previews?.get(item.path)
            return {
              type: item.type,
              path: item.path,
              ...(item.name != null ? { name: item.name } : {}),
              ...(previewUrl != null ? { previewUrl } : {}),
            }
          })
        return [...previous, ...added]
      })
    },
    [],
  )

  /** 上传一批本机文件到目标端（选文件与粘贴图片共用） */
  const uploadLocalPaths = useCallback(
    async (paths: string[], previews?: Map<string, string>) => {
      if (!sessionId || paths.length === 0) return
      setUploading(true)
      try {
        const result = await uploadAttachments({ deviceId, sessionId, paths })
        appendUploaded(result.attachments, previews)
        setError(null)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        setUploading(false)
      }
    },
    [appendUploaded, deviceId, sessionId, uploadAttachments],
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
      await uploadLocalPaths(paths)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [openFileDialog, sessionId, uploadLocalPaths])

  /**
   * 粘贴图片：先在**本机**落盘（file:save-pasted-image，与主输入区同一个接口），
   * 再传一份到目标端。这样粘贴框里能立刻显示缩略图，发送走的还是目标端路径。
   */
  const handlePasteImages = useCallback(
    async (files: Blob[]) => {
      if (!sessionId || uploading || files.length === 0) return
      setUploading(true)
      try {
        const paths: string[] = []
        const previews = new Map<string, string>()
        for (const [index, file] of files.entries()) {
          const source = await toPastedImageSource(file, index)
          const saved = await savePastedImage({
            dataUrl: source.dataUrl,
            mimeType: source.mimeType,
            suggestedBaseName: source.suggestedBaseName,
          })
          paths.push(saved.filePath)
          previews.set(saved.filePath, remoteFileUrl(saved.filePath))
        }
        if (paths.length === 0) return
        const result = await uploadAttachments({ deviceId, sessionId, paths })
        appendUploaded(result.attachments, previews)
        setError(null)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        setUploading(false)
      }
    },
    [appendUploaded, deviceId, savePastedImage, sessionId, uploadAttachments, uploading],
  )
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
          clearRemoteDraft(deviceId, sessionId)
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
      clearRemoteDraft(deviceId, sessionId)
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
        {!loading && items.length > 0 && (
          <div className="rc-history-head">
            {history.hasMore ? (
              <button
                type="button"
                className="rc-history-more"
                onClick={() => void loadEarlier()}
                disabled={history.loading}
              >
                {history.loading ? (
                  <>
                    <Icons.Spinner size={11} className="spin" />
                    正在加载更早的消息…
                  </>
                ) : (
                  <>
                    <Icons.ChevronUp size={11} />
                    加载更早的消息
                  </>
                )}
              </button>
            ) : (
              <span className="rc-history-end">已经到会话开头</span>
            )}
          </div>
        )}
        {loading && <div className="rc-pane-hint">正在读取会话内容…</div>}
        {!loading && items.length === 0 && <div className="rc-pane-hint">这个会话还没有消息</div>}
        <RemoteMessageList items={visibleItems} deviceId={deviceId} running={running} />
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
        onPasteImages={(items) => void handlePasteImages(items)}
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
