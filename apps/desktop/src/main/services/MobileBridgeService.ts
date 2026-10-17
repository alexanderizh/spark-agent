/**
 * MobileBridgeService — SparkWork 移动端（微信小程序）经云端中继访问桌面端的桥接服务。
 *
 * 传输层已收敛为纯云端中继：桌面端主动出网连 Spark 平台服务（MobileBridgeRelayClient），
 * 小程序也连同一服务，服务端按账号转发 —— 局域网直连（HTTP 监听 + LAN WebSocket +
 * 设备令牌配对）已整体移除（小程序体验版强制 https/wss + 域名白名单，真机不可用）。
 *
 * 本服务职责（中继合成请求的唯一路由层）：
 *   1. 请求处理：invokeRelay 把中继帧 { m, p, b } 合成为 HTTP 语义调用，
 *      经 handleHttpRequest 路由到项目 / 会话 / 选项目录 / 工作流绑定 / 附件 /
 *      语音转写 / 定时任务 / 斜杠命令等端点（全部经 deps 闭包注入，避免循环依赖）
 *   2. 事件推送：addRelaySubscriber 每 500ms 按 seq 读取原始新事件（包含 delta），
 *      把会话事件增量交给中继上行；历史分页仍走过滤 delta 的 getHistory
 *
 * 依赖注入参照 RemoteConnectionService.startRuntime(handler) 模式：
 * 本服务不 import SessionService/AuthService，由 registerMobileBridgeIpc 装配。
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable, PassThrough } from 'node:stream'
import { tmpdir } from 'node:os'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createLogger, SparkError } from '@spark/shared'
import { SESSION_LABEL_KEYS } from '@spark/protocol'
import type {
  MobileBridgeApprovalDecision,
  MobileBridgeAttachment,
  MobileBridgeCatalog,
  MobileBridgeCommandItem,
  MobileBridgeCreateScheduledTaskRequest,
  MobileBridgeCreateSessionResponse,
  MobileBridgeEvent,
  MobileBridgeForkSessionRequest,
  MobileBridgeForkSessionResponse,
  MobileBridgeHistoryResponse,
  MobileBridgeInteractionsResponse,
  MobileBridgeLineageResponse,
  MobileBridgeProjectListResponse,
  MobileBridgeProjectSummary,
  MobileBridgeScheduledTask,
  MobileBridgeSessionListResponse,
  MobileBridgeSessionRuntime,
  MobileBridgeSessionSummary,
  MobileBridgeSetWorkflowBindingRequest,
  MobileBridgeSidebarOrderUpdateResponse,
  MobileBridgeSkillListResponse,
  MobileBridgeSubmitTurnRequest,
  MobileBridgeUpdateProjectRequest,
  MobileBridgeUpdateScheduledTaskRequest,
  MobileBridgeUpdateSessionRequest,
  MobileBridgeUploadAttachmentsRequest,
  MobileBridgeWorkflowBindingResponse,
  SessionSearchResponse,
  SidebarOrderState,
  SidebarOrderUpdateRequest,
} from '@spark/protocol'

const log = createLogger('mobile-bridge')

/** 轮询间隔：LLM 回合以秒计，500ms 增量延迟不可感知 */
const STREAM_POLL_INTERVAL_MS = 500
/** 单次 getHistory 拉取上限（保底，正常远小于此） */
const HISTORY_LIMIT = 400
const MAX_BODY_BYTES = 256 * 1024
/** 附件上传 / 语音转写路由单独放宽的 body 上限（base64 膨胀后 ≈ 原始 8MB） */
const MAX_UPLOAD_BODY_BYTES = 12 * 1024 * 1024
/** 会话 PATCH 中会改变侧栏展示的字段（标题/置顶/归档/标记/项目归属）；
 *  纯运行时配置（模型/权限/推理等）侧栏不展示，不触发侧栏广播 */
const SIDEBAR_VISIBLE_SESSION_FIELDS: readonly (keyof MobileBridgeUpdateSessionRequest)[] = [
  'title',
  'pinned',
  'archived',
  'sessionLabel',
  'projectId',
]

export interface MobileBridgeDeps {
  /** 项目列表（workspace 投影，含项目下会话数） */
  listProjects(limit: number): Promise<MobileBridgeProjectListResponse>
  /** 会话列表（最近 limit 条，含预览；projectId 过滤时仅返回该项目下的会话） */
  listSessions(
    limit: number,
    projectId?: string,
  ): Promise<{ sessions: MobileBridgeSessionSummary[]; total: number }>
  /** 新建会话（默认渠道/默认 Agent，标题缺省「移动端会话」；projectId 归属项目） */
  createSession(input: { title?: string; projectId?: string }): Promise<MobileBridgeSessionSummary>
  /** 重命名 / 置顶 / 归档 / 运行时配置 / 项目归属（仅透传需要修改的字段） */
  updateSession(
    sessionId: string,
    patch: MobileBridgeUpdateSessionRequest,
  ): Promise<MobileBridgeSessionSummary>
  /** 删除会话（含终端等副作用清理） */
  deleteSession(sessionId: string): Promise<{ deleted: boolean }>
  /** 项目重命名 / 置顶 / 归档（返回更新后摘要，端上据此回显校验；与 workspace:update 同换算） */
  updateProject(
    projectId: string,
    patch: { name?: string; pinned?: boolean; archived?: boolean },
  ): Promise<MobileBridgeProjectSummary>
  /** 项目删除（级联删除项目下全部会话；保留项目抛 VALIDATION_FAILED SparkError） */
  deleteProject(projectId: string): Promise<{ deleted: boolean }>
  /** 会话搜索（标题 LIKE + 内容 FTS5；projectId 过滤，'default' 为虚拟未归属项目） */
  searchSessions(query: string, projectId?: string, limit?: number): Promise<SessionSearchResponse>
  /** 侧栏手动排序读取（项目序 + 项目内会话序 + 置顶会话序） */
  getSidebarOrder(): SidebarOrderState
  /** 侧栏手动排序写入（校验内置：项目存在、会话归属；返回落库后的 id 顺序） */
  updateSidebarOrder(
    request: SidebarOrderUpdateRequest,
  ): Promise<MobileBridgeSidebarOrderUpdateResponse>
  /** 侧栏相关写成功后广播（渲染端订阅 stream:session:list-changed 立即重拉，双向同步） */
  notifySidebarChanged(): void
  /**
   * 会话历史（agent 事件 → 移动端子集）。
   * beforeSeq：向上翻页游标，只返回 seq 小于该值的事件（服务端按 seq 正序返回）。
   */
  getHistory(
    sessionId: string,
    query: {
      limit: number
      turnLimit?: number
      eventLimit?: number
      beforeSeq?: number
    },
  ): Promise<{
    events: MobileBridgeEvent[]
    running: boolean
    hasMore?: boolean
    nextBeforeSeq?: number
  }>
  /** 实时流按 seq 读取原始增量事件；历史分页会有意过滤 delta。 */
  getStreamEvents(
    sessionId: string,
    afterSeq: number,
  ): Promise<{ events: MobileBridgeEvent[]; nextSeq: number }>
  /** 提交回合（消息进入会话，等同桌面端发送；attachmentPaths 须来自 saveAttachments） */
  submitTurn(
    sessionId: string,
    text: string,
    attachmentPaths?: string[],
  ): Promise<{ turnId: string }>
  /** 取消进行中的回合 */
  cancelTurn(sessionId: string): Promise<void>

