/**
 * MobileBridgeService — SparkWork 移动端（微信小程序）直连桌面端的桥接服务。
 *
 * 解决「小程序接管桌面端会话」的传输层：
 *   1. 配对：小程序持 edu-server 账号 token 换取设备令牌（同账号即授权，令牌落 SettingsService）
 *   2. 会话：列表 / 新建 / 历史 / 提交回合 / 取消（全部经 deps 闭包注入，避免循环依赖）
 *   3. 流式：WebSocket 按事件 seq 增量推送（500ms 轮询 getHistory，diff 后只发新事件）
 *
 * 网络模型：桌面端监听 0.0.0.0，小程序经局域网 IP 直连；
 * 公网部署时在服务端前置反代（wss 443 → 本端口）即可，协议不变。
 *
 * 依赖注入参照 RemoteConnectionService.startRuntime(handler) 模式：
 * 本服务不 import SessionService/AuthService，由 registerMobileBridgeIpc 装配。
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { networkInterfaces, tmpdir } from 'node:os'
import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { createLogger } from '@spark/shared'
import type {
  MobileBridgeAttachment,
  MobileBridgeCatalog,
  MobileBridgeCommandItem,
  MobileBridgeCreateScheduledTaskRequest,
  MobileBridgeCreateSessionResponse,
  MobileBridgeEvent,
  MobileBridgeHistoryResponse,
  MobileBridgePairResponse,
  MobileBridgeProjectListResponse,
  MobileBridgeScheduledTask,
  MobileBridgeSessionListResponse,
  MobileBridgeSessionRuntime,
  MobileBridgeSessionSummary,
  MobileBridgeSetWorkflowBindingRequest,
  MobileBridgeSettings,
  MobileBridgeStatus,
  MobileBridgeSubmitTurnRequest,
  MobileBridgeUpdateScheduledTaskRequest,
  MobileBridgeUpdateSessionRequest,
  MobileBridgeUploadAttachmentsRequest,
  MobileBridgeWorkflowBindingResponse,
} from '@spark/protocol'

const log = createLogger('mobile-bridge')

/** WS 轮询间隔：LLM 回合以秒计，500ms 增量延迟不可感知 */
const STREAM_POLL_INTERVAL_MS = 500
/** 单次 getHistory 拉取上限（保底，正常远小于此） */
const HISTORY_LIMIT = 400
/** 回合终态后的轮询宽限期：等 settle 阶段补发事件（如滞后 agent_error）到齐再回收 */
const TERMINAL_GRACE_MS = 5_000
/** 单个 WebSocket 连接最大静默期（无事件 10 分钟即回收，由 ping 保活） */
const WS_IDLE_TIMEOUT_MS = 10 * 60 * 1000
const MAX_BODY_BYTES = 256 * 1024
/** 附件上传 / 语音转写路由单独放宽的 body 上限（base64 膨胀后 ≈ 原始 8MB） */
const MAX_UPLOAD_BODY_BYTES = 12 * 1024 * 1024

/**
 * 局域网 IPv4 地址（用于生成小程序可访问的 localUrl）。
 *
 * 多网卡（Wi-Fi + VPN 隧道 + 虚拟机桥接）时**物理网卡优先**：
 * utun 是 VPN 隧道、veth/docker/br-/vmnet 是容器或虚拟网卡，手机多半到不了，
 * 直接取「第一个」可能给出一个连不上的地址。
 * 找不到时返回 null（调用方退化为占位提示）。
 */
function findLanAddress(): string | null {
  const ifaces = networkInterfaces()
  const candidates: { name: string; address: string }[] = []
  for (const [name, list] of Object.entries(ifaces)) {
    for (const info of list ?? []) {
      if (info.family === 'IPv4' && !info.internal) {
        candidates.push({ name, address: info.address })
      }
    }
  }
  const preferred = candidates.find(
    (c) => !/^(utun|veth|docker|br-|bridge|vmnet|llw|awdl)/i.test(c.name),
  )
  return preferred?.address ?? candidates[0]?.address ?? null
}

