import type {
  SidebarOrderState,
  SidebarOrderUpdateRequest,
} from '../../../packages/protocol/src/sidebar-order'
import type {
  MobileBridgeEvent,
  MobileBridgeHistoryResponse,
  MobileBridgeRelayDesktopInfo,
  MobileBridgeRelayFrame,
  MobileBridgeSessionListResponse,
  MobileBridgeSubmitTurnResponse,
} from '../../../packages/protocol/src/mobile-bridge'
import { getSessionLabelMeta } from '../../mobile/src/utils/sidebar-order'
import type { BridgeApprovalDecision } from '../../mobile/src/utils/chat-interactions'
import { readInteractions } from './interaction-data'
import { SERVICE_ORIGIN } from './auth'

export type Device = Pick<MobileBridgeRelayDesktopInfo, 'deviceId' | 'label'>
export type Project = {
  id: string
  name: string
  sessionCount: number
  pinnedAt?: string
  updatedAt?: string
  runningSessionCount?: number
}
export type Session = Pick<MobileBridgeSessionListResponse['sessions'][number], 'id' | 'title'> &
  Partial<
    Pick<
      MobileBridgeSessionListResponse['sessions'][number],
      'pinnedAt' | 'sessionLabel' | 'labeledAt' | 'projectId' | 'status' | 'updatedAt' | 'preview'
    >
  >
export type SessionSearchHit = Session & { snippet?: string; matchType?: 'title' | 'content' }

interface SessionPage {
  sessions: Session[]
  nextOffset: number | null
}

class RequestNotSent extends Error {}

export class SubmitError extends Error {
  constructor(
    readonly outcome: 'not-sent' | 'unconfirmed',
    cause: unknown,
  ) {
    super(cause instanceof Error ? cause.message : '电脑未确认消息', { cause })
  }
}

export interface Target {
  deviceId: string
  sessionId: string
}
type SocketHandler = 'onopen' | 'onmessage' | 'onerror' | 'onclose'
export type SocketPort = Pick<WebSocket, 'send' | 'close'> & {
  [Handler in SocketHandler]: OmitThisParameter<NonNullable<WebSocket[Handler]>> | null
}
type SocketFactory = (url: string) => SocketPort

interface Pending {
  resolve(body: unknown): void
  reject(error: Error): void
  timer: ReturnType<typeof setTimeout>
}

export function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

const textFields = [
  'content',
  'segmentId',
  'toolName',
  'toolCallId',
  'status',
  'statusMessage',
] as const
export function readEvents(value: unknown): MobileBridgeEvent[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((raw: unknown): MobileBridgeEvent[] => {
    const event = object(raw)
    if (
      !event ||
      typeof event.id !== 'string' ||
      typeof event.turnId !== 'string' ||
      typeof event.seq !== 'number' ||
      !Number.isSafeInteger(event.seq) ||
      typeof event.timestamp !== 'string'
    )
      return []
    const { id, turnId, seq, timestamp, type } = event
    if (
      type !== 'user_message' &&
      type !== 'assistant_message' &&
      type !== 'agent_thinking' &&
      type !== 'tool_call' &&
      type !== 'tool_result' &&
      type !== 'agent_error' &&
      type !== 'agent_status' &&
      type !== 'presented_files'
    )
      return []
    const safe: MobileBridgeEvent = { id, turnId, seq, timestamp, type }
    for (const field of textFields) {
      const entry = event[field]
      if (typeof entry === 'string') safe[field] = entry
    }
    if (event.mode === 'delta' || event.mode === 'complete') safe.mode = event.mode
    if (event.toolStatus === 'success' || event.toolStatus === 'error') {
      safe.toolStatus = event.toolStatus
    }
    if (typeof event.isFinal === 'boolean') safe.isFinal = event.isFinal
    if (type === 'presented_files' && Array.isArray(event.files)) {
      safe.files = event.files.flatMap((value: unknown) => {
        const file = object(value)
        return typeof file?.path === 'string' && file.path
          ? [{ path: file.path, ...(typeof file.title === 'string' ? { title: file.title } : {}) }]
          : []
      })
    }
    if (type === 'user_message' && Array.isArray(event.attachments)) {
      safe.attachments = event.attachments.flatMap((value: unknown) => {
        const item = object(value)
        if (typeof item?.path !== 'string' || !item.path) return []
        const { type } = item
        if (type !== 'image' && type !== 'file') return []
        return [
          { path: item.path, type, ...(typeof item.name === 'string' ? { name: item.name } : {}) },
        ]
      })
    }
    return [safe]
  })
}

