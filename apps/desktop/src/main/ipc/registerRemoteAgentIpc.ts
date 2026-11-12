import { app } from 'electron'
import path from 'node:path'
import fs from 'node:fs/promises'
import { createHash } from 'node:crypto'
import type {
  RemoteAgentApprovalRequest,
  RemoteAgentArtifactFetchRequest,
  RemoteAgentAttachmentFetchRequest,
  RemoteAgentAttachmentFetchResponse,
  RemoteAgentAttachmentSummary,
  RemoteAgentAttachmentUploadRequest,
  RemoteAgentAttachmentUploadResponse,
  RemoteAgentDeviceAliasRequest,
  RemoteAgentDeviceListResponse,
  RemoteAgentRelayStatus,
  RemoteAgentRemoteAgentListResponse,
  RemoteAgentRemoteProjectListResponse,
  RemoteAgentTaskActionRequest,
  RemoteAgentTaskDispatchRequest,
  RemoteAgentTargetAgentListRequest,
  RemoteAgentTargetProjectListRequest,
  RemoteAgentTaskGetRequest,
  RemoteAgentTaskListRequest,
  RemoteAgentStreamSubscribeRequest,
  RemoteAgentStreamSubscribeResponse,
  RemoteAgentTargetRequest,
  RemoteAgentTargetResponse,
} from '@spark/protocol'
import {
  registerPlatformBridgeRpcHandler,
  type SessionService,
  type SettingsService,
} from '@spark/agent-runtime'
import { createLogger } from '@spark/shared'
import { RemoteAgentRelayClient } from '../services/RemoteAgentRelayClient.js'
import { RemoteAgentCoordinator } from '../services/RemoteAgentCoordinator.js'
import { getDatabase } from '../db.js'
import { RemoteAgentCollaborationService } from '../services/RemoteAgentCollaborationService.js'
import { pushStreamEvent, typedIpcHandle } from './typed-ipc.js'
import {
  applyDeviceAliases,
  readDeviceAliases,
  writeDeviceAlias,
} from './remote-agent-device-aliases.js'

const log = createLogger('remote-agent:ipc')

export interface RemoteAgentIpcDeps {
  getRelayBaseUrl(): string
  getRelayAccessToken(): Promise<string | null>
  getClientLabel(): string
  getLocalDeviceId(): string
  getVersion(): string
  getCurrentUserId(): string | null
  getSettingsService(): SettingsService
  getSessionService(): SessionService
  getLocalAttachmentRoot(): string
  addLogoutHook(hook: () => Promise<void>): () => void
}

let relayClient: RemoteAgentRelayClient | null = null
let coordinator: RemoteAgentCoordinator | null = null
let collaborationService: RemoteAgentCollaborationService | null = null
let beforeQuitHookRegistered = false

const REMOTE_AGENT_TOOL_METHODS = [
  'devices_list',
  'device_inspect',
  'sessions_list',
  'session_open',
  'message_send',
  'events_read',
  'operation_cancel',
  'artifact_transfer',
] as const

/** 设备列表的统一出口：过滤本机 + 合并本机备注名 */
function listDevicesWithAliases(deps: RemoteAgentIpcDeps): RemoteAgentDeviceListResponse {
  const response = relayClient?.listDevices() ?? { devices: [] }
  const visible = excludeLocalDevice(response.devices, deps.getLocalDeviceId)
  let aliases = {}
  try {
    aliases = readDeviceAliases(deps.getSettingsService())
  } catch (error) {
    log.warn(`读取设备备注名失败：${error instanceof Error ? error.message : String(error)}`)
  }
  return { devices: applyDeviceAliases(visible, aliases) }
}

function excludeLocalDevice(
  devices: RemoteAgentDeviceListResponse['devices'],
  getLocalDeviceId: () => string,
): RemoteAgentDeviceListResponse['devices'] {
  try {
    const localDeviceId = getLocalDeviceId()
    return devices.filter((device) => device.deviceId !== localDeviceId)
  } catch {
    return devices
  }
}