  // ─── 挂起交互（权限审批 + 用户问答；移动端审批卡/问答卡数据源，2026-10-16） ──

  /** 会话挂起交互快照（无推送通道的端轮询拉取；旧版桌面端可由端上兼容为空） */
  listPendingInteractions(sessionId: string): Promise<MobileBridgeInteractionsResponse>
  /** 解析权限审批（requestId 必须属于该会话）；false = 审批已结束或不存在 */
  resolveApproval(
    sessionId: string,
    requestId: string,
    decision: MobileBridgeApprovalDecision,
  ): Promise<boolean>
  /** 应答用户问答（questionId 必须属于该会话）；false = 提问已结束或不存在 */
  answerQuestion(
    sessionId: string,
    questionId: string,
    answers: Record<string, unknown>,
  ): Promise<boolean>

  // ─── 会话内配置与输入能力扩展（2026-10-14） ──────────────────────────────────

  /** 选项目录：agents + workflows + 对话可用渠道（剔除 embedding/纯多媒体） */
  getCatalog(): Promise<MobileBridgeCatalog>
  /** 会话运行配置摘要（配置条回显；null = 旧数据缺失，端上按默认渲染） */
  getSessionRuntime(sessionId: string): Promise<MobileBridgeSessionRuntime | null>
  /** 工作流绑定读取 */
  getWorkflowBinding(sessionId: string): Promise<MobileBridgeWorkflowBindingResponse>
  /** 工作流绑定写入（mode=override 时 workflowId 必填） */
  setWorkflowBinding(
    sessionId: string,
    request: MobileBridgeSetWorkflowBindingRequest,
  ): Promise<MobileBridgeWorkflowBindingResponse>
  /** 附件落盘（base64 → userData/attachments 白名单目录；图片压缩到 ≤2000px） */
  saveAttachments(
    sessionId: string,
    files: MobileBridgeUploadAttachmentsRequest['files'],
  ): Promise<MobileBridgeAttachment[]>
  /** 附件内容读取（仅白名单目录内路径；null = 路径非法或不存在） */
  readAttachmentContent(path: string): Promise<{ data: Buffer; mimeType: string } | null>
  /** 语音转写（本地 SenseVoice → 云渠道兜底） */
  transcribeAudio(input: {
    audioPath: string
    mimeType?: string
  }): Promise<
    { kind: 'ok'; text: string; engine: 'local' | 'cloud' } | { kind: 'failed'; message: string }
  >
  /** session 作用域定时任务列表 */
  listSessionTasks(sessionId: string): Promise<MobileBridgeScheduledTask[]>
  /** 创建 session 作用域定时任务（模型仅 LLM；缺省跟随会话模型） */
  createSessionTask(
    sessionId: string,
    request: MobileBridgeCreateScheduledTaskRequest,
  ): Promise<MobileBridgeScheduledTask>
  /** 更新任务（名称/提示词/触发方式/启停） */
  updateSessionTask(
    taskId: string,
    request: MobileBridgeUpdateScheduledTaskRequest,
  ): Promise<MobileBridgeScheduledTask | null>
  /** 删除任务 */
  deleteSessionTask(taskId: string): Promise<boolean>
  /** 启停任务 */
  toggleSessionTask(taskId: string, enabled: boolean): Promise<MobileBridgeScheduledTask | null>
  /** 立即执行一次 */
  runSessionTaskNow(taskId: string): Promise<{ started: boolean }>
  /** 斜杠命令目录（会话上下文相关，含技能命令） */
  listCommands(sessionId: string): Promise<MobileBridgeCommandItem[]>
  /** 执行斜杠命令（设置型在主进程内生效，操作型转发 agent；运行中排队 queued=true） */
  executeCommand(
    sessionId: string,
    raw: string,
  ): Promise<{
    isCommand: boolean
    forwardToAgent: boolean
    queued?: boolean
    message?: string
  }>

  // ─── 会话分支 + 技能列表（2026-10-16） ─────────────────────────────────────

  /** 从指定会话 fork 出独立子会话（对齐桌面端「从此处分支」；锚点须为已完成 turn） */
  forkSession(
    sessionId: string,
    request: MobileBridgeForkSessionRequest,
  ): Promise<MobileBridgeForkSessionResponse>
  /** 会话分支血缘（来源 + 直接子分支；lineage=null = 该会话不是 fork 副本） */
  getSessionLineage(sessionId: string): Promise<MobileBridgeLineageResponse>
  /** 技能只读列表（平台已安装 + 会话项目技能；移动端选择器数据源，旧版桌面端 404） */
  listSkills(sessionId: string): Promise<MobileBridgeSkillListResponse>
}

/**
 * handleHttpRequest 的调用来源标记，是唯一的信任依据：
 *   relay=true  仅限进程内的云端中继合成请求（invokeRelay → runSyntheticRequest）
 *               传入，edu-server 已按账号鉴权并只转发给本人；
 *   relay=false 其他一切来源——本服务已不再监听网络端口，出现该值即拒绝。
 * 鉴权绝不信任任何请求头——网络侧请求可随意伪造 header（安全修复 F1）。
 */
interface HttpRequestOrigin {
  relay: boolean
}

export class MobileBridgeService {
  private deps: MobileBridgeDeps | null = null
  /** sessionId → 该会话当前订阅连接集合（中继订阅者；广播用） */
  private readonly streamClients = new Map<string, Set<WsConnection>>()
  /** sessionId → 轮询定时器 */
  private readonly streamPollers = new Map<string, ReturnType<typeof setInterval>>()

  setDeps(deps: MobileBridgeDeps): void {
    this.deps = deps
  }

  // ─── HTTP 语义路由（唯一入口：进程内中继合成请求） ───────────────────────────

  private async handleHttpRequest(
    req: IncomingMessage,
    res: ServerResponse,
    origin: HttpRequestOrigin = { relay: false },
  ): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const path = url.pathname.replace(/\/+$/, '') || '/'

    // CORS：小程序端无跨域限制，但保留调试便利
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    if (path === '/v1/health' && req.method === 'GET') {
      this.sendJson(res, 200, { ok: true, running: true })
      return
    }

    // 唯一鉴权：LAN 令牌路径已随局域网直连一并移除，origin.relay 是唯一信任来源，
    // 且只可能由本进程 runSyntheticRequest 显式传入（合成请求不可能来自网络）。
    if (!origin.relay) {
      this.sendJson(res, 401, {
        error: { code: 'UNAUTHORIZED', message: '仅接受云端中继调用' },
      })
      return
    }

    // ─── 项目（workspace 投影） ────────────────────────────────────────────────

