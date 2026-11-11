import type { MobileBridgeEvent } from './mobile-bridge.js'

/**
 * Remote Agent collaborator contracts shared by the desktop main and renderer.
 * The remote computer remains the execution authority; these types describe the
 * task projection and transport state visible to the originating computer.
 */

export const REMOTE_AGENT_TASK_STATUSES = [
  'dispatching',
  'queued',
  'running',
  'awaiting_approval',
  'completed',
  'failed',
  'rejected',
  'cancel_requested',
  'cancelled',
] as const

export type RemoteAgentTaskStatus = (typeof REMOTE_AGENT_TASK_STATUSES)[number]

export type RemoteAgentTransportState = 'unknown' | 'reachable' | 'unreachable'

/** Per-file payload cap; matches the existing mobile bridge content-read limit. */
export const REMOTE_AGENT_MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024

export type RemoteAgentErrorCode =
  | 'DEVICE_UNREACHABLE'
  | 'REMOTE_AUTH_REQUIRED'
  | 'REMOTE_TARGET_NOT_FOUND'
  | 'TASK_ID_CONFLICT'
  | 'REMOTE_REQUEST_TIMEOUT'
  | 'REMOTE_EXECUTION_FAILED'
  | 'REMOTE_DISPATCH_INTERRUPTED'
  | 'REMOTE_CANCEL_REJECTED'
  | 'UNKNOWN'

/** Minimal online-device projection. It deliberately contains no local paths. */
export interface RemoteAgentDeviceSummary {
  deviceId: string
  name: string
  version: string | null
  online: boolean
  lastSeenAt: string | null
}

/** Minimal directory projections; B's local filesystem paths never cross IPC. */
export interface RemoteAgentProjectSummary {
  id: string
  name: string
}

export interface RemoteAgentAgentSummary {
  id: string
  name: string
}

export interface RemoteAgentTask {
  taskId: string
  sourceSessionId: string
  targetDeviceId: string
  targetProjectId: string
  targetAgentId: string
  remoteSessionId: string | null
  status: RemoteAgentTaskStatus
  transportState: RemoteAgentTransportState
  pendingApprovalId: string | null
  resultSummary: string | null
  errorCode: RemoteAgentErrorCode | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
}

export type RemoteAgentSharedContextItem =
  | { kind: 'message'; sourceMessageId: string; text: string }
  | {
      kind: 'attachment'
      sourceMessageId: string
      name: string
      mimeType: string
      dataBase64: string
    }

/** Explicit user-selected input for a new remote task. Never inferred from chat history. */
export interface RemoteAgentDispatchRequest {
  taskId: string
  /** SHA-256 of the canonical instruction + explicitly selected context payload. */
  requestFingerprint: string
  sourceSessionId: string
  targetProjectId: string
  targetAgentId: string
  instruction: string
  sharedContext: RemoteAgentSharedContextItem[]
}

/**
 * Stable serialization shared by the A-side fingerprint producer and B-side verifier.
 * Keep the explicit property order: JSON object property order is part of this hash input.
 */
export function serializeRemoteAgentInputFingerprintPayload(
  request: Pick<RemoteAgentDispatchRequest, 'instruction' | 'sharedContext'>,
): string {
  return JSON.stringify({
    instruction: request.instruction,
    sharedContext: request.sharedContext.map((item) =>
      item.kind === 'message'
        ? {
            kind: item.kind,
            sourceMessageId: item.sourceMessageId,
            text: item.text,
          }
        : {
            kind: item.kind,
            sourceMessageId: item.sourceMessageId,
            name: item.name,
            mimeType: item.mimeType,
            dataBase64: item.dataBase64,
          },
    ),
  })
}

export interface RemoteAgentRemoteProjectListResponse {
  projects: RemoteAgentProjectSummary[]
}

export interface RemoteAgentTargetProjectListRequest {
  deviceId: string
}

export interface RemoteAgentRemoteAgentListRequest {
  projectId: string
}

export interface RemoteAgentTargetAgentListRequest {
  deviceId: string
  projectId: string
}

export interface RemoteAgentRemoteAgentListResponse {
  agents: RemoteAgentAgentSummary[]
}

export interface RemoteAgentDispatchResponse {
  taskId: string
  remoteSessionId: string | null
  turnId: string | null
  status: 'dispatching' | 'queued' | 'running'
}