export class Relay {
  private socket: SocketPort | null = null
  private ready = false
  private seq = 0
  private handshake?: ReturnType<typeof setTimeout>
  private heartbeat?: ReturnType<typeof setInterval>
  private lastFrame = 0
  private retry?: ReturnType<typeof setTimeout>
  private failures = 0
  private active = false
  private authBlocked = false
  private retryAuthInForeground = false
  private pending = new Map<string, Pending>()
  private subscription?: { target: Target; listener(events: MobileBridgeEvent[]): void }

  constructor(
    private token: string,
    private readonly clientId: string,
    private readonly callbacks: {
      presence(devices: Device[]): void
      state(status: 'connecting' | 'online' | 'offline'): void
      issue(message: string): void
      restored(): void
      authExpired?(): void
    },
    private readonly makeSocket: SocketFactory = (url) => new WebSocket(url),
  ) {}

  resume(): void {
    if (this.authBlocked) {
      if (!this.retryAuthInForeground) return
      this.retryAuthInForeground = false
      this.callbacks.authExpired?.()
      return
    }
    this.active = true
    if (this.socket || this.retry) return
    this.callbacks.state('connecting')
    const label = 'SparkWork 原生样机'
    const base = SERVICE_ORIGIN.replace(/^https:/, 'wss:')
    let socket: SocketPort
    try {
      socket = this.makeSocket(
        `${base}/ws/bridge/client?token=${encodeURIComponent(this.token)}&deviceId=${encodeURIComponent(this.clientId)}&label=${encodeURIComponent(label)}`,
      )
    } catch {
      this.lost('无法连接云中继')
      return
    }
    this.socket = socket
    this.handshake = setTimeout(() => this.lost('云中继握手超时'), 12_000)
    socket.onopen = () => {
      if (this.socket === socket) this.send({ t: 'hello', deviceId: this.clientId, label })
    }
    socket.onmessage = ({ data }) => {
      if (this.socket === socket && typeof data === 'string') this.accept(data)
    }
    socket.onerror = () => {
      if (this.socket === socket) this.lost('云中继连接中断')
    }
    socket.onclose = ({ code }) => {
      if (this.socket !== socket) return
      if (code === 4401 || code === 4403 || code === 1008) this.authFailed()
      else this.lost('云中继连接已关闭')
    }
  }

  renewToken(token: string, foreground: boolean): void {
    if (token === this.token && !this.authBlocked) return
    this.pause()
    this.token = token
    this.authBlocked = false
    this.retryAuthInForeground = false
    if (foreground) this.resume()
  }

  retryAuthOnResume() {
    if (this.authBlocked) this.retryAuthInForeground = true
  }

  pause(): void {
    this.active = false
    clearTimeout(this.retry)
    this.retry = undefined
    this.disconnect('云中继已暂停')
  }

  private disconnect(message: string): void {
    clearTimeout(this.handshake)
    clearInterval(this.heartbeat)
    const socket = this.socket
    this.socket = null
    this.ready = false
    try {
      socket?.close()
    } catch {
      /* Already closed. */
    }
    for (const request of this.pending.values()) {
      clearTimeout(request.timer)
      request.reject(new Error(message))
    }
    this.pending.clear()
    this.callbacks.state('offline')
  }

  private lost(message: string): void {
    this.disconnect(message)
    if (!this.active) return
    this.callbacks.issue(`${message}，正在重连`)
    this.retry = setTimeout(
      () => {
        this.retry = undefined
        this.resume()
      },
      Math.min(15_000, 1000 * 2 ** this.failures),
    )
    this.failures = Math.min(4, this.failures + 1)
  }

  private authFailed(): void {
    this.authBlocked = true
    this.pause()
    this.callbacks.issue('账号鉴权失败，请重新登录')
    this.callbacks.authExpired?.()
  }

  private send(frame: MobileBridgeRelayFrame): boolean {
    if (!this.socket) return false
    try {
      this.socket.send(JSON.stringify(frame))
      return true
    } catch {
      this.lost('无法发送中继数据')
      return false
    }
  }