    if (path === '/v1/projects' && req.method === 'GET') {
      const limit = Math.max(1, Math.min(Number(url.searchParams.get('limit') ?? '50') || 50, 200))
      const body = await this.requireDeps().listProjects(limit)
      this.sendJson(res, 200, body)
      return
    }

    // 项目重命名 / 置顶 / 归档（移动端反向设置；响应带更新后摘要供端上回显校验）
    const projectItemMatch = /^\/v1\/projects\/([^/]+)$/.exec(path)
    if (projectItemMatch && req.method === 'PATCH') {
      const rawId = projectItemMatch[1]
      if (rawId == null) {
        this.sendJson(res, 404, { error: { code: 'NOT_FOUND', message: '接口不存在' } })
        return
      }
      const payload = await this.readJson<MobileBridgeUpdateProjectRequest>(req)
      const patch: MobileBridgeUpdateProjectRequest = {}
      if (payload.name !== undefined) {
        if (typeof payload.name !== 'string' || payload.name.trim().length === 0) {
          this.sendJson(res, 400, { error: { code: 'BAD_REQUEST', message: '项目名不能为空' } })
          return
        }
        patch.name = payload.name.trim()
      }
      if (typeof payload.pinned === 'boolean') patch.pinned = payload.pinned
      if (typeof payload.archived === 'boolean') patch.archived = payload.archived
      if (patch.name === undefined && patch.pinned === undefined && patch.archived === undefined) {
        this.sendJson(res, 400, { error: { code: 'BAD_REQUEST', message: '缺少需要修改的字段' } })
        return
      }
      try {
        const project = await this.requireDeps().updateProject(decodeURIComponent(rawId), patch)
        this.requireDeps().notifySidebarChanged()
        this.sendJson(res, 200, { project })
      } catch (error) {
        this.sendSparkError(res, error)
      }
      return
    }

    // 项目删除（移动端反向设置；与桌面端 workspace:delete 同语义：级联删除项目下全部会话）
    if (projectItemMatch && req.method === 'DELETE') {
      const rawId = projectItemMatch[1]
      if (rawId == null) {
        this.sendJson(res, 404, { error: { code: 'NOT_FOUND', message: '接口不存在' } })
        return
      }
      try {
        const body = await this.requireDeps().deleteProject(decodeURIComponent(rawId))
        if (body.deleted) this.requireDeps().notifySidebarChanged()
        this.sendJson(res, 200, body)
      } catch (error) {
        this.sendSparkError(res, error)
      }
      return
    }

    // 会话搜索（标题 LIKE + 内容 FTS5；projectId 过滤语义与列表端点一致）
    if (path === '/v1/search' && req.method === 'GET') {
      const query = (url.searchParams.get('q') ?? '').trim()
      if (!query) {
        this.sendJson(res, 400, { error: { code: 'BAD_REQUEST', message: '缺少搜索关键词 q' } })
        return
      }
      const projectIdParam = (url.searchParams.get('projectId') ?? '').trim()
      const limitParam = Number(url.searchParams.get('limit') ?? '20') || 20
      const body = await this.requireDeps().searchSessions(
        query,
        projectIdParam || undefined,
        Math.min(limitParam, 50),
      )
      this.sendJson(res, 200, body)
      return
    }

    // ─── 侧栏手动排序（移动端与桌面端共享同一份手动序） ──────────────────────────

    if (path === '/v1/sidebar-order' && req.method === 'GET') {
      const order = await this.requireDeps().getSidebarOrder()
      this.sendJson(res, 200, order)
      return
    }
    if (path === '/v1/sidebar-order' && req.method === 'PUT') {
      const payload = await this.readJson<SidebarOrderUpdateRequest>(req)
      if (
        payload?.scope !== 'projects' &&
        payload?.scope !== 'sessions' &&
        payload?.scope !== 'pinned-sessions'
      ) {
        this.sendJson(res, 400, {
          error: { code: 'BAD_REQUEST', message: 'scope 必须是 projects/sessions/pinned-sessions' },
        })
        return
      }
      if (
        payload.scope !== 'projects' &&
        !(typeof payload.projectId === 'string' && payload.projectId)
      ) {
        this.sendJson(res, 400, { error: { code: 'BAD_REQUEST', message: '缺少 projectId' } })
        return
      }
      if (
        !Array.isArray(payload.itemIds) ||
        payload.itemIds.some((id) => typeof id !== 'string') ||
        new Set(payload.itemIds).size !== payload.itemIds.length
      ) {
        this.sendJson(res, 400, {
          error: { code: 'BAD_REQUEST', message: 'itemIds 必须是不含重复项的 id 数组' },
        })
        return
      }
      try {
        const body = await this.requireDeps().updateSidebarOrder(payload)
        this.requireDeps().notifySidebarChanged()
        this.sendJson(res, 200, body)
      } catch (error) {
        this.sendSparkError(res, error)
      }
      return
    }

    // ─── 选项目录（配置条数据源） ─────────────────────────────────────────────

    if (path === '/v1/catalog' && req.method === 'GET') {
      const body = await this.requireDeps().getCatalog()
      this.sendJson(res, 200, body)
      return
    }

    // ─── 语音转写（本地 SenseVoice → 云渠道兜底） ──────────────────────────────

    if (path === '/v1/transcribe' && req.method === 'POST') {
      const payload = await this.readJson<{ audioBase64?: string; mimeType?: string }>(
        req,
        MAX_UPLOAD_BODY_BYTES,
      )
      const audioBase64 = (payload.audioBase64 ?? '').trim()
      if (!audioBase64) {
        this.sendJson(res, 400, { error: { code: 'BAD_REQUEST', message: '缺少 audioBase64' } })
        return
      }
      let audioPath: string
      try {
        audioPath = await writeBase64TempFile(audioBase64, payload.mimeType)
      } catch {
        this.sendJson(res, 400, { error: { code: 'BAD_REQUEST', message: '音频数据无效' } })
        return
      }
      try {
        const outcome = await this.requireDeps().transcribeAudio({
          audioPath,
          ...(payload.mimeType != null ? { mimeType: payload.mimeType } : {}),
        })
        if (outcome.kind === 'ok') {
          this.sendJson(res, 200, { text: outcome.text, engine: outcome.engine })
        } else {
          this.sendJson(res, 422, { error: { code: 'BAD_REQUEST', message: outcome.message } })
        }
      } finally {
        fs.unlink(audioPath).catch(() => undefined)
      }
      return
    }

    // ─── 斜杠命令 ─────────────────────────────────────────────────────────────

    if (path === '/v1/commands' && req.method === 'GET') {
      const sessionId = (url.searchParams.get('sessionId') ?? '').trim()
      const commands = await this.requireDeps().listCommands(sessionId)
      this.sendJson(res, 200, { commands })
      return
    }

    // ─── 技能列表（移动端只读选择器；旧版桌面端无此端点，端上 404 降级隐藏入口） ──

    if (path === '/v1/skills' && req.method === 'GET') {
      const sessionId = (url.searchParams.get('sessionId') ?? '').trim()
      const body = await this.requireDeps().listSkills(sessionId)
      this.sendJson(res, 200, body)
      return
    }