export interface MobileBridgeDeps {
  /** 用 edu-server 账号 token 换用户身份；无效返回 null */
  validateAccountToken(token: string): Promise<{ userId: string; account: string } | null>
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
  /** 会话历史（agent 事件 → 移动端子集） */
  getHistory(
    sessionId: string,
    limit: number,
  ): Promise<{ events: MobileBridgeEvent[]; running: boolean }>
  /** 提交回合（消息进入会话，等同桌面端发送；attachmentPaths 须来自 saveAttachments） */
  submitTurn(
    sessionId: string,
    text: string,
    attachmentPaths?: string[],
  ): Promise<{ turnId: string }>
  /** 取消进行中的回合 */
  cancelTurn(sessionId: string): Promise<void>
  /** 桌面端信息（配对回显） */
  getDesktopInfo(): { name: string; version: string }

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

interface PairedDeviceRecord {
  deviceId: string
  deviceToken: string
  account: string
  userId: string
  deviceLabel: string
  pairedAt: string
  lastSeenAt: string
}

/** 持久化到 SettingsService 的设备形态（含令牌，本机 Secrets，与远程连接凭据同存储） */
export type MobileBridgePersistedDevice = PairedDeviceRecord

interface BridgeStore {
  settings: MobileBridgeSettings
  devices: PairedDeviceRecord[]
}

const DEFAULT_SETTINGS: MobileBridgeSettings = { enabled: false, port: 3721 }

export class MobileBridgeService {
  private server: Server | null = null
  private runtimePort: number | null = null
  private store: BridgeStore = { settings: { ...DEFAULT_SETTINGS }, devices: [] }
  private deps: MobileBridgeDeps | null = null
  /** sessionId → 该会话当前 WS 连接集合（广播用） */
  private readonly streamClients = new Map<string, Set<WsConnection>>()
  /** sessionId → 轮询定时器 */
  private readonly streamPollers = new Map<string, ReturnType<typeof setInterval>>()

  constructor(
    private readonly readStore: () => BridgeStore,
    private readonly writeStore: (store: BridgeStore) => void,
  ) {
    // 构造即加载持久化配置：否则 start() 读到的永远是内存默认值（enabled=false），
    // 设置里开过服务也会被当成「未开启」而拒绝监听。
    this.store = this.readStore()
  }

  setDeps(deps: MobileBridgeDeps): void {
    this.deps = deps
  }

  // ─── 生命周期 ───────────────────────────────────────────────────────────────

  async start(): Promise<void> {
    if (this.server != null) return
    if (!this.store.settings.enabled) {
      log.info('mobile bridge disabled by settings; not starting')
      return
    }
    if (this.deps == null) {
      log.warn('mobile bridge deps not wired; skip start')
      return
    }
    await new Promise<void>((resolve, reject) => {
      const server = createServer((req, res) => {
        this.handleHttpRequest(req, res).catch((err) => {
          this.sendJson(res, 500, {
            error: { code: 'INTERNAL', message: err instanceof Error ? err.message : String(err) },
          })
        })
      })
      server.on('upgrade', (req, socket) => {
        this.handleUpgrade(req, socket).catch((err) => {
          log.warn(`ws upgrade failed: ${err instanceof Error ? err.message : String(err)}`)
          socket.destroy()
        })
      })
      const listenPort = this.store.settings.port > 0 ? this.store.settings.port : 0
      server.listen(listenPort, '0.0.0.0', () => {
        const addr = server.address()
        this.runtimePort = typeof addr === 'object' && addr != null ? addr.port : null
        this.server = server
        log.info(`mobile bridge listening on 0.0.0.0:${this.runtimePort}`)
        resolve()
      })
      server.on('error', reject)
    })
  }

  async stop(): Promise<void> {
    for (const timer of this.streamPollers.values()) clearInterval(timer)
    this.streamPollers.clear()
    for (const clients of this.streamClients.values()) {
      for (const client of clients) client.close()
    }
    this.streamClients.clear()
    const server = this.server
    if (server == null) return
    this.server = null
    this.runtimePort = null
    await new Promise<void>((resolve) => server.close(() => resolve()))
    log.info('mobile bridge stopped')
  }

  /** 设置变更后重生效（端口/开关变化时重启） */
  async applySettings(settings: MobileBridgeSettings): Promise<void> {
    const changed =
      settings.enabled !== this.store.settings.enabled || settings.port !== this.store.settings.port
    this.store = { ...this.store, settings }
    this.writeStore(this.store)
    if (!changed) return
    await this.stop()
    await this.start()
  }

  getStatus(): MobileBridgeStatus {
    const port = this.runtimePort
    const lan = port != null ? findLanAddress() : null
    return {
      running: this.server != null,
      port,
      localUrl: port != null ? `http://${lan ?? '<本机局域网IP（未检测到网卡）>'}:${port}` : null,
      pairedDevices: this.store.devices.map((device) => ({
        deviceId: device.deviceId,
        deviceLabel: device.deviceLabel,
        account: device.account,
        pairedAt: device.pairedAt,
        lastSeenAt: device.lastSeenAt,
      })),
      settings: { ...this.store.settings },
    }
  }