  private accept(text: string): void {
    let frame: Record<string, unknown> | undefined
    try {
      frame = object(JSON.parse(text))
    } catch {
      return
    }
    if (!frame) return
    this.lastFrame = Date.now()

    if (frame.t === 'welcome' || frame.t === 'presence') {
      if (frame.t === 'presence' && !this.ready) return
      const devices: Device[] = []
      if (Array.isArray(frame.devices)) {
        for (const raw of frame.devices) {
          const device = object(raw)
          if (device?.online !== false && typeof device?.deviceId === 'string' && device.deviceId) {
            devices.push({
              deviceId: device.deviceId,
              label: typeof device.label === 'string' ? device.label : device.deviceId,
            })
          }
        }
      } else {
        const legacy = object(frame.desktop)
        if (legacy?.online === true && typeof legacy.deviceId === 'string' && legacy.deviceId) {
          devices.push({
            deviceId: legacy.deviceId,
            label: typeof legacy.label === 'string' ? legacy.label : legacy.deviceId,
          })
        }
      }
      this.callbacks.presence(devices)
      if (this.ready) return
      clearTimeout(this.handshake)
      this.ready = true
      this.failures = 0
      this.heartbeat = setInterval(() => {
        if (Date.now() - this.lastFrame >= 55_000) this.lost('云中继心跳超时')
        else this.send({ t: 'ping' })
      }, 25_000)
      const target = this.subscription?.target
      if (target && !this.send({ t: 'sub', sessionId: target.sessionId, d: target.deviceId }))
        return
      this.callbacks.state('online')
      this.callbacks.restored()
      return
    }

    if (frame.t === 'error') {
      if (frame.code === 'AUTH' || frame.code === 'UNAUTHORIZED') {
        this.authFailed()
      } else this.callbacks.issue('云中继拒绝了当前操作')
      return
    }
    if (!this.ready) return
    if (frame.t === 'res' && typeof frame.id === 'string') {
      const request = this.pending.get(frame.id)
      if (!request) return
      this.pending.delete(frame.id)
      clearTimeout(request.timer)
      const status = frame.s
      if (typeof status === 'number' && status >= 200 && status < 300) request.resolve(frame.b)
      else
        request.reject(
          new Error(
            status === 503
              ? '电脑暂不可用'
              : status === 504
                ? '电脑响应超时'
                : `电脑请求失败 (${typeof status === 'number' ? status : '响应异常'})`,
          ),
        )
    }
    if (frame.t === 'event') {
      const subscription = this.subscription
      if (
        subscription &&
        frame.sessionId === subscription.target.sessionId &&
        frame.d === subscription.target.deviceId
      ) {
        subscription.listener(readEvents(frame.events))
      }
    }
  }

  subscribe(target: Target, listener: (events: MobileBridgeEvent[]) => void): () => void {
    const subscription = { target, listener }
    this.subscription = subscription
    if (this.ready) this.send({ t: 'sub', sessionId: target.sessionId, d: target.deviceId })
    return () => {
      if (this.subscription !== subscription) return
      this.subscription = undefined
      if (this.ready) this.send({ t: 'unsub', sessionId: target.sessionId, d: target.deviceId })
    }
  }