export interface RemoteAgentDispatchStatusResponse {
  task: RemoteAgentDispatchResponse | null
  /** True while B's current process still owns the task's idempotent dispatch lock. */
  dispatchActive?: boolean
}

export interface RemoteAgentTaskStatusEvent {
  eventId: string
  taskId: string
  occurredAt: string
  status: RemoteAgentTaskStatus
  pendingApprovalId?: string | null
  resultSummary?: string | null
  errorCode?: RemoteAgentErrorCode | null
}

export type RemoteAgentRelayState = 'stopped' | 'connecting' | 'connected' | 'reconnecting'

export interface RemoteAgentRelayStatus {
  state: RemoteAgentRelayState
  connected: boolean
  connectionId: string | null
  lastError: string | null
  lastSeenAt: string | null
}

export interface RemoteAgentDeviceListResponse {
  devices: RemoteAgentDeviceSummary[]
}

export interface RemoteAgentTaskListRequest {
  sourceSessionId: string
}

export interface RemoteAgentTaskListResponse {
  tasks: RemoteAgentTask[]
}

export interface RemoteAgentTaskGetRequest {
  taskId: string
}

export interface RemoteAgentTaskDispatchRequest {
  taskId?: string
  sourceSessionId: string
  targetDeviceId: string
  targetProjectId: string
  targetAgentId: string
  instruction: string
  sharedContext: RemoteAgentSharedContextItem[]
}

export interface RemoteAgentTaskActionRequest {
  taskId: string
}

export interface RemoteAgentApprovalRequest extends RemoteAgentTaskActionRequest {
  approvalId: string
  decision: 'allow-once' | 'deny'
}

export type RemoteAgentTaskEvent = Omit<MobileBridgeEvent, 'files' | 'attachments'> & {
  taskId: string
  files?: Array<{ artifactId: string; title?: string }>
  attachments?: Array<{ type: 'image' | 'file'; artifactId: string; name?: string }>
}

export interface RemoteAgentTaskHistoryResponse {
  taskId: string
  events: RemoteAgentTaskEvent[]
  running: boolean
}

export interface RemoteAgentArtifactSummary {
  artifactId: string
  name: string
  title?: string
  kind: 'attachment' | 'presented'
}

export interface RemoteAgentArtifactListResponse {
  taskId: string
  artifacts: RemoteAgentArtifactSummary[]
}

export interface RemoteAgentArtifactFetchRequest extends RemoteAgentTaskActionRequest {
  artifactId: string
}

export interface RemoteAgentArtifactFile {
  artifactId: string
  name: string
  mimeType: string
  localPath: string
  sizeBytes: number
}

/**
 * 远程操控（Remote Control）：把一条 HTTP 语义请求原样转发给目标设备。
 *
 * 目标设备收到后走 MobileBridgeService.handleHttpRequest，因此小程序端已有的
 * /v1/projects、/v1/sessions、/v1/messages、/v1/turns、/v1/interactions 等路由
 * 天然可用，无需为桌面端另开一套协议。
 */
export interface RemoteAgentTargetRequest {
  deviceId: string
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  /** 目标设备上的绝对路径，必须以 / 开头，例如 /v1/sessions?limit=50 */
  path: string
  body?: unknown
  /** 缺省 60s，上限 180s（对齐 RemoteAgentRelayClient 的 DEFAULT/MAX_REQUEST_TIMEOUT_MS） */
  timeoutMs?: number
}

export interface RemoteAgentTargetResponse {
  status: number
  /** 目标设备的原始响应体；调用方按具体接口自行收窄 */
  body: unknown
}

/** 远程会话事件流订阅：一台设备上的一个会话对应一条订阅。 */
export interface RemoteAgentStreamSubscribeRequest {
  deviceId: string
  sessionId: string
}

export interface RemoteAgentStreamSubscribeResponse {
  subscribed: boolean
}

/**
 * 流事件批次。带 deviceId/sessionId 是因为同一渲染进程可能同时订阅多个会话，
 * 事件本身不带设备信息，不带标识会串台。
 */
export interface RemoteAgentSessionEventsMessage {
  deviceId: string
  sessionId: string
  events: MobileBridgeEvent[]
}