function getRelayClient(deps: RemoteAgentIpcDeps): RemoteAgentRelayClient {
  if (relayClient != null) return relayClient
  const client = new RemoteAgentRelayClient({
    getBaseUrl: deps.getRelayBaseUrl,
    getAccessToken: deps.getRelayAccessToken,
    getClientLabel: deps.getClientLabel,
    getVersion: deps.getVersion,
    onStatusChange: (status) => {
      pushStreamEvent('stream:remote-agent:relay-status', status)
      // 客户端 stop/断线会清空自身订阅，重连后按引用计数重建远程会话流
      if (status.connected) restoreStreamSubscriptions(deps)
      coordinator?.handleRelayStatus(status)
      collaborationService?.handleRelayStatus(status)
    },
    onDevicesChange: (devices) => {
      pushStreamEvent('stream:remote-agent:devices', listDevicesWithAliases(deps))
      coordinator?.handleDevicesChange(devices)
    },
  })
  relayClient = client
  coordinator = new RemoteAgentCoordinator({
    getDatabase,
    getCurrentUserId: deps.getCurrentUserId,
    getRelayClient: () => client,
    getArtifactRoot: () => path.join(app.getPath('userData'), 'remote-agent-results'),
    onTaskUpdated: (task) => pushStreamEvent('stream:remote-agent:task-updated', task),
    onTaskEvents: (events) => pushStreamEvent('stream:remote-agent:task-events', events),
  })
  collaborationService = new RemoteAgentCollaborationService({
    getDatabase,
    getCurrentUserId: deps.getCurrentUserId,
    getLocalDeviceId: deps.getLocalDeviceId,
    getSessionService: deps.getSessionService,
    getLocalAttachmentRoot: deps.getLocalAttachmentRoot,
    getRelayClient: () => client,
    getArtifactRoot: () => path.join(app.getPath('userData'), 'remote-agent-results'),
  })
  deps.addLogoutHook(async () => {
    relayClient?.stop()
    // 账号已登出：远程订阅失效，避免下次登录用旧订阅重放
    streamSubscriptions.clear()
    log.info('relay stopped after account logout')
  })
  if (!beforeQuitHookRegistered) {
    beforeQuitHookRegistered = true
    app.once('before-quit', () => relayClient?.stop())
  }
  return client
}

function stoppedStatus(): RemoteAgentRelayStatus {
  return {
    state: 'stopped',
    connected: false,
    connectionId: null,
    lastError: null,
    lastSeenAt: null,
  }
}

async function requestRemoteDirectory<T>(
  client: RemoteAgentRelayClient,
  deviceId: string,
  path: string,
  isResponse: (value: unknown) => value is T,
): Promise<T> {
  const response = await client.request(deviceId, 'GET', path)
  if (response.status < 200 || response.status >= 300 || !isResponse(response.body)) {
    throw new Error('目标电脑未能返回有效目录')
  }
  return response.body
}

function isProjectListResponse(value: unknown): value is RemoteAgentRemoteProjectListResponse {
  if (value == null || typeof value !== 'object' || !('projects' in value)) return false
  const projects = (value as { projects?: unknown }).projects
  return (
    Array.isArray(projects) &&
    projects.every(
      (item) =>
        item != null &&
        typeof item === 'object' &&
        typeof (item as { id?: unknown }).id === 'string' &&
        typeof (item as { name?: unknown }).name === 'string',
    )
  )
}

function isAgentListResponse(value: unknown): value is RemoteAgentRemoteAgentListResponse {
  if (value == null || typeof value !== 'object' || !('agents' in value)) return false
  const agents = (value as { agents?: unknown }).agents
  return (
    Array.isArray(agents) &&
    agents.every(
      (item) =>
        item != null &&
        typeof item === 'object' &&
        typeof (item as { id?: unknown }).id === 'string' &&
        typeof (item as { name?: unknown }).name === 'string',
    )
  )
}

// ─── 远程操控：通用转发 + 会话流订阅 ────────────────────────────────────────────

/**
 * 远程转发只允许命中桥接语义路由，避免借中继访问目标设备的其它路径。
 * 目标设备侧 handleHttpRequest 本来也只认 /v1/*，这里提前拦截以便错误信息更清楚。
 */