  revokeDevice(deviceId: string): void {
    const next = this.store.devices.filter((device) => device.deviceId !== deviceId)
    if (next.length === this.store.devices.length) return
    this.store = { ...this.store, devices: next }
    this.writeStore(this.store)
    // 断开该设备的所有 WS
    for (const clients of this.streamClients.values()) {
      for (const client of clients) {
        if (client.deviceId === deviceId) client.close()
      }
    }
    log.info(`mobile bridge device revoked: ${deviceId}`)
  }

  // ─── HTTP ───────────────────────────────────────────────────────────────────

  private async handleHttpRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
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

    if (path === '/v1/pair' && req.method === 'POST') {
      await this.handlePair(req, res)
      return
    }

    if (path === '/v1/health' && req.method === 'GET') {
      this.sendJson(res, 200, { ok: true, running: true })
      return
    }

    // 附件内容预览：wx.previewImage 不支持自定义 header，故本路由额外接受 query token
    if (path === '/v1/attachments/content' && req.method === 'GET') {
      const queryToken = (url.searchParams.get('token') ?? '').trim()
      const deviceByQuery =
        queryToken != null && queryToken.length > 0
          ? (this.store.devices.find((device) => device.deviceToken === queryToken) ?? null)
          : null
      const deviceForContent = deviceByQuery ?? this.authenticate(req)
      if (deviceForContent == null) {
        this.sendJson(res, 401, {
          error: { code: 'UNAUTHORIZED', message: '设备令牌无效，请重新配对' },
        })
        return
      }
      this.touchDevice(deviceForContent)
      const requestedPath = (url.searchParams.get('path') ?? '').trim()
      if (!requestedPath) {
        this.sendJson(res, 400, { error: { code: 'BAD_REQUEST', message: '缺少 path' } })
        return
      }
      const content = await this.requireDeps().readAttachmentContent(requestedPath)
      if (content == null) {
        this.sendJson(res, 404, {
          error: { code: 'NOT_FOUND', message: '附件不存在或不在白名单内' },
        })
        return
      }
      res.writeHead(200, { 'Content-Type': content.mimeType })
      res.end(content.data)
      return
    }