/**
 * 附件搬运。
 *
 * 上传：渲染端只传本机路径，主进程读文件 → base64 → POST 目标设备
 * /v1/sessions/:id/attachments（该接口收 JSON+base64，单次上限 12MiB）。
 * 回显：目标设备上的图片本机无法直接读，取回后落到 userData 缓存，
 * 交给 safe-file:// 加载（userData 在 safe-file 白名单内）。
 */
export interface RemoteAgentAttachmentUploadRequest {
  deviceId: string
  sessionId: string
  /** 本机绝对路径，由渲染端通过 dialog:open-file 选择 */
  paths: string[]
}

export interface RemoteAgentAttachmentSummary {
  type: 'image' | 'file'
  /** 目标设备上的绝对路径，提交 turn 时原样回传 */
  path: string
  name?: string
}

export interface RemoteAgentAttachmentUploadResponse {
  attachments: RemoteAgentAttachmentSummary[]
}

export interface RemoteAgentAttachmentFetchRequest {
  deviceId: string
  /** 目标设备上的附件路径 */
  path: string
}

export interface RemoteAgentAttachmentFetchResponse {
  /** 已落盘的本地缓存路径，可直接交给 safe-file:// 加载 */
  localPath: string
  mimeType: string
  /**
   * 文本类内容（html / md / txt / json / svg 等）原文，供渲染端直接内联预览
   * （如 HTML 产物的沙箱 iframe）。非文本或超过上限时缺省。
   */
  text?: string
}

export interface RemoteAgentIpcChannelMap {
  'remote-agent:relay:get-status': [{}, RemoteAgentRelayStatus]
  'remote-agent:relay:connect': [{}, RemoteAgentRelayStatus]
  'remote-agent:relay:disconnect': [{}, RemoteAgentRelayStatus]
  'remote-agent:relay:list-devices': [{}, RemoteAgentDeviceListResponse]
  'remote-agent:target:list-projects': [
    RemoteAgentTargetProjectListRequest,
    RemoteAgentRemoteProjectListResponse,
  ]
  'remote-agent:target:list-agents': [
    RemoteAgentTargetAgentListRequest,
    RemoteAgentRemoteAgentListResponse,
  ]
  'remote-agent:task:list': [RemoteAgentTaskListRequest, RemoteAgentTaskListResponse]
  'remote-agent:task:get': [RemoteAgentTaskGetRequest, RemoteAgentTask | null]
  'remote-agent:task:dispatch': [RemoteAgentTaskDispatchRequest, RemoteAgentTask]
  'remote-agent:task:reconcile': [RemoteAgentTaskActionRequest, RemoteAgentTask | null]
  'remote-agent:task:approve': [RemoteAgentApprovalRequest, RemoteAgentTask]
  'remote-agent:task:cancel': [RemoteAgentTaskActionRequest, RemoteAgentTask]
  'remote-agent:task:get-history': [RemoteAgentTaskActionRequest, RemoteAgentTaskHistoryResponse]
  'remote-agent:task:list-artifacts': [
    RemoteAgentTaskActionRequest,
    RemoteAgentArtifactListResponse,
  ]
  'remote-agent:task:fetch-artifact': [RemoteAgentArtifactFetchRequest, RemoteAgentArtifactFile]
  'remote-agent:target:request': [RemoteAgentTargetRequest, RemoteAgentTargetResponse]
  'remote-agent:stream:subscribe': [
    RemoteAgentStreamSubscribeRequest,
    RemoteAgentStreamSubscribeResponse,
  ]
  'remote-agent:stream:unsubscribe': [
    RemoteAgentStreamSubscribeRequest,
    RemoteAgentStreamSubscribeResponse,
  ]
  'remote-agent:attachment:upload': [
    RemoteAgentAttachmentUploadRequest,
    RemoteAgentAttachmentUploadResponse,
  ]
  'remote-agent:attachment:fetch': [
    RemoteAgentAttachmentFetchRequest,
    RemoteAgentAttachmentFetchResponse,
  ]
}

export interface RemoteAgentIpcStreamChannelMap {
  'stream:remote-agent:relay-status': RemoteAgentRelayStatus
  'stream:remote-agent:devices': RemoteAgentDeviceListResponse
  'stream:remote-agent:task-updated': RemoteAgentTask
  'stream:remote-agent:task-events': RemoteAgentTaskEvent[]
  'stream:remote-agent:session-events': RemoteAgentSessionEventsMessage
}