function assertRelayTargetPath(rawPath: string): string {
  const path = rawPath.trim()
  if (!path.startsWith('/v1/')) throw new Error('远程路径必须以 /v1/ 开头')
  if (path.length > 2048) throw new Error('远程路径过长')
  return path
}

const TARGET_REQUEST_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * 会话流订阅的引用计数：同一 deviceId+sessionId 可能被多个渲染端组件订阅，
 * 而中继客户端每 subscribe 一次就会多挂一个 listener，必须在这里收敛。
 */
const streamSubscriptions = new Map<string, { dispose: () => void; refs: number }>()

const STREAM_KEY_SEPARATOR = '\u0000'

function streamKey(deviceId: string, sessionId: string): string {
  return `${deviceId}${STREAM_KEY_SEPARATOR}${sessionId}`
}

function relaySessionEvents(deviceId: string, sessionId: string, events: unknown[]): void {
  if (events.length === 0) return
  pushStreamEvent('stream:remote-agent:session-events', { deviceId, sessionId, events })
}

function openStreamSubscription(
  deps: RemoteAgentIpcDeps,
  deviceId: string,
  sessionId: string,
): void {
  const key = streamKey(deviceId, sessionId)
  const existing = streamSubscriptions.get(key)
  if (existing != null) {
    existing.refs += 1
    return
  }
  const dispose = getRelayClient(deps).subscribe(deviceId, sessionId, (events) => {
    relaySessionEvents(deviceId, sessionId, events)
  })
  streamSubscriptions.set(key, { dispose, refs: 1 })
}

function closeStreamSubscription(deviceId: string, sessionId: string): void {
  const key = streamKey(deviceId, sessionId)
  const entry = streamSubscriptions.get(key)
  if (entry == null) return
  entry.refs -= 1
  if (entry.refs > 0) return
  streamSubscriptions.delete(key)
  entry.dispose()
}

/**
 * 中继断开时客户端会清空自己持有的订阅，重连后必须重建，否则远程会话收不到流。
 * 重建保持原有引用计数（一条逻辑订阅对应一个 listener），避免重复推送。
 */
function restoreStreamSubscriptions(deps: RemoteAgentIpcDeps): void {
  if (streamSubscriptions.size === 0) return
  const entries = [...streamSubscriptions.entries()]
  streamSubscriptions.clear()
  for (const [key, entry] of entries) {
    const separator = key.indexOf(STREAM_KEY_SEPARATOR)
    if (separator <= 0) continue
    const deviceId = key.slice(0, separator)
    const sessionId = key.slice(separator + 1)
    const dispose = getRelayClient(deps).subscribe(deviceId, sessionId, (events) => {
      relaySessionEvents(deviceId, sessionId, events)
    })
    streamSubscriptions.set(key, { dispose, refs: entry.refs })
  }
}

/**
 * 附件搬运：目标端 /v1/sessions/:id/attachments 收 JSON+base64，请求体上限 12MiB，
 * base64 膨胀约 4/3，故单文件原始体积上限取 8MiB。
 */
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024
const MAX_ATTACHMENTS_PER_BATCH = 20
const ATTACHMENT_UPLOAD_TIMEOUT_MS = 120_000
/** 回传文本原文的体积上限：只为内联预览（HTML 产物等），不用于下载 */
const MAX_ATTACHMENT_TEXT_BYTES = 512 * 1024

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.json': 'application/json',
  '.csv': 'text/csv',
  '.zip': 'application/zip',
  '.mp4': 'video/mp4',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
}

function guessMimeType(filePath: string): string {
  return MIME_BY_EXT[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream'
}

/** 无 MIME 线索但按源码可读的扩展名 */
const TEXT_PREVIEW_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.css',
  '.yml',
  '.yaml',
  '.xml',
  '.toml',
  '.log',
])

/** 可安全按 UTF-8 解成字符串并内联预览的类型（二进制一律不给 text） */
function isTextMimeType(mimeType: string, remotePath: string): boolean {
  if (mimeType.startsWith('text/')) return true
  if (mimeType === 'image/svg+xml') return true
  if (mimeType === 'application/json') return true
  return TEXT_PREVIEW_EXTENSIONS.has(path.extname(remotePath).toLowerCase())
}

