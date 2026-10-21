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
}

export interface RemoteAgentIpcStreamChannelMap {
  'stream:remote-agent:relay-status': RemoteAgentRelayStatus
  'stream:remote-agent:devices': RemoteAgentDeviceListResponse
  'stream:remote-agent:task-updated': RemoteAgentTask
  'stream:remote-agent:task-events': RemoteAgentTaskEvent[]
}
