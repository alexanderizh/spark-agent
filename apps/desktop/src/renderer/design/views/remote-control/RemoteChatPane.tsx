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
  SessionGetQueueResponse,
  UserQuestionPrompt,
} from '@spark/protocol'
import { createLogger } from '@spark/shared'
import { Icons } from '../../Icons'
import { useIpcInvoke } from '../../hooks/useIpc'
import { useOptionalToast } from '../../components/Toast'
import { UserQuestionDock } from '../chat/UserQuestionDock'
import {
  RemoteApprovalCard,
  toApprovalRequest,
  type RemoteApprovalDecision,
} from './RemoteApprovalCard'
import { RemoteComposer } from './RemoteComposer'
import { RemoteMessageList, type RemoteUserItem } from './RemoteMessageList'
import type { RemoteAttachmentRef } from './RemoteAttachmentStrip'
import {
  buildRemoteTimeline,
  isAwaitingResponse,
  isPendingUserVisible,
  mergeRemoteEvents,
} from './remoteEventMerge'
import { ATTACHMENT_ONLY_TEXT, toReusableDraft } from './remoteMessageReuse'
import { resolvePendingQuickReplies } from './remoteQuickReplies'
import { fileNameOf } from './remoteRichContent'
import { patchSessionFromLiveEvents } from './remoteSessionStore'
import { buildQuickReplyMessage } from '../../services/quick-reply-suggestions'
import { shouldShowScrollToBottom } from '../chat-scroll'
import {
  clampChatScrollTop,
  forgetChatScroll,
  isChatScrollAtBottom,
  readChatScroll,
  rememberChatScroll,
} from '../chat-scroll-memory'
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

const logger = createLogger('remote-chat-pane')

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

export interface RemoteChatPaneProps {
  deviceId: string
  sessionId: string | null
  /** 侧栏缓存里的会话标题；改名后由 store 直接回流 */
  sessionTitle?: string | null
  deviceName: string
  /** 记住的会话已经不存在（目标端 404）：宿主清掉选择并回到列表 */
  onSessionInvalid?: () => void
  /** 右侧项目信息面板开关（头部按钮；缺省不渲染按钮） */
  projectPanelOpen?: boolean | undefined
  onToggleProjectPanel?: (() => void) | undefined
}

