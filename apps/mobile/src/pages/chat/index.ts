/**
 * 远程对话页。
 *
 * 接替桌面端会话：进入即拉全量历史，随后经云端中继 WebSocket 增量跟流；
 * 发送消息走 submitTurn（与桌面端发送同一会话同一回合机制）。
 * 路由带 deviceId 时所有调用与 sub/unsub 定向到该电脑；onShow 校验其在线状态，
 * 离线显示顶部提示条（仍可看历史）。
 *
 * 能力面（2026-10-14 扩展）：
 *   配置条    助手 / 模型 / 权限策略 / 推理强度 / 工作流 / 项目 → 半屏面板切换
 *   附件      图片/文件上传（桌面端落盘）→ 随回合提交；技能/命令快捷插入
 *   语音      按住说话 → 桌面端转写（本地 SenseVoice → 云渠道）→ 填入输入框
 *   命令      / 前缀补全 → executeCommand（设置型主进程生效，技能型转发 agent）
 *   定时任务  独立任务页（pages/session-tasks，chat 页菜单跳转）
 *   分支      长按用户气泡「从此处分支」→ 复制子会话；lineage-banner 展示分支关系
 *
 * 渲染分层：BridgeEvent → chat-reducer(消息列表) → chat-view(渲染项+时间分界) → setData。
 * 流式期间 setData 做了 100ms 合并节流，避免高频 delta 卡顿。
 * 滚动策略：贴底才跟随流式自动回底；用户上滑查看历史即停止跟随（悬浮「最新」回底）。
 */

import * as bridge from '../../api/bridge'
import {
  applyEvents,
  emptyTimeline,
  filterUnseenEvents,
  type ChatTimeline,
} from '../../utils/chat-reducer'
import {
  buildTimelineItems,
  filterExecutionDetails,
  type TimelineItem,
} from '../../utils/chat-view'
import { formatRelativeTime } from '../../utils/format'
import { logMobileError } from '../../utils/logger'
import {
  buildApprovalCardViews,
  buildQuestionAnswerPayload,
  buildQuestionCardViews,
  buildQuestionSkipPayload,
  emptyQuestionDraft,
  questionDraftKey,
  type ApprovalCardView,
  type QuestionCardView,
  type QuestionDraft,
} from '../../utils/interaction-view'
import { PERMISSION_LABELS, REASONING_LABELS } from '../../utils/session-config'
import { getItem, setItem, StorageKeys } from '../../utils/storage'

interface ComposerAttachmentView {
  type: 'image' | 'file'
  path: string
  name: string
  /** 本地临时路径（图片上传前预览；上传后用桌面端预览地址） */
  localPath?: string
  uploaded: boolean
}

interface ChipView {
  key: string
  label: string
  value: string
}

interface PanelOptionView {
  id: string
  label: string
  sub?: string
  checked?: boolean
  disabled?: boolean
}

type PanelKind =
  | 'agent'
  | 'model'
  | 'permission'
  | 'reasoning'
  | 'workflow'
  | 'project'
  | 'skill'
  | 'command'
  | 'branch'

interface ChatPageData {
  sessionId: string
  /** 定向的桌面端 deviceId（'' = 主桌面端；路由传入） */
  deviceId: string
  /** 所选电脑是否离线（离线仍可看历史，顶部提示条） */
  deviceOffline: boolean
  title: string
  updatedAtLabel: string
  items: ReturnType<typeof buildTimelineItems>
  running: boolean
  inputText: string
  loading: boolean
  connected: boolean
  /** scroll-into-view 目标（固定锚点 id；'' = 不锚定，跟随用户滚动位置） */
  scrollToId: string
  /** 悬浮「最新」按钮显隐（用户上滑查看历史时出现） */
  showJumpLatest: boolean
  /** 历史向上翻页中（顶部提示「加载更早消息…」） */
  loadingEarlier: boolean
  /** 首屏历史已经成功返回；与空历史及请求失败区分 */
  historyLoaded: boolean
  historyError: string
  /** 是否还有更早历史（false 或旧版桌面端缺省时顶部显示「已到最前面」仅当确认拉完） */
  hasMoreHistory: boolean
  /** 隐藏工具调用与思考记录（沿用旧存储键，兼容已有本地偏好） */
  hideExecutionDetails: boolean
  /** 键盘弹起中（dock 安全区让位，避免与键盘高度叠加出缝） */
  keyboardOpen: boolean
  // ── 分支（Session Fork 血缘横幅） ──
  /** fork 来源会话标题（'' = 当前会话不是 fork 副本，横幅隐藏） */
  lineageSourceTitle: string
  /** 直接子分支数（0 = 横幅右半隐藏） */
  lineageChildCount: number
  // ── 配置条与面板 ──
  chips: ChipView[]
  panelShow: boolean
  panelKind: PanelKind | ''
  panelTitle: string
  panelMode: 'list' | 'slider'
  panelOptions: PanelOptionView[]
  panelSliderOptions: string[]
  panelSliderIndex: number
  panelLoading: boolean
  panelEmpty: string
  // ── 输入扩展 ──
  attachments: ComposerAttachmentView[]
  commands: bridge.BridgeCommandItem[]
  /** 斜杠命令补全面板显隐（输入以 / 开头且尚未带参数时显示） */
  showCommands: boolean
  /** 桌面端支持 /v1/skills（false = 旧版桌面端，附件菜单隐藏技能入口） */
  skillsAvailable: boolean
  recording: boolean
  transcribing: boolean
  // ── 挂起交互卡（权限审批 + 用户问答，置于输入区上方） ──
  approvalCards: (ApprovalCardView & { busy?: boolean })[]
  questionCards: QuestionCardView[]
}

const FLUSH_INTERVAL_MS = 100
/** 附件单回合上限（与桌面端 normalizeTurnAttachments 一致） */
const MAX_ATTACHMENTS = 20
/** 挂起交互轮询间隔：回合进行中或有卡片挂起时 3s，空闲 15s 兜底（桌面端无下行推送） */
const INTERACTION_POLL_ACTIVE_MS = 3_000
const INTERACTION_POLL_IDLE_MS = 15_000
/** 距底部 ≤ 该像素视为「贴底」：贴底才跟随流式内容自动回底 */
const BOTTOM_STICKY_THRESHOLD_PX = 100
/** 松手后惯性滚动仍视为用户滚动的窗口（ms），窗口外的 scroll 事件是程序化回底/锚定调整 */
const SCROLL_MOMENTUM_WINDOW_MS = 800

/** 单张图片保存到系统相册（回调 → Promise；拒绝授权时 errMsg 带 auth deny） */
function saveImageToPhotosAlbum(filePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    wx.saveImageToPhotosAlbum({
      filePath,
      success: () => resolve(),
      fail: (err) => reject(new Error(err.errMsg ?? 'saveImageToPhotosAlbum fail')),
    })
  })
}