    const projectSessionsMatch = /^\/v1\/projects\/([^/]+)\/sessions$/.exec(path)
    if (projectSessionsMatch && req.method === 'GET') {
      const rawId = projectSessionsMatch[1]
      if (rawId == null) {
        this.sendJson(res, 404, { error: { code: 'NOT_FOUND', message: '接口不存在' } })
        return
      }
      const projectId = decodeURIComponent(rawId)
      const limit = Math.max(1, Math.min(Number(url.searchParams.get('limit') ?? '50') || 50, 200))
      const result = await this.requireDeps().listSessions(limit, projectId)
      const body: MobileBridgeSessionListResponse = result
      this.sendJson(res, 200, body)
      return
    }

    // ─── 会话 ─────────────────────────────────────────────────────────────────

    if (path === '/v1/sessions' && req.method === 'GET') {
      const limit = Math.max(1, Math.min(Number(url.searchParams.get('limit') ?? '50') || 50, 200))
      const projectIdParam = url.searchParams.get('projectId')
      const result = await this.requireDeps().listSessions(
        limit,
        projectIdParam ? decodeURIComponent(projectIdParam) : undefined,
      )
      const body: MobileBridgeSessionListResponse = result
      this.sendJson(res, 200, body)
      return
    }

    if (path === '/v1/sessions' && req.method === 'POST') {
      const payload = await this.readJson<{ title?: string; projectId?: string }>(req)
      const session = await this.requireDeps().createSession({
        ...(payload.title ? { title: payload.title } : {}),
        ...(payload.projectId ? { projectId: payload.projectId } : {}),
      })
      // 桌面端侧栏对自身 CRUD 走乐观更新，移动端新建只有靠这里广播才能实时出现
      this.requireDeps().notifySidebarChanged()
      const body: MobileBridgeCreateSessionResponse = { session }
      this.sendJson(res, 200, body)
      return
    }

    const sessionItemMatch = /^\/v1\/sessions\/([^/]+)$/.exec(path)
    if (sessionItemMatch && req.method === 'PATCH') {
      const rawId = sessionItemMatch[1]
      if (rawId == null) {
        this.sendJson(res, 404, { error: { code: 'NOT_FOUND', message: '接口不存在' } })
        return
      }
      const sessionId = decodeURIComponent(rawId)
      const payload = await this.readJson<MobileBridgeUpdateSessionRequest>(req)
      const patch: MobileBridgeUpdateSessionRequest = {}
      if (typeof payload.title === 'string' && payload.title.trim())
        patch.title = payload.title.trim()
      if (typeof payload.pinned === 'boolean') patch.pinned = payload.pinned
      if (typeof payload.archived === 'boolean') patch.archived = payload.archived
      // ── 运行时配置（与桌面端 session:update 同语义；仅透传显式给出的字段） ──
      if (typeof payload.providerProfileId === 'string' && payload.providerProfileId) {
        patch.providerProfileId = payload.providerProfileId
      }
      if (payload.modelId !== undefined) {
        patch.modelId = typeof payload.modelId === 'string' ? payload.modelId : null
      }
      if (typeof payload.agentAdapter === 'string' && payload.agentAdapter) {
        patch.agentAdapter = payload.agentAdapter
      }
      if (payload.agentId !== undefined) {
        patch.agentId =
          typeof payload.agentId === 'string' && payload.agentId ? payload.agentId : null
      }
      if (typeof payload.permissionMode === 'string' && payload.permissionMode) {
        patch.permissionMode = payload.permissionMode
      }
      if (typeof payload.reasoningEffort === 'string' && payload.reasoningEffort) {
        patch.reasoningEffort = payload.reasoningEffort
      }
      if (typeof payload.chatMode === 'string' && payload.chatMode) {
        patch.chatMode = payload.chatMode
      }
      if (typeof payload.projectId === 'string' && payload.projectId) {
        patch.projectId = payload.projectId
      }
      // 会话标记（null = 取消标记；非法值直接 400，不静默忽略避免端上假成功）
      if (payload.sessionLabel !== undefined) {
        if (
          payload.sessionLabel !== null &&
          !(SESSION_LABEL_KEYS as readonly string[]).includes(payload.sessionLabel)
        ) {
          this.sendJson(res, 400, {
            error: { code: 'BAD_REQUEST', message: '不支持的会话标记' },
          })
          return
        }
        patch.sessionLabel = payload.sessionLabel
      }
      if (Object.keys(patch).length === 0) {
        this.sendJson(res, 400, { error: { code: 'BAD_REQUEST', message: '没有需要修改的字段' } })
        return
      }
      const session = await this.requireDeps().updateSession(sessionId, patch)
      // 置顶/打标/改名等侧栏可见字段实时回流桌面端（渲染端订阅后防抖重拉）；
      // 纯运行时配置补丁（快速发起建会话后紧跟的模型/权限/推理 patch）不打扰侧栏重拉
      if (SIDEBAR_VISIBLE_SESSION_FIELDS.some((field) => patch[field] !== undefined)) {
        this.requireDeps().notifySidebarChanged()
      }
      const runtime = await this.requireDeps().getSessionRuntime(sessionId)
      this.sendJson(res, 200, { session: { ...session, ...(runtime != null ? { runtime } : {}) } })
      return
    }

    if (sessionItemMatch && req.method === 'DELETE') {
      const rawId = sessionItemMatch[1]
      if (rawId == null) {
        this.sendJson(res, 404, { error: { code: 'NOT_FOUND', message: '接口不存在' } })
        return
      }
      const sessionId = decodeURIComponent(rawId)
      const result = await this.requireDeps().deleteSession(sessionId)
      // 删除实时回流桌面端侧栏（乐观更新模型感知不到外部删除，会一直滞留旧条目）
      this.requireDeps().notifySidebarChanged()
      this.sendJson(res, 200, result)
      return
    }

