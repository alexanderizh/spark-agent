import type { MobileBridgeEvent } from './mobile-bridge.js'
import type { UserQuestionPrompt } from './ipc/index.js'

export const REMOTE_COLLABORATION_MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024
export const REMOTE_COLLABORATION_MAX_ATTACHMENT_COUNT = 20
export const REMOTE_COLLABORATION_MAX_MESSAGE_BYTES = 256 * 1024

export type RemoteCollaborationOperationStatus =
  | 'submitting'
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancel_requested'
  | 'cancelled'
  | 'uncertain'

export interface RemoteCollaborationLink {
  linkId: string
  targetDeviceId: string
  targetProjectId: string
  targetProjectName?: string
  targetAgentId: string
  targetAgentName?: string
  status: 'opening' | 'ready' | 'unreachable'
  createdAt: string
  updatedAt: string
}

export interface RemoteCollaborationLinkCreateRequest {
  linkId: string
  sourceDeviceId: string
  sourceSessionId: string
  targetProjectId: string
  targetAgentId: string
}

export interface RemoteCollaborationLinkCreateResponse {
  linkId: string
  remoteSessionId: string | null
  status: 'ready' | 'uncertain'
}

export interface RemoteCollaborationSessionOpenToolResponse {
  linkId: string
  deviceRef: string
  status: 'ready' | 'uncertain'
}

export interface RemoteCollaborationAttachmentInput {
  artifactRef: string
  name: string
  mimeType: string
  dataBase64: string
}

export interface RemoteCollaborationAttachmentUploadRequest {
  artifact: RemoteCollaborationAttachmentInput
}

export interface RemoteCollaborationAttachmentUploadResponse {
  artifactRef: string
  name: string
  sizeBytes: number
  sha256: string
}

export interface RemoteCollaborationMessageRequest {
  operationId: string
  requestFingerprint: string
  text: string
  attachmentRefs: string[]
  questionReply?: { questionId: string; answers: Record<string, unknown> }
}

export function serializeRemoteCollaborationMessageFingerprintPayload(
  request: Pick<RemoteCollaborationMessageRequest, 'text' | 'attachmentRefs' | 'questionReply'>,
): string {
  return JSON.stringify({
    text: request.text.trim(),
    attachmentRefs: request.attachmentRefs,
    ...(request.questionReply != null ? { questionReply: request.questionReply } : {}),
  })
}

export interface RemoteCollaborationMessageResponse {
  operationId: string
  turnId: string | null
  status: RemoteCollaborationOperationStatus
}

export interface RemoteCollaborationMessageToolResponse {
  operationId: string
  status: RemoteCollaborationOperationStatus
  targetStatus: 'accepted' | 'uncertain'
}

export interface RemoteCollaborationEventsResponse {
  linkId: string
  events: MobileBridgeEvent[]
  nextCursor: number
  operationId?: string
  operationStatus?: RemoteCollaborationOperationStatus
  /** Internal routing field consumed by Spark main; stripped from MCP tool output. */
  operationTurnId?: string | null
  interactions?: RemoteCollaborationInteractionSnapshot
}

export interface RemoteCollaborationInteractionSnapshot {
  questions: Array<{ questionId: string; questions: UserQuestionPrompt[] }>
  approvals: Array<{
    approvalId: string
    toolName: string
    action: string
    riskLevel: 'low' | 'medium' | 'high'
    createdAt: string
    defaultToNo?: boolean
  }>
}

export type RemoteCollaborationSafeEvent = Omit<MobileBridgeEvent, 'files' | 'attachments'> & {
  files?: Array<{ artifactRef: string; title?: string }>
  attachments?: Array<{ type: 'image' | 'file'; artifactRef: string; name?: string }>
}

export interface RemoteCollaborationToolEventsResponse {
  linkId: string
  events: RemoteCollaborationSafeEvent[]
  nextCursor: number
  operationId?: string
  operationStatus?: RemoteCollaborationOperationStatus
  interactions?: RemoteCollaborationInteractionSnapshot
  deliveryState?: 'pending' | 'submitted' | 'suppressed' | 'failed'
}

export interface RemoteCollaborationCancelResponse {
  operationId: string
  status: RemoteCollaborationOperationStatus
  confirmed: boolean
}

export interface RemoteCollaborationArtifactResponse {
  artifactRef: string
  name: string
  mimeType: string
  localPath: string
  sizeBytes: number
  sha256: string
}
