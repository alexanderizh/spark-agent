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
 *   2. 事件推送：addRelaySubscriber 复用轮询广播管线（500ms 轮询 getHistory，
 *      diff 后只发新事件），把会话事件增量交给中继上行
 *
 * 依赖注入参照 RemoteConnectionService.startRuntime(handler) 模式：
 * 本服务不 import SessionService/AuthService，由 registerMobileBridgeIpc 装配。
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable, PassThrough } from 'node:stream'
import { tmpdir } from 'node:os'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createLogger } from '@spark/shared'
import type {
  MobileBridgeAttachment,
  MobileBridgeCatalog,
  MobileBridgeCommandItem,
  MobileBridgeCreateScheduledTaskRequest,
  MobileBridgeCreateSessionResponse,
  MobileBridgeEvent,
  MobileBridgeHistoryResponse,
  MobileBridgeProjectListResponse,
  MobileBridgeScheduledTask,
  MobileBridgeSessionListResponse,
  MobileBridgeSessionRuntime,
  MobileBridgeSessionSummary,
  MobileBridgeSetWorkflowBindingRequest,
  MobileBridgeSubmitTurnRequest,
  MobileBridgeUpdateScheduledTaskRequest,
  MobileBridgeUpdateSessionRequest,
  MobileBridgeUploadAttachmentsRequest,
  MobileBridgeWorkflowBindingResponse,
} from '@spark/protocol'

const log = createLogger('mobile-bridge')

/** 轮询间隔：LLM 回合以秒计，500ms 增量延迟不可感知 */
const STREAM_POLL_INTERVAL_MS = 500
/** 单次 getHistory 拉取上限（保底，正常远小于此） */
const HISTORY_LIMIT = 400
/** 回合终态后的轮询宽限期：等 settle 阶段补发事件（如滞后 agent_error）到齐再回收 */
const TERMINAL_GRACE_MS = 5_000
const MAX_BODY_BYTES = 256 * 1024
/** 附件上传 / 语音转写路由单独放宽的 body 上限（base64 膨胀后 ≈ 原始 8MB） */
const MAX_UPLOAD_BODY_BYTES = 12 * 1024 * 1024

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
  /**
   * 会话历史（agent 事件 → 移动端子集）。
   * beforeSeq：向上翻页游标，只返回 seq 小于该值的事件（服务端按 seq 正序返回）。
   */
  getHistory(
    sessionId: string,
    limit: number,
    beforeSeq?: number,
  ): Promise<{ events: MobileBridgeEvent[]; running: boolean; hasMore?: boolean }>
  /** 提交回合（消息进入会话，等同桌面端发送；attachmentPaths 须来自 saveAttachments） */
  submitTurn(
    sessionId: string,
    text: string,
    attachmentPaths?: string[],
  ): Promise<{ turnId: string }>
  /** 取消进行中的回合 */
  cancelTurn(sessionId: string): Promise<void>

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
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS')
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
      const limit = Math.min(Number(url.searchParams.get('limit') ?? '50') || 50, 200)
      const body = await this.requireDeps().listProjects(limit)
      this.sendJson(res, 200, body)
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

    const projectSessionsMatch = /^\/v1\/projects\/([^/]+)\/sessions$/.exec(path)
    if (projectSessionsMatch && req.method === 'GET') {
      const rawId = projectSessionsMatch[1]
      if (rawId == null) {
        this.sendJson(res, 404, { error: { code: 'NOT_FOUND', message: '接口不存在' } })
        return
      }
      const projectId = decodeURIComponent(rawId)
      const limit = Math.min(Number(url.searchParams.get('limit') ?? '50') || 50, 200)
      const result = await this.requireDeps().listSessions(limit, projectId)
      const body: MobileBridgeSessionListResponse = result
      this.sendJson(res, 200, body)
      return
    }

    // ─── 会话 ─────────────────────────────────────────────────────────────────

    if (path === '/v1/sessions' && req.method === 'GET') {
      const limit = Math.min(Number(url.searchParams.get('limit') ?? '50') || 50, 200)
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
      if (Object.keys(patch).length === 0) {
        this.sendJson(res, 400, { error: { code: 'BAD_REQUEST', message: '没有需要修改的字段' } })
        return
      }
      const session = await this.requireDeps().updateSession(sessionId, patch)
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
      const limit = Math.min(Number(url.searchParams.get('limit') ?? 200) || 200, HISTORY_LIMIT)
      // 向上翻页游标：仅接受正整数（非法值静默忽略 = 按最新页返回，向后兼容旧客户端）
      const beforeSeqRaw = url.searchParams.get('beforeSeq')
      const beforeSeq =
        beforeSeqRaw != null && /^\d+$/.test(beforeSeqRaw) && Number(beforeSeqRaw) > 0
          ? Number(beforeSeqRaw)
          : undefined
      const result = await this.requireDeps().getHistory(sessionId, limit, beforeSeq)
      const body: MobileBridgeHistoryResponse = {
        sessionId,
        events: result.events,
        running: result.running,
        ...(result.hasMore != null ? { hasMore: result.hasMore } : {}),
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
      const body = await this.requireDeps().runSessionTaskNow(decodeURIComponent(rawId))
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

  /** 每个有订阅者的会话一个轮询器：拉历史 → 按 seq diff → 广播新事件 */
  private ensurePoller(sessionId: string): void {
    if (this.streamPollers.has(sessionId)) return
    const deps = this.deps
    if (deps == null) return
    // 基线：客户端已从 /messages 取过全量，轮询器先同步一次当前最大 seq，避免重复推送
    let lastSeq = -1
    // 终态宽限：completed 后 settle 阶段还可能补发 agent_error（实测 seq 1121 晚于 1118
    // completed），立即停轮询会漏推，导致客户端 running 卡死。终态后静默满宽限期才回收。
    let terminalSince: number | null = null
    const timer = setInterval(() => {
      void (async () => {
        if (this.deps == null) return
        try {
          const history = await this.deps.getHistory(sessionId, HISTORY_LIMIT)
          const fresh = history.events.filter((event) => event.seq > lastSeq)
          if (fresh.length === 0) {
            // 无新事件时也可能到达回收条件（终态在上一拍已推完）
            if (terminalSince != null && Date.now() - terminalSince >= TERMINAL_GRACE_MS) {
              this.stopPoller(sessionId)
            }
            return
          }
          lastSeq = Math.max(...fresh.map((event) => event.seq))
          terminalSince = null
          const clients = this.streamClients.get(sessionId)
          if (clients != null && clients.size > 0) {
            const payload = JSON.stringify({ type: 'events', sessionId, events: fresh })
            for (const client of clients) client.send(payload)
          }
          // 回合终态：不立即停，进入宽限期等 settle 补发；宽限期内再有新事件则重置
          const terminal = fresh.some(
            (event) =>
              event.type === 'agent_status' &&
              (event.status === 'idle' ||
                event.status === 'completed' ||
                event.status === 'cancelled' ||
                event.status === 'error'),
          )
          if (terminal && !history.running) {
            terminalSince = Date.now()
          }
        } catch (error) {
          log.warn(
            `mobile bridge stream poll failed: ${error instanceof Error ? error.message : String(error)}`,
          )
        }
      })()
    }, STREAM_POLL_INTERVAL_MS)

    void (async () => {
      try {
        const history = await deps.getHistory(sessionId, HISTORY_LIMIT)
        lastSeq = history.events.reduce((max, event) => Math.max(max, event.seq), -1)
      } catch {
        // 基线拉取失败时退回「全量推一次」：客户端按 (seq, id) 去重，不会重复渲染
        lastSeq = -1
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
