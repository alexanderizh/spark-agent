/**
 * 远程对话页。
 *
 * 接替桌面端会话：进入即拉全量历史，随后 WebSocket 增量跟流；
 * 发送消息走 submitTurn（与桌面端发送同一会话同一回合机制）。
 *
 * 能力面（2026-10-14 扩展）：
 *   配置条    助手 / 模型 / 权限策略 / 推理强度 / 工作流 / 项目 → 半屏面板切换
 *   附件      图片/文件上传（桌面端落盘）→ 随回合提交
 *   语音      按住说话 → 桌面端转写（本地 SenseVoice → 云渠道）→ 填入输入框
 *   命令      / 前缀补全 → executeCommand（设置型主进程生效，技能型转发 agent）
 *   定时任务  session 作用域面板（session-tasks-panel 组件）
 *
 * 渲染分层：BridgeEvent → chat-reducer(消息列表) → chat-view(渲染项+时间分界) → setData。
 * 流式期间 setData 做了 100ms 合并节流，避免高频 delta 卡顿。
 */

import * as bridge from '../../api/bridge'
import { applyEvents, emptyTimeline, type ChatTimeline } from '../../utils/chat-reducer'
import { buildTimelineItems, type TimelineItem } from '../../utils/chat-view'
import { formatRelativeTime } from '../../utils/format'

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

type PanelKind = 'agent' | 'model' | 'permission' | 'reasoning' | 'workflow' | 'project'

const REASONING_LABELS: Record<string, string> = {
  minimal: '最省',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '超高',
  max: '极致',
}

const PERMISSION_LABELS: Record<string, string> = {
  'claude-ask': '每步确认',
  'claude-auto-edits': '自动编辑',
  'claude-plan': '规划模式',
  'claude-auto': '自动',
  'claude-bypass': '免确认',
  'codex-default': '默认',
  'codex-auto-review': '自动审查',
  'codex-full-access': '完全访问',
  'spark-default': '默认',
  'spark-accept-edits': '接受编辑',
  'spark-plan': '规划模式',
  'spark-bypass': '免确认',
  'spark-auto': '自动',
}

interface ChatPageData {
  sessionId: string
  title: string
  updatedAtLabel: string
  items: ReturnType<typeof buildTimelineItems>
  running: boolean
  inputText: string
  loading: boolean
  connected: boolean
  /** scroll-into-view 目标（固定锚点 id） */
  scrollToId: string
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
  recording: boolean
  transcribing: boolean
  // ── 定时任务 ──
  tasksShow: boolean
}

const FLUSH_INTERVAL_MS = 100
/** 附件单回合上限（与桌面端 normalizeTurnAttachments 一致） */
const MAX_ATTACHMENTS = 20