  private call(
    deviceId: string,
    path: string,
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    body?: unknown,
    timeoutMs = 30_000,
  ): Promise<unknown> {
    if (!this.ready || !this.socket || !deviceId)
      return Promise.reject(new RequestNotSent('尚未连接到云中继'))
    const id = `native-${++this.seq}`
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('电脑端响应超时'))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      this.send({ t: 'req', id, m: method, p: path, b: body ?? null, d: deviceId })
    })
  }

  async searchSessions(
    deviceId: string,
    query: string,
    projectId?: string,
  ): Promise<SessionSearchHit[]> {
    const path = `/v1/search?q=${encodeURIComponent(query)}&limit=20${projectId ? `&projectId=${encodeURIComponent(projectId)}` : ''}`
    const body = object(await this.call(deviceId, path, 'GET'))
    if (!Array.isArray(body?.results)) throw new Error('搜索结果格式异常')
    return body.results.flatMap((value: unknown) => {
      const row = object(value)
      if (typeof row?.sessionId !== 'string' || typeof row.title !== 'string') return []
      return [
        {
          id: row.sessionId,
          title: row.title,
          updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : undefined,
          snippet: typeof row.snippet === 'string' ? row.snippet : undefined,
          matchType:
            row.matchType === 'title' || row.matchType === 'content' ? row.matchType : undefined,
        },
      ]
    })
  }

  async updateProject(
    deviceId: string,
    projectId: string,
    patch: { name?: string; pinned?: boolean; archived?: boolean },
  ) {
    const path = `/v1/projects/${encodeURIComponent(projectId)}`
    const project = object(object(await this.call(deviceId, path, 'PATCH', patch))?.project)
    if (
      !project ||
      (patch.archived && typeof project.archivedAt !== 'string') ||
      (patch.name !== undefined && project.name !== patch.name) ||
      (patch.pinned !== undefined && (typeof project.pinnedAt === 'string') !== patch.pinned)
    )
      throw new Error('项目修改未确认，请刷新列表核对')
  }

  async deleteProject(deviceId: string, projectId: string) {
    const path = `/v1/projects/${encodeURIComponent(projectId)}`
    return object(await this.call(deviceId, path, 'DELETE'))?.deleted === true
  }

  async readSidebarOrder(deviceId: string): Promise<SidebarOrderState> {
    const order = object(await this.call(deviceId, '/v1/sidebar-order', 'GET'))
    const stringList = (value: unknown) =>
      Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []
    const orderMap = (value: unknown) =>
      Object.fromEntries(
        Object.entries(object(value) ?? {}).map(([key, ids]) => [key, stringList(ids)]),
      )
    if (!Array.isArray(order?.projectIds)) throw new Error('排序结果格式异常')
    return {
      projectIds: stringList(order.projectIds),
      sessionIdsByProject: orderMap(order.sessionIdsByProject),
      pinnedSessionIdsByProject: orderMap(order.pinnedSessionIdsByProject),
    }
  }

  async saveSidebarOrder(deviceId: string, update: SidebarOrderUpdateRequest) {
    const result = object(await this.call(deviceId, '/v1/sidebar-order', 'PUT', update))
    const ids = result?.itemIds
    if (
      !Array.isArray(ids) ||
      ids.length !== update.itemIds.length ||
      update.itemIds.some((id, index) => ids[index] !== id)
    )
      throw new Error('排序未确认')
  }

  async projects(deviceId: string): Promise<Project[]> {
    return (await this.projectList(deviceId)).projects
  }

  async unassignedSessionCount(deviceId: string) {
    const result = object(
      await this.call(deviceId, '/v1/sessions?limit=1&projectId=default', 'GET'),
    )
    const total = result?.total
    if (typeof total !== 'number' || !Number.isSafeInteger(total) || total < 0)
      throw new Error('未归属项目会话数量格式异常')
    return total
  }

  async projectList(deviceId: string) {
    const response = object(await this.call(deviceId, '/v1/projects?limit=100', 'GET'))
    if (!Array.isArray(response?.projects)) throw new Error('项目列表格式异常')
    const projects = response.projects.flatMap((entry: unknown) => {
      const project = object(entry)
      if (typeof project?.id !== 'string' || !project.id || typeof project.name !== 'string')
        return []
      return [
        {
          id: project.id,
          name: project.name,
          sessionCount: typeof project.sessionCount === 'number' ? project.sessionCount : 0,
          pinnedAt: typeof project.pinnedAt === 'string' ? project.pinnedAt : undefined,
          updatedAt: typeof project.updatedAt === 'string' ? project.updatedAt : undefined,
          runningSessionCount:
            typeof project.runningSessionCount === 'number'
              ? project.runningSessionCount
              : undefined,
        },
      ]
    })
    return {
      projects,
      unassignedRunningSessionCount:
        typeof response.unassignedRunningSessionCount === 'number'
          ? response.unassignedRunningSessionCount
          : undefined,
      complete:
        response.total === response.projects.length && projects.length === response.projects.length,
    }
  }

  async createSession(deviceId: string, projectId?: string, title?: string): Promise<Session> {
    const body = object(await this.call(deviceId, '/v1/sessions', 'POST', { projectId, title }))
    const session = object(body?.session)
    if (typeof session?.id !== 'string' || !session.id || typeof session.title !== 'string')
      throw new Error('创建结果未确认')
    return { id: session.id, title: session.title }
  }

  async sessions(
    deviceId: string,
    offset = 0,
    projectId?: string,
    limit = 50,
  ): Promise<SessionPage> {
    const path = projectId
      ? `/v1/projects/${encodeURIComponent(projectId)}/sessions`
      : '/v1/sessions'
    const body = object(await this.call(deviceId, `${path}?limit=${limit}&offset=${offset}`, 'GET'))
    if (
      !Array.isArray(body?.sessions) ||
      typeof body.total !== 'number' ||
      !Number.isSafeInteger(body.total) ||
      body.total < 0
    )
      throw new Error('会话列表格式异常')
    const end = offset + body.sessions.length
    const sessions = body.sessions.flatMap((row: unknown) => {
      const session = object(row)
      if (typeof session?.id !== 'string' || !session.id || typeof session.title !== 'string')
        return []
      const label = getSessionLabelMeta(
        typeof session.sessionLabel === 'string' ? session.sessionLabel : null,
      )
      return [
        {
          id: session.id,
          title: session.title,
          ...(typeof session.status === 'string' ? { status: session.status } : {}),
          ...(typeof session.projectId === 'string' ? { projectId: session.projectId } : {}),
          ...(typeof session.pinnedAt === 'string' ? { pinnedAt: session.pinnedAt } : {}),
          ...(typeof session.labeledAt === 'string' ? { labeledAt: session.labeledAt } : {}),
          ...(typeof session.preview === 'string' ? { preview: session.preview } : {}),
          ...(typeof session.updatedAt === 'string' ? { updatedAt: session.updatedAt } : {}),
          ...(label ? { sessionLabel: label.key } : {}),
        },
      ]
    })
    return { sessions, nextOffset: end > offset && end < body.total ? end : null }
  }

  async history(
    target: Target,
    beforeSeq?: number,
  ): Promise<
    Pick<MobileBridgeHistoryResponse, 'events' | 'running'> & { nextBeforeSeq: number | null }
  > {
    const query = `limit=200&turnLimit=12&eventLimit=1200${beforeSeq == null ? '' : `&beforeSeq=${beforeSeq}`}`
    const body = object(
      await this.call(
        target.deviceId,
        `/v1/sessions/${encodeURIComponent(target.sessionId)}/messages?${query}`,
        'GET',
      ),
    )
    if (
      body?.sessionId !== target.sessionId ||
      !Array.isArray(body.events) ||
      typeof body.running !== 'boolean'
    ) {
      throw new Error('会话历史格式异常')
    }
    const events = readEvents(body.events)
    const hasMore = typeof body.hasMore === 'boolean' ? body.hasMore : body.events.length >= 200
    const cursor = body.nextBeforeSeq ?? events[0]?.seq
    if (
      hasMore &&
      (typeof cursor !== 'number' ||
        !Number.isSafeInteger(cursor) ||
        (beforeSeq != null && cursor >= beforeSeq))
    ) {
      throw new Error('历史分页游标未向更早记录推进')
    }
    return {
      events,
      running: body.running,
      nextBeforeSeq: hasMore && typeof cursor === 'number' ? cursor : null,
    }
  }

  async composerSuggestions(target: Target, mode: 'commands' | 'skills') {
    const path = `/v1/${mode}?sessionId=${encodeURIComponent(target.sessionId)}`
    const body = object(await this.call(target.deviceId, path, 'GET'))
    const entries = body?.[mode]
    return Array.isArray(entries)
      ? entries.flatMap((value: unknown) => {
          const item = object(value)
          return typeof item?.name === 'string' && item.name && item.enabled !== false
            ? [
                {
                  name: item.name,
                  description: typeof item.description === 'string' ? item.description : '',
                },
              ]
            : []
        })
      : []
  }

  async executeCommand(target: Target, raw: string) {
    const path = `/v1/sessions/${encodeURIComponent(target.sessionId)}/commands`
    const body = object(await this.call(target.deviceId, path, 'POST', { raw }))
    if (typeof body?.isCommand !== 'boolean') throw new Error('命令结果未确认')
    return { handled: body.isCommand, started: body.queued !== true }
  }

  async catalog(deviceId: string) {
    return object(await this.call(deviceId, '/v1/catalog', 'GET'))
  }

  async getRuntime(target: Target) {
    const route = `/v1/sessions/${encodeURIComponent(target.sessionId)}/runtime`
    return object(object(await this.call(target.deviceId, route, 'GET'))?.runtime)
  }

  async updateSession(
    target: Target,
    patch: import('../../../packages/protocol/src/mobile-bridge').MobileBridgeUpdateSessionRequest,
  ) {
    const route = `/v1/sessions/${encodeURIComponent(target.sessionId)}`
    return object(object(await this.call(target.deviceId, route, 'PATCH', patch))?.session)
  }

  async setWorkflow(
    target: Target,
    mode: 'inherit' | 'override' | 'disabled',
    workflowId?: string,
  ) {
    const route = `/v1/sessions/${encodeURIComponent(target.sessionId)}/workflow`
    const result = object(
      await this.call(target.deviceId, route, 'PUT', {
        mode,
        ...(workflowId ? { workflowId } : {}),
      }),
    )
    if (typeof result?.error === 'string' && result.error) throw new Error(result.error)
  }

  async deleteSession(target: Target) {
    const route = `/v1/sessions/${encodeURIComponent(target.sessionId)}`
    return object(await this.call(target.deviceId, route, 'DELETE'))?.deleted === true
  }

  async sessionTasks(
    target: Target,
  ): Promise<import('../../mobile/src/utils/task-types').BridgeScheduledTask[]> {
    const body = object(
      await this.call(
        target.deviceId,
        `/v1/sessions/${encodeURIComponent(target.sessionId)}/tasks`,
        'GET',
      ),
    )
    if (!Array.isArray(body?.tasks)) throw new Error('定时任务列表格式异常')
    return body.tasks.flatMap(
      (value: unknown): import('../../mobile/src/utils/task-types').BridgeScheduledTask[] => {
        const item = object(value)
        if (
          typeof item?.id !== 'string' ||
          typeof item.name !== 'string' ||
          typeof item.prompt !== 'string'
        )
          return []
        const type = item.triggerType
        if (type !== 'once' && type !== 'interval' && type !== 'cron') return []
        return [
          {
            id: item.id,
            name: item.name,
            prompt: item.prompt,
            description: '',
            enabled: item.enabled === true,
            triggerType: type,
            status: typeof item.status === 'string' ? item.status : '',
            executionCount: typeof item.executionCount === 'number' ? item.executionCount : 0,
            runAt: typeof item.runAt === 'string' ? item.runAt : null,
            cronExpression: typeof item.cronExpression === 'string' ? item.cronExpression : null,
            intervalSeconds: typeof item.intervalSeconds === 'number' ? item.intervalSeconds : null,
          },
        ]
      },
    )
  }

  async createTask(
    target: Target,
    input: import('../../mobile/src/utils/task-types').BridgeCreateTaskInput,
  ) {
    const body = object(
      await this.call(
        target.deviceId,
        `/v1/sessions/${encodeURIComponent(target.sessionId)}/tasks`,
        'POST',
        input,
      ),
    )
    if (!object(body?.task)) throw new Error('未确认创建结果')
  }

  async updateTask(
    deviceId: string,
    taskId: string,
    action: 'edit' | 'toggle' | 'delete' | 'run',
    data?: object,
  ) {
    const route = `/v1/tasks/${encodeURIComponent(taskId)}`
    const result = object(
      await this.call(
        deviceId,
        action === 'run' || action === 'toggle' ? `${route}/${action}` : route,
        action === 'edit' ? 'PATCH' : action === 'delete' ? 'DELETE' : 'POST',
        data,
      ),
    )
    if (action === 'run') return result?.started === true
    if (action === 'delete') return result?.deleted === true
    return !!object(result?.task)
  }

  async uploadAttachment(
    target: Target,
    file: { name: string; mimeType?: string; dataBase64: string },
  ): Promise<string> {
    const path = `/v1/sessions/${encodeURIComponent(target.sessionId)}/attachments`
    const body = object(await this.call(target.deviceId, path, 'POST', { files: [file] }, 120_000))
    const attachment = object(Array.isArray(body?.attachments) ? body.attachments[0] : undefined)
    if (typeof attachment?.path !== 'string' || !attachment.path) throw new Error('附件上传未确认')
    return attachment.path
  }

  async transcribe(deviceId: string, audioBase64: string): Promise<string> {
    const body = object(
      await this.call(
        deviceId,
        '/v1/transcribe',
        'POST',
        { audioBase64, mimeType: 'audio/mp4' },
        120_000,
      ),
    )
    if (typeof body?.text !== 'string') throw new Error('转写结果异常')
    return body.text
  }

  async attachmentImage(deviceId: string, path: string): Promise<string> {
    const body = object(
      await this.call(deviceId, `/v1/attachments/content?path=${encodeURIComponent(path)}`, 'GET'),
    )
    if (
      typeof body?.base64 !== 'string' ||
      body.base64.length > 12_000_000 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(body.base64) ||
      typeof body.mimeType !== 'string' ||
      !/^image\/(?:png|jpeg|webp|gif|bmp)$/i.test(body.mimeType)
    ) {
      throw new Error('图片格式异常')
    }
    return `data:${body.mimeType};base64,${body.base64}`
  }

  async lineage(target: Target) {
    const path = `/v1/sessions/${encodeURIComponent(target.sessionId)}/lineage`
    const body = object(await this.call(target.deviceId, path, 'GET'))
    const source = object(body?.lineage)
    const parent =
      source?.childSessionId === target.sessionId && typeof source.parentSessionId === 'string'
        ? {
            id: source.parentSessionId,
            title:
              typeof source.sourceTitleSnapshot === 'string'
                ? source.sourceTitleSnapshot
                : '来源会话',
          }
        : undefined
    const children: Session[] = Array.isArray(body?.children)
      ? body.children.flatMap((entry: unknown) => {
          const child = object(entry)
          return child?.parentSessionId === target.sessionId &&
            typeof child.childSessionId === 'string'
            ? [
                {
                  id: child.childSessionId,
                  title: typeof child.childTitle === 'string' ? child.childTitle : '分支会话',
                },
              ]
            : []
        })
      : []
    return { parent, children }
  }

  async fork(target: Target, anchorTurnId: string, title: string) {
    const path = `/v1/sessions/${encodeURIComponent(target.sessionId)}/fork`
    const body = object(
      await this.call(target.deviceId, path, 'POST', { anchorTurnId, ...(title ? { title } : {}) }),
    )
    const session = object(body?.session)
    if (typeof session?.id !== 'string' || !session.id || typeof session.title !== 'string') {
      throw new Error('分支创建结果未确认')
    }
    return {
      session: { id: session.id, title: session.title },
      bindingWarning: body?.bindingWarning != null,
      sourceWasRunning: body?.sourceWasRunning === true,
    }
  }

  async interactions(target: Target) {
    const path = `/v1/sessions/${encodeURIComponent(target.sessionId)}/interactions`
    return readInteractions(await this.call(target.deviceId, path, 'GET'), target.sessionId)
  }

  async resolveApproval(target: Target, requestId: string, decision: BridgeApprovalDecision) {
    const path = `/v1/sessions/${encodeURIComponent(target.sessionId)}/approvals/${encodeURIComponent(requestId)}/resolve`
    return this.interactionReply(target.deviceId, path, { decision })
  }

  async answerQuestion(target: Target, questionId: string, answers: Record<string, unknown>) {
    const path = `/v1/sessions/${encodeURIComponent(target.sessionId)}/questions/${encodeURIComponent(questionId)}/answer`
    return this.interactionReply(target.deviceId, path, { answers })
  }

  private async interactionReply(deviceId: string, path: string, data: unknown): Promise<boolean> {
    const body = object(await this.call(deviceId, path, 'POST', data))
    if (typeof body?.ok !== 'boolean') throw new Error('电脑未确认处理结果')
    return body.ok
  }

  async cancel(target: Target): Promise<void> {
    const body = object(
      await this.call(
        target.deviceId,
        `/v1/sessions/${encodeURIComponent(target.sessionId)}/cancel`,
        'POST',
      ),
    )
    if (body?.cancelled !== true) throw new Error('电脑未确认停止')
  }

  async submit(
    target: Target,
    text: string,
    clientMessageId: string,
    attachmentPaths: string[] = [],
  ): Promise<MobileBridgeSubmitTurnResponse> {
    try {
      const body = object(
        await this.call(
          target.deviceId,
          `/v1/sessions/${encodeURIComponent(target.sessionId)}/turns`,
          'POST',
          { text, clientMessageId, ...(attachmentPaths.length ? { attachmentPaths } : {}) },
        ),
      )
      if (typeof body?.turnId !== 'string' || !body.turnId) throw new Error('电脑未确认消息')
      return { turnId: body.turnId, started: body.started !== false }
    } catch (cause) {
      // Only a local preflight rejection proves the request never left the client.
      throw new SubmitError(cause instanceof RequestNotSent ? 'not-sent' : 'unconfirmed', cause)
    }
  }
}