/** 缓存文件必须带扩展名：safe-file 按扩展名给 Content-Type，否则图片不渲染。 */
function extensionForAttachment(mimeType: string, remotePath: string): string {
  const fromMime = Object.keys(MIME_BY_EXT).find((ext) => MIME_BY_EXT[ext] === mimeType)
  if (fromMime != null) return fromMime
  const fromPath = path.extname(remotePath)
  return fromPath.length > 0 ? fromPath : '.bin'
}

export function registerRemoteAgentIpc(deps: RemoteAgentIpcDeps): void {
  const platformBridge = deps.getSessionService().getPlatformBridge()
  for (const method of REMOTE_AGENT_TOOL_METHODS) {
    registerPlatformBridgeRpcHandler(platformBridge, `remote.${method}`, (params) =>
      getCollaborationService(deps).invoke(method, params),
    )
  }
  void getCollaborationService(deps)
    .resumePendingDeliveries()
    .catch((error) => {
      log.warn('remote collaboration recovery startup failed', {
        phase: 'resume',
        errorCode: error instanceof Error ? error.name : 'UNKNOWN',
      })
    })

  typedIpcHandle(
    'remote-agent:relay:get-status',
    async () => relayClient?.getStatus() ?? stoppedStatus(),
  )

  typedIpcHandle('remote-agent:relay:connect', async () => {
    const client = getRelayClient(deps)
    await client.start()
    log.info('relay connection requested')
    return client.getStatus()
  })

  typedIpcHandle('remote-agent:relay:disconnect', async () => {
    relayClient?.stop()
    return relayClient?.getStatus() ?? stoppedStatus()
  })

  typedIpcHandle('remote-agent:relay:list-devices', async () => listDevicesWithAliases(deps))

  typedIpcHandle(
    'remote-agent:device:set-alias',
    async (request: RemoteAgentDeviceAliasRequest): Promise<RemoteAgentDeviceListResponse> => {
      const deviceId = typeof request?.deviceId === 'string' ? request.deviceId.trim() : ''
      if (!deviceId) throw new Error('deviceId 不能为空')
      writeDeviceAlias(deps.getSettingsService(), deviceId, request?.alias ?? null)
      return listDevicesWithAliases(deps)
    },
  )

  typedIpcHandle(
    'remote-agent:target:list-projects',
    async (request: RemoteAgentTargetProjectListRequest) => {
      if (typeof request?.deviceId !== 'string' || !request.deviceId.trim()) {
        throw new Error('deviceId 不能为空')
      }
      return requestRemoteDirectory(
        getRelayClient(deps),
        request.deviceId,
        '/v1/remote-agent/projects',
        isProjectListResponse,
      )
    },
  )

  typedIpcHandle(
    'remote-agent:target:list-agents',
    async (request: RemoteAgentTargetAgentListRequest) => {
      if (
        typeof request?.deviceId !== 'string' ||
        !request.deviceId.trim() ||
        typeof request.projectId !== 'string' ||
        !request.projectId.trim()
      ) {
        throw new Error('deviceId 与 projectId 不能为空')
      }
      const projectId = encodeURIComponent(request.projectId.trim())
      return requestRemoteDirectory(
        getRelayClient(deps),
        request.deviceId,
        `/v1/remote-agent/agents?projectId=${projectId}`,
        isAgentListResponse,
      )
    },
  )

  typedIpcHandle('remote-agent:task:list', async (request: RemoteAgentTaskListRequest) => {
    if (typeof request?.sourceSessionId !== 'string' || !request.sourceSessionId.trim()) {
      throw new Error('sourceSessionId 不能为空')
    }
    if (deps.getCurrentUserId() == null) return { tasks: [] }
    const activeCoordinator = getCoordinator(deps)
    return { tasks: activeCoordinator.list(request.sourceSessionId) }
  })

  typedIpcHandle('remote-agent:task:get', async (request: RemoteAgentTaskGetRequest) => {
    if (typeof request?.taskId !== 'string' || !request.taskId.trim()) {
      throw new Error('taskId 不能为空')
    }
    if (deps.getCurrentUserId() == null) return null
    return getCoordinator(deps).get(request.taskId)
  })

  typedIpcHandle('remote-agent:task:dispatch', async (request: RemoteAgentTaskDispatchRequest) =>
    getCoordinator(deps).dispatch(request),
  )

  typedIpcHandle('remote-agent:task:reconcile', async (request: RemoteAgentTaskActionRequest) =>
    getCoordinator(deps).reconcile(request),
  )

  typedIpcHandle('remote-agent:task:approve', async (request: RemoteAgentApprovalRequest) =>
    getCoordinator(deps).approve(request),
  )

  typedIpcHandle('remote-agent:task:cancel', async (request: RemoteAgentTaskActionRequest) =>
    getCoordinator(deps).cancel(request),
  )

  typedIpcHandle('remote-agent:task:get-history', async (request: RemoteAgentTaskActionRequest) =>
    getCoordinator(deps).getHistory(request),
  )

  typedIpcHandle(
    'remote-agent:task:list-artifacts',
    async (request: RemoteAgentTaskActionRequest) => getCoordinator(deps).listArtifacts(request),
  )

  typedIpcHandle(
    'remote-agent:task:fetch-artifact',
    async (request: RemoteAgentArtifactFetchRequest) => getCoordinator(deps).fetchArtifact(request),
  )

  // ─── 远程操控：通用转发（远程视图的会话/消息/审批都走这一条） ──────────────────

  typedIpcHandle(
    'remote-agent:target:request',
    async (request: RemoteAgentTargetRequest): Promise<RemoteAgentTargetResponse> => {
      const deviceId = typeof request?.deviceId === 'string' ? request.deviceId.trim() : ''
      if (!deviceId) throw new Error('deviceId 不能为空')
      const method = String(request?.method ?? '').toUpperCase()
      if (!TARGET_REQUEST_METHODS.has(method)) throw new Error('远程请求方法不受支持')
      const path = assertRelayTargetPath(String(request?.path ?? ''))
      const response = await getRelayClient(deps).request(
        deviceId,
        method,
        path,
        request.body,
        request.timeoutMs,
      )
      return { status: response.status, body: response.body }
    },
  )

  typedIpcHandle(
    'remote-agent:stream:subscribe',
    async (
      request: RemoteAgentStreamSubscribeRequest,
    ): Promise<RemoteAgentStreamSubscribeResponse> => {
      const deviceId = typeof request?.deviceId === 'string' ? request.deviceId.trim() : ''
      const sessionId = typeof request?.sessionId === 'string' ? request.sessionId.trim() : ''
      if (!deviceId || !sessionId) throw new Error('deviceId 与 sessionId 不能为空')
      openStreamSubscription(deps, deviceId, sessionId)
      return { subscribed: true }
    },
  )

  typedIpcHandle(
    'remote-agent:stream:unsubscribe',
    async (
      request: RemoteAgentStreamSubscribeRequest,
    ): Promise<RemoteAgentStreamSubscribeResponse> => {
      const deviceId = typeof request?.deviceId === 'string' ? request.deviceId.trim() : ''
      const sessionId = typeof request?.sessionId === 'string' ? request.sessionId.trim() : ''
      if (!deviceId || !sessionId) return { subscribed: false }
      closeStreamSubscription(deviceId, sessionId)
      return { subscribed: false }
    },
  )

  // ─── 附件搬运 ────────────────────────────────────────────────────────────────

  typedIpcHandle(
    'remote-agent:attachment:upload',
    async (
      request: RemoteAgentAttachmentUploadRequest,
    ): Promise<RemoteAgentAttachmentUploadResponse> => {
      const deviceId = typeof request?.deviceId === 'string' ? request.deviceId.trim() : ''
      const sessionId = typeof request?.sessionId === 'string' ? request.sessionId.trim() : ''
      if (!deviceId || !sessionId) throw new Error('deviceId 与 sessionId 不能为空')
      const paths = Array.isArray(request?.paths)
        ? request.paths.filter(
            (item): item is string => typeof item === 'string' && item.trim() !== '',
          )
        : []
      if (paths.length === 0) throw new Error('没有选择附件')
      if (paths.length > MAX_ATTACHMENTS_PER_BATCH) {
        throw new Error(`单次最多 ${MAX_ATTACHMENTS_PER_BATCH} 个附件`)
      }

      const files: { name: string; mimeType: string; dataBase64: string }[] = []
      for (const localPath of paths) {
        const stat = await fs.stat(localPath)
        if (!stat.isFile()) continue
        if (stat.size > MAX_ATTACHMENT_BYTES) {
          throw new Error(`附件过大（上限 8MB）：${path.basename(localPath)}`)
        }
        const data = await fs.readFile(localPath)
        files.push({
          name: path.basename(localPath),
          mimeType: guessMimeType(localPath),
          dataBase64: data.toString('base64'),
        })
      }
      if (files.length === 0) throw new Error('没有可上传的文件')

      const response = await getRelayClient(deps).request(
        deviceId,
        'POST',
        `/v1/sessions/${encodeURIComponent(sessionId)}/attachments`,
        { files },
        ATTACHMENT_UPLOAD_TIMEOUT_MS,
      )
      if (response.status < 200 || response.status >= 300) {
        const message =
          (response.body as { error?: { message?: string } } | null)?.error?.message ??
          `附件上传失败 (${response.status})`
        throw new Error(message)
      }
      const body = response.body as { attachments?: RemoteAgentAttachmentSummary[] } | null
      return { attachments: Array.isArray(body?.attachments) ? body.attachments : [] }
    },
  )

  typedIpcHandle(
    'remote-agent:attachment:fetch',
    async (
      request: RemoteAgentAttachmentFetchRequest,
    ): Promise<RemoteAgentAttachmentFetchResponse> => {
      const deviceId = typeof request?.deviceId === 'string' ? request.deviceId.trim() : ''
      const remotePath = typeof request?.path === 'string' ? request.path.trim() : ''
      if (!deviceId || !remotePath) throw new Error('deviceId 与 path 不能为空')

      const response = await getRelayClient(deps).request(
        deviceId,
        'GET',
        `/v1/attachments/content?path=${encodeURIComponent(remotePath)}`,
        undefined,
        ATTACHMENT_UPLOAD_TIMEOUT_MS,
      )
      if (response.status < 200 || response.status >= 300) {
        const message =
          (response.body as { error?: { message?: string } } | null)?.error?.message ??
          `读取远程附件失败 (${response.status})`
        throw new Error(message)
      }
      const body = response.body as { base64?: string; mimeType?: string } | null
      const base64 = body?.base64
      if (typeof base64 !== 'string' || base64.length === 0) throw new Error('远程附件内容为空')
      const mimeType = body?.mimeType ?? 'application/octet-stream'

      // 落到 userData（safe-file 白名单内），文件名按 device+path 哈希，扩展名供 Content-Type
      const cacheDir = path.join(app.getPath('userData'), 'remote-attachments')
      const hash = createHash('sha1').update(`${deviceId}\u0000${remotePath}`).digest('hex')
      const target = path.join(cacheDir, `${hash}${extensionForAttachment(mimeType, remotePath)}`)
      await fs.mkdir(cacheDir, { recursive: true })
      const buffer = Buffer.from(base64, 'base64')
      await fs.writeFile(target, buffer)

      // 文本类产物（html 页面 / md / svg…）顺带回一份原文，
      // 渲染端可内联预览，不必再读盘或另开窗口
      const text =
        buffer.byteLength <= MAX_ATTACHMENT_TEXT_BYTES && isTextMimeType(mimeType, remotePath)
          ? buffer.toString('utf8')
          : undefined
      return { localPath: target, mimeType, ...(text != null ? { text } : {}) }
    },
  )
}

function getCoordinator(deps: RemoteAgentIpcDeps): RemoteAgentCoordinator {
  getRelayClient(deps)
  if (coordinator == null) throw new Error('远程 Agent 编排器尚未初始化')
  return coordinator
}

function getCollaborationService(deps: RemoteAgentIpcDeps): RemoteAgentCollaborationService {
  getRelayClient(deps)
  if (collaborationService == null) throw new Error('远程协作服务尚未初始化')
  return collaborationService
}