    const messagesMatch = /^\/v1\/sessions\/([^/]+)\/messages$/.exec(path)
    if (messagesMatch && req.method === 'GET') {
      const rawId = messagesMatch[1]
      if (rawId == null) {
        this.sendJson(res, 404, { error: { code: 'NOT_FOUND', message: '接口不存在' } })
        return
      }
      const sessionId = decodeURIComponent(rawId)
      const limit = Math.max(
        1,
        Math.min(Number(url.searchParams.get('limit') ?? 200) || 200, HISTORY_LIMIT),
      )
      // 向上翻页游标：仅接受正整数（非法值静默忽略 = 按最新页返回，向后兼容旧客户端）
      const beforeSeqRaw = url.searchParams.get('beforeSeq')
      const beforeSeq =
        beforeSeqRaw != null &&
        /^\d+$/.test(beforeSeqRaw) &&
        Number.isSafeInteger(Number(beforeSeqRaw))
          ? Number(beforeSeqRaw)
          : undefined
      const turnLimitRaw = url.searchParams.get('turnLimit')
      const turnLimit =
        turnLimitRaw != null && /^\d+$/.test(turnLimitRaw) && Number(turnLimitRaw) > 0
          ? Math.min(Number(turnLimitRaw), 50)
          : undefined
      const eventLimitRaw = url.searchParams.get('eventLimit')
      const eventLimit =
        eventLimitRaw != null && /^\d+$/.test(eventLimitRaw) && Number(eventLimitRaw) > 0
          ? Math.min(Number(eventLimitRaw), 5_000)
          : undefined
      const result = await this.requireDeps().getHistory(sessionId, {
        limit,
        ...(turnLimit != null ? { turnLimit } : {}),
        ...(eventLimit != null ? { eventLimit } : {}),
        ...(beforeSeq != null ? { beforeSeq } : {}),
      })
      const body: MobileBridgeHistoryResponse = {
        sessionId,
        events: result.events,
        running: result.running,
        ...(result.hasMore != null ? { hasMore: result.hasMore } : {}),
        ...(result.nextBeforeSeq != null ? { nextBeforeSeq: result.nextBeforeSeq } : {}),
      }
      this.sendJson(res, 200, body)
      return
    }

    const turnMatch = /^\/v1\/sessions\/([^/]+)\/turns$/.exec(path)
    if (turnMatch && req.method === 'POST') {
      const rawId = turnMatch[1]
      if (rawId == null) {
        this.sendJson(res, 404, { error: { code: 'NOT_FOUND', message: '接口不存在' } })
        return
      }
      const sessionId = decodeURIComponent(rawId)
      const payload = await this.readJson<MobileBridgeSubmitTurnRequest>(req)
      const text = (payload.text ?? '').trim()
      if (!text) {
        this.sendJson(res, 400, { error: { code: 'BAD_REQUEST', message: '消息不能为空' } })
        return
      }
      // 附件路径仅接受本服务 /attachments 端点落盘产生的路径（装配层再做白名单校验）
      const attachmentPaths = Array.isArray(payload.attachmentPaths)
        ? payload.attachmentPaths.filter((item): item is string => typeof item === 'string')
        : undefined
      const result = await this.requireDeps().submitTurn(
        sessionId,
        text,
        attachmentPaths != null && attachmentPaths.length > 0 ? attachmentPaths : undefined,
      )
      // 新回合：确保该会话轮询器在跑（终态后可能已停）
      this.ensurePoller(sessionId)
      this.sendJson(res, 200, result)
      return
    }

    const cancelMatch = /^\/v1\/sessions\/([^/]+)\/cancel$/.exec(path)
    if (cancelMatch && req.method === 'POST') {
      const rawId = cancelMatch[1]
      if (rawId == null) {
        this.sendJson(res, 404, { error: { code: 'NOT_FOUND', message: '接口不存在' } })
        return
      }
      const sessionId = decodeURIComponent(rawId)
      await this.requireDeps().cancelTurn(sessionId)
      this.sendJson(res, 200, { cancelled: true })
      return
    }

    // ─── 会话分支（Session Fork：对齐桌面端「从此处分支」；子会话为独立实体） ──

    const forkMatch = /^\/v1\/sessions\/([^/]+)\/fork$/.exec(path)
    if (forkMatch && req.method === 'POST') {
      const rawId = forkMatch[1]
      if (rawId == null) {
        this.sendJson(res, 404, { error: { code: 'NOT_FOUND', message: '接口不存在' } })
        return
      }
      const sessionId = decodeURIComponent(rawId)
      const payload = await this.readJson<MobileBridgeForkSessionRequest>(req)
      // anchorTurnId / title 只接受非空字符串（缺省 = 复制全部已完成内容 / 沿用自动标题）
      if (
        payload.anchorTurnId != null &&
        !(typeof payload.anchorTurnId === 'string' && payload.anchorTurnId.trim())
      ) {
        this.sendJson(res, 400, { error: { code: 'BAD_REQUEST', message: 'anchorTurnId 无效' } })
        return
      }
      if (payload.title != null && !(typeof payload.title === 'string' && payload.title.trim())) {
        this.sendJson(res, 400, { error: { code: 'BAD_REQUEST', message: 'title 无效' } })
        return
      }
      let body
      try {
        body = await this.requireDeps().forkSession(sessionId, payload)
      } catch (error) {
        // 源会话不存在→404、锚点无效→400（装配层转 SparkError）；其余 rethrow 兜底 500
        this.sendSparkError(res, error)
        return
      }
      log.info(
        `mobile bridge session forked: session=${sessionId} child=${body.session.id} turns=${body.copiedTurnCount}`,
      )
      // 子会话是侧栏可见实体：通知桌面端刷新（复用既有双向同步通道）
      this.requireDeps().notifySidebarChanged()
      this.sendJson(res, 200, body)
      return
    }

    const lineageMatch = /^\/v1\/sessions\/([^/]+)\/lineage$/.exec(path)
    if (lineageMatch && req.method === 'GET') {
      const rawId = lineageMatch[1]
      if (rawId == null) {
        this.sendJson(res, 404, { error: { code: 'NOT_FOUND', message: '接口不存在' } })
        return
      }
      const body = await this.requireDeps().getSessionLineage(decodeURIComponent(rawId))
      this.sendJson(res, 200, body)
      return
    }

    // ─── 挂起交互（审批/问答轮询 + 应答；移动端无下行推送通道） ────────────────

    const interactionsMatch = /^\/v1\/sessions\/([^/]+)\/interactions$/.exec(path)
    if (interactionsMatch && req.method === 'GET') {
      const rawId = interactionsMatch[1]
      if (rawId == null) {
        this.sendJson(res, 404, { error: { code: 'NOT_FOUND', message: '接口不存在' } })
        return
      }
      const body = await this.requireDeps().listPendingInteractions(decodeURIComponent(rawId))
      this.sendJson(res, 200, body)
      return
    }

    const approvalMatch = /^\/v1\/sessions\/([^/]+)\/approvals\/([^/]+)\/resolve$/.exec(path)
    if (approvalMatch && req.method === 'POST') {
      const rawSessionId = approvalMatch[1]
      const rawRequestId = approvalMatch[2]
      if (rawSessionId == null || rawRequestId == null) {
        this.sendJson(res, 404, { error: { code: 'NOT_FOUND', message: '接口不存在' } })
        return
      }
      const payload = await this.readJson<{ decision?: string }>(req)
      const decision = payload.decision
      if (decision !== 'allow-once' && decision !== 'allow-session' && decision !== 'deny') {
        this.sendJson(res, 400, {
          error: { code: 'BAD_REQUEST', message: 'decision 必须是 allow-once/allow-session/deny' },
        })
        return
      }
      const ok = await this.requireDeps().resolveApproval(
        decodeURIComponent(rawSessionId),
        decodeURIComponent(rawRequestId),
        decision,
      )
      if (!ok) {
        this.sendJson(res, 404, {
          error: { code: 'NOT_FOUND', message: '审批已结束或不存在，请刷新后重试' },
        })
        return
      }
      this.sendJson(res, 200, { ok: true })
      return
    }