Page({
  data: {
    sessionId: '',
    title: '对话',
    updatedAtLabel: '',
    items: [],
    running: false,
    inputText: '',
    loading: true,
    connected: false,
    scrollToId: '',
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
    recording: false,
    transcribing: false,
    tasksShow: false,
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
  /** 命令目录原始数据（补全过滤用） */
  commandCatalog: [] as bridge.BridgeCommandItem[],

  onLoad(options: Record<string, string | undefined>) {
    const sessionId = options.sessionId ?? ''
    if (!sessionId) {
      wx.showToast({ title: '缺少会话 ID', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 600)
      return
    }
    this.setData({
      sessionId,
      title: options.title ? decodeURIComponent(options.title) : '对话',
    })
    // 配置目录/命令目录异步补齐，不阻塞首屏历史
    void this.loadCatalog()
    void this.loadCommands()
  },

  onShow() {
    void this.init()
  },

  onUnload() {
    if (this.flushTimer) clearTimeout(this.flushTimer)
    if (this.watchdogTimer) clearInterval(this.watchdogTimer)
    this.watchdogTimer = 0
    this.closeStream?.()
    this.closeStream = null
  },

  async init() {
    const { sessionId } = this.data
    if (!sessionId) return
    this.setData({ loading: true })
    try {
      const [history] = await Promise.all([
        bridge.getMessages(sessionId, 200),
        this.refreshRuntime().catch(() => undefined),
      ])
      const timeline = applyEvents(emptyTimeline(), history.events)
      this.latestTimeline = timeline
      this.localPending = null
      this.lastEventAt = Date.now()
      this.flushTimeline(true)
      this.connectStream()
      this.startWatchdog()
    } catch (error) {
      wx.showToast({ title: (error as Error).message || '历史加载失败', icon: 'none' })
    } finally {
      this.setData({ loading: false })
    }
  },

  connectStream() {
    this.closeStream?.()
    this.closeStream = bridge.connectStream(this.data.sessionId, {
      onOpen: () => {
        // 连接状态以真实 onOpen 为准（此前在发起连接时同步置 true，WS 失败也显示已连接）
        this.setData({ connected: true })
      },
      onEvent: (events) => {
        const base = this.latestTimeline ?? emptyTimeline()
        const timeline = applyEvents(base, events)
        // 乐观占位去重：真实 user_message 到达且文本匹配 → 移除本地占位，避免双气泡
        if (this.localPending != null) {
          const confirmed = events.some(
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
      },
      onError: () => {
        this.setData({ connected: false })
        // bridge 内部自动重连；watchdog 兜底校正状态
      },
      onClose: () => {
        this.setData({ connected: false })
      },
    })
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

  /** 渲染节流：高频流式事件合并为每 100ms 一次 setData；force 立即刷 */
  flushTimeline(force = false) {
    const paint = () => {
      this.flushTimer = 0
      const timeline = this.latestTimeline
      if (!timeline) return
      const items = buildTimelineItems(timeline.messages).map((item) => this.decorateItem(item))
      this.setData({
        items,
        running: timeline.running,
      })
      this.scrollToBottom()
    }
    if (force) {
      if (this.flushTimer) clearTimeout(this.flushTimer)
      paint()
      return
    }
    if (this.flushTimer) return
    this.flushTimer = setTimeout(paint, FLUSH_INTERVAL_MS)
  },

  /** 用户气泡附件渲染：把发送时挂载的附件映射到对应文本的用户项上（预填 previewUrl） */
  decorateItem(item: TimelineItem): TimelineItem {
    if (item.kind !== 'user') return item
    const attachments = this.sentAttachmentsByText[item.text]
    if (attachments == null || attachments.length === 0) return item
    const views = attachments.map((att) => ({
      ...att,
      // 中继模式下小程序访问不到桌面端的局域网地址，直接预览手机本地那份原图
      previewUrl:
        att.type === 'image'
          ? bridge.isRelayEnabled()
            ? ((att as { localPath?: string }).localPath ?? '')
            : bridge.buildAttachmentPreviewUrl(att.path)
          : '',
    }))
    return { ...item, attachments: views } as TimelineItem
  },

  scrollToBottom() {
    setTimeout(() => {
      this.setData({ scrollToId: 'chat-anchor' })
    }, 60)
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
        const result = await bridge.executeCommand(this.data.sessionId, text)
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
      )
      // 用户消息会经流回来；若流未连上，本地先乐观渲染（流恢复后按文本去重）
      if (!this.data.connected) {
        const localKey = `u:local-${Date.now()}`
        this.localPending = { key: localKey, text }
        const base = this.latestTimeline ?? emptyTimeline()
        this.latestTimeline = applyEvents(base, [
          {
            id: localKey,
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
      await bridge.cancelTurn(this.data.sessionId)
      wx.showToast({ title: '已请求停止', icon: 'success' })
    } catch (error) {
      wx.showToast({ title: (error as Error).message || '取消失败', icon: 'none' })
    }
  },

  // ─── 配置目录与 chips ────────────────────────────────────────────────────────

  async loadCatalog() {
    try {
      const catalog = await bridge.getCatalog()
      this.catalog = catalog
      this.refreshChips()
    } catch {
      // 目录加载失败不阻塞对话；chips 隐藏（旧版桌面端兼容）
      this.catalog = null
      this.refreshChips()
    }
    try {
      const { projects } = await bridge.listProjects(100)
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
      const { commands } = await bridge.listCommands(this.data.sessionId)
      this.commandCatalog = commands
      this.setData({ commands })
    } catch {
      this.commandCatalog = []
    }
  },

  async refreshRuntime() {
    const { runtime } = await bridge.getSessionRuntime(this.data.sessionId)
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
    this.setData({ panelLoading: true })
    try {
      if (kind === 'agent') {
        await bridge.updateSession(this.data.sessionId, { agentId: id })
      } else if (kind === 'model') {
        const sep = id.indexOf('::')
        if (sep < 0) return
        const providerId = id.slice(0, sep)
        const modelId = id.slice(sep + 2)
        await bridge.updateSession(this.data.sessionId, {
          providerProfileId: providerId,
          ...(modelId !== '' ? { modelId } : { modelId: null }),
        })
      } else if (kind === 'permission') {
        await bridge.updateSession(this.data.sessionId, { permissionMode: id })
      } else if (kind === 'workflow') {
        if (id === 'inherit' || id === 'disabled') {
          await bridge.setWorkflowBinding(this.data.sessionId, id)
        } else {
          await bridge.setWorkflowBinding(this.data.sessionId, 'override', id)
        }
      } else if (kind === 'project') {
        await bridge.updateSession(this.data.sessionId, { projectId: id })
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
      await bridge.updateSession(this.data.sessionId, { reasoningEffort: effort })
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
    wx.showActionSheet({
      itemList: ['图片', '文件'],
      itemColor: '#1a1a1a',
      success: (res) => {
        if (res.tapIndex === 0) void this.chooseImage(remaining)
        if (res.tapIndex === 1) void this.chooseFile(remaining)
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
      const { attachments: uploaded } = await bridge.uploadAttachments(this.data.sessionId, [
        { name: input.name, mimeType: input.mimeType || undefined, dataBase64 },
      ])
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
      const { text } = await bridge.transcribeAudio(dataBase64, 'audio/mp3')
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

  // ─── 会话操作（导航栏 ··· 菜单） ─────────────────────────────────────────────

  onMore() {
    wx.showActionSheet({
      itemList: ['重命名', '定时任务', '刷新配置', '删除会话'],
      itemColor: '#1a1a1a',
      success: (res) => {
        if (res.tapIndex === 0) void this.onRename()
        if (res.tapIndex === 1) this.setData({ tasksShow: true })
        if (res.tapIndex === 2) void this.onRefreshConfig()
        if (res.tapIndex === 3) void this.onDelete()
      },
      fail: () => {
        /* 用户取消 */
      },
    })
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

  onTasksClose() {
    this.setData({ tasksShow: false })
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
          await bridge.renameSession(this.data.sessionId, name)
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
          await bridge.deleteSession(this.data.sessionId)
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