    // 其余接口均需设备令牌
    const device = this.authenticate(req)
    if (device == null) {
      this.sendJson(res, 401, {
        error: { code: 'UNAUTHORIZED', message: '设备令牌无效，请重新配对' },
      })
      return
    }
    this.touchDevice(device)

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
      const result = await this.requireDeps().getHistory(sessionId, limit)
      const body: MobileBridgeHistoryResponse = {
        sessionId,
        events: result.events,
        running: result.running,
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

  private async handlePair(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const payload = await this.readJson<{ accountToken?: string; deviceLabel?: string }>(req)
    const token = (payload.accountToken ?? '').trim()
    if (!token) {
      this.sendJson(res, 400, { error: { code: 'BAD_REQUEST', message: '缺少 accountToken' } })
      return
    }
    const identity = await this.requireDeps().validateAccountToken(token)
    if (identity == null) {
      this.sendJson(res, 401, {
        error: { code: 'NOT_PAIRED', message: '账号验证失败，请重新登录' },
      })
      return
    }
    const now = new Date().toISOString()
    const deviceId = randomUUID()
    const deviceToken = `${deviceId}.${createHash('sha256').update(`${deviceId}:${identity.userId}:${Date.now()}`).digest('base64url')}`
    const record: PairedDeviceRecord = {
      deviceId,
      deviceToken,
      account: identity.account,
      userId: identity.userId,
      deviceLabel: payload.deviceLabel?.trim() || '移动端设备',
      pairedAt: now,
      lastSeenAt: now,
    }
    // 同账号旧设备保留（多手机可同时在线）；上限 10 台防无限增长
    const devices = [
      ...this.store.devices.filter(
        (item) => item.userId !== identity.userId || item.deviceId === deviceId,
      ),
      record,
    ].slice(-10)
    this.store = { ...this.store, devices }
    this.writeStore(this.store)
    const info = this.requireDeps().getDesktopInfo()
    const body: MobileBridgePairResponse = {
      deviceToken,
      deviceId,
      desktop: info,
      account: identity.account,
    }
    log.info(`mobile bridge paired: device=${deviceId} account=${identity.account}`)
    this.sendJson(res, 200, body)
  }

  private authenticate(req: IncomingMessage): PairedDeviceRecord | null {
    const header = req.headers.authorization
    if (header == null || !header.startsWith('Bearer ')) return null
    const token = header.slice('Bearer '.length).trim()
    return this.store.devices.find((device) => device.deviceToken === token) ?? null
  }

  private touchDevice(device: PairedDeviceRecord): void {
    const now = new Date().toISOString()
    if (device.lastSeenAt === now) return
    device.lastSeenAt = now
    this.writeStore(this.store)
  }

  // ─── WebSocket 流 ───────────────────────────────────────────────────────────

  private async handleUpgrade(
    req: IncomingMessage,
    socket: import('node:stream').Duplex,
  ): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (url.pathname !== '/v1/stream') {
      socket.destroy()
      return
    }
    // WebSocket 握手：Sec-WebSocket-Key + 魔术 GUID → Sec-WebSocket-Accept
    const key = req.headers['sec-websocket-key']
    if (typeof key !== 'string' || key.length === 0) {
      socket.destroy()
      return
    }
    const accept = createHash('sha1')
      .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
      .digest('base64')
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
        'Upgrade: websocket\r\n' +
        'Connection: Upgrade\r\n' +
        `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
    )

    const token = (url.searchParams.get('token') ?? '').trim()
    const sessionId = (url.searchParams.get('sessionId') ?? '').trim()
    const device = this.store.devices.find((item) => item.deviceToken === token) ?? null
    if (device == null || !sessionId) {
      this.writeWsFrame(socket, JSON.stringify({ type: 'error', message: '未授权' }))
      socket.end()
      return
    }

    const connection: WsConnection = {
      socket,
      deviceId: device.deviceId,
      sessionId,
      close: () => {
        try {
          socket.destroy()
        } catch {
          /* noop */
        }
      },
      send: (data: string) => this.writeWsFrame(socket, data),
    }

    let clients = this.streamClients.get(sessionId)
    if (clients == null) {
      clients = new Set()
      this.streamClients.set(sessionId, clients)
    }
    clients.add(connection)
    this.touchDevice(device)

    // 客户端帧最小解析：处理 close(0x8)/ping(0x9)，忽略业务数据（小程序只读流）
    socket.on('data', (chunk: Buffer) => {
      this.handleClientFrame(socket, chunk)
    })
    socket.on('close', () => {
      clients?.delete(connection)
      if (clients != null && clients.size === 0) {
        this.streamClients.delete(sessionId)
        this.stopPoller(sessionId)
      }
    })
    socket.on('error', () => connection.close())

    // 首帧：连接确认（端上从 messages 接口取全量，这里只推增量）
    connection.send(JSON.stringify({ type: 'connected', sessionId, deviceId: device.deviceId }))
    this.ensurePoller(sessionId)
    log.info(`mobile bridge ws connected: session=${sessionId} device=${device.deviceId}`)
  }

  /** 客户端帧最小解析：close → 关闭；ping → pong；其余忽略 */
  private handleClientFrame(socket: import('node:stream').Duplex, chunk: Buffer): void {
    if (chunk.length < 2) return
    const first = chunk[0]
    if (first == null) return
    const opcode = first & 0x0f
    if (opcode === 0x8) {
      try {
        socket.end()
      } catch {
        /* noop */
      }
      return
    }
    if (opcode === 0x9) {
      // pong：FIN + pong opcode， Echo 负载（客户端帧带掩码，pong 不带）
      const payload = chunk.length > 2 ? chunk.subarray(2) : Buffer.alloc(0)
      const header = Buffer.from([0x8a, payload.length])
      try {
        socket.write(Buffer.concat([header, payload]))
      } catch {
        /* noop */
      }
    }
  }

  /** 每个有 WS 连接的会话一个轮询器：拉历史 → 按 seq diff → 广播新事件 */
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

  /** 最小 WebSocket 服务端帧实现（文本帧 + close，够用免依赖） */
  private writeWsFrame(socket: import('node:stream').Duplex, data: string): void {
    if (socket.destroyed) return
    const payload = Buffer.from(data, 'utf8')
    const length = payload.length
    let header: Buffer
    if (length < 126) {
      header = Buffer.alloc(2)
      header[1] = length
    } else if (length < 65536) {
      header = Buffer.alloc(4)
      header[1] = 126
      header.writeUInt16BE(length, 2)
    } else {
      header = Buffer.alloc(10)
      header[1] = 127
      header.writeBigUInt64BE(BigInt(length), 2)
    }
    header[0] = 0x81 // FIN + text frame
    try {
      socket.write(Buffer.concat([header, payload]))
    } catch {
      /* 连接已断开 */
    }
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

/** 空闲 WS 兜底回收（客户端 ping 由小程序侧 keep-alive 触发） */
export const MOBILE_BRIDGE_WS_IDLE_TIMEOUT_MS = WS_IDLE_TIMEOUT_MS