    const questionMatch = /^\/v1\/sessions\/([^/]+)\/questions\/([^/]+)\/answer$/.exec(path)
    if (questionMatch && req.method === 'POST') {
      const rawSessionId = questionMatch[1]
      const rawQuestionId = questionMatch[2]
      if (rawSessionId == null || rawQuestionId == null) {
        this.sendJson(res, 404, { error: { code: 'NOT_FOUND', message: '接口不存在' } })
        return
      }
      const payload = await this.readJson<{ answers?: unknown }>(req)
      if (payload.answers == null || typeof payload.answers !== 'object') {
        this.sendJson(res, 400, { error: { code: 'BAD_REQUEST', message: '缺少 answers' } })
        return
      }
      const ok = await this.requireDeps().answerQuestion(
        decodeURIComponent(rawSessionId),
        decodeURIComponent(rawQuestionId),
        payload.answers as Record<string, unknown>,
      )
      if (!ok) {
        this.sendJson(res, 404, {
          error: { code: 'NOT_FOUND', message: '提问已结束或不存在，请刷新后重试' },
        })
        return
      }
      this.sendJson(res, 200, { ok: true })
      return
    }

    // ─── 会话运行配置摘要（详情回显） ──────────────────────────────────────────

    const sessionRuntimeMatch = /^\/v1\/sessions\/([^/]+)\/runtime$/.exec(path)
    if (sessionRuntimeMatch && req.method === 'GET') {
      const rawId = sessionRuntimeMatch[1]
      if (rawId == null) {
        this.sendJson(res, 404, { error: { code: 'NOT_FOUND', message: '接口不存在' } })
        return
      }
      const sessionId = decodeURIComponent(rawId)
      const runtime = await this.requireDeps().getSessionRuntime(sessionId)
      this.sendJson(res, 200, { runtime: runtime ?? {} })
      return
    }

    // ─── 工作流绑定 ───────────────────────────────────────────────────────────

    const workflowMatch = /^\/v1\/sessions\/([^/]+)\/workflow$/.exec(path)
    if (workflowMatch && req.method === 'GET') {
      const rawId = workflowMatch[1]
      if (rawId == null) {
        this.sendJson(res, 404, { error: { code: 'NOT_FOUND', message: '接口不存在' } })
        return
      }
      const body = await this.requireDeps().getWorkflowBinding(decodeURIComponent(rawId))
      this.sendJson(res, 200, body)
      return
    }
    if (workflowMatch && req.method === 'PUT') {
      const rawId = workflowMatch[1]
      if (rawId == null) {
        this.sendJson(res, 404, { error: { code: 'NOT_FOUND', message: '接口不存在' } })
        return
      }
      const sessionId = decodeURIComponent(rawId)
      const payload = await this.readJson<MobileBridgeSetWorkflowBindingRequest>(req)
      if (
        payload.mode !== 'inherit' &&
        payload.mode !== 'override' &&
        payload.mode !== 'disabled'
      ) {
        this.sendJson(res, 400, {
          error: { code: 'BAD_REQUEST', message: 'mode 必须是 inherit/override/disabled' },
        })
        return
      }
      if (
        payload.mode === 'override' &&
        !(typeof payload.workflowId === 'string' && payload.workflowId)
      ) {
        this.sendJson(res, 400, {
          error: { code: 'BAD_REQUEST', message: 'mode=override 时必须提供 workflowId' },
        })
        return
      }
      const body = await this.requireDeps().setWorkflowBinding(sessionId, payload)
      this.sendJson(res, body.error != null ? 409 : 200, body)
      return
    }

    // ─── 附件上传（base64 → 桌面端白名单目录落盘） ────────────────────────────

    const attachmentsMatch = /^\/v1\/sessions\/([^/]+)\/attachments$/.exec(path)
    if (attachmentsMatch && req.method === 'POST') {
      const rawId = attachmentsMatch[1]
      if (rawId == null) {
        this.sendJson(res, 404, { error: { code: 'NOT_FOUND', message: '接口不存在' } })
        return
      }
      const sessionId = decodeURIComponent(rawId)
      const payload = await this.readJson<MobileBridgeUploadAttachmentsRequest>(
        req,
        MAX_UPLOAD_BODY_BYTES,
      )
      if (!Array.isArray(payload.files) || payload.files.length === 0) {
        this.sendJson(res, 400, { error: { code: 'BAD_REQUEST', message: '缺少 files' } })
        return
      }
      if (payload.files.length > 20) {
        this.sendJson(res, 400, { error: { code: 'BAD_REQUEST', message: '单次最多 20 个附件' } })
        return
      }
      const attachments = await this.requireDeps().saveAttachments(sessionId, payload.files)
      this.sendJson(res, 200, { attachments })
      return
    }

    // ─── 会话内定时任务（session 作用域） ──────────────────────────────────────

    const sessionTasksMatch = /^\/v1\/sessions\/([^/]+)\/tasks$/.exec(path)
    if (sessionTasksMatch && req.method === 'GET') {
      const rawId = sessionTasksMatch[1]
      if (rawId == null) {
        this.sendJson(res, 404, { error: { code: 'NOT_FOUND', message: '接口不存在' } })
        return
      }
      const tasks = await this.requireDeps().listSessionTasks(decodeURIComponent(rawId))
      this.sendJson(res, 200, { tasks })
      return
    }
    if (sessionTasksMatch && req.method === 'POST') {
      const rawId = sessionTasksMatch[1]
      if (rawId == null) {
        this.sendJson(res, 404, { error: { code: 'NOT_FOUND', message: '接口不存在' } })
        return
      }
      const sessionId = decodeURIComponent(rawId)
      const payload = await this.readJson<MobileBridgeCreateScheduledTaskRequest>(req)
      if (!(typeof payload.name === 'string' && payload.name.trim())) {
        this.sendJson(res, 400, { error: { code: 'BAD_REQUEST', message: '缺少任务名称' } })
        return
      }
      if (!(typeof payload.prompt === 'string' && payload.prompt.trim())) {
        this.sendJson(res, 400, { error: { code: 'BAD_REQUEST', message: '缺少提示词' } })
        return
      }
      if (
        payload.triggerType !== 'interval' &&
        payload.triggerType !== 'cron' &&
        payload.triggerType !== 'once'
      ) {
        this.sendJson(res, 400, {
          error: { code: 'BAD_REQUEST', message: 'triggerType 必须是 interval/cron/once' },
        })
        return
      }
      const task = await this.requireDeps().createSessionTask(sessionId, payload)
      this.sendJson(res, 200, { task })
      return
    }

    // ─── 斜杠命令执行 ─────────────────────────────────────────────────────────