export function RemoteChatPane({
  deviceId,
  sessionId,
  sessionTitle,
  deviceName,
  onSessionInvalid,
  projectPanelOpen,
  onToggleProjectPanel,
}: RemoteChatPaneProps) {
  const call = useRemoteCall()
  const toast = useOptionalToast()?.toast ?? null
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
   * 本地待发的用户消息（乐观气泡）。
   *
   * POST /turns 是 await 的，消息进列表要等目标端把 user_message 事件推回来，
   * 链路一慢界面就「发了却看不到、也没有任何反馈」。发送瞬间先本地渲染：
   *   sending → POST 在途；sent → 已送达、等事件回流（由 isPendingUserVisible 对账）；
   *   failed → 留在气泡上可点击重试，文字不丢。
   * queued = 目标端已接受但排队（会话有活跃回合）：气泡挂到 user 事件入库为止，
   * 状态行显示「已加入队列」，避免消息看起来发了就没影了。
   * 会话切换（下面 composeKey 那段）一并清掉：换会话不该带上一条的待发态。
   */
  const [pendingUser, setPendingUser] = useState<{
    clientMessageId: string
    text: string
    attachments: RemoteAttachmentRef[]
    status: 'sending' | 'sent' | 'failed'
    /** 历次提交拿到的回合 id：事件流出现同 turnId 的 user 条目即交棒（见 isPendingUserVisible） */
    turnIds: string[]
    queued?: boolean
    error?: string
  } | null>(null)
  /**
   * 草稿与待发附件按（设备, 会话）存档。
   *
   * 组件是长驻的：`sessionId` 变了只是换数据、不重建组件，草稿 state 不会自己重置，
   * 于是在会话 A 打的字切到 B 还留着、切回 A 又没了，待发附件也会被带过去。
   *
   * 这里用「渲染期按 prop 调整 state」而不是 effect 来切换：effect 里改会和下面
   * 清空待发附件的那段抢执行顺序（同一 commit 里后写的赢），渲染期处理则天然在前面。
   * 初值给哨兵，首帧必然不相等 —— 远程视图是 lazy 挂载的，切到别的页面再回来组件
   * 会重建，靠这一步把模块级缓存里的草稿取回来（缓存里的最新值由下面的
   * write-through effect 保证，单靠这里的切换存档救不了「卸载时没人写」的情况）。
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
    setPendingUser(null)
  }
  const [approvals, setApprovals] = useState<RemoteApproval[]>([])
  const [questions, setQuestions] = useState<RemoteQuestion[]>([])
  const [approvalBusy, setApprovalBusy] = useState(false)
  const [commands, setCommands] = useState<MobileBridgeCommandItem[]>([])
  const [queueSnapshot, setQueueSnapshot] = useState<SessionGetQueueResponse | null>(null)
  const [queueApiSupported, setQueueApiSupported] = useState<Record<string, boolean>>({})
  const queueWarningsRef = useRef(new Set<string>())
  const activeQueueTargetRef = useRef({ deviceId, sessionId })
  const activeHistoryTargetRef = useRef({ deviceId, sessionId })

  useLayoutEffect(() => {
    activeQueueTargetRef.current = { deviceId, sessionId }
    activeHistoryTargetRef.current = { deviceId, sessionId }
  }, [deviceId, sessionId])

  /**
   * 草稿随打随存（write-through）：模块级缓存与输入区 state 始终同值。
   *
   * 上面 composeKey 那段只在「会话/设备切换」时存档；但远程视图是按路由条件渲染的
   * （App.tsx 的 switch），切到别的界面整个组件直接卸载，state 销毁时没有任何代码
   * 往缓存里写 —— 再切回来只能取回上一次会话切换时的旧草稿（通常就是空），打了一半
   * 的字就丢了。这里在每次内容变化时同步写回，组件无论因为什么路径卸载/重建，
   * 缓存里都是最新值。空白草稿在 writeRemoteDraft 里等同删除，不会堆积空条目；
   * 发送清空（handleSend 里的 clearRemoteDraft + 空值删除）语义保持一致。
   */
  useEffect(() => {
    if (sessionId == null) return
    writeRemoteDraft(deviceId, sessionId, { text: draft, attachments: pendingAttachments })
  }, [deviceId, sessionId, draft, pendingAttachments])

  // 运行时配置（助手 / 模型 / 权限）：目录按设备缓存，运行时按会话拉一次
  const config = useRemoteComposerConfig(deviceId, sessionId)

  const scrollRef = useRef<HTMLDivElement | null>(null)
  const stickToBottomRef = useRef(true)
  /** 「回到底部」悬浮按钮：距底部超过阈值时浮现（与桌面端对话区同一口径） */
  const [showBottomButton, setShowBottomButton] = useState(false)
  /** 会话切换后待恢复的阅读进度（一次性指令，见 chat-scroll-memory） */
  const pendingScrollRestoreRef = useRef<number | null>(null)

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

  const refreshQueueState = useCallback(
    async (targetSessionId: string | null = sessionId) => {
      if (targetSessionId == null || queueApiSupported[deviceId] === false) return
      try {
        const snapshot = await call<SessionGetQueueResponse>(
          deviceId,
          'GET',
          `/v1/sessions/${encodeURIComponent(targetSessionId)}/queue`,
        )
        setQueueApiSupported((previous) =>
          previous[deviceId] === true ? previous : { ...previous, [deviceId]: true },
        )
        const active = activeQueueTargetRef.current
        if (active.deviceId !== deviceId || active.sessionId !== targetSessionId) return
        queueWarningsRef.current.delete(`${deviceId}\u0000${targetSessionId}`)
        setQueueSnapshot(snapshot)
        setRunning(snapshot.running)
      } catch (cause) {
        if ((cause as RemoteCallError | null)?.status === 404) {
          setQueueApiSupported((previous) =>
            previous[deviceId] === false ? previous : { ...previous, [deviceId]: false },
          )
          const active = activeQueueTargetRef.current
          if (active.deviceId === deviceId && active.sessionId === targetSessionId) {
            setQueueSnapshot(null)
          }
          return
        }
        const warningKey = `${deviceId}\u0000${targetSessionId}`
        if (!queueWarningsRef.current.has(warningKey)) {
          queueWarningsRef.current.add(warningKey)
          logger.warn('Remote queue snapshot request failed', {
            deviceId,
            sessionId: targetSessionId,
            message: cause instanceof Error ? cause.message : String(cause),
          })
        }
      }
    },
    [call, deviceId, queueApiSupported, sessionId],
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
    const isActiveRequest = () => {
      const active = activeHistoryTargetRef.current
      return active.deviceId === deviceId && active.sessionId === id
    }
    // 冷却：前插会改变容器高度并触发 scroll，不冷却会「加载→重排→又触发加载」
    if (Date.now() - lastTopLoadAtRef.current < HISTORY_LOAD_COOLDOWN_MS) return
    lastTopLoadAtRef.current = Date.now()
    applyHistory({ ...current, loading: true })
    // 顶部翻页绝不能落回底部
    stickToBottomRef.current = false
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
        if (!isActiveRequest()) return
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
      if (!isActiveRequest()) return
      if (collected.length > 0) {
        // Capture immediately before the prepend; live events may change height during the request.
        const node = scrollRef.current
        const anchor = { height: node?.scrollHeight ?? 0, top: node?.scrollTop ?? 0 }
        pendingAnchorRef.current = anchor
        applyEvents(mergeRemoteEvents(eventsRef.current, collected))
      }
      applyHistory({ hasMore, cursor, loading: false })
    } catch (cause) {
      if (!isActiveRequest()) return
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
    // 滚动容器是长驻节点（不随会话切换重建），进入时先捕获引用供 cleanup 读取
    const scrollNode = scrollRef.current
    applyEvents([])
    applyHistory({ hasMore: false, cursor: null, loading: false })
    setApprovals([])
    setQuestions([])
    pendingAnchorRef.current = null
    // 立即作废上一轮可能残留的恢复指令（快速连切时不得串会话）
    pendingScrollRestoreRef.current = null
    // 阅读进度：切走时存档过「非贴底」位置的会话切回来恢复原位置（接着看），
    // 否则保持原行为贴底跟随最新消息。
    // 此处只决定 stick/按钮状态；恢复指令**推迟到历史 applyEvents 之后**才武装 ——
    // 若在这里就设置，会被紧接着「清空旧内容」的过渡渲染提前消费掉（那一刻
    // scrollHeight≈0，钳制后归零），历史真正渲染时反而无指令可用，最终贴底。
    const savedScroll = sessionId != null ? readChatScroll(`${deviceId}\u0000${sessionId}`) : null
    const restoreTop = savedScroll != null && !savedScroll.atBottom ? savedScroll.scrollTop : null
    if (restoreTop != null) {
      // 先关掉贴底跟随：贴底 effect 与流式 pin 在恢复完成前不得把视图拉回底部
      stickToBottomRef.current = false
      setShowBottomButton(true)
    } else {
      stickToBottomRef.current = true
    }
    call<RemoteHistoryPage>(deviceId, 'GET', buildHistoryUrl(sessionId))
      .then((response) => {
        if (cancelled) return
        applyEvents(Array.isArray(response.events) ? response.events : [])
        // 历史已就绪：此刻武装恢复指令，由内容 commit 后的 layout effect 消费
        if (restoreTop != null) pendingScrollRestoreRef.current = restoreTop
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
          if (sessionId != null) forgetChatScroll(`${deviceId}\u0000${sessionId}`)
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
      // 切走前存档阅读进度。cleanup 在新会话内容 commit 前运行，此刻容器里还是
      // 旧会话的 DOM，scrollTop 即用户的真实阅读位置；贴底状态不存档
      // （见 rememberChatScroll —— 切回来本来就该贴底）。
      if (scrollNode != null && sessionId != null) {
        rememberChatScroll(`${deviceId}\u0000${sessionId}`, {
          scrollTop: scrollNode.scrollTop,
          atBottom: isChatScrollAtBottom(
            scrollNode.scrollTop,
            scrollNode.scrollHeight,
            scrollNode.clientHeight,
          ),
        })
      }
    }
  }, [applyEvents, applyHistory, call, deviceId, onSessionInvalid, sessionId])

  const handleStreamEvents = useCallback(
    (incoming: MobileBridgeEvent[]) => {
      applyEvents(mergeRemoteEvents(eventsRef.current, incoming))
      // 左侧列表实时同步：状态（运行中 ↔ 结束）与最新消息预览立即写回会话缓存，
      // 不等 30s 轮询；写回是绝对值覆盖，订阅重连回放同批事件也不会重复累计
      if (sessionId != null) patchSessionFromLiveEvents(deviceId, sessionId, incoming)
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
    [applyEvents, deviceId, sessionId],
  )

  useRemoteSessionStream(deviceId, sessionId, handleStreamEvents)

  const queuedTurnCount =
    queueSnapshot?.sessionId === sessionId ? queueSnapshot.queuedTurns.length : 0

  useEffect(() => {
    if (sessionId == null || queueApiSupported[deviceId] === false) return
    const initialTimer = window.setTimeout(() => void refreshQueueState(sessionId), 0)
    if (!running && queuedTurnCount === 0) {
      return () => window.clearTimeout(initialTimer)
    }
    const timer = window.setInterval(() => void refreshQueueState(sessionId), 3000)
    return () => {
      window.clearTimeout(initialTimer)
      window.clearInterval(timer)
    }
  }, [deviceId, queueApiSupported, queuedTurnCount, refreshQueueState, running, sessionId])

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
   * 乐观气泡可见性：事件流末尾出现同文本 user 消息 = 目标端已回录，交棒。
   * 判据用数据层 items（不是平滑后的 visibleItems）——揭示动画没播到末尾时，
   * 气泡也该按时退场，否则会和真实消息重叠。
   */
  const showPendingUser = isPendingUserVisible(items, pendingUser)
  /** 已送达但目标端还没吐第一个字：列表末尾渲染等待指示器（空窗期唯一反馈） */
  const awaitingResponse = running && isAwaitingResponse(items)

  /**
   * 快捷回复建议：从**原始事件**里找最近一次未被消费的建议（时间线把 tool_call
   * 折叠进活动段，不再保留 quickReplies）。有待回答的问答卡时不显示，与桌面端一致。
   */
  const pendingQuickReplies = useMemo(
    () => resolvePendingQuickReplies(events, { hasPendingQuestion: questions.length > 0 }),
    [events, questions.length],
  )
  /** 用户点过「关闭」的那一批：换了新的建议（不同 toolCallId）会重新出现 */
  const [dismissedQuickReply, setDismissedQuickReply] = useState<string | null>(null)
  const activeQuickReplies =
    pendingQuickReplies != null && pendingQuickReplies.toolCallId !== dismissedQuickReply
      ? pendingQuickReplies.replies
      : undefined

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

  /**
   * 会话切换后的阅读进度恢复：历史已渲染（绘制前）把视图放回存档位置而非贴底。
   * 存档值可能超出当前可滚动范围（后台新消息不改首屏，但富内容异步撑高前高度偏小），
   * 统一钳制兜底；用 layout effect 保证用户看不到「先贴底再跳回去」的闪烁。
   *
   * 消费时必须同步把 stickToBottomRef 压回 false：hydrate 的「清空旧内容」过渡渲染
   * 会让浏览器 clamp scrollTop 并派发 scroll 事件，handleScroll 按塌缩后的小距离把
   * stick 污染回 true——若不在这里纠正，同一 commit 里随后执行的贴底 effect 会立刻
   * 把刚恢复的位置覆盖回底部（真机轨迹实测：恢复写 2259 后 1ms 被贴底写 scrollHeight）。
   */
  useLayoutEffect(() => {
    const restoreTop = pendingScrollRestoreRef.current
    if (restoreTop == null) return
    pendingScrollRestoreRef.current = null
    const node = scrollRef.current
    if (node == null) return
    node.scrollTop = clampChatScrollTop(restoreTop, node.scrollHeight, node.clientHeight)
    stickToBottomRef.current = false
    setShowBottomButton(true)
  }, [visibleItems])

  useEffect(() => {
    const node = scrollRef.current
    // 恢复指令在途时不得贴底：过渡渲染可能已把 stick 污染成 true（见上方恢复 effect 注释）
    if (node == null || !stickToBottomRef.current || pendingScrollRestoreRef.current != null) {
      return
    }
    node.scrollTop = node.scrollHeight
  }, [visibleItems, showPendingUser, awaitingResponse])

  const handleScroll = useCallback(() => {
    const node = scrollRef.current
    if (node == null) return
    const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight
    stickToBottomRef.current = distanceFromBottom < 120
    setShowBottomButton(shouldShowScrollToBottom(distanceFromBottom))
    // 贴到顶部且内容确实可滚动 → 自动补一页更早的（loadEarlier 自带冷却与幂等守卫）
    if (node.scrollTop < HISTORY_TOP_THRESHOLD_PX && node.scrollHeight > node.clientHeight + 200) {
      void loadEarlier()
    }
  }, [loadEarlier])

  const handleScrollToBottom = useCallback(() => {
    const node = scrollRef.current
    if (node == null) return
    stickToBottomRef.current = true
    setShowBottomButton(false)
    node.scrollTo({ top: node.scrollHeight, behavior: 'smooth' })
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

  /**
   * 上传结果入待发条：同一路径不重复加。
   *
   * previews 用「本机文件名」做键——上传返回的是**目标端**路径，与本机路径不同名不同根，
   * 按路径查永远查不到（粘贴图片于是白等一轮远程回图）。目标端保存时保留了原始文件名
   * （见 registerMobileBridgeIpc 的 saveAttachments），所以文件名是两端唯一稳定的锚点。
   */
  const appendUploaded = useCallback(
    (uploaded: RemoteAgentAttachmentSummary[], previews?: Map<string, string>) => {
      setPendingAttachments((previous) => {
        const seen = new Set(previous.map((item) => item.path))
        const added = uploaded
          .filter((item) => !seen.has(item.path))
          .map((item) => {
            const previewUrl = previews?.get(item.name ?? fileNameOf(item.path))
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
          // 键用文件名，与 appendUploaded 查表的一侧对齐（见该函数的说明）
          previews.set(fileNameOf(saved.filePath), remoteFileUrl(saved.filePath))
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

  /**
   * 「重新发送」：把这条用户消息的正文与附件放回输入区。
   *
   * 附件直接复用目标端已有路径（不重新上传，也不会在目标机留下第二份）；
   * 纯附件消息的零宽占位正文由 toReusableDraft 抹掉，否则会把「请查看附件」当正文再发。
   */
  const handleReuseUserMessage = useCallback(
    (item: RemoteUserItem) => {
      setDraft(toReusableDraft(item.text))
      setPendingAttachments(
        item.attachments.map((attachment) => ({
          type: attachment.type,
          path: attachment.path,
          ...(attachment.name != null ? { name: attachment.name } : {}),
        })),
      )
      toast?.success(
        item.attachments.length > 0 ? '已填回输入框（含附件）' : '已填回输入框，可直接再次发送',
      )
    },
    [toast],
  )

  /**
   * 把一条待发消息提交到目标端（斜杠命令路由 + POST /turns），并推进乐观气泡状态机。
   *
   * 与 handleSend 分开：失败重发走同一入口（clientMessageId 复用即幂等键）。
   * 输入区的清空不在这里——发送瞬间就清，不等往返（见 handleSend）。
   */
  const submitPendingUser = useCallback(
    async (entry: {
      clientMessageId: string
      text: string
      attachments: RemoteAttachmentRef[]
    }) => {
      if (!sessionId) return
      setSending(true)
      try {
        // 斜杠命令走目标端的命令执行路由：/clear 这类本地命令不产生回合，
        // 技能命令则由目标端转给 agent（随后事件经流推送）。
        if (entry.text.startsWith('/') && entry.attachments.length === 0) {
          const result = await call<{
            isCommand: boolean
            forwardToAgent: boolean
            queued?: boolean
          }>(deviceId, 'POST', `/v1/sessions/${encodeURIComponent(sessionId)}/commands`, {
            raw: entry.text,
          })
          if (result.isCommand) {
            setError(null)
            if (result.forwardToAgent) {
              // 转给 agent 的技能命令同样产生回合：气泡留着等事件回流（命令
              // 响应没有 turnId，交棒走文本对账回退）；会话在跑时它同样会被
              // 排队，queued 态挂到 user 事件入库为止
              setPendingUser((previous) =>
                previous != null && previous.clientMessageId === entry.clientMessageId
                  ? { ...previous, status: 'sent', ...(result.queued ? { queued: true } : {}) }
                  : {
                      ...entry,
                      status: 'sent',
                      turnIds: [],
                      ...(result.queued ? { queued: true } : {}),
                    },
              )
              setRunning(true)
              if (result.queued === true) void refreshQueueState(sessionId)
            } else {
              // 本地命令不产生回合：气泡直接撤下
              setPendingUser(null)
            }
            return
          }
          // 不是已注册命令：按普通消息继续走下面的 /turns
        }
        const turn = await call<{ turnId: string; started: boolean }>(
          deviceId,
          'POST',
          `/v1/sessions/${encodeURIComponent(sessionId)}/turns`,
          {
            text: entry.text.length > 0 ? entry.text : ATTACHMENT_ONLY_TEXT,
            ...(entry.attachments.length > 0
              ? { attachmentPaths: entry.attachments.map((item) => item.path) }
              : {}),
            clientMessageId: entry.clientMessageId,
          },
        )
        setRunning(true)
        setError(null)
        // 真实 user_message 还要绕目标端一圈才回来：先转 sent，事件流出现同
        // turnId 的 user 条目后由 isPendingUserVisible 交棒给真实消息。
        // started=false = 已入队等当前回合结束：气泡标 queued 继续挂着，
        // 排队回合在起跑前不会产生 user_message 事件。
        setPendingUser((previous) =>
          previous != null && previous.clientMessageId === entry.clientMessageId
            ? {
                ...previous,
                status: 'sent',
                turnIds: [...previous.turnIds, turn.turnId],
                ...(turn.started ? {} : { queued: true }),
              }
            : previous,
        )
        // started=false（已入队）时立刻拉一次队列快照：排队面板马上能看到这条
        void refreshQueueState(sessionId)
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause)
        setError(message)
        // 不回滚输入区：文字还在气泡上，点它就能重发（与小程序端同一套路）
        setPendingUser((previous) =>
          previous != null && previous.clientMessageId === entry.clientMessageId
            ? { ...previous, status: 'failed', error: message }
            : previous,
        )
      } finally {
        setSending(false)
      }
    },
    [call, deviceId, refreshQueueState, sessionId],
  )

  /**
   * 发送一条消息。
   *
   * `quickReply` 走的是「建议 + 用户已打的补充」合成文本（与桌面端主输入区同一口径），
   * 合成后同样清空草稿；其余行为（斜杠命令、附件、清草稿存档）与手发完全一致。
   *
   * 输入区在提交前就清空、乐观气泡立即上屏：POST 要经中继绕一趟目标端，
   * 等它返回再动界面，慢一点就像「发了却没反应」。
   */
  const handleSend = useCallback(
    (options?: { quickReply?: string }) => {
      if (!sessionId || sending) return
      const reply = options?.quickReply
      const text = (reply != null ? buildQuickReplyMessage(reply, draft) : draft).trim()
      if (text.length === 0 && pendingAttachments.length === 0) return
      const entry = {
        clientMessageId: `desktop-remote-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        text,
        attachments: pendingAttachments,
      }
      setDraft('')
      setPendingAttachments([])
      clearRemoteDraft(deviceId, sessionId)
      setPendingUser({ ...entry, status: 'sending', turnIds: [] })
      stickToBottomRef.current = true
      void submitPendingUser(entry)
    },
    [deviceId, draft, pendingAttachments, sending, sessionId, submitPendingUser],
  )

  const handleStop = useCallback(async () => {
    if (!sessionId) return
    try {
      await call(deviceId, 'POST', `/v1/sessions/${encodeURIComponent(sessionId)}/cancel`)
      setRunning(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [call, deviceId, sessionId])

  /** 点击失败气泡：同一条消息重发（文字与附件都还在 pendingUser 里，clientMessageId 复用做幂等） */
  const retryPendingUser = useCallback(() => {
    if (pendingUser == null || pendingUser.status !== 'failed') return
    const entry = {
      clientMessageId: pendingUser.clientMessageId,
      text: pendingUser.text,
      attachments: pendingUser.attachments,
    }
    // 重试沿用同一 clientMessageId；已拿到的 turnIds 保留——上一次提交可能
    // 实际已在目标端入队，旧 turnId 的 user 事件同样能精确交棒
    setPendingUser((previous) =>
      previous != null ? { ...entry, status: 'sending', turnIds: previous.turnIds } : previous,
    )
    void submitPendingUser(entry)
  }, [pendingUser, submitPendingUser])

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
        {onToggleProjectPanel != null && (
          <button
            type="button"
            className={`rc-icon-btn rc-chat-panel-toggle${projectPanelOpen ? ' is-active' : ''}`}
            onClick={onToggleProjectPanel}
            title={projectPanelOpen ? '收起项目信息面板' : '查看项目信息'}
            aria-label={projectPanelOpen ? '收起项目信息面板' : '查看项目信息'}
            aria-pressed={projectPanelOpen === true}
          >
            <Icons.Folder size={13} />
          </button>
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
        <RemoteMessageList
          items={visibleItems}
          deviceId={deviceId}
          running={running}
          onReuseUserMessage={handleReuseUserMessage}
          {...(showPendingUser && pendingUser != null ? { pendingUser } : {})}
          {...(awaitingResponse ? { awaitingResponse: true } : {})}
          {...(pendingUser?.status === 'failed' ? { onRetryPendingUser: retryPendingUser } : {})}
        />
        {showBottomButton && (
          <button
            type="button"
            className="rc-scroll-bottom-btn"
            onClick={handleScrollToBottom}
            aria-label="回到底部"
            title="回到底部"
          >
            <Icons.ArrowDown size={13} />
          </button>
        )}
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
        deviceName={deviceName}
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
        queueSnapshot={queueSnapshot?.sessionId === sessionId ? queueSnapshot : null}
        {...(activeQuickReplies != null ? { quickReplies: activeQuickReplies } : {})}
        onPickQuickReply={(reply) => void handleSend({ quickReply: reply })}
        onDismissQuickReplies={() =>
          setDismissedQuickReply(pendingQuickReplies?.toolCallId ?? null)
        }
      />
    </section>
  )
}