Page({
  data: {
    sessionId: '',
    deviceId: '',
    deviceOffline: false,
    title: '对话',
    updatedAtLabel: '',
    items: [],
    running: false,
    inputText: '',
    loading: true,
    connected: false,
    scrollToId: '',
    showJumpLatest: false,
    loadingEarlier: false,
    historyLoaded: false,
    historyError: '',
    hasMoreHistory: false,
    hideExecutionDetails: false,
    keyboardOpen: false,
    lineageSourceTitle: '',
    lineageChildCount: 0,
    chips: [] as ChipView[],
    panelShow: false,
    panelKind: '' as PanelKind | '',
    panelTitle: '',
    panelMode: 'list',
    panelOptions: [] as PanelOptionView[],
    panelSliderOptions: [] as string[],
    panelSliderIndex: 0,
    panelLoading: false,
    panelEmpty: '',
    attachments: [] as ComposerAttachmentView[],
    commands: [] as bridge.BridgeCommandItem[],
    showCommands: false,
    skillsAvailable: false,
    recording: false,
    transcribing: false,
    approvalCards: [] as ApprovalCardView[],
    questionCards: [] as QuestionCardView[],
  } as ChatPageData,

  /** 最近一次渲染的消息快照（节流合并的基准） */
  latestTimeline: null as ChatTimeline | null,
  flushTimer: 0 as ReturnType<typeof setTimeout> | 0,
  closeStream: null as (() => void) | null,
  /** 乐观渲染的本地用户消息占位（流式回包后按文本匹配清除，防双气泡） */
  localPending: null as { key: string; text: string } | null,
  /** 最近一次收到事件的时间（watchdog 判卡死用） */
  lastEventAt: 0,
  /** 运行中卡死看门狗：running 且长时间无事件 → 重拉全量校正 */
  watchdogTimer: 0 as ReturnType<typeof setInterval> | 0,
  /** 选项目录（进入会话拉一次，配置面板数据源） */
  catalog: null as bridge.BridgeCatalog | null,
  /** 当前运行配置（chips 数据源） */
  runtime: null as bridge.BridgeSessionRuntime | null,
  /** 本次进入会话期间发送过的附件（按消息文本索引，用户气泡下方渲染） */
  sentAttachmentsByText: {} as Record<string, bridge.BridgeAttachment[]>,
  /** 用户主动展开的思考段落；流式重绘时保留展开状态。 */
  expandedThinkingKeys: new Set<string>(),
  /** 命令目录原始数据（补全过滤用） */
  commandCatalog: [] as bridge.BridgeCommandItem[],
  /** 技能目录原始数据（技能选择面板数据源；旧版桌面端为空） */
  skillCatalog: [] as bridge.BridgeSkillItem[],
  /** 当前会话分支血缘（横幅与跳转数据源；null = 非分支会话） */
  lineage: null as bridge.BridgeLineage | null,
  /** 直接子分支（点开分支列表用） */
  lineageChildren: [] as bridge.BridgeLineage[],
  /** 已发起过缓存解析的 media 消息 key（流式全量重绘时防重复触发） */
  mediaResolvedKeys: new Set<string>(),
  /** 正在保存到相册的 media 消息 key（防重复点击；渲染态经 decorateItem 回填） */
  mediaSavingKeys: new Set<string>(),
  /** 已发起过缓存解析的历史附件用户消息 key */
  userAttachResolvedKeys: new Set<string>(),
  /** 历史附件图片解析结果（消息 key → 桌面路径 → 本地缓存路径） */
  userAttachPreviews: {} as Record<string, Record<string, string>>,
  /** 设备列表订阅取消函数（onShow 校验所选电脑在线状态 + 实时刷新） */
  unsubscribeDevices: null as (() => void) | null,
  /** 已加载的全部历史事件（按 seq 升序累积；向上翻页时前插） */
  allEvents: [] as bridge.BridgeEvent[],
  /** 中继重连会重放当前回合事件；页面级 ID 集合去重，避免 delta 被二次拼接。 */
  seenEventIds: new Set<string>(),
  /** 与桌面端 ChatView 对齐：每页完整 12 个 turn；eventLimit 是软上限，单个 turn 不会被切碎。 */
  historyTurnPageSize: 12,
  historyEventPageLimit: 1200,
  /** 原始事件游标，即使服务端映射器过滤掉本页所有事件也能继续向前翻页。 */
  historyCursor: null as number | null,
  historyGeneration: 0,
  /** 挂起交互轮询定时器（自适应间隔；onUnload 回收） */
  interactionTimer: 0 as ReturnType<typeof setTimeout> | 0,
  /** 页面已卸载标记：在途轮询回来后不得再布防下一轮（防 onUnload 后定时器泄漏） */
  interactionPollStopped: false,
  /** 服务端挂起交互原始快照（用于新旧对比与乐观移除） */
  pendingApprovals: [] as bridge.BridgeApprovalItem[],
  pendingQuestions: [] as bridge.BridgeQuestionItem[],
  /** 问答卡本地草稿（cardKey = `${questionId}#${index}`） */
  questionDrafts: {} as Record<string, QuestionDraft>,
  /** 应答提交中的卡片（审批 requestId / 问答 questionId），渲染 busy 态防重复提交 */
  submittingKeys: new Set<string>(),
  /**
   * 用户滚动意图：true = 贴底，跟随流式内容自动回底；
   * 用户上滑查看历史后转 false，流式刷新不再回底（不再抢滚动视口）。
   */
  stickBottom: true as boolean,
  /** scroll-view 视口高度 px（onReady 测量；键盘弹起后复测），用于算距底距离 */
  scrollViewHeight: 0 as number,
  /** 手指正按在消息区上（拖拽中的 scroll 事件才算用户滚动） */
  scrollTouching: false as boolean,
  /** 最近一次松手时间戳：松手后的惯性滚动在窗口期内仍视为用户滚动 */
  lastScrollTouchEndAt: 0 as number,

  onLoad(options: Record<string, string | undefined>) {
    this.expandedThinkingKeys = new Set<string>()
    this.interactionPollStopped = false
    const deviceId = options.deviceId ?? ''
    if (!deviceId) {
      // 聊天必须继承项目层传入的电脑，缺少上下文时回到顶层重新选择。
      wx.redirectTo({ url: '/pages/home/index' })
      return
    }
    const sessionId = options.sessionId ?? ''
    if (!sessionId) {
      wx.showToast({ title: '缺少会话 ID', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 600)
      return
    }
    this.setData({
      sessionId,
      deviceId,
      title: options.title ? decodeURIComponent(options.title) : '对话',
      // 工具记录显隐是本地持久偏好，进入页面即生效
      hideExecutionDetails: getItem<boolean>(StorageKeys.chatHideToolEvents) === true,
    })
    // presence 增量：所选电脑上下线时刷新顶部离线提示条
    this.unsubscribeDevices = bridge.onRelayDevicesChanged(() => this.refreshDeviceOnline())
    // 配置目录/命令目录/技能目录异步补齐，不阻塞首屏历史
    void this.loadCatalog()
    void this.loadCommands()
    void this.loadSkills()
  },

  onReady() {
    this.measureScrollViewHeight()
  },

  onShow() {
    this.refreshDeviceOnline()
    void this.init()
  },

  onUnload() {
    this.historyGeneration += 1
    if (this.flushTimer) clearTimeout(this.flushTimer)
    if (this.watchdogTimer) clearInterval(this.watchdogTimer)
    this.watchdogTimer = 0
    this.interactionPollStopped = true
    if (this.interactionTimer) clearTimeout(this.interactionTimer)
    this.interactionTimer = 0
    this.closeStream?.()
    this.closeStream = null
    this.unsubscribeDevices?.()
    this.unsubscribeDevices = null
  },

  /** 聊天页只使用路由继承的电脑，不回退到中继默认选择。 */
  targetDeviceId(): string {
    return this.data.deviceId
  },

  /** 所选电脑是否在线：presence 已知时刷新顶部提示条；未知（WS 未连上）时不误报 */
  refreshDeviceOnline() {
    const deviceId = this.data.deviceId
    if (!deviceId) {
      if (this.data.deviceOffline) this.setData({ deviceOffline: false })
      return
    }
    if (!bridge.isRelayPresenceFresh()) return
    const online = bridge.getRelayPresenceDevices().some((item) => item.deviceId === deviceId)
    const offline = !online
    if (offline === this.data.deviceOffline) return
    this.setData({ deviceOffline: offline })
  },

  async init() {
    const { sessionId } = this.data
    if (!sessionId) return
    const generation = ++this.historyGeneration
    this.closeStream?.()
    this.closeStream = null
    this.setData({ loading: true, historyError: '', historyLoaded: false, connected: false })
    try {
      const [firstPage] = await Promise.all([
        bridge.getMessages(sessionId, {
          deviceId: this.targetDeviceId(),
          turnLimit: this.historyTurnPageSize,
          eventLimit: this.historyEventPageLimit,
        }),
        this.refreshRuntime().catch(() => undefined),
      ])
      if (generation !== this.historyGeneration) return
      const events = [...firstPage.events]
      let hasMore = this.resolveHasMore(firstPage)
      let cursor = firstPage.nextBeforeSeq ?? firstPage.events[0]?.seq ?? null
      let skippedPages = 0
      while (!this.hasRenderableHistory(events) && hasMore && skippedPages < 8) {
        if (cursor == null) throw new Error('历史分页缺少游标，请重试加载记录')
        const page = await bridge.getMessages(sessionId, {
          deviceId: this.targetDeviceId(),
          beforeSeq: cursor,
          turnLimit: this.historyTurnPageSize,
          eventLimit: this.historyEventPageLimit,
        })
        if (generation !== this.historyGeneration) return
        const nextCursor = page.nextBeforeSeq ?? page.events[0]?.seq ?? null
        const seen = new Set(events.map((event) => event.id))
        for (const event of page.events) {
          if (!seen.has(event.id)) events.push(event)
        }
        hasMore = this.resolveHasMore(page)
        if (hasMore && (nextCursor == null || nextCursor >= cursor)) {
          throw new Error('历史分页游标未向更早记录推进，请重试加载记录')
        }
        cursor = nextCursor
        skippedPages += 1
      }
      this.allEvents = events.sort((a, b) => a.seq - b.seq)
      this.seenEventIds = new Set(this.allEvents.map((event) => event.id))
      this.historyCursor = cursor
      this.setData({ hasMoreHistory: hasMore, historyLoaded: true })
      const timeline = applyEvents(emptyTimeline(), this.allEvents)
      this.latestTimeline = timeline
      this.localPending = null
      this.lastEventAt = Date.now()
      this.flushTimeline(true)
      this.connectStream()
      this.startWatchdog()
      // 分支血缘横幅（旧版桌面端 404 静默隐藏）
      void this.loadLineage()
      // 挂起交互立刻对一次账（进入页面可能正有等确认的审批/问答），随后自适应轮询
      void this.pollInteractions()
    } catch (error) {
      if (generation === this.historyGeneration) {
        const message = (error as Error).message || '历史加载失败'
        this.setData({ historyError: message, historyLoaded: false, connected: false })
      }
    } finally {
      if (generation === this.historyGeneration) this.setData({ loading: false })
    }
  },

  onRetryHistory() {
    this.stickBottom = true
    this.setData({ showJumpLatest: false })
    void this.init()
  },

  /** A page may contain only event types omitted from the mobile timeline. */
  hasRenderableHistory(events: bridge.BridgeEvent[]): boolean {
    return buildTimelineItems(applyEvents(emptyTimeline(), events).messages).some(
      (item) => item.kind !== 'time',
    )
  },

  /** hasMore 归一：新版桌面端以服务端为准；旧版缺省时按「满页即可能还有」兜底 */
  resolveHasMore(history: Awaited<ReturnType<typeof bridge.getMessages>>): boolean {
    if (typeof history.hasMore === 'boolean') return history.hasMore
    return history.events.length >= 200
  },

  /**
   * 向上翻页：scroll-view 顶部触底触发。
   * 以当前已加载最小 seq 为游标拉更早一页，按事件 id 去重后前插并全量重放时间线；
   * scroll-view 开了 scroll-anchoring，前插内容时视觉位置不跳。
   */
  async loadEarlier() {
    if (this.data.loading || this.data.loadingEarlier || !this.data.hasMoreHistory) return
    const initialCursor = this.historyCursor ?? this.allEvents[0]?.seq
    if (initialCursor == null) return
    this.setData({ loadingEarlier: true })
    try {
      let cursor = initialCursor
      let hasMore: boolean = this.data.hasMoreHistory
      const seen = new Set(this.allEvents.map((event) => event.id))
      const freshEvents: bridge.BridgeEvent[] = []

      // 个别历史页可能只有移动端不展示的内部事件。继续用原始游标向前扫，
      // 不把「本页没有可渲染事件」误判成「已经到最前面」。每次手势最多扫 8 页。
      for (let page = 0; page < 8 && hasMore && freshEvents.length === 0; page += 1) {
        const history = await bridge.getMessages(this.data.sessionId, {
          deviceId: this.targetDeviceId(),
          beforeSeq: cursor,
          turnLimit: this.historyTurnPageSize,
          eventLimit: this.historyEventPageLimit,
        })
        const nextCursor = history.nextBeforeSeq ?? history.events[0]?.seq ?? null
        for (const event of history.events) {
          if (!seen.has(event.id)) freshEvents.push(event)
        }
        hasMore = this.resolveHasMore(history)
        if (!hasMore) {
          this.historyCursor = nextCursor
          break
        }
        if (nextCursor == null || nextCursor >= cursor) {
          throw new Error('历史分页游标未向更早记录推进，请刷新后重试')
        }
        cursor = nextCursor
        this.historyCursor = cursor
      }
      if (freshEvents.length > 0) {
        for (const event of freshEvents) this.seenEventIds.add(event.id)
        this.allEvents = [...freshEvents, ...this.allEvents].sort((a, b) => a.seq - b.seq)
        const timeline = applyEvents(emptyTimeline(), this.allEvents)
        this.latestTimeline = timeline
        // 顶部加载：保持当前视觉位置，不触发回底。
        this.flushTimeline(true, { keepScroll: true })
      }
      this.setData({ hasMoreHistory: hasMore })
    } catch (error) {
      wx.showToast({ title: (error as Error).message || '加载更早消息失败', icon: 'none' })
    } finally {
      this.setData({ loadingEarlier: false })
    }
  },

  connectStream() {
    this.closeStream?.()
    this.closeStream = bridge.connectStream(
      this.data.sessionId,
      {
        onOpen: () => {
          // 连接状态以真实 onOpen 为准（此前在发起连接时同步置 true，WS 失败也显示已连接）
          this.setData({ connected: true })
        },
        onEvent: (events) => {
          const unseenEvents = filterUnseenEvents(this.seenEventIds, events)
          if (unseenEvents.length === 0) return
          const base = this.latestTimeline ?? emptyTimeline()
          const timeline = applyEvents(base, unseenEvents)
          // 乐观占位去重：真实 user_message 到达且文本匹配 → 移除本地占位，避免双气泡
          if (this.localPending != null) {
            const confirmed = unseenEvents.some(
              (event) =>
                event.type === 'user_message' &&
                (event.content ?? '').trim() === this.localPending?.text,
            )
            if (confirmed) {
              timeline.messages = timeline.messages.filter(
                (item) => item.key !== this.localPending?.key,
              )
              this.localPending = null
            }
          }
          this.latestTimeline = timeline
          this.lastEventAt = Date.now()
          this.flushTimeline()
          // 桌面端弹审批/问答会先落 waiting 状态事件：立刻对一次账，卡片不用等下一轮轮询
          if (
            unseenEvents.some(
              (event) =>
                event.type === 'agent_status' &&
                (event.status === 'waiting_permission' || event.status === 'waiting_user'),
            )
          ) {
            void this.pollInteractions()
          }
        },
        onError: () => {
          this.setData({ connected: false })
          // bridge 内部自动重连；watchdog 兜底校正状态
        },
        onClose: () => {
          this.setData({ connected: false })
        },
      },
      this.targetDeviceId(),
    )
  },

  /** 运行中看门狗：running 且 45s 无任何事件 → 重拉全量校正（覆盖漏推/断流/running 卡死） */
  startWatchdog() {
    if (this.watchdogTimer) clearInterval(this.watchdogTimer)
    this.watchdogTimer = setInterval(() => {
      if (this.data.running && Date.now() - this.lastEventAt > 45_000) {
        this.lastEventAt = Date.now()
        void this.init()
      }
    }, 20_000)
  },

  /**
   * 渲染节流：高频流式事件合并为每 100ms 一次 setData；force 立即刷。
   * opts.keepScroll：顶部加载更早消息时保持视觉位置，不回底。
   */
  flushTimeline(force = false, opts?: { keepScroll?: boolean }) {
    const paint = () => {
      this.flushTimer = 0
      const timeline = this.latestTimeline
      if (!timeline) return
      const items = filterExecutionDetails(
        buildTimelineItems(timeline.messages),
        this.data.hideExecutionDetails,
      ).map((item) => this.decorateItem(item))
      this.setData({
        items,
        running: timeline.running,
      })
      if (opts?.keepScroll !== true) this.scrollToBottom()
    }
    if (force) {
      if (this.flushTimer) clearTimeout(this.flushTimer)
      paint()
      return
    }
    if (this.flushTimer) return
    this.flushTimer = setTimeout(paint, FLUSH_INTERVAL_MS)
  },

  /**
   * 渲染项装饰：
   *   thinking  展开态回填
   *   user      附件视图（本次发送用本地图；历史消息图片经本地缓存异步解析）
   *   media     产物图片条（桌面路径经本地缓存异步解析为 previews）
   */
  decorateItem(item: TimelineItem): TimelineItem {
    if (item.kind === 'thinking') {
      return { ...item, expanded: this.expandedThinkingKeys.has(item.key) }
    }
    if (item.kind === 'media') {
      const previews = item.previews ?? []
      if (previews.length !== item.paths.length) void this.resolveMediaItem(item.key, item.paths)
      const saving = this.mediaSavingKeys.has(item.key)
      if (previews.length === 0 && !saving) return item
      return { ...item, previews: previews.length > 0 ? previews : undefined, saving }
    }
    if (item.kind !== 'user') return item
    // 优先本次会话发送时挂载的附件（手机本地原图直显）
    const sent = this.sentAttachmentsByText[item.text]
    if (sent != null && sent.length > 0) {
      const views = sent.map((att) => ({
        ...att,
        // 小程序访问不到桌面端本地路径，直接预览手机本地那份原图
        previewUrl: att.type === 'image' ? ((att as { localPath?: string }).localPath ?? '') : '',
      }))
      return { ...item, attachments: views } as TimelineItem
    }
    // 历史消息透传的附件（旧版桌面端无该字段）：图片经本地缓存解析后可预览
    const historyAtts = item.attachments
    if (historyAtts == null || historyAtts.length === 0) return item
    if (!this.userAttachResolvedKeys.has(item.key)) {
      void this.resolveUserAttachments(item.key, historyAtts)
    }
    const views = historyAtts.map((att) => ({
      ...att,
      previewUrl: att.type === 'image' ? (this.userAttachPreviews[item.key]?.[att.path] ?? '') : '',
    }))
    return { ...item, attachments: views } as TimelineItem
  },

  /**
   * media 条图片解析：桌面路径 → 本地缓存路径，完成后回填对应渲染项的 previews。
   * 并发去重由 image-cache inflight 保证；mediaResolvedKeys 防流式全量重绘重复触发。
   */
  async resolveMediaItem(key: string, paths: string[]) {
    if (this.mediaResolvedKeys.has(key)) return
    this.mediaResolvedKeys.add(key)
    const deviceId = this.targetDeviceId()
    const resolved = await Promise.all(
      paths.map((path) => bridge.fetchRelayAttachmentTempPath(path, deviceId)),
    )
    const previews = resolved.filter((path): path is string => path != null)
    if (previews.length === 0) return
    const index = this.data.items.findIndex((item) => item.kind === 'media' && item.key === key)
    if (index < 0) return
    this.setData({ [`items[${index}].previews`]: previews })
  },

  /** 历史用户附件图片解析（同 media 条机制；解析结果按 key+path 记录） */
  async resolveUserAttachments(
    key: string,
    attachments: NonNullable<Extract<TimelineItem, { kind: 'user' }>['attachments']>,
  ) {
    if (this.userAttachResolvedKeys.has(key)) return
    this.userAttachResolvedKeys.add(key)
    const deviceId = this.targetDeviceId()
    const images = attachments.filter((att) => att.type === 'image')
    if (images.length === 0) return
    const resolved = await Promise.all(
      images.map((att) => bridge.fetchRelayAttachmentTempPath(att.path, deviceId)),
    )
    const byPath: Record<string, string> = {}
    images.forEach((att, i) => {
      const local = resolved[i]
      if (local != null) byPath[att.path] = local
    })
    if (Object.keys(byPath).length === 0) return
    this.userAttachPreviews = { ...this.userAttachPreviews, [key]: byPath }
    // 重刷渲染项（decorateItem 会按新 previews 重组 attachment views）
    if (this.latestTimeline != null) this.flushTimeline(true, { keepScroll: true })
  },

  /** 按 key 查找 media 渲染项（预览与保存共用） */
  findMediaItem(key: string): Extract<TimelineItem, { kind: 'media' }> | null {
    const item = this.data.items.find((it) => it.kind === 'media' && it.key === key)
    return item != null && item.kind === 'media' ? item : null
  },

  /** 缩略图点击 → 全屏预览（同条多图可左右滑动） */
  onMediaImageTap(
    e: WechatMiniprogram.BaseEvent<WechatMiniprogram.IAnyObject, { key: string; idx: number }>,
  ) {
    const key = e.currentTarget.dataset.key
    if (typeof key !== 'string' || key.length === 0) return
    const item = this.findMediaItem(key)
    const previews = item?.previews
    if (previews == null || previews.length === 0) return
    const idx = e.currentTarget.dataset.idx
    const current =
      typeof idx === 'number' && idx >= 0 && idx < previews.length ? previews[idx] : previews[0]
    wx.previewImage({ urls: previews, current })
  },

  /** 底部操作按钮组：保存整条图片到系统相册（移动端承载桌面端「复制/下载图片」） */
  async onMediaSave(e: WechatMiniprogram.BaseEvent<WechatMiniprogram.IAnyObject, { key: string }>) {
    const key = e.currentTarget.dataset.key
    if (typeof key !== 'string' || key.length === 0) return
    if (this.mediaSavingKeys.has(key)) return
    const item = this.findMediaItem(key)
    const previews = item?.previews ?? []
    if (previews.length === 0) {
      wx.showToast({ title: '图片还在加载中，请稍后再试', icon: 'none' })
      return
    }

    this.mediaSavingKeys.add(key)
    this.setMediaItemSaving(key, true)
    let saved = 0
    let denied = false
    for (const filePath of previews) {
      try {
        await saveImageToPhotosAlbum(filePath)
        saved += 1
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (message.includes('auth deny') || message.includes('authorize')) {
          denied = true
        } else {
          logMobileError('mobile-chat', 'media-save-album', error)
        }
      }
    }
    this.mediaSavingKeys.delete(key)
    this.setMediaItemSaving(key, false)

    if (saved === 0 && denied) {
      wx.showModal({
        title: '需要相册权限',
        content: '保存图片需要「添加到相册」权限，请在设置中开启',
        confirmText: '去设置',
        success: (res) => {
          if (res.confirm) void wx.openSetting({})
        },
      })
      return
    }
    if (saved === 0) {
      wx.showToast({ title: '保存失败，请重试', icon: 'none' })
      return
    }
    wx.showToast({
      title:
        saved === previews.length
          ? `已保存 ${saved} 张到相册`
          : `已保存 ${saved}/${previews.length} 张`,
      icon: 'success',
    })
  },

  /** 回填单条 media 渲染项的 saving 态（按钮 busy 展示） */
  setMediaItemSaving(key: string, saving: boolean) {
    const index = this.data.items.findIndex((it) => it.kind === 'media' && it.key === key)
    if (index < 0) return
    this.setData({ [`items[${index}].saving`]: saving })
  },

  onThinkingToggle(e: WechatMiniprogram.BaseEvent<WechatMiniprogram.IAnyObject, { key: string }>) {
    const key = e.currentTarget.dataset.key
    if (typeof key !== 'string' || key.length === 0) return
    if (this.expandedThinkingKeys.has(key)) this.expandedThinkingKeys.delete(key)
    else this.expandedThinkingKeys.add(key)

    const expanded = this.expandedThinkingKeys.has(key)
    const items = this.data.items.map((item) =>
      item.kind === 'thinking' && item.key === key ? { ...item, expanded } : item,
    )
    this.setData({ items })
  },

  scrollToBottom() {
    // 用户上滑查看历史时不再抢滚动视口：仅贴底跟随态才回底；
    // 强制回底走 onJumpLatest / onSend（先恢复 stickBottom 再调本方法）。
    if (!this.stickBottom) return
    setTimeout(() => {
      this.setData({ scrollToId: 'chat-anchor' })
    }, 60)
  },

  // ─── 滚动意图跟踪（贴底跟随 / 上滑停止跟随 + 悬浮「最新」按钮） ─────────────

  /** 测量消息区视口高度（scroll 事件里算距底距离用） */
  measureScrollViewHeight() {
    wx.createSelectorQuery()
      .in(this)
      .select('.chat-scroll')
      .boundingClientRect((rect) => {
        if (rect != null && rect.height > 0) this.scrollViewHeight = rect.height
      })
      .exec()
  },

  /**
   * 用户滚动意图判定：距底 ≤ 阈值视为贴底（恢复跟随），超过则停止跟随并亮出「最新」按钮。
   * 只采信触摸驱动的 scroll 事件（拖拽中 / 松手惯性窗口内）：
   * 程序化回底与 scroll-anchoring 前插调整也会触发 scroll，但期间没有触摸，不算用户意图。
   */
  onChatScroll(e: WechatMiniprogram.CustomEvent<{ scrollTop: number; scrollHeight: number }>) {
    const userDriven =
      this.scrollTouching || Date.now() - this.lastScrollTouchEndAt < SCROLL_MOMENTUM_WINDOW_MS
    if (!userDriven) return
    if (this.scrollViewHeight <= 0) return
    const { scrollTop, scrollHeight } = e.detail
    if (typeof scrollTop !== 'number' || typeof scrollHeight !== 'number') return
    const sticky = scrollHeight - scrollTop - this.scrollViewHeight <= BOTTOM_STICKY_THRESHOLD_PX
    if (sticky === this.stickBottom) return
    this.stickBottom = sticky
    if (sticky) {
      this.setData({ showJumpLatest: false })
    } else {
      // 清空锚点：后续流式重绘不再携带 scroll-into-view，滚动位置完全交给用户
      this.setData({ scrollToId: '', showJumpLatest: true })
    }
  },

  onScrollTouchStart() {
    this.scrollTouching = true
  },

  onScrollTouchEnd() {
    this.scrollTouching = false
    this.lastScrollTouchEndAt = Date.now()
  },

  /** 悬浮「最新」：强制回底并恢复贴底跟随 */
  onJumpLatest() {
    this.stickBottom = true
    this.setData({ showJumpLatest: false })
    this.scrollToBottom()
  },

  // ─── 输入 ───────────────────────────────────────────────────────────────────

  onInput(e: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const value = e.detail.value
    // WXML 表达式不支持字符串下标（inputText[0]），补全显隐在 TS 层算好；
    // 已敲空格进入参数区后不再弹补全
    this.setData({
      inputText: value,
      showCommands: value.startsWith('/') && !value.includes(' '),
    })
  },

  async onSend(e: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const text = (e.detail.value ?? this.data.inputText).trim()
    if (!text || this.data.running) return
    const attachments = this.data.attachments
    const uploadPending = attachments.some((item) => !item.uploaded)
    if (uploadPending) {
      wx.showToast({ title: '附件还在上传，稍等一下', icon: 'none' })
      return
    }
    this.setData({ inputText: '', showCommands: false })
    // 发送即回到底部：恢复贴底跟随，新消息照常自动回底
    this.stickBottom = true
    this.setData({ showJumpLatest: false })
    const attachmentPaths = attachments.map((item) => item.path)
    const sentAttachments = attachments.map((item) => ({
      type: item.type,
      path: item.path,
      name: item.name,
    }))
    // 清空附件条；正文引用渲染用（本次会话内存内）
    if (sentAttachments.length > 0) {
      this.sentAttachmentsByText = {
        ...this.sentAttachmentsByText,
        [text]: sentAttachments,
      }
      this.setData({ attachments: [] })
    }

    // 斜杠命令：设置型命令主进程内直接生效；不识别时按普通消息发送
    if (text.startsWith('/')) {
      try {
        const result = await bridge.executeCommand(this.data.sessionId, text, this.targetDeviceId())
        if (result.isCommand) {
          if (result.queued === true) {
            wx.showToast({ title: '当前回合运行中，命令已排队', icon: 'none', duration: 2500 })
          } else if (!result.forwardToAgent) {
            wx.showToast({ title: '命令已执行', icon: 'success' })
          }
          return
        }
      } catch (error) {
        wx.showToast({ title: (error as Error).message || '命令执行失败', icon: 'none' })
        this.setData({ inputText: text })
        return
      }
    }

    try {
      await bridge.submitTurn(
        this.data.sessionId,
        text,
        attachmentPaths.length > 0 ? attachmentPaths : undefined,
        this.targetDeviceId(),
      )
      // 用户消息会经流回来；若流未连上，本地先乐观渲染（流恢复后按文本去重）。
      // key 口径必须与 chat-reducer 一致：事件 id 是裸 id，渲染 key 由 reducer 统一加 `u:` 前缀
      // ——之前把带前缀的 key 塞进事件 id，渲染 key 变成 `u:u:local-…`，去重永远删不掉（双气泡）。
      if (!this.data.connected) {
        const localId = `local-${Date.now()}`
        this.localPending = { key: `u:${localId}`, text }
        const base = this.latestTimeline ?? emptyTimeline()
        this.latestTimeline = applyEvents(base, [
          {
            id: localId,
            seq: -1,
            turnId: 'local',
            type: 'user_message',
            timestamp: new Date().toISOString(),
            content: text,
          },
        ])
        this.flushTimeline(true)
      }
    } catch (error) {
      this.setData({ inputText: text })
      wx.showToast({ title: (error as Error).message || '发送失败', icon: 'none' })
    }
  },

  async onCancel() {
    try {
      await bridge.cancelTurn(this.data.sessionId, this.targetDeviceId())
      wx.showToast({ title: '已请求停止', icon: 'success' })
    } catch (error) {
      wx.showToast({ title: (error as Error).message || '取消失败', icon: 'none' })
    }
  },

  // ─── 挂起交互（权限审批卡 + 问答卡；桌面端无下行推送，轮询对账） ─────────────

  /** 轮询一次挂起交互并按结果刷新卡片；随后自适应安排下一轮 */
  async pollInteractions() {
    if (this.interactionPollStopped) return
    if (this.interactionTimer) {
      clearTimeout(this.interactionTimer)
      this.interactionTimer = 0
    }
    if (!this.data.deviceOffline) {
      try {
        const snapshot = await bridge.getPendingInteractions(
          this.data.sessionId,
          this.targetDeviceId(),
        )
        this.applyInteractions(snapshot)
      } catch {
        // 旧版桌面端没有该端点 / 网络抖动：静默等下一轮，不弹错误
      }
    }
    const active =
      this.data.running ||
      this.pendingApprovals.length > 0 ||
      this.pendingQuestions.length > 0 ||
      this.data.approvalCards.length > 0 ||
      this.data.questionCards.length > 0
    if (this.interactionPollStopped) return
    this.interactionTimer = setTimeout(
      () => void this.pollInteractions(),
      active ? INTERACTION_POLL_ACTIVE_MS : INTERACTION_POLL_IDLE_MS,
    )
  },

  /** 服务端快照 → 卡片视图；新出现的审批/问答轻微震动提醒 */
  applyInteractions(snapshot: bridge.BridgeInteractions) {
    const approvals = Array.isArray(snapshot.approvals) ? snapshot.approvals : []
    const questions = Array.isArray(snapshot.questions) ? snapshot.questions : []
    const knownApprovalIds = new Set(this.pendingApprovals.map((item) => item.requestId))
    const knownQuestionIds = new Set(this.pendingQuestions.map((item) => item.questionId))
    const hasNew =
      approvals.some((item) => !knownApprovalIds.has(item.requestId)) ||
      questions.some((item) => !knownQuestionIds.has(item.questionId))
    this.pendingApprovals = approvals
    this.pendingQuestions = questions
    // 已不在挂起列表的题目草稿一并回收，防止同一 questionId 复用后残留旧选择
    const liveDraftKeys = new Set<string>()
    for (const item of questions) {
      item.questions.forEach((_, index) =>
        liveDraftKeys.add(questionDraftKey(item.questionId, index)),
      )
    }
    for (const key of Object.keys(this.questionDrafts)) {
      if (!liveDraftKeys.has(key)) delete this.questionDrafts[key]
    }
    if (hasNew) wx.vibrateShort({ type: 'medium' })
    this.refreshInteractionCards()
  },

  /** 由挂起快照重建两张卡片列表（草稿驱动选中态；提交中渲染 busy） */
  refreshInteractionCards() {
    const approvalCards = buildApprovalCardViews(this.pendingApprovals).map((card) => ({
      ...card,
      busy: this.submittingKeys.has(card.requestId),
    }))
    const questionCards = buildQuestionCardViews(this.pendingQuestions, this.questionDrafts).map(
      (card) => ({
        ...card,
        busy: this.submittingKeys.has(card.questionId),
      }),
    )
    this.setData({ approvalCards, questionCards })
  },

  /** 审批卡应答：乐观移卡，失败回滚（下一轮轮询会按服务端真实状态兜底） */
  async onApprovalDecide(
    e: WechatMiniprogram.BaseEvent<WechatMiniprogram.IAnyObject, { id: string; decision: string }>,
  ) {
    const requestId = e.currentTarget.dataset.id
    const decision = e.currentTarget.dataset.decision
    if (
      !requestId ||
      (decision !== 'allow-once' && decision !== 'allow-session' && decision !== 'deny')
    ) {
      return
    }
    if (this.submittingKeys.has(requestId)) return
    this.submittingKeys.add(requestId)
    this.refreshInteractionCards()
    try {
      await bridge.resolveApproval(this.data.sessionId, requestId, decision, this.targetDeviceId())
      this.pendingApprovals = this.pendingApprovals.filter((item) => item.requestId !== requestId)
      wx.showToast({
        title: decision === 'deny' ? '已拒绝' : '已允许',
        icon: 'success',
      })
    } catch (error) {
      wx.showToast({ title: (error as Error).message || '操作失败', icon: 'none' })
    } finally {
      this.submittingKeys.delete(requestId)
      this.refreshInteractionCards()
    }
  },

  /** 选项点击：单选替换 / 多选切换（与桌面端 UserQuestionDock.handleSelectOption 同语义） */
  onQuestionOptionTap(
    e: WechatMiniprogram.BaseEvent<
      WechatMiniprogram.IAnyObject,
      { qid: string; index: number; label: string }
    >,
  ) {
    const { qid, index, label } = e.currentTarget.dataset
    if (!qid || typeof index !== 'number' || typeof label !== 'string') return
    const key = questionDraftKey(qid, index)
    const question = this.findQuestion(qid, index)
    if (question == null) return
    const draft = this.questionDrafts[key] ?? emptyQuestionDraft()
    const multi = this.isMultiChoiceQuestion(question)
    let next: QuestionDraft
    if (multi) {
      const selected = draft.selectedLabels.includes(label)
      next = {
        ...draft,
        skipped: false,
        text: '',
        selectedLabels: selected
          ? draft.selectedLabels.filter((item) => item !== label)
          : [...draft.selectedLabels, label],
        selectedValues: selected
          ? draft.selectedValues.filter((_, i) => draft.selectedLabels[i] !== label)
          : [...draft.selectedValues, this.optionValue(question, label)],
      }
    } else {
      const allowsFreeText = (question.options ?? []).some(
        (option) => option.label === label && option.allowsFreeText === true,
      )
      next = {
        ...draft,
        skipped: false,
        text: '',
        selectedLabels: [label],
        selectedValues: [this.optionValue(question, label)],
        // allowsFreeText 选项保留已输入的其他文本（与桌面端一致），其余选项清空
        otherText: allowsFreeText ? draft.otherText : '',
      }
    }
    this.questionDrafts = { ...this.questionDrafts, [key]: next }
    this.refreshInteractionCards()
  },

  /** 「其他」自由输入：单选视为选中「其他」，多选仅记录文本（与桌面端 handleOtherTextChange 同语义） */
  onQuestionOtherInput(e: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const qid = e.currentTarget.dataset.qid as string | undefined
    const index = e.currentTarget.dataset.index as number | undefined
    if (!qid || typeof index !== 'number') return
    const key = questionDraftKey(qid, index)
    const question = this.findQuestion(qid, index)
    if (question == null) return
    const draft = this.questionDrafts[key] ?? emptyQuestionDraft()
    const value = e.detail.value ?? ''
    const next: QuestionDraft = this.isMultiChoiceQuestion(question)
      ? { ...draft, skipped: false, otherText: value, text: '' }
      : {
          ...draft,
          skipped: false,
          selectedLabels: [this.otherLabelOf(question)],
          selectedValues: [this.otherLabelOf(question)],
          otherText: value,
          text: '',
        }
    this.questionDrafts = { ...this.questionDrafts, [key]: next }
    this.refreshInteractionCards()
  },

  /** 文本型题目输入 */
  onQuestionTextInput(e: WechatMiniprogram.CustomEvent<{ value: string }>) {
    const qid = e.currentTarget.dataset.qid as string | undefined
    const index = e.currentTarget.dataset.index as number | undefined
    if (!qid || typeof index !== 'number') return
    const key = questionDraftKey(qid, index)
    const draft = this.questionDrafts[key] ?? emptyQuestionDraft()
    this.questionDrafts = {
      ...this.questionDrafts,
      [key]: { ...draft, text: e.detail.value ?? '' },
    }
    this.refreshInteractionCards()
  },

  /** 提交整卡（一次 AskUserQuestion 的全部题目一次提交，载荷与桌面端渲染端同构） */
  async onQuestionSubmit(
    e: WechatMiniprogram.BaseEvent<WechatMiniprogram.IAnyObject, { qid: string }>,
  ) {
    const questionId = e.currentTarget.dataset.qid
    if (!questionId || this.submittingKeys.has(questionId)) return
    const item = this.pendingQuestions.find((entry) => entry.questionId === questionId)
    if (item == null) return
    // 与桌面端同语义：必答题未就绪不允许提交（WXML 按钮置灰，这里兜底防连点）
    const card = this.data.questionCards.find((entry) => entry.questionId === questionId)
    if (card == null || card.canSubmit !== true || card.busy === true) return
    this.submittingKeys.add(questionId)
    this.refreshInteractionCards()
    try {
      const answers = buildQuestionAnswerPayload(item.questions, this.questionDrafts, questionId)
      await bridge.answerQuestion(this.data.sessionId, questionId, answers, this.targetDeviceId())
      this.pendingQuestions = this.pendingQuestions.filter(
        (entry) => entry.questionId !== questionId,
      )
      wx.showToast({ title: '已回答', icon: 'success' })
    } catch (error) {
      wx.showToast({ title: (error as Error).message || '提交失败', icon: 'none' })
    } finally {
      this.submittingKeys.delete(questionId)
      this.refreshInteractionCards()
    }
  },

  /** 跳过整卡 */
  async onQuestionSkip(
    e: WechatMiniprogram.BaseEvent<WechatMiniprogram.IAnyObject, { qid: string }>,
  ) {
    const questionId = e.currentTarget.dataset.qid
    if (!questionId || this.submittingKeys.has(questionId)) return
    const item = this.pendingQuestions.find((entry) => entry.questionId === questionId)
    if (item == null) return
    this.submittingKeys.add(questionId)
    this.refreshInteractionCards()
    try {
      const answers = buildQuestionSkipPayload(item.questions, this.questionDrafts, questionId)
      await bridge.answerQuestion(this.data.sessionId, questionId, answers, this.targetDeviceId())
      this.pendingQuestions = this.pendingQuestions.filter(
        (entry) => entry.questionId !== questionId,
      )
      wx.showToast({ title: '已跳过', icon: 'none' })
    } catch (error) {
      wx.showToast({ title: (error as Error).message || '操作失败', icon: 'none' })
    } finally {
      this.submittingKeys.delete(questionId)
      this.refreshInteractionCards()
    }
  },

  findQuestion(questionId: string, index: number): bridge.BridgeQuestionPrompt | null {
    const item = this.pendingQuestions.find((entry) => entry.questionId === questionId)
    const question = item?.questions[index]
    return question ?? null
  },

  isMultiChoiceQuestion(question: bridge.BridgeQuestionPrompt): boolean {
    const type = question.type ?? (question.multiSelect === true ? 'multi_choice' : 'single_choice')
    return type === 'multi_choice'
  },

  otherLabelOf(question: bridge.BridgeQuestionPrompt): string {
    return question.otherOptionLabel?.trim() || '其他'
  },

  optionValue(question: bridge.BridgeQuestionPrompt, label: string): string {
    const option = (question.options ?? []).find((item) => item.label === label)
    return option?.value ?? label
  },

  // ─── 配置目录与 chips ────────────────────────────────────────────────────────

  async loadCatalog() {
    try {
      const catalog = await bridge.getCatalog(this.targetDeviceId())
      this.catalog = catalog
      this.refreshChips()
    } catch {
      // 目录加载失败不阻塞对话；chips 隐藏（旧版桌面端兼容）
      this.catalog = null
      this.refreshChips()
    }
    try {
      const { projects } = await bridge.listProjects(100, this.targetDeviceId())
      this.projectOptionsCache = projects.map((project) => ({
        id: project.id,
        label: project.name,
        sub: project.rootPath || '',
      }))
      this.refreshChips()
    } catch {
      this.projectOptionsCache = []
    }
  },

  projectOptionsCache: [] as { id: string; label: string; sub?: string }[],

  async loadCommands() {
    try {
      const { commands } = await bridge.listCommands(this.data.sessionId, this.targetDeviceId())
      this.commandCatalog = commands
      this.setData({ commands })
    } catch {
      this.commandCatalog = []
    }
  },

  async refreshRuntime() {
    const { runtime } = await bridge.getSessionRuntime(this.data.sessionId, this.targetDeviceId())
    this.runtime = runtime
    this.refreshChips()
  },

  refreshChips() {
    const { catalog, runtime } = this
    if (catalog == null || runtime == null) {
      this.setData({ chips: [] })
      return
    }
    const agent = catalog.agents.find((item) => item.id === runtime.agentId)
    const provider = catalog.providers.find((item) => item.id === runtime.providerProfileId)
    const modelLabel =
      runtime.modelId ??
      (provider != null ? `${provider.name}${provider.isAutoRouter ? '·自动' : ''}` : '默认')
    const binding = runtime.workflowBinding
    const workflowLabel =
      binding == null || binding.mode === 'inherit'
        ? '跟随默认'
        : binding.mode === 'disabled'
          ? '已停用'
          : (catalog.workflows.find((wf) => wf.id === binding.workflowId)?.name ?? '已绑定')
    const chips: ChipView[] = [
      { key: 'agent', label: '助手', value: agent?.name ?? '默认' },
      { key: 'model', label: '模型', value: modelLabel },
      {
        key: 'permission',
        label: '权限',
        value: PERMISSION_LABELS[runtime.permissionMode ?? ''] ?? runtime.permissionMode ?? '默认',
      },
      {
        key: 'reasoning',
        label: '推理',
        value: REASONING_LABELS[runtime.reasoningEffort ?? ''] ?? runtime.reasoningEffort ?? '中',
      },
      { key: 'workflow', label: '工作流', value: workflowLabel },
    ]
    if (this.projectOptionsCache.length > 0) {
      const projectId = runtime.projectId ?? 'default'
      chips.push({
        key: 'project',
        label: '项目',
        value:
          projectId === 'default'
            ? '临时会话'
            : (this.projectOptionsCache.find((item) => item.id === projectId)?.label ?? '已归属'),
      })
    }
    this.setData({ chips })
  },

  // ─── 半屏面板 ───────────────────────────────────────────────────────────────

  onChipTap(e: WechatMiniprogram.CustomEvent<{ key: string }>) {
    const key = e.detail.key as PanelKind
    if (key === 'agent') this.openAgentPanel()
    else if (key === 'model') this.openModelPanel()
    else if (key === 'permission') this.openPermissionPanel()
    else if (key === 'reasoning') this.openReasoningPanel()
    else if (key === 'workflow') this.openWorkflowPanel()
    else if (key === 'project') this.openProjectPanel()
  },

  openPanel(config: {
    kind: PanelKind
    title: string
    mode?: 'list' | 'slider'
    options?: PanelOptionView[]
    sliderOptions?: string[]
    sliderIndex?: number
    empty?: string
  }) {
    this.setData({
      panelShow: true,
      panelKind: config.kind,
      panelTitle: config.title,
      panelMode: config.mode ?? 'list',
      panelOptions: config.options ?? [],
      panelSliderOptions: config.sliderOptions ?? [],
      panelSliderIndex: config.sliderIndex ?? 0,
      panelEmpty: config.empty ?? '',
    })
  },

  closePanel() {
    this.setData({ panelShow: false, panelKind: '' })
  },

  openAgentPanel() {
    const catalog = this.catalog
    if (catalog == null || catalog.agents.length === 0) {
      wx.showToast({ title: '助手目录为空', icon: 'none' })
      return
    }
    this.openPanel({
      kind: 'agent',
      title: '切换助手',
      options: catalog.agents.map((agent) => ({
        id: agent.id,
        label: agent.name,
        sub: agent.description,
        checked: this.runtime?.agentId === agent.id,
      })),
      empty: '没有可用助手',
    })
  },

  openModelPanel() {
    const catalog = this.catalog
    if (catalog == null || catalog.providers.length === 0) {
      wx.showToast({ title: '渠道目录为空', icon: 'none' })
      return
    }
    const options: PanelOptionView[] = []
    for (const provider of catalog.providers) {
      if (provider.isAutoRouter) {
        options.push({
          id: `${provider.id}::`,
          label: `${provider.name}（自动路由）`,
          sub: '按规则自动分流模型',
          checked: this.runtime?.providerProfileId === provider.id && this.runtime?.modelId == null,
        })
        continue
      }
      for (const model of provider.models) {
        options.push({
          id: `${provider.id}::${model.id}`,
          label: model.name,
          sub: provider.name,
          checked:
            this.runtime?.providerProfileId === provider.id && this.runtime?.modelId === model.id,
        })
      }
    }
    this.openPanel({ kind: 'model', title: '切换模型', options, empty: '没有可用模型' })
  },

  openPermissionPanel() {
    const catalog = this.catalog
    const adapter = this.runtime?.agentAdapter ?? 'claude'
    const modes = catalog?.permissionModes[adapter] ?? []
    if (modes.length === 0) {
      wx.showToast({ title: '当前助手不支持切换权限', icon: 'none' })
      return
    }
    this.openPanel({
      kind: 'permission',
      title: '权限策略',
      options: modes.map((mode) => ({
        id: mode,
        label: PERMISSION_LABELS[mode] ?? mode,
        checked: this.runtime?.permissionMode === mode,
      })),
    })
  },

  openReasoningPanel() {
    const catalog = this.catalog
    const efforts = catalog?.reasoningEfforts ?? []
    if (efforts.length === 0) {
      wx.showToast({ title: '推理强度不可用', icon: 'none' })
      return
    }
    const current = this.runtime?.reasoningEffort ?? 'medium'
    this.openPanel({
      kind: 'reasoning',
      title: '推理强度',
      mode: 'slider',
      sliderOptions: efforts,
      sliderIndex: Math.max(efforts.indexOf(current), 0),
    })
  },

  openWorkflowPanel() {
    const catalog = this.catalog
    if (catalog == null) return
    const binding = this.runtime?.workflowBinding
    const options: PanelOptionView[] = [
      { id: 'inherit', label: '跟随默认', checked: binding == null || binding.mode === 'inherit' },
      { id: 'disabled', label: '停用工作流', checked: binding?.mode === 'disabled' },
      ...catalog.workflows.map((workflow) => ({
        id: workflow.id,
        label: workflow.name,
        sub: workflow.description,
        checked: binding?.mode === 'override' && binding.workflowId === workflow.id,
      })),
    ]
    this.openPanel({ kind: 'workflow', title: '工作流', options })
  },

  openProjectPanel() {
    const options = this.projectOptionsCache
    if (options.length === 0) {
      wx.showToast({ title: '项目列表为空', icon: 'none' })
      return
    }
    const currentProjectId = this.runtime?.projectId ?? 'default'
    this.openPanel({
      kind: 'project',
      title: '移动到项目',
      options: [
        {
          id: 'default',
          label: '临时会话',
          sub: '不归属任何项目',
          checked: currentProjectId === 'default',
        },
        ...options.map((option) => ({
          id: option.id,
          label: option.label,
          sub: option.sub,
          checked: currentProjectId === option.id,
        })),
      ],
      empty: '没有可用项目',
    })
  },

  async onPanelSelect(e: WechatMiniprogram.CustomEvent<{ id: string }>) {
    const kind = this.data.panelKind as PanelKind | ''
    const id = e.detail.id
    if (kind === '') return
    // 技能/命令是「插入输入框」型选择：不发起会话配置写请求
    if (kind === 'skill' || kind === 'command') {
      const name = kind === 'skill' ? this.skillNameById(id) : this.commandNameById(id)
      if (name != null) this.insertTextToken(kind === 'skill' ? `@${name} ` : `/${name} `)
      this.closePanel()
      return
    }
    // 分支列表：点选跳转子会话
    if (kind === 'branch') {
      this.closePanel()
      const child = this.lineageChildren.find((entry) => entry.childSessionId === id)
      this.navigateToSession(id, child?.childTitle ?? child?.sourceTitleSnapshot ?? '分支会话')
      return
    }
    this.setData({ panelLoading: true })
    try {
      if (kind === 'agent') {
        await bridge.updateSession(this.data.sessionId, { agentId: id }, this.targetDeviceId())
      } else if (kind === 'model') {
        const sep = id.indexOf('::')
        if (sep < 0) return
        const providerId = id.slice(0, sep)
        const modelId = id.slice(sep + 2)
        await bridge.updateSession(
          this.data.sessionId,
          {
            providerProfileId: providerId,
            ...(modelId !== '' ? { modelId } : { modelId: null }),
          },
          this.targetDeviceId(),
        )
      } else if (kind === 'permission') {
        await bridge.updateSession(
          this.data.sessionId,
          { permissionMode: id },
          this.targetDeviceId(),
        )
      } else if (kind === 'workflow') {
        if (id === 'inherit' || id === 'disabled') {
          await bridge.setWorkflowBinding(this.data.sessionId, id, undefined, this.targetDeviceId())
        } else {
          await bridge.setWorkflowBinding(
            this.data.sessionId,
            'override',
            id,
            this.targetDeviceId(),
          )
        }
      } else if (kind === 'project') {
        await bridge.updateSession(this.data.sessionId, { projectId: id }, this.targetDeviceId())
      }
      await this.refreshRuntime()
      this.closePanel()
      wx.showToast({ title: '已切换', icon: 'success' })
    } catch (error) {
      wx.showToast({ title: (error as Error).message || '切换失败', icon: 'none' })
    } finally {
      this.setData({ panelLoading: false })
    }
  },

  async onPanelSliderChange(e: WechatMiniprogram.CustomEvent<{ index: number }>) {
    const efforts = this.data.panelSliderOptions
    const effort = efforts[e.detail.index]
    if (effort == null) return
    try {
      await bridge.updateSession(
        this.data.sessionId,
        { reasoningEffort: effort },
        this.targetDeviceId(),
      )
      await this.refreshRuntime()
      this.closePanel()
      wx.showToast({ title: `推理强度：${REASONING_LABELS[effort] ?? effort}`, icon: 'success' })
    } catch (error) {
      wx.showToast({ title: (error as Error).message || '切换失败', icon: 'none' })
    }
  },

  // ─── 附件 ───────────────────────────────────────────────────────────────────

  onAddAttachment() {
    const remaining = MAX_ATTACHMENTS - this.data.attachments.length
    if (remaining <= 0) {
      wx.showToast({ title: `最多 ${MAX_ATTACHMENTS} 个附件`, icon: 'none' })
      return
    }
    // 菜单动态构建：旧版桌面端无 /v1/skills → 隐藏「技能」；命令目录为空 → 隐藏「命令」
    const entries: ('image' | 'file' | 'skill' | 'command')[] = ['image', 'file']
    if (this.data.skillsAvailable) entries.push('skill')
    if (this.commandCatalog.length > 0) entries.push('command')
    const labels: Record<(typeof entries)[number], string> = {
      image: '图片',
      file: '文件',
      skill: '技能',
      command: '命令',
    }
    wx.showActionSheet({
      itemList: entries.map((entry) => labels[entry]),
      itemColor: '#1a1a1a',
      success: (res) => {
        const picked = entries[res.tapIndex]
        if (picked === 'image') void this.chooseImage(remaining)
        else if (picked === 'file') void this.chooseFile(remaining)
        else if (picked === 'skill') this.openSkillPanel()
        else if (picked === 'command') this.openCommandPanel()
      },
      fail: () => {
        /* 用户取消 */
      },
    })
  },

  async chooseImage(count: number) {
    try {
      const result = await wx.chooseMedia({
        count,
        mediaType: ['image'],
        sizeType: ['compressed'],
      })
      for (const file of result.tempFiles) {
        await this.uploadOneAttachment({
          type: 'image',
          localPath: file.tempFilePath,
          name: `image-${Date.now()}.png`,
          mimeType: 'image/png',
        })
      }
    } catch {
      /* 用户取消 */
    }
  },

  async chooseFile(count: number) {
    try {
      const result = await wx.chooseMessageFile({ count, type: 'file' })
      for (const file of result.tempFiles) {
        await this.uploadOneAttachment({
          type: 'file',
          localPath: file.path,
          name: file.name,
          mimeType: '',
        })
      }
    } catch {
      /* 用户取消 */
    }
  },

  /** 读取本地文件 → base64 上传 → 桌面端落盘 → 拿白名单路径 */
  async uploadOneAttachment(input: {
    type: 'image' | 'file'
    localPath: string
    name: string
    mimeType: string
  }) {
    const placeholder: ComposerAttachmentView = {
      type: input.type,
      path: '',
      name: input.name,
      localPath: input.localPath,
      uploaded: false,
    }
    const attachments = [...this.data.attachments, placeholder]
    this.setData({ attachments })
    const index = attachments.length - 1
    try {
      const dataBase64 = await new Promise<string>((resolve, reject) => {
        wx.getFileSystemManager().readFile({
          filePath: input.localPath,
          encoding: 'base64',
          success: (res) => resolve(String(res.data)),
          fail: (err) => reject(new Error(err.errMsg || '读取文件失败')),
        })
      })
      const { attachments: uploaded } = await bridge.uploadAttachments(
        this.data.sessionId,
        [{ name: input.name, mimeType: input.mimeType || undefined, dataBase64 }],
        this.targetDeviceId(),
      )
      const first = uploaded[0]
      if (first == null) throw new Error('上传失败')
      this.setData({
        [`attachments[${index}]`]: {
          type: first.type,
          path: first.path,
          name: first.name ?? input.name,
          localPath: input.localPath,
          uploaded: true,
        },
      })
    } catch (error) {
      // 上传失败：移除占位并提示
      this.setData({ attachments: this.data.attachments.filter((_, i) => i !== index) })
      wx.showToast({ title: (error as Error).message || '附件上传失败', icon: 'none' })
    }
  },

  onRemoveAttachment(e: WechatMiniprogram.CustomEvent<{ index: number }>) {
    const index = e.detail.index
    this.setData({ attachments: this.data.attachments.filter((_, i) => i !== index) })
  },

  onPreviewAttachment(e: WechatMiniprogram.BaseEvent) {
    const url = e.currentTarget.dataset.url as string | undefined
    if (url == null) return
    wx.previewImage({ urls: [url] })
  },

  // ─── 语音（按住说话 → 转写 → 填输入框） ──────────────────────────────────────

  onVoiceStart() {
    if (this.data.transcribing) return
    this.setData({ recording: true })
  },

  onVoiceEnd() {
    if (!this.data.recording) return
    this.setData({ recording: false })
  },

  onVoiceFile(e: WechatMiniprogram.CustomEvent<{ tempFilePath: string; duration: number }>) {
    const { tempFilePath, duration } = e.detail
    // 松开太短视为误触
    if (duration != null && duration < 800) {
      wx.showToast({ title: '说话时间太短', icon: 'none' })
      return
    }
    void this.transcribeVoice(tempFilePath)
  },

  async transcribeVoice(tempFilePath: string) {
    this.setData({ transcribing: true })
    try {
      const dataBase64 = await new Promise<string>((resolve, reject) => {
        wx.getFileSystemManager().readFile({
          filePath: tempFilePath,
          encoding: 'base64',
          success: (res) => resolve(String(res.data)),
          fail: (err) => reject(new Error(err.errMsg || '读取录音失败')),
        })
      })
      const { text } = await bridge.transcribeAudio(dataBase64, 'audio/mp3', this.targetDeviceId())
      if (!text.trim()) {
        wx.showToast({ title: '没有识别到内容', icon: 'none' })
        return
      }
      const merged = this.data.inputText
        ? `${this.data.inputText.trimEnd()} ${text.trim()}`
        : text.trim()
      this.setData({ inputText: merged })
    } catch (error) {
      wx.showToast({ title: (error as Error).message || '转写失败', icon: 'none' })
    } finally {
      this.setData({ transcribing: false })
    }
  },

  onVoiceError(e: WechatMiniprogram.CustomEvent<{ message: string }>) {
    this.setData({ recording: false, transcribing: false })
    wx.showToast({ title: e.detail.message || '录音失败', icon: 'none' })
  },

  // ─── 命令补全 ───────────────────────────────────────────────────────────────

  onCommandPick(e: WechatMiniprogram.CustomEvent<{ name: string }>) {
    this.setData({ inputText: `/${e.detail.name} `, showCommands: false })
  },

  // ─── 技能 / 命令选择（对齐桌面 Composer：纯文本 token 插入输入框） ─────────────

  async loadSkills() {
    try {
      const { skills } = await bridge.listSkills(this.data.sessionId, this.targetDeviceId())
      this.skillCatalog = skills
      this.setData({ skillsAvailable: true })
    } catch {
      // 旧版桌面端无 /v1/skills（404）：隐藏技能入口，不提示错误
      this.skillCatalog = []
      this.setData({ skillsAvailable: false })
    }
  },

  openSkillPanel() {
    const enabled = this.skillCatalog.filter((skill) => skill.enabled)
    if (enabled.length === 0) {
      wx.showToast({ title: '没有可用技能', icon: 'none' })
      return
    }
    const sourceLabel = (skill: bridge.BridgeSkillItem): string =>
      skill.source === 'project' ? '项目技能' : '技能'
    this.openPanel({
      kind: 'skill',
      title: '插入技能',
      options: enabled.map((skill) => ({
        id: skill.id,
        label: `@${skill.name}`,
        sub: skill.description
          ? `${skill.description}（${sourceLabel(skill)}）`
          : sourceLabel(skill),
      })),
      empty: '没有可用技能',
    })
  },

  openCommandPanel() {
    if (this.commandCatalog.length === 0) {
      wx.showToast({ title: '命令目录为空', icon: 'none' })
      return
    }
    this.openPanel({
      kind: 'command',
      title: '插入命令',
      options: this.commandCatalog.map((command) => ({
        id: command.name,
        label: `/${command.name}`,
        sub: command.usage ? `${command.description} · ${command.usage}` : command.description,
      })),
      empty: '没有可用命令',
    })
  },

  skillNameById(id: string): string | null {
    return this.skillCatalog.find((skill) => skill.id === id)?.name ?? null
  },

  commandNameById(name: string): string | null {
    return this.commandCatalog.some((command) => command.name === name) ? name : null
  },

  /** 在输入框光标语义末尾追加 token（与 onCommandPick 同机制：整体替换为已填内容 + token） */
  insertTextToken(token: string) {
    const current = this.data.inputText
    // 输入框已有斜杠命令草稿时追加到其后，否则追加到现有文本之后
    const base = current.trimEnd()
    this.setData({ inputText: base ? `${base} ${token}` : token, showCommands: false })
  },

  // ─── 会话分支（Session Fork：长按用户气泡从该轮创建子会话） ───────────────────

  async loadLineage() {
    try {
      const { lineage, children } = await bridge.getSessionLineage(
        this.data.sessionId,
        this.targetDeviceId(),
      )
      this.lineage = lineage
      this.lineageChildren = children
      this.setData({
        lineageSourceTitle: lineage?.sourceTitleSnapshot ?? '',
        lineageChildCount: children.length,
      })
    } catch {
      // 旧版桌面端无 /v1/sessions/:id/lineage（404）：静默隐藏横幅
      this.lineage = null
      this.lineageChildren = []
      this.setData({ lineageSourceTitle: '', lineageChildCount: 0 })
    }
  },

  /** 横幅「分支自《源》›」：跳回父会话 */
  onLineageSource() {
    const parent = this.lineage?.parentSessionId
    if (!parent) return
    this.navigateToSession(parent, this.lineage?.sourceTitleSnapshot ?? '来源会话')
  },

  /** 横幅「N 个分支」：sheet-panel 列出直接子分支，点选跳转 */
  onLineageChildren() {
    if (this.lineageChildren.length === 0) return
    const options = this.lineageChildren.map((child) => ({
      id: child.childSessionId,
      label: child.childTitle ?? child.sourceTitleSnapshot,
      sub: `分支自「${child.sourceTitleSnapshot}」 · ${formatRelativeTime(child.createdAt)}`,
    }))
    this.openPanel({ kind: 'branch', title: '分支列表', options })
  },

  onUserBubbleLongPress(
    e: WechatMiniprogram.BaseEvent<WechatMiniprogram.IAnyObject, { turnid: string }>,
  ) {
    const turnId = e.currentTarget.dataset.turnid
    if (typeof turnId !== 'string' || !turnId) return
    wx.showActionSheet({
      itemList: ['从此处分支'],
      itemColor: '#1a1a1a',
      success: (res) => {
        if (res.tapIndex === 0) void this.forkFromTurn(turnId)
      },
      fail: () => {
        /* 用户取消 */
      },
    })
  },

  /** 从指定回合 fork 子会话（可选自定义标题；错误原样透出，如锚点未完成） */
  async forkFromTurn(turnId: string) {
    wx.showModal({
      title: '从此处分支',
      content: '将复制该会话到此轮消息为止，生成一个独立子会话。',
      editable: true,
      placeholderText: '子会话标题（可留空）',
      success: async (res) => {
        if (!res.confirm) return
        const title = (res.content ?? '').trim()
        try {
          const result = await bridge.forkSession(
            this.data.sessionId,
            { anchorTurnId: turnId, ...(title ? { title } : {}) },
            this.targetDeviceId(),
          )
          if (result.sourceWasRunning) {
            wx.showToast({ title: '源会话仍在运行，已复制当前内容', icon: 'none', duration: 2500 })
          } else if (result.bindingWarning != null) {
            wx.showToast({
              title: '分支已创建，但复制的工作流绑定当前不可用',
              icon: 'none',
              duration: 2500,
            })
          } else {
            wx.showToast({ title: '分支已创建', icon: 'success' })
          }
          setTimeout(() => {
            this.navigateToSession(result.session.id, result.session.title)
          }, 600)
        } catch (error) {
          wx.showToast({ title: (error as Error).message || '分支创建失败', icon: 'none' })
        }
      },
    })
  },

  /** 跳转到指定会话（fork 跳转/分支列表共用；navigateTo 保留返回栈回到当前会话） */
  navigateToSession(sessionId: string, title: string) {
    const { deviceId } = this.data
    wx.navigateTo({
      url: `/pages/chat/index?sessionId=${encodeURIComponent(sessionId)}&deviceId=${encodeURIComponent(deviceId)}&title=${encodeURIComponent(title)}`,
    })
  },

  // ─── 会话操作（导航栏 ··· 菜单） ─────────────────────────────────────────────

  onMore() {
    wx.showActionSheet({
      itemList: [
        '重命名',
        '定时任务',
        '刷新配置',
        this.data.hideExecutionDetails ? '显示工具与思考记录' : '隐藏工具与思考记录',
        '删除会话',
      ],
      itemColor: '#1a1a1a',
      success: (res) => {
        if (res.tapIndex === 0) void this.onRename()
        if (res.tapIndex === 1) this.openSessionTasksPage()
        if (res.tapIndex === 2) void this.onRefreshConfig()
        if (res.tapIndex === 3) this.onToggleToolRecords()
        if (res.tapIndex === 4) void this.onDelete()
      },
      fail: () => {
        /* 用户取消 */
      },
    })
  },

  /** 定时任务独立管理页（替代旧半屏面板；列表/表单/空态都在新页面内） */
  openSessionTasksPage() {
    const { sessionId, deviceId, title } = this.data
    wx.navigateTo({
      url: `/pages/session-tasks/index?sessionId=${encodeURIComponent(sessionId)}&deviceId=${encodeURIComponent(deviceId)}&title=${encodeURIComponent(title)}`,
    })
  },

  /** 隐藏/显示工具与思考记录（本地持久化，立即重渲染） */
  onToggleToolRecords() {
    const next = !this.data.hideExecutionDetails
    this.setData({ hideExecutionDetails: next })
    setItem(StorageKeys.chatHideToolEvents, next)
    wx.showToast({ title: next ? '已隐藏工具与思考记录' : '已显示工具与思考记录', icon: 'none' })
    if (this.latestTimeline != null) this.flushTimeline(true)
  },

  /** 输入框键盘高度变化（组件转发）：弹起时收起 dock 底部安全区，避免键盘上方出缝 */
  onComposerKeyboard(e: WechatMiniprogram.CustomEvent<{ height: number }>) {
    const open = e.detail.height > 0
    if (open !== this.data.keyboardOpen) {
      this.setData({ keyboardOpen: open }, () => this.measureScrollViewHeight())
    }
  },

  async onRefreshConfig() {
    try {
      await this.loadCatalog()
      await this.refreshRuntime()
      wx.showToast({ title: '配置已刷新', icon: 'success' })
    } catch (error) {
      wx.showToast({ title: (error as Error).message || '刷新失败', icon: 'none' })
    }
  },

  async onRename() {
    wx.showModal({
      title: '重命名会话',
      editable: true,
      placeholderText: this.data.title,
      success: async (res) => {
        if (!res.confirm) return
        const name = (res.content ?? '').trim()
        if (!name) return
        try {
          await bridge.renameSession(this.data.sessionId, name, this.targetDeviceId())
          this.setData({ title: name })
          wx.showToast({ title: '已重命名', icon: 'success' })
        } catch (error) {
          wx.showToast({ title: (error as Error).message || '重命名失败', icon: 'none' })
        }
      },
    })
  },

  async onDelete() {
    wx.showModal({
      title: '删除会话',
      content: '删除后桌面端该会话将移入回收站，无法在移动端恢复。',
      confirmColor: '#dc2626',
      success: async (res) => {
        if (!res.confirm) return
        try {
          await bridge.deleteSession(this.data.sessionId, this.targetDeviceId())
          wx.showToast({ title: '已删除', icon: 'success' })
          setTimeout(
            () => wx.navigateBack({ fail: () => wx.reLaunch({ url: '/pages/home/index' }) }),
            500,
          )
        } catch (error) {
          wx.showToast({ title: (error as Error).message || '删除失败', icon: 'none' })
        }
      },
    })
  },

  // WXML 未直接调用，但保留给列表页跳转来源展示
  updatedAtLabelView: formatRelativeTime,
})