    const sessionCommandsMatch = /^\/v1\/sessions\/([^/]+)\/commands$/.exec(path)
    if (sessionCommandsMatch && req.method === 'POST') {
      const rawId = sessionCommandsMatch[1]
      if (rawId == null) {
        this.sendJson(res, 404, { error: { code: 'NOT_FOUND', message: '接口不存在' } })
        return
      }
      const sessionId = decodeURIComponent(rawId)
      const payload = await this.readJson<{ raw?: string }>(req)
      const raw = (payload.raw ?? '').trim()
      if (!raw.startsWith('/')) {
        this.sendJson(res, 400, { error: { code: 'BAD_REQUEST', message: '必须以 / 开头' } })
        return
      }
      const body = await this.requireDeps().executeCommand(sessionId, raw)
      this.sendJson(res, 200, body)
      return
    }

    // ─── 定时任务项操作（更新/删除/启停/立即执行） ─────────────────────────────

    const taskItemMatch = /^\/v1\/tasks\/([^/]+)$/.exec(path)
    if (taskItemMatch && req.method === 'PATCH') {
      const rawId = taskItemMatch[1]
      if (rawId == null) {
        this.sendJson(res, 404, { error: { code: 'NOT_FOUND', message: '接口不存在' } })
        return
      }
      const payload = await this.readJson<MobileBridgeUpdateScheduledTaskRequest>(req)
      const task = await this.requireDeps().updateSessionTask(decodeURIComponent(rawId), payload)
      if (task == null) {
        this.sendJson(res, 404, { error: { code: 'NOT_FOUND', message: '任务不存在' } })
        return
      }
      this.sendJson(res, 200, { task })
      return
    }
    if (taskItemMatch && req.method === 'DELETE') {
      const rawId = taskItemMatch[1]
      if (rawId == null) {
        this.sendJson(res, 404, { error: { code: 'NOT_FOUND', message: '接口不存在' } })
        return
      }
      const deleted = await this.requireDeps().deleteSessionTask(decodeURIComponent(rawId))
      this.sendJson(
        res,
        deleted ? 200 : 404,
        deleted ? { deleted: true } : { error: { code: 'NOT_FOUND', message: '任务不存在' } },
      )
      return
    }

    const taskToggleMatch = /^\/v1\/tasks\/([^/]+)\/toggle$/.exec(path)
    if (taskToggleMatch && req.method === 'POST') {
      const rawId = taskToggleMatch[1]
      if (rawId == null) {
        this.sendJson(res, 404, { error: { code: 'NOT_FOUND', message: '接口不存在' } })
        return
      }
      const payload = await this.readJson<{ enabled?: boolean }>(req)
      const task = await this.requireDeps().toggleSessionTask(
        decodeURIComponent(rawId),
        payload.enabled !== false,
      )
      if (task == null) {
        this.sendJson(res, 404, { error: { code: 'NOT_FOUND', message: '任务不存在' } })
        return
      }
      this.sendJson(res, 200, { task })
      return
    }

    const taskRunMatch = /^\/v1\/tasks\/([^/]+)\/run$/.exec(path)
    if (taskRunMatch && req.method === 'POST') {
      const rawId = taskRunMatch[1]
      if (rawId == null) {
        this.sendJson(res, 404, { error: { code: 'NOT_FOUND', message: '接口不存在' } })
        return
      }
      let body
      try {
        body = await this.requireDeps().runSessionTaskNow(decodeURIComponent(rawId))
      } catch (error) {
        // 任务不存在→404（装配层抛 SparkError NOT_FOUND）；其余 rethrow 兜底 500
        this.sendSparkError(res, error)
        return
      }
      this.sendJson(res, 200, body)
      return
    }

    this.sendJson(res, 404, { error: { code: 'NOT_FOUND', message: '接口不存在' } })
  }

  // ─── 云端中继：把既有 HTTP 处理器复用为「方法调用」 ──────────────────────────
  //
  // 中继收到的每一帧都是 { m: HTTP method, p: path, b: body }，
  // 与其重写一遍路由表，不如用一对内存里的 req/res 直接喂给 handleHttpRequest：
  // 全部既有接口（含附件上传、语音转写、定时任务、斜杠命令）天然可用，零重复实现。

  /**
   * 中继调用入口。返回 HTTP 语义的 { status, body }，由中继客户端回成 res 帧。
   * 附件内容路由特殊处理：小程序经中继拿不到可直连的桌面端地址，改为返回 base64。
   */
  async invokeRelay(
    method: string,
    urlPath: string,
    body: unknown,
  ): Promise<{ status: number; body: unknown }> {
    const pathOnly = (urlPath ?? '').split('?')[0] ?? ''
    if (method === 'GET' && pathOnly === '/v1/attachments/content') {
      return this.readRelayAttachment(urlPath)
    }
    return this.runSyntheticRequest(method, urlPath, body)
  }

  private async readRelayAttachment(urlPath: string): Promise<{ status: number; body: unknown }> {
    const query = new URL(urlPath, 'http://localhost').searchParams
    const requestedPath = (query.get('path') ?? '').trim()
    if (!requestedPath) {
      return { status: 400, body: { error: { code: 'BAD_REQUEST', message: '缺少 path' } } }
    }
    try {
      const content = await this.requireDeps().readAttachmentContent(requestedPath)
      if (content == null) {
        return {
          status: 404,
          body: { error: { code: 'NOT_FOUND', message: '附件不存在或不在白名单内' } },
        }
      }
      return {
        status: 200,
        body: {
          base64: content.data.toString('base64'),
          mimeType: content.mimeType,
        },
      }
    } catch (error) {
      return {
        status: 500,
        body: {
          error: {
            code: 'INTERNAL',
            message: error instanceof Error ? error.message : String(error),
          },
        },
      }
    }
  }

  private async runSyntheticRequest(
    method: string,
    urlPath: string,
    body: unknown,
  ): Promise<{ status: number; body: unknown }> {
    const payload = body == null || method === 'GET' ? '' : JSON.stringify(body)
    const req = Readable.from(
      payload ? [Buffer.from(payload, 'utf8')] : [],
    ) as unknown as IncomingMessage
    req.method = method
    req.url = urlPath
    req.headers = {
      authorization: 'Bearer relay',
      // 仅作日志/排障线索保留；鉴权信任来自下方 origin 参数，与请求头无关
      'x-spark-relay': '1',
      'content-type': 'application/json',
    }

    // 用对象装结果：直接 let 会被控制流分析收敛成 null（赋值发生在闭包里，TS 看不到）
    const sink: { status: number; raw: string | Buffer | null } = { status: 500, raw: null }
    const res = {
      writeHead(code: number) {
        sink.status = code
        return res
      },
      setHeader() {
        /* CORS 头，中继场景不需要 */
      },
      end(data?: string | Buffer) {
        sink.raw = data ?? null
      },
    } as unknown as ServerResponse

    try {
      // 唯一的 relay=true 调用点：本函数只被进程内 invokeRelay 触达，
      // 该合成请求不可能来自网络，信任参数无法被外部伪造。
      await this.handleHttpRequest(req, res, { relay: true })
    } catch (error) {
      return {
        status: 500,
        body: {
          error: {
            code: 'INTERNAL',
            message: error instanceof Error ? error.message : String(error),
          },
        },
      }
    }

    let parsed: unknown = null
    if (sink.raw != null) {
      const text = typeof sink.raw === 'string' ? sink.raw : sink.raw.toString('utf8')
      try {
        parsed = JSON.parse(text)
      } catch {
        parsed = text
      }
    }
    return { status: sink.status, body: parsed }
  }

  /**
   * 中继订阅者：小程序经云端中继订阅会话事件流。
   * 复用既有轮询广播管线，只是把「发送」换成中继帧。
   * 返回的句柄用于取消订阅。
   */
  addRelaySubscriber(
    sessionId: string,
    sendEvents: (events: MobileBridgeEvent[]) => void,
  ): () => void {
    const connection: WsConnection = {
      socket: new PassThrough() as unknown as import('node:stream').Duplex,
      deviceId: 'cloud-relay',
      sessionId,
      send: (data: string) => {
        try {
          const parsed = JSON.parse(data) as { events?: MobileBridgeEvent[] }
          if (Array.isArray(parsed.events) && parsed.events.length > 0) sendEvents(parsed.events)
        } catch {
          /* 忽略无法解析的帧 */
        }
      },
      close: () => unsubscribe(),
    }
    /** 摘掉订阅者；会话上没人订阅时回收轮询器（箭头函数捕获 this，避免 this 别名） */
    const unsubscribe = (): void => {
      const clients = this.streamClients.get(sessionId)
      if (clients == null) return
      clients.delete(connection)
      if (clients.size === 0) {
        this.streamClients.delete(sessionId)
        this.stopPoller(sessionId)
      }
    }
    let clients = this.streamClients.get(sessionId)
    if (clients == null) {
      clients = new Set()
      this.streamClients.set(sessionId, clients)
    }
    clients.add(connection)
    this.ensurePoller(sessionId)
    return unsubscribe
  }

  // ─── 事件轮询广播 ───────────────────────────────────────────────────────────

  /** 每个有订阅者的会话一个轮询器：按原始事件 seq 增量读取并广播 */
  private ensurePoller(sessionId: string): void {
    if (this.streamPollers.has(sessionId)) return
    const deps = this.deps
    if (deps == null) return
    // 基线：普通会话从最后可见事件后开始；运行中的会话从最近用户消息后回放当前回合。
    let lastSeq = -1
    let baselineReady = false
    let pollInFlight = false
    const timer = setInterval(() => {
      void (async () => {
        if (this.deps == null || !baselineReady || pollInFlight) return
        pollInFlight = true
        try {
          const stream = await this.deps.getStreamEvents(sessionId, lastSeq)
          const fresh = stream.events
          if (fresh.length === 0) {
            lastSeq = Math.max(lastSeq, stream.nextSeq)
            return
          }
          lastSeq = Math.max(lastSeq, stream.nextSeq)
          const clients = this.streamClients.get(sessionId)
          if (clients != null && clients.size > 0) {
            const payload = JSON.stringify({ type: 'events', sessionId, events: fresh })
            for (const client of clients) client.send(payload)
          }
        } catch (error) {
          log.warn(
            `mobile bridge stream poll failed: ${error instanceof Error ? error.message : String(error)}`,
          )
        } finally {
          pollInFlight = false
        }
      })()
    }, STREAM_POLL_INTERVAL_MS)

    void (async () => {
      try {
        const history = await deps.getHistory(sessionId, { limit: HISTORY_LIMIT })
        const maxVisibleSeq = history.events.reduce((max, event) => Math.max(max, event.seq), -1)
        if (history.running) {
          const lastUserSeq = history.events.reduce(
            (max, event) => (event.type === 'user_message' ? Math.max(max, event.seq) : max),
            -1,
          )
          // 打开正在运行的会话时，从当前回合用户消息之后回放，补齐已生成的 delta。
          lastSeq = lastUserSeq >= 0 ? lastUserSeq : maxVisibleSeq
        } else {
          lastSeq = maxVisibleSeq
        }
        baselineReady = true
      } catch {
        // 基线拉取失败时退回「全量推一次」：客户端按 (seq, id) 去重，不会重复渲染
        lastSeq = -1
        baselineReady = true
      }
    })()
    this.streamPollers.set(sessionId, timer)
  }

  /** 停止并回收指定会话的轮询器 */
  private stopPoller(sessionId: string): void {
    const timer = this.streamPollers.get(sessionId)
    if (timer == null) return
    clearInterval(timer)
    this.streamPollers.delete(sessionId)
  }

  // ─── 工具 ───────────────────────────────────────────────────────────────────

  private requireDeps(): MobileBridgeDeps {
    if (this.deps == null) throw new Error('MobileBridge deps 未装配')
    return this.deps
  }

  private async readJson<T>(req: IncomingMessage, maxBytes: number = MAX_BODY_BYTES): Promise<T> {
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of req) {
      size += (chunk as Buffer).length
      if (size > maxBytes) throw new Error('请求体过大')
      chunks.push(chunk as Buffer)
    }
    if (chunks.length === 0) return {} as T
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T
  }

  private sendJson(res: ServerResponse, status: number, body: unknown): void {
    const payload = JSON.stringify(body)
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(payload)
  }

  /**
   * SparkError → HTTP 语义响应（侧栏排序校验等带错误码的领域异常）。
   * NOT_FOUND 映射 404，VALIDATION_FAILED 映射 400；其余按内部错误兜底 500。
   */
  private sendSparkError(res: ServerResponse, error: unknown): void {
    if (error instanceof SparkError) {
      if (error.code === 'NOT_FOUND') {
        this.sendJson(res, 404, { error: { code: 'NOT_FOUND', message: error.message } })
        return
      }
      if (error.code === 'VALIDATION_FAILED') {
        this.sendJson(res, 400, { error: { code: 'BAD_REQUEST', message: error.message } })
        return
      }
    }
    throw error
  }
}

interface WsConnection {
  socket: import('node:stream').Duplex
  deviceId: string
  sessionId: string
  send(data: string): void
  close(): void
}

/** base64 音频落盘为临时文件（转写端点用；调用方负责删除） */
async function writeBase64TempFile(base64: string, mimeType?: string): Promise<string> {
  const buffer = Buffer.from(base64, 'base64')
  if (buffer.length === 0) throw new Error('empty audio payload')
  const ext = mimeTypeToAudioExtension(mimeType)
  const dir = path.join(tmpdir(), 'spark-mobile-voice')
  await fs.mkdir(dir, { recursive: true })
  const filePath = path.join(dir, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`)
  await fs.writeFile(filePath, buffer)
  return filePath
}

function mimeTypeToAudioExtension(mimeType?: string): string {
  const normalized = (mimeType ?? '').toLowerCase()
  if (normalized.includes('wav')) return 'wav'
  if (normalized.includes('mp3') || normalized.includes('mpeg')) return 'mp3'
  if (normalized.includes('aac')) return 'aac'
  if (normalized.includes('ogg')) return 'ogg'
  if (normalized.includes('flac')) return 'flac'
  if (normalized.includes('webm')) return 'webm'
  if (normalized.includes('m4a') || normalized.includes('mp4')) return 'm4a'
  return 'bin'
}
