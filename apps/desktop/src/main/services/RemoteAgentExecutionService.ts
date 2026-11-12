import { createHash } from 'node:crypto'
import {
  RemoteAgentCollaborationRepository,
  AgentRepository,
  RemoteAgentExecutionConflictError,
  RemoteAgentExecutionRepository,
  SessionRepository,
  TurnRequestRepository,
  WorkspaceRepository,
  type RemoteAgentExecutionRow,
} from '@spark/storage'
import type {
  MobileBridgeAttachment,
  MobileBridgeEvent,
  MobileBridgeInteractionsResponse,
  RemoteCollaborationAttachmentUploadRequest,
  RemoteCollaborationEventsResponse,
  RemoteCollaborationLinkCreateRequest,
  RemoteCollaborationLinkCreateResponse,
  RemoteCollaborationMessageRequest,
  RemoteCollaborationMessageResponse,
  RemoteCollaborationOperationStatus,
  RemoteAgentDispatchRequest,
  RemoteAgentDispatchResponse,
  RemoteAgentDispatchStatusResponse,
  RemoteAgentRemoteAgentListResponse,
  RemoteAgentRemoteProjectListResponse,
  RemoteAgentSharedContextItem,
} from '@spark/protocol'
import {
  REMOTE_COLLABORATION_MAX_ATTACHMENT_BYTES,
  REMOTE_COLLABORATION_MAX_ATTACHMENT_COUNT,
  REMOTE_COLLABORATION_MAX_MESSAGE_BYTES,
  serializeRemoteCollaborationMessageFingerprintPayload,
} from '@spark/protocol'
import { serializeRemoteAgentInputFingerprintPayload } from '@spark/protocol'
import type { SessionService } from '@spark/agent-runtime'
import { createLogger } from '@spark/shared'
import type { SparkDatabase } from '@spark/storage'

const log = createLogger('remote-agent:execution')

const MAX_TASK_BODY_BYTES = 12 * 1024 * 1024
const MAX_TOTAL_ATTACHMENT_BYTES = 8 * 1024 * 1024
const MAX_TEXT_BYTES = 256 * 1024
const MAX_ATTACHMENT_COUNT = 20
const MAX_PROJECT_COUNT = 500
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type SavedSessionAttachment = Pick<MobileBridgeAttachment, 'type' | 'path'>

export interface RemoteAgentExecutionServiceDeps {
  getDatabase(): SparkDatabase
  getSessionService(): SessionService
  getAccountUserId(): string | null
  getDeviceId(): string
  saveAttachments(
    sessionId: string,
    files: Array<{ name: string; mimeType?: string; dataBase64: string }>,
  ): Promise<MobileBridgeAttachment[]>
  getEventsAfterSeq(
    sessionId: string,
    afterSeq: number,
  ): Promise<{ events: MobileBridgeEvent[]; nextSeq: number }>
  getPendingInteractions(sessionId: string): Promise<MobileBridgeInteractionsResponse>
  answerQuestion(
    sessionId: string,
    questionId: string,
    answers: Record<string, unknown>,
  ): Promise<boolean>
  getQuestionSourceTurnId(sessionId: string, questionId: string): string | null
}

class RemoteAgentRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'RemoteAgentRequestError'
  }
}

interface ValidatedAttachment {
  kind: 'attachment'
  sourceMessageId: string
  name: string
  mimeType: string
  dataBase64: string
  byteLength: number
}

type ValidatedContextItem =
  | Extract<RemoteAgentSharedContextItem, { kind: 'message' }>
  | ValidatedAttachment

export class RemoteAgentExecutionService {
  private readonly activeTasks = new Map<string, Promise<void>>()
  private readonly activeCollaborationOperations = new Map<string, Promise<void>>()

  constructor(private readonly deps: RemoteAgentExecutionServiceDeps) {}

  async handleRelayRequest(
    method: string,
    requestPath: string,
    body: unknown,
  ): Promise<{ status: number; body: unknown }> {
    const normalizedMethod = method.toUpperCase()
    const url = new URL(requestPath, 'http://localhost')
    const path = url.pathname.replace(/\/+$/, '') || '/'

    try {
      if (normalizedMethod === 'GET' && path === '/v1/remote-agent/projects') {
        return { status: 200, body: this.listProjects() }
      }
      if (normalizedMethod === 'GET' && path === '/v1/remote-agent/agents') {
        return {
          status: 200,
          body: this.listAgents(url.searchParams.get('projectId') ?? ''),
        }
      }
      if (normalizedMethod === 'POST' && path === '/v1/remote-agent/tasks') {
        const result = await this.dispatch(body)
        return { status: 200, body: result }
      }
      if (normalizedMethod === 'POST' && path === '/v1/remote-agent/links') {
        return { status: 200, body: await this.openCollaborationLink(body) }
      }
      const linkMatch =
        /^\/v1\/remote-agent\/links\/([^/]+)(?:\/(messages|attachments|events))?$/.exec(path)
      if (linkMatch?.[1] != null) {
        const linkId = decodeURIComponent(linkMatch[1])
        if (normalizedMethod === 'POST' && linkMatch[2] === 'messages') {
          return { status: 200, body: await this.submitCollaborationMessage(linkId, body) }
        }
        if (normalizedMethod === 'POST' && linkMatch[2] === 'attachments') {
          return { status: 200, body: await this.uploadCollaborationAttachment(linkId, body) }
        }
        if (normalizedMethod === 'GET' && linkMatch[2] === 'events') {
          return {
            status: 200,
            body: await this.readCollaborationEvents(linkId, url.searchParams),
          }
        }
      }
      const cancelMatch = /^\/v1\/remote-agent\/operations\/([^/]+)\/cancel$/.exec(path)
      if (normalizedMethod === 'POST' && cancelMatch?.[1] != null) {
        return {
          status: 200,
          body: await this.cancelCollaborationOperation(decodeURIComponent(cancelMatch[1])),
        }
      }
      const taskMatch = /^\/v1\/remote-agent\/tasks\/([^/]+)$/.exec(path)
      if (normalizedMethod === 'GET' && taskMatch?.[1] != null) {
        return this.getTask(decodeURIComponent(taskMatch[1]))
      }
      return {
        status: 404,
        body: { error: { code: 'NOT_FOUND', message: '远程 Agent 接口不存在' } },
      }
    } catch (error) {
      const known = error instanceof RemoteAgentRequestError
      const status = known ? error.status : 500
      const code = known ? error.code : 'REMOTE_EXECUTION_FAILED'
      if (known) {
        return { status, body: { error: { code, message: error.message } } }
      }
      log.warn('remote task request failed', {
        deviceId: this.safeDeviceId(),
        phase: 'request',
        errorCode: code,
      })
      return {
        status,
        body: { error: { code, message: '远程任务处理失败，请稍后重试' } },
      }
    }
  }

  private async openCollaborationLink(
    body: unknown,
  ): Promise<RemoteCollaborationLinkCreateResponse> {
    const request = validateCollaborationLinkRequest(body)
    const accountUserId = this.requireAccountUserId()
    const lockKey = `${accountUserId}\u0000link:${request.linkId}`
    return this.withCollaborationLock(lockKey, () =>
      this.openCollaborationLinkLocked(accountUserId, request),
    )
  }

  private async openCollaborationLinkLocked(
    accountUserId: string,
    request: RemoteCollaborationLinkCreateRequest,
  ): Promise<RemoteCollaborationLinkCreateResponse> {
    const repository = new RemoteAgentCollaborationRepository(this.deps.getDatabase())
    const targetDeviceId = this.safeDeviceId()
    if (targetDeviceId == null) {
      throw new RemoteAgentRequestError(
        503,
        'REMOTE_TARGET_NOT_FOUND',
        '当前设备的远程身份尚未就绪',
      )
    }
    const { link } = repository.getOrCreateLink({
      accountUserId,
      linkId: request.linkId,
      sourceDeviceId: request.sourceDeviceId,
      sourceSessionId: request.sourceSessionId,
      targetDeviceId,
      targetProjectId: request.targetProjectId,
      targetAgentId: request.targetAgentId,
    })
    if (link.remote_session_id != null) {
      const existingSession = new SessionRepository(this.deps.getDatabase()).get(
        link.remote_session_id,
      )
      if (existingSession == null || existingSession.archived_at != null) {
        throw new RemoteAgentRequestError(
          409,
          'REMOTE_TARGET_NOT_FOUND',
          '远程协作会话已归档或不存在',
        )
      }
      return { linkId: link.link_id, remoteSessionId: link.remote_session_id, status: 'ready' }
    }

    const workspace = this.getActiveWorkspace(request.targetProjectId)
    const agent = new AgentRepository(this.deps.getDatabase()).get(request.targetAgentId)
    const allowedIds = parseAllowedAgentIds(workspace.allowed_agent_ids_json)
    if (
      agent == null ||
      !agent.enabled ||
      (allowedIds != null && allowedIds.length > 0 && !allowedIds.includes(agent.id))
    ) {
      throw new RemoteAgentRequestError(404, 'REMOTE_TARGET_NOT_FOUND', '所选项目或 Agent 已不可用')
    }

    const title = collaborationSessionTitle(request.linkId)
    let remoteSessionId = findRemoteCollaborationSessionId(
      this.deps.getDatabase(),
      request.linkId,
      workspace.id,
      agent.id,
      title,
    )
    if (remoteSessionId == null) {
      const created = await this.deps.getSessionService().createSession({
        providerProfileId: agent.providerProfileId ?? '',
        ...(agent.modelId != null ? { modelId: agent.modelId } : {}),
        agentId: agent.id,
        title,
        workspaceId: workspace.id,
      })
      remoteSessionId = created.sessionId
    }
    new SessionRepository(this.deps.getDatabase()).patchMetadata(remoteSessionId, {
      remoteAgentLinkId: request.linkId,
    })
    repository.setRemoteSessionId(accountUserId, request.linkId, remoteSessionId)
    log.info('remote collaboration link opened', {
      linkId: request.linkId,
      deviceId: this.safeDeviceId(),
      projectId: workspace.id,
      agentId: agent.id,
      phase: 'session-open',
    })
    return { linkId: request.linkId, remoteSessionId, status: 'ready' }
  }

  private async uploadCollaborationAttachment(
    linkId: string,
    body: unknown,
  ): Promise<{ artifactRef: string; name: string; sizeBytes: number; sha256: string }> {
    const accountUserId = this.requireAccountUserId()
    const request = validateCollaborationAttachmentRequest(body)
    const lockKey = `${accountUserId}\u0000artifact:${request.artifact.artifactRef}`
    return this.withCollaborationLock(lockKey, async () => {
      const repository = new RemoteAgentCollaborationRepository(this.deps.getDatabase())
      const link = this.requireCollaborationLink(repository, accountUserId, linkId)
      if (link.remote_session_id == null) {
        throw new RemoteAgentRequestError(409, 'REMOTE_TARGET_NOT_FOUND', '远端会话尚未建立')
      }
      const session = new SessionRepository(this.deps.getDatabase()).get(link.remote_session_id)
      if (session == null || session.archived_at != null) {
        throw new RemoteAgentRequestError(
          409,
          'REMOTE_TARGET_NOT_FOUND',
          '远程协作会话已归档或不存在',
        )
      }
      const data = decodeBase64(request.artifact.dataBase64)
      if (data.length > REMOTE_COLLABORATION_MAX_ATTACHMENT_BYTES) {
        throw new RemoteAgentRequestError(413, 'BAD_REQUEST', '远程附件超过 8 MiB 上限')
      }
      const sha256 = createHash('sha256').update(data).digest('hex')
      const existing = repository.getArtifact(accountUserId, request.artifact.artifactRef)
      if (existing != null) {
        if (
          existing.link_id !== linkId ||
          existing.direction !== 'input' ||
          existing.sha256 !== sha256
        ) {
          throw new RemoteAgentRequestError(409, 'TASK_ID_CONFLICT', '附件引用已绑定到其他内容')
        }
        return {
          artifactRef: existing.artifact_ref,
          name: existing.name,
          sizeBytes: existing.size_bytes,
          sha256: existing.sha256,
        }
      }
      const saved = await this.deps.saveAttachments(link.remote_session_id, [
        {
          name: request.artifact.name,
          mimeType: request.artifact.mimeType,
          dataBase64: request.artifact.dataBase64,
        },
      ])
      const attachment = saved[0]
      if (saved.length !== 1 || attachment == null) {
        throw new RemoteAgentRequestError(500, 'REMOTE_EXECUTION_FAILED', '远程附件保存失败')
      }
      repository.insertArtifact({
        accountUserId,
        artifactRef: request.artifact.artifactRef,
        linkId,
        direction: 'input',
        remotePath: attachment.path,
        name: request.artifact.name,
        mimeType: request.artifact.mimeType,
        sizeBytes: data.length,
        sha256,
      })
      log.info('remote collaboration attachment accepted', {
        linkId,
        deviceId: this.safeDeviceId(),
        phase: 'attachment-upload',
        sizeBytes: data.length,
      })
      return {
        artifactRef: request.artifact.artifactRef,
        name: request.artifact.name,
        sizeBytes: data.length,
        sha256,
      }
    })
  }

  private async submitCollaborationMessage(
    linkId: string,
    body: unknown,
  ): Promise<RemoteCollaborationMessageResponse> {
    const request = validateCollaborationMessageRequest(body)
    const accountUserId = this.requireAccountUserId()
    const lockKey = `${accountUserId}\u0000operation:${request.operationId}`
    return this.withCollaborationLock(lockKey, () =>
      this.submitCollaborationMessageLocked(accountUserId, linkId, request),
    )
  }

  private async submitCollaborationMessageLocked(
    accountUserId: string,
    linkId: string,
    request: RemoteCollaborationMessageRequest,
  ): Promise<RemoteCollaborationMessageResponse> {
    const db = this.deps.getDatabase()
    const repository = new RemoteAgentCollaborationRepository(db)
    const link = this.requireCollaborationLink(repository, accountUserId, linkId)
    if (link.remote_session_id == null) {
      throw new RemoteAgentRequestError(409, 'REMOTE_TARGET_NOT_FOUND', '远端会话尚未建立')
    }
    const session = new SessionRepository(db).get(link.remote_session_id)
    if (session == null || session.archived_at != null) {
      throw new RemoteAgentRequestError(
        409,
        'REMOTE_TARGET_NOT_FOUND',
        '远程协作会话已归档或不存在',
      )
    }
    if (request.questionReply == null) {
      this.assertCollaborationAgentAvailable(link.target_project_id, link.target_agent_id)
    }
    const expectedFingerprint = createHash('sha256')
      .update(serializeRemoteCollaborationMessageFingerprintPayload(request))
      .digest('hex')
    if (expectedFingerprint !== request.requestFingerprint) {
      throw new RemoteAgentRequestError(409, 'TASK_ID_CONFLICT', '远程消息内容指纹不匹配')
    }
    if (request.attachmentRefs.length > REMOTE_COLLABORATION_MAX_ATTACHMENT_COUNT) {
      throw new RemoteAgentRequestError(413, 'BAD_REQUEST', '单条消息最多 20 个附件')
    }
    const attachmentRows = request.attachmentRefs.map((artifactRef) => {
      const artifact = repository.getArtifact(accountUserId, artifactRef)
      if (
        artifact == null ||
        artifact.link_id !== linkId ||
        artifact.direction !== 'input' ||
        artifact.remote_path == null
      ) {
        throw new RemoteAgentRequestError(404, 'REMOTE_TARGET_NOT_FOUND', '远程附件引用无效')
      }
      return artifact
    })
    if (
      attachmentRows.reduce((sum, artifact) => sum + artifact.size_bytes, 0) >
      REMOTE_COLLABORATION_MAX_ATTACHMENT_BYTES
    ) {
      throw new RemoteAgentRequestError(413, 'BAD_REQUEST', '单条消息附件合计超过 8 MiB')
    }

    let questionTurnId: string | null = null
    let pendingQuestionFound = false
    const turnRequests = new TurnRequestRepository(db)
    if (request.questionReply != null) {
      if (request.attachmentRefs.length > 0) {
        throw new RemoteAgentRequestError(400, 'BAD_REQUEST', '回答远端问题时不能附加文件')
      }
      const pending = await this.deps.getPendingInteractions(link.remote_session_id)
      const question = pending.questions.find(
        (candidate) => candidate.questionId === request.questionReply!.questionId,
      )
      pendingQuestionFound = question != null
      questionTurnId =
        question == null
          ? null
          : this.deps.getQuestionSourceTurnId(link.remote_session_id, question.questionId)
      if (questionTurnId != null) {
        const questionTurn = turnRequests.get(questionTurnId)
        if (
          questionTurn == null ||
          questionTurn.session_id !== link.remote_session_id ||
          (questionTurn.status !== 'accepted' && questionTurn.status !== 'running')
        ) {
          questionTurnId = null
        }
      }
    }

    const { operation } = repository.reserveOperation(
      accountUserId,
      request.operationId,
      linkId,
      request.requestFingerprint,
    )
    if (request.questionReply != null) {
      if (
        operation.status === 'completed' ||
        operation.status === 'failed' ||
        operation.status === 'cancelled'
      ) {
        return {
          operationId: request.operationId,
          turnId: operation.turn_id,
          status: operation.status,
        }
      }
      const turnId = questionTurnId ?? operation.turn_id
      if (turnId == null) {
        repository.setOperationState(accountUserId, request.operationId, { status: 'failed' })
        throw new RemoteAgentRequestError(
          409,
          'REMOTE_TARGET_NOT_FOUND',
          '远端问题已结束或缺少来源回合',
        )
      }
      if (!pendingQuestionFound) {
        const existingTurn = turnRequests.get(turnId)
        const status =
          existingTurn == null ? operation.status : operationStatusFromTurn(existingTurn.status)
        repository.setOperationState(accountUserId, request.operationId, { status, turnId })
        return { operationId: request.operationId, turnId, status }
      }
      repository.setOperationState(accountUserId, request.operationId, {
        status: 'submitting',
        turnId,
      })
      const answered = await this.deps.answerQuestion(
        link.remote_session_id,
        request.questionReply.questionId,
        request.questionReply.answers,
      )
      if (!answered) {
        const stillPending = await this.deps.getPendingInteractions(link.remote_session_id)
        if (
          stillPending.questions.some(
            (question) => question.questionId === request.questionReply!.questionId,
          )
        ) {
          repository.setOperationState(accountUserId, request.operationId, {
            status: 'uncertain',
            turnId,
          })
          return { operationId: request.operationId, turnId, status: 'uncertain' }
        }
      }
      const turn = turnRequests.get(turnId)
      const status = turn == null ? 'running' : operationStatusFromTurn(turn.status)
      repository.setOperationState(accountUserId, request.operationId, { status, turnId })
      return { operationId: request.operationId, turnId, status }
    }
    const previousTurn = turnRequests.findByClientMessageId(
      link.remote_session_id,
      request.operationId,
    )
    if (previousTurn != null) {
      if (previousTurn.session_id !== link.remote_session_id) {
        throw new RemoteAgentRequestError(409, 'TASK_ID_CONFLICT', '操作 ID 已用于其他远端会话')
      }
      const status = operationStatusFromTurn(previousTurn.status)
      const current = repository.setOperationState(accountUserId, request.operationId, {
        status,
        turnId: previousTurn.id,
      })
      return {
        operationId: request.operationId,
        turnId: current.turn_id,
        status: current.status,
      }
    }
    if (
      operation.status === 'completed' ||
      operation.status === 'failed' ||
      operation.status === 'cancelled'
    ) {
      return {
        operationId: request.operationId,
        turnId: operation.turn_id,
        status: operation.status,
      }
    }

    repository.setOperationState(accountUserId, request.operationId, {
      status: 'submitting',
    })
    const submission = await this.deps.getSessionService().submitTurn({
      sessionId: link.remote_session_id,
      message: request.text,
      clientMessageId: request.operationId,
      turnSource: 'remote_user',
      ...(attachmentRows.length > 0
        ? {
            attachments: attachmentRows.map((artifact) => ({
              type: isImageAttachment(artifact.name, artifact.mime_type) ? 'image' : 'file',
              path: artifact.remote_path!,
            })),
          }
        : {}),
    })
    const status = submission.started ? 'running' : 'queued'
    repository.setOperationState(accountUserId, request.operationId, {
      status,
      turnId: submission.turnId,
    })
    log.info('remote collaboration operation accepted', {
      operationId: request.operationId,
      linkId,
      deviceId: this.safeDeviceId(),
      phase: 'message-submit',
      status,
    })
    return { operationId: request.operationId, turnId: submission.turnId, status }
  }

  private async readCollaborationEvents(
    linkId: string,
    searchParams: URLSearchParams,
  ): Promise<RemoteCollaborationEventsResponse> {
    const accountUserId = this.requireAccountUserId()
    const repository = new RemoteAgentCollaborationRepository(this.deps.getDatabase())
    const link = this.requireCollaborationLink(repository, accountUserId, linkId)
    if (link.remote_session_id == null) {
      throw new RemoteAgentRequestError(409, 'REMOTE_TARGET_NOT_FOUND', '远端会话尚未建立')
    }
    const afterSeq = parseEventCursor(searchParams.get('afterSeq'))
    const operationId = searchParams.get('operationId')?.trim()
    if (operationId != null && operationId !== '' && !UUID_PATTERN.test(operationId)) {
      throw new RemoteAgentRequestError(400, 'BAD_REQUEST', 'operationId 必须是 UUID')
    }
    const page = await this.deps.getEventsAfterSeq(link.remote_session_id, afterSeq)
    let operationStatus: RemoteCollaborationOperationStatus | undefined
    if (operationId != null && operationId !== '') {
      const operation = repository.getOperation(accountUserId, operationId)
      if (operation == null || operation.link_id !== linkId) {
        throw new RemoteAgentRequestError(404, 'REMOTE_TARGET_NOT_FOUND', '远程操作不存在')
      }
      operationStatus = this.refreshCollaborationOperationStatus(
        repository,
        accountUserId,
        operationId,
        link.remote_session_id,
      )
    }
    const pending = await this.deps.getPendingInteractions(link.remote_session_id)
    const interactions = {
      questions: pending.questions.map(({ questionId, questions }) => ({ questionId, questions })),
      approvals: pending.approvals.map(
        ({ requestId, toolName, action, riskLevel, createdAt, defaultToNo }) => ({
          approvalId: requestId,
          toolName,
          action,
          riskLevel,
          createdAt,
          ...(defaultToNo === true ? { defaultToNo: true } : {}),
        }),
      ),
    }
    return {
      linkId,
      events: page.events,
      nextCursor: page.nextSeq,
      interactions,
      ...(operationId != null && operationId !== '' ? { operationId } : {}),
      ...(operationStatus != null ? { operationStatus } : {}),
      ...(operationId != null && operationId !== ''
        ? { operationTurnId: repository.getOperation(accountUserId, operationId)?.turn_id ?? null }
        : {}),
    }
  }

  private async cancelCollaborationOperation(operationId: string): Promise<{
    operationId: string
    status: RemoteCollaborationOperationStatus
    confirmed: boolean
  }> {
    if (!UUID_PATTERN.test(operationId)) {
      throw new RemoteAgentRequestError(400, 'BAD_REQUEST', 'operationId 必须是 UUID')
    }
    const accountUserId = this.requireAccountUserId()
    const lockKey = `${accountUserId}\u0000operation:${operationId}`
    return this.withCollaborationLock(lockKey, async () => {
      const repository = new RemoteAgentCollaborationRepository(this.deps.getDatabase())
      const operation = repository.getOperation(accountUserId, operationId)
      if (operation == null) {
        throw new RemoteAgentRequestError(404, 'REMOTE_TARGET_NOT_FOUND', '远程操作不存在')
      }
      const link = this.requireCollaborationLink(repository, accountUserId, operation.link_id)
      if (link.remote_session_id == null) {
        throw new RemoteAgentRequestError(409, 'REMOTE_TARGET_NOT_FOUND', '远端会话尚未建立')
      }
      const status = this.refreshCollaborationOperationStatus(
        repository,
        accountUserId,
        operationId,
        link.remote_session_id,
      )
      if (status === 'cancelled') return { operationId, status, confirmed: true }
      if (status === 'completed' || status === 'failed') {
        return { operationId, status, confirmed: false }
      }
      const currentOperation = repository.getOperation(accountUserId, operationId)
      const turnId = currentOperation?.turn_id
      if (turnId == null) {
        return { operationId, status, confirmed: false }
      }
      const sessionService = this.deps.getSessionService()
      const queue = sessionService.getQueueState({ sessionId: link.remote_session_id })
      const queued = queue.queuedTurns.some((turn) => turn.turnId === turnId)
      let confirmed: boolean
      if (queued) {
        confirmed = sessionService.cancelQueuedTurn({
          sessionId: link.remote_session_id,
          turnId,
        }).cancelled
      } else {
        const cancelled = await sessionService.cancelTurn(link.remote_session_id, turnId)
        confirmed = cancelled.cancelled === true && cancelled.turnId === turnId
      }
      const finalStatus: RemoteCollaborationOperationStatus = confirmed
        ? 'cancelled'
        : this.refreshCollaborationOperationStatus(
            repository,
            accountUserId,
            operationId,
            link.remote_session_id,
          )
      if (confirmed) {
        repository.setOperationState(accountUserId, operationId, { status: 'cancelled', turnId })
      }
      return { operationId, status: finalStatus, confirmed }
    })
  }

  private refreshCollaborationOperationStatus(
    repository: RemoteAgentCollaborationRepository,
    accountUserId: string,
    operationId: string,
    remoteSessionId: string,
  ): RemoteCollaborationOperationStatus {
    const operation = repository.getOperation(accountUserId, operationId)
    if (operation == null)
      throw new RemoteAgentRequestError(404, 'REMOTE_TARGET_NOT_FOUND', '远程操作不存在')
    const requests = new TurnRequestRepository(this.deps.getDatabase())
    const turn =
      operation.turn_id != null
        ? requests.get(operation.turn_id)
        : requests.findByClientMessageId(remoteSessionId, operationId)
    if (turn == null) return operation.status
    if (turn.session_id !== remoteSessionId) {
      throw new RemoteAgentRequestError(409, 'TASK_ID_CONFLICT', '远程操作会话映射不一致')
    }
    const status = operationStatusFromTurn(turn.status)
    repository.setOperationState(accountUserId, operationId, { status, turnId: turn.id })
    return repository.getOperation(accountUserId, operationId)?.status ?? status
  }

  private requireCollaborationLink(
    repository: RemoteAgentCollaborationRepository,
    accountUserId: string,
    linkId: string,
  ) {
    if (!UUID_PATTERN.test(linkId)) {
      throw new RemoteAgentRequestError(400, 'BAD_REQUEST', 'linkId 必须是 UUID')
    }
    const link = repository.getLink(accountUserId, linkId)
    if (link == null)
      throw new RemoteAgentRequestError(404, 'REMOTE_TARGET_NOT_FOUND', '远程协作会话不存在')
    if (link.remote_session_id != null) {
      const session = new SessionRepository(this.deps.getDatabase()).get(link.remote_session_id)
      if (
        session == null ||
        session.project_id !== link.target_project_id ||
        session.agent_id !== link.target_agent_id ||
        !hasRemoteAgentLinkMetadata(session.metadata_json, link.link_id)
      ) {
        throw new RemoteAgentRequestError(409, 'TASK_ID_CONFLICT', '远端会话与协作关联不匹配')
      }
    }
    return link
  }

  private assertCollaborationAgentAvailable(projectId: string, agentId: string): void {
    const workspace = this.getActiveWorkspace(projectId)
    const agent = new AgentRepository(this.deps.getDatabase()).get(agentId)
    const allowedIds = parseAllowedAgentIds(workspace.allowed_agent_ids_json)
    if (
      agent == null ||
      !agent.enabled ||
      (allowedIds != null && allowedIds.length > 0 && !allowedIds.includes(agent.id))
    ) {
      throw new RemoteAgentRequestError(404, 'REMOTE_TARGET_NOT_FOUND', '所选项目或 Agent 已不可用')
    }
  }

  private async withCollaborationLock<T>(key: string, work: () => Promise<T>): Promise<T> {
    const previous = this.activeCollaborationOperations.get(key) ?? Promise.resolve()
    let releaseLock: () => void = () => undefined
    const lock = new Promise<void>((resolve) => {
      releaseLock = resolve
    })
    const queued = previous.catch(() => undefined).then(() => lock)
    this.activeCollaborationOperations.set(key, queued)
    await previous.catch(() => undefined)
    try {
      return await work()
    } finally {
      releaseLock()
      if (this.activeCollaborationOperations.get(key) === queued) {
        this.activeCollaborationOperations.delete(key)
      }
    }
  }

  private listProjects(): RemoteAgentRemoteProjectListResponse {
    this.requireAccountUserId()
    const projects = new WorkspaceRepository(this.deps.getDatabase())
      .listAll(MAX_PROJECT_COUNT, 0)
      .filter((project) => !isWorktree(project.worktree_meta_json))
      .map(({ id, name }) => ({ id, name }))
    return { projects }
  }

  private listAgents(projectId: string): RemoteAgentRemoteAgentListResponse {
    this.requireAccountUserId()
    const workspace = this.getActiveWorkspace(projectId)
    const allowedIds = parseAllowedAgentIds(workspace.allowed_agent_ids_json)
    const agents = new AgentRepository(this.deps.getDatabase())
      .list()
      .filter(
        (agent) =>
          agent.enabled &&
          (allowedIds == null || allowedIds.length === 0 || allowedIds.includes(agent.id)),
      )
      .map(({ id, name }) => ({ id, name }))
    return { agents }
  }

  private async getTask(taskId: string): Promise<{ status: number; body: unknown }> {
    const accountUserId = this.requireAccountUserId()
    if (!taskId.trim() || taskId.length > 128) {
      throw new RemoteAgentRequestError(400, 'BAD_REQUEST', 'taskId 无效')
    }
    const lockKey = `${accountUserId}\u0000${taskId}`
    const dispatchActive = this.activeTasks.has(lockKey)
    const execution = new RemoteAgentExecutionRepository(this.deps.getDatabase()).get(
      accountUserId,
      taskId,
    )
    if (execution == null && !dispatchActive) {
      return {
        status: 404,
        body: { error: { code: 'REMOTE_TARGET_NOT_FOUND', message: '远程任务不存在' } },
      }
    }
    const body: RemoteAgentDispatchStatusResponse = {
      task: execution == null ? null : toDispatchResponse(execution),
      dispatchActive,
    }
    return { status: 200, body }
  }

  private async dispatch(body: unknown): Promise<RemoteAgentDispatchResponse> {
    const request = validateDispatchRequest(body)
    const accountUserId = this.requireAccountUserId()
    const startedAt = Date.now()
    const expectedFingerprint = createHash('sha256')
      .update(serializeRemoteAgentInputFingerprintPayload(request))
      .digest('hex')
    if (expectedFingerprint !== request.requestFingerprint) {
      throw new RemoteAgentRequestError(409, 'TASK_ID_CONFLICT', '任务内容指纹不匹配')
    }

    const lockKey = `${accountUserId}\u0000${request.taskId}`
    const previous = this.activeTasks.get(lockKey) ?? Promise.resolve()
    let releaseLock: () => void = () => undefined
    const lock = new Promise<void>((resolve) => {
      releaseLock = resolve
    })
    const queuedLock = previous.catch(() => undefined).then(() => lock)
    this.activeTasks.set(lockKey, queuedLock)
    await previous.catch(() => undefined)
    try {
      const result = await this.dispatchLocked(accountUserId, request)
      log.info('remote task accepted', {
        taskId: request.taskId,
        deviceId: this.safeDeviceId(),
        phase: 'submitted',
        durationMs: Date.now() - startedAt,
        status: result.status,
      })
      return result
    } catch (error) {
      const errorCode =
        error instanceof RemoteAgentRequestError
          ? error.code
          : error instanceof RemoteAgentExecutionConflictError
            ? 'TASK_ID_CONFLICT'
            : 'REMOTE_EXECUTION_FAILED'
      log.warn('remote task dispatch failed', {
        taskId: request.taskId,
        deviceId: this.safeDeviceId(),
        phase: 'dispatch',
        durationMs: Date.now() - startedAt,
        errorCode,
      })
      if (error instanceof RemoteAgentExecutionConflictError) {
        throw new RemoteAgentRequestError(409, 'TASK_ID_CONFLICT', 'taskId 已绑定到其他任务')
      }
      if (error instanceof RemoteAgentRequestError) throw error
      throw new RemoteAgentRequestError(
        500,
        'REMOTE_EXECUTION_FAILED',
        '远程任务处理失败，请使用同一 taskId 重试',
      )
    } finally {
      releaseLock()
      if (this.activeTasks.get(lockKey) === queuedLock) this.activeTasks.delete(lockKey)
    }
  }

  private async dispatchLocked(
    accountUserId: string,
    request: RemoteAgentDispatchRequest,
  ): Promise<RemoteAgentDispatchResponse> {
    const repository = new RemoteAgentExecutionRepository(this.deps.getDatabase())
    const existing = repository.get(accountUserId, request.taskId)
    if (existing != null) {
      assertSameRequest(existing, request)
      if (existing.status === 'submitted') return toDispatchResponse(existing)
    }

    const workspace = this.getActiveWorkspace(request.targetProjectId)
    const agent = new AgentRepository(this.deps.getDatabase()).get(request.targetAgentId)
    const allowedIds = parseAllowedAgentIds(workspace.allowed_agent_ids_json)
    if (
      agent == null ||
      !agent.enabled ||
      (allowedIds != null && allowedIds.length > 0 && !allowedIds.includes(agent.id))
    ) {
      throw new RemoteAgentRequestError(404, 'REMOTE_TARGET_NOT_FOUND', '所选项目或 Agent 已不可用')
    }

    const { execution } = repository.reserve({
      accountUserId,
      taskId: request.taskId,
      requestFingerprint: request.requestFingerprint,
      sourceSessionId: request.sourceSessionId,
      targetProjectId: request.targetProjectId,
      targetAgentId: request.targetAgentId,
    })

    const sessionRepository = new SessionRepository(this.deps.getDatabase())
    let remoteSessionId = execution.remote_session_id
    const title = remoteTaskSessionTitle(request.taskId)
    if (remoteSessionId == null) {
      remoteSessionId = findRemoteTaskSessionId(
        this.deps.getDatabase(),
        request.taskId,
        workspace.id,
        agent.id,
        title,
      )
    }
    if (remoteSessionId == null) {
      const created = await this.deps.getSessionService().createSession({
        providerProfileId: agent.providerProfileId ?? '',
        agentId: agent.id,
        title,
        workspaceId: workspace.id,
      })
      remoteSessionId = created.sessionId
    }
    sessionRepository.patchMetadata(remoteSessionId, { remoteAgentTaskId: request.taskId })
    repository.setRemoteSessionId(accountUserId, request.taskId, remoteSessionId)
    const session = sessionRepository.get(remoteSessionId)
    if (session == null || session.project_id !== workspace.id || session.agent_id !== agent.id) {
      throw new RemoteAgentRequestError(
        409,
        'TASK_ID_CONFLICT',
        '远程任务对应的本机会话与目标配置不一致',
      )
    }
    repository.markSessionCreated(accountUserId, request.taskId)

    let current = repository.get(accountUserId, request.taskId)
    if (current == null) throw new Error('远程任务映射丢失')
    if (current.attachment_paths_json == null) {
      const files = attachmentFiles(request.sharedContext)
      const uploaded =
        files.length > 0 ? await this.deps.saveAttachments(remoteSessionId, files) : []
      if (uploaded.length !== files.length) {
        throw new Error('远程附件保存数量不匹配')
      }
      current = repository.setAttachmentPaths(
        accountUserId,
        request.taskId,
        uploaded.map(({ type, path }) => ({ type, path })),
      )
    }

    const attachments = parseAttachmentPaths(current.attachment_paths_json)
    const message = composeTaskMessage(request)
    repository.markSubmitting(accountUserId, request.taskId)
    const acceptedTurn = findAcceptedRemoteTaskTurn(
      this.deps.getDatabase(),
      remoteSessionId,
      message,
    )
    if (acceptedTurn != null) {
      const status = acceptedTurn.status === 'running' ? 'running' : 'queued'
      return toDispatchResponse(
        repository.markSubmitted(accountUserId, request.taskId, acceptedTurn.turnId, status),
      )
    }
    const submission = await this.deps.getSessionService().submitTurn({
      sessionId: remoteSessionId,
      message,
      ...(attachments.length > 0 ? { attachments } : {}),
      turnSource: 'remote_user',
    })
    const status = submission.started ? 'running' : 'queued'
    const completed = repository.markSubmitted(
      accountUserId,
      request.taskId,
      submission.turnId,
      status,
    )
    return toDispatchResponse(completed)
  }

  private getActiveWorkspace(projectId: string) {
    if (!projectId.trim() || projectId.length > 256) {
      throw new RemoteAgentRequestError(400, 'BAD_REQUEST', 'projectId 无效')
    }
    const workspace = new WorkspaceRepository(this.deps.getDatabase()).get(projectId)
    if (
      workspace == null ||
      workspace.archived_at != null ||
      isWorktree(workspace.worktree_meta_json)
    ) {
      throw new RemoteAgentRequestError(404, 'REMOTE_TARGET_NOT_FOUND', '所选项目不存在或已归档')
    }
    return workspace
  }

  private requireAccountUserId(): string {
    const userId = this.deps.getAccountUserId()
    if (userId == null || userId.trim().length === 0) {
      throw new RemoteAgentRequestError(401, 'REMOTE_AUTH_REQUIRED', '请先登录 Spark 平台账号')
    }
    return userId
  }

  private safeDeviceId(): string | null {
    try {
      return this.deps.getDeviceId() || null
    } catch {
      return null
    }
  }
}

function validateCollaborationLinkRequest(body: unknown): RemoteCollaborationLinkCreateRequest {
  if (!isRecord(body)) throw new RemoteAgentRequestError(400, 'BAD_REQUEST', 'link 请求格式无效')
  const linkId = readBoundedString(body.linkId, 'linkId', 64)
  const sourceDeviceId = readBoundedString(body.sourceDeviceId, 'sourceDeviceId', 256)
  const sourceSessionId = readBoundedString(body.sourceSessionId, 'sourceSessionId', 256)
  const targetProjectId = readBoundedString(body.targetProjectId, 'targetProjectId', 256)
  const targetAgentId = readBoundedString(body.targetAgentId, 'targetAgentId', 256)
  if (!UUID_PATTERN.test(linkId))
    throw new RemoteAgentRequestError(400, 'BAD_REQUEST', 'linkId 必须是 UUID')
  if (!sourceDeviceId.trim() || !sourceSessionId.trim()) {
    throw new RemoteAgentRequestError(400, 'BAD_REQUEST', '来源设备与会话不能为空')
  }
  return { linkId, sourceDeviceId, sourceSessionId, targetProjectId, targetAgentId }
}

function validateCollaborationAttachmentRequest(
  body: unknown,
): RemoteCollaborationAttachmentUploadRequest {
  if (!isRecord(body) || !isRecord(body.artifact)) {
    throw new RemoteAgentRequestError(400, 'BAD_REQUEST', '附件请求格式无效')
  }
  const artifact = body.artifact
  const artifactRef = readBoundedString(artifact.artifactRef, 'artifactRef', 64)
  const name = readBoundedString(artifact.name, 'name', 255)
  const mimeType = readBoundedString(artifact.mimeType, 'mimeType', 128)
  const dataBase64 = readBoundedString(
    artifact.dataBase64,
    'dataBase64',
    Math.ceil((REMOTE_COLLABORATION_MAX_ATTACHMENT_BYTES * 4) / 3) + 8,
  )
  if (!UUID_PATTERN.test(artifactRef) || !name.trim() || !mimeType.trim()) {
    throw new RemoteAgentRequestError(400, 'BAD_REQUEST', '附件标识、文件名或 MIME 类型无效')
  }
  return { artifact: { artifactRef, name, mimeType, dataBase64 } }
}

function validateCollaborationMessageRequest(body: unknown): RemoteCollaborationMessageRequest {
  if (!isRecord(body) || !Array.isArray(body.attachmentRefs)) {
    throw new RemoteAgentRequestError(400, 'BAD_REQUEST', '远程消息请求格式无效')
  }
  const operationId = readBoundedString(body.operationId, 'operationId', 64)
  const requestFingerprint = readBoundedString(body.requestFingerprint, 'requestFingerprint', 64)
  const text =
    typeof body.text === 'string'
      ? readBoundedString(body.text, 'text', REMOTE_COLLABORATION_MAX_MESSAGE_BYTES)
      : ''
  const questionReply = validateQuestionReplyInput(body.questionReply)
  if (!UUID_PATTERN.test(operationId) || !/^[0-9a-f]{64}$/.test(requestFingerprint)) {
    throw new RemoteAgentRequestError(400, 'BAD_REQUEST', '操作 ID 或内容指纹无效')
  }
  if (!text.trim() && questionReply == null) {
    throw new RemoteAgentRequestError(400, 'BAD_REQUEST', '消息不能为空')
  }
  if (text.trim() && questionReply != null) {
    throw new RemoteAgentRequestError(
      400,
      'BAD_REQUEST',
      'questionReply 不能与普通消息文本同时提交',
    )
  }
  if (body.attachmentRefs.length > REMOTE_COLLABORATION_MAX_ATTACHMENT_COUNT) {
    throw new RemoteAgentRequestError(413, 'BAD_REQUEST', '单条消息最多 20 个附件')
  }
  const attachmentRefs = body.attachmentRefs.map((value, index) => {
    const ref = readBoundedString(value, `attachmentRefs[${index}]`, 64)
    if (!UUID_PATTERN.test(ref))
      throw new RemoteAgentRequestError(400, 'BAD_REQUEST', '附件引用无效')
    return ref
  })
  if (new Set(attachmentRefs).size !== attachmentRefs.length) {
    throw new RemoteAgentRequestError(400, 'BAD_REQUEST', '附件引用不能重复')
  }
  if (questionReply != null && attachmentRefs.length > 0) {
    throw new RemoteAgentRequestError(400, 'BAD_REQUEST', '回答远端问题时不能附加文件')
  }
  return {
    operationId,
    requestFingerprint,
    text,
    attachmentRefs,
    ...(questionReply != null ? { questionReply } : {}),
  }
}

function validateQuestionReplyInput(
  value: unknown,
): { questionId: string; answers: Record<string, unknown> } | undefined {
  if (value == null) return undefined
  if (!isRecord(value) || !isRecord(value.answers)) {
    throw new RemoteAgentRequestError(400, 'BAD_REQUEST', 'questionReply 格式无效')
  }
  const questionId = readBoundedString(value.questionId, 'questionReply.questionId', 256)
  if (
    Buffer.byteLength(JSON.stringify(value.answers), 'utf8') >
    REMOTE_COLLABORATION_MAX_MESSAGE_BYTES
  ) {
    throw new RemoteAgentRequestError(413, 'BAD_REQUEST', '远端问题回答超过 256 KiB')
  }
  return { questionId, answers: value.answers }
}

function collaborationSessionTitle(linkId: string): string {
  return `远程协作 · ${linkId}`
}

function hasRemoteAgentLinkMetadata(metadataJson: string | null, linkId: string): boolean {
  if (metadataJson == null) return false
  try {
    const metadata: unknown = JSON.parse(metadataJson)
    return isRecord(metadata) && metadata.remoteAgentLinkId === linkId
  } catch {
    return false
  }
}

function findRemoteCollaborationSessionId(
  db: SparkDatabase,
  linkId: string,
  projectId: string,
  agentId: string,
  title: string,
): string | null {
  const rows = db.raw
    .prepare(
      `SELECT id, metadata_json FROM sessions
       WHERE project_id = ? AND agent_id = ? AND title = ?`,
    )
    .all(projectId, agentId, title) as Array<{ id: string; metadata_json: string | null }>
  const matches = new Set<string>()
  for (const row of rows) {
    let metadata: unknown
    try {
      metadata = row.metadata_json == null ? null : JSON.parse(row.metadata_json)
    } catch {
      continue
    }
    if (isRecord(metadata) && metadata.remoteAgentLinkId === linkId) matches.add(row.id)
    else if (row.metadata_json == null) matches.add(row.id)
  }
  if (matches.size > 1) {
    throw new RemoteAgentRequestError(409, 'TASK_ID_CONFLICT', '同一 linkId 对应多个远端会话')
  }
  return matches.values().next().value ?? null
}

function parseEventCursor(value: string | null): number {
  if (value == null || value === '') return -1
  if (!/^-?\d+$/.test(value)) throw new RemoteAgentRequestError(400, 'BAD_REQUEST', '事件游标无效')
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < -1) {
    throw new RemoteAgentRequestError(400, 'BAD_REQUEST', '事件游标无效')
  }
  return parsed
}

function operationStatusFromTurn(
  status: 'accepted' | 'running' | 'completed' | 'failed' | 'cancelled',
): RemoteCollaborationOperationStatus {
  if (status === 'accepted') return 'queued'
  return status
}

function isImageAttachment(name: string, mimeType: string): boolean {
  return mimeType.toLowerCase().startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp)$/i.test(name)
}

function validateDispatchRequest(body: unknown): RemoteAgentDispatchRequest {
  if (!isRecord(body) || !Array.isArray(body.sharedContext)) {
    throw new RemoteAgentRequestError(400, 'BAD_REQUEST', '远程任务请求格式无效')
  }
  const taskId = readBoundedString(body.taskId, 'taskId', 64)
  if (!UUID_PATTERN.test(taskId)) {
    throw new RemoteAgentRequestError(400, 'BAD_REQUEST', 'taskId 必须是 UUID')
  }
  const requestFingerprint = readBoundedString(body.requestFingerprint, 'requestFingerprint', 64)
  if (!/^[0-9a-f]{64}$/.test(requestFingerprint)) {
    throw new RemoteAgentRequestError(400, 'BAD_REQUEST', 'requestFingerprint 格式无效')
  }
  const sourceSessionId = readBoundedString(body.sourceSessionId, 'sourceSessionId', 256)
  const targetProjectId = readBoundedString(body.targetProjectId, 'targetProjectId', 256)
  const targetAgentId = readBoundedString(body.targetAgentId, 'targetAgentId', 256)
  if (sourceSessionId.trim().length === 0) {
    throw new RemoteAgentRequestError(400, 'BAD_REQUEST', 'sourceSessionId 不能为空')
  }
  const instruction = readBoundedString(body.instruction, 'instruction', MAX_TEXT_BYTES)
  if (instruction.trim().length === 0) {
    throw new RemoteAgentRequestError(400, 'BAD_REQUEST', '任务说明不能为空')
  }
  if (body.sharedContext.length > 100) {
    throw new RemoteAgentRequestError(413, 'BAD_REQUEST', '共享消息数量超出上限')
  }

  const sharedContext: ValidatedContextItem[] = body.sharedContext.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new RemoteAgentRequestError(400, 'BAD_REQUEST', `共享上下文第 ${index + 1} 项无效`)
    }
    const sourceMessageId = readBoundedString(
      entry.sourceMessageId,
      `sharedContext[${index}].sourceMessageId`,
      256,
    )
    if (sourceMessageId.trim().length === 0) {
      throw new RemoteAgentRequestError(400, 'BAD_REQUEST', '共享上下文缺少来源消息 ID')
    }
    if (entry.kind === 'message') {
      return {
        kind: 'message',
        sourceMessageId,
        text: readBoundedString(entry.text, `sharedContext[${index}].text`, MAX_TEXT_BYTES),
      }
    }
    if (entry.kind !== 'attachment') {
      throw new RemoteAgentRequestError(400, 'BAD_REQUEST', `共享上下文第 ${index + 1} 项类型无效`)
    }
    const name = readBoundedString(entry.name, `sharedContext[${index}].name`, 255)
    const mimeType = readBoundedString(entry.mimeType, `sharedContext[${index}].mimeType`, 128)
    if (name.trim().length === 0) {
      throw new RemoteAgentRequestError(400, 'BAD_REQUEST', '共享附件缺少文件名')
    }
    const dataBase64 = readBoundedString(
      entry.dataBase64,
      `sharedContext[${index}].dataBase64`,
      MAX_TASK_BODY_BYTES,
    )
    const decoded = decodeBase64(dataBase64)
    return {
      kind: 'attachment',
      sourceMessageId,
      name,
      mimeType,
      dataBase64,
      byteLength: decoded.length,
    }
  })

  const attachments = sharedContext.filter(
    (item): item is ValidatedAttachment => item.kind === 'attachment',
  )
  if (attachments.length > MAX_ATTACHMENT_COUNT) {
    throw new RemoteAgentRequestError(413, 'BAD_REQUEST', '单次最多共享 20 个附件')
  }
  if (attachments.reduce((sum, item) => sum + item.byteLength, 0) > MAX_TOTAL_ATTACHMENT_BYTES) {
    throw new RemoteAgentRequestError(413, 'BAD_REQUEST', '共享附件总大小不能超过 8 MiB')
  }
  const textBytes = Buffer.byteLength(
    [
      instruction,
      ...sharedContext.flatMap((item) => (item.kind === 'message' ? [item.text] : [])),
    ].join('\n'),
    'utf8',
  )
  if (textBytes > MAX_TEXT_BYTES) {
    throw new RemoteAgentRequestError(413, 'BAD_REQUEST', '任务说明与共享消息总长度超出上限')
  }

  const request: RemoteAgentDispatchRequest = {
    taskId,
    requestFingerprint,
    sourceSessionId,
    targetProjectId,
    targetAgentId,
    instruction,
    sharedContext: sharedContext.map((item) =>
      item.kind === 'message'
        ? item
        : {
            kind: item.kind,
            sourceMessageId: item.sourceMessageId,
            name: item.name,
            mimeType: item.mimeType,
            dataBase64: item.dataBase64,
          },
    ),
  }
  if (Buffer.byteLength(JSON.stringify(request), 'utf8') > MAX_TASK_BODY_BYTES) {
    throw new RemoteAgentRequestError(413, 'BAD_REQUEST', '远程任务请求体超过 12 MiB')
  }
  if (Buffer.byteLength(composeTaskMessage(request), 'utf8') > MAX_TEXT_BYTES) {
    throw new RemoteAgentRequestError(413, 'BAD_REQUEST', '任务正文超过 256 KiB')
  }
  return request
}

function assertSameRequest(
  execution: RemoteAgentExecutionRow,
  request: RemoteAgentDispatchRequest,
): void {
  if (
    execution.request_fingerprint !== request.requestFingerprint ||
    execution.source_session_id !== request.sourceSessionId ||
    execution.target_project_id !== request.targetProjectId ||
    execution.target_agent_id !== request.targetAgentId
  ) {
    throw new RemoteAgentRequestError(409, 'TASK_ID_CONFLICT', 'taskId 已用于不同的请求')
  }
}

function attachmentFiles(
  context: RemoteAgentSharedContextItem[],
): Array<{ name: string; mimeType?: string; dataBase64: string }> {
  return context.flatMap((item) =>
    item.kind === 'attachment'
      ? [{ name: item.name, mimeType: item.mimeType, dataBase64: item.dataBase64 }]
      : [],
  )
}

function parseAttachmentPaths(value: string | null): SavedSessionAttachment[] {
  if (value == null) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(value) as unknown
  } catch {
    throw new Error('远程任务附件映射损坏')
  }
  if (!Array.isArray(parsed)) throw new Error('远程任务附件映射格式无效')
  return parsed.map((item): SavedSessionAttachment => {
    if (
      !isRecord(item) ||
      (item.type !== 'image' && item.type !== 'file') ||
      typeof item.path !== 'string' ||
      item.path.length === 0
    ) {
      throw new Error('远程任务附件映射条目无效')
    }
    return { type: item.type, path: item.path }
  })
}

function composeTaskMessage(request: RemoteAgentDispatchRequest): string {
  const messages = request.sharedContext.filter(
    (item): item is Extract<RemoteAgentSharedContextItem, { kind: 'message' }> =>
      item.kind === 'message',
  )
  const attachments = request.sharedContext.filter(
    (item): item is Extract<RemoteAgentSharedContextItem, { kind: 'attachment' }> =>
      item.kind === 'attachment',
  )
  const sections = [request.instruction.trim()]
  if (messages.length > 0) {
    sections.push(
      `\n\n用户明确共享的消息：\n${messages
        .map((item, index) => `【消息 ${index + 1}】\n${item.text}`)
        .join('\n\n')}`,
    )
  }
  if (attachments.length > 0) {
    sections.push(
      `\n\n用户明确共享的附件：\n${attachments.map((item) => `- ${item.name}`).join('\n')}`,
    )
  }
  return sections.join('')
}

function remoteTaskSessionTitle(taskId: string): string {
  return `远程协作任务 · ${taskId}`
}

function findRemoteTaskSessionId(
  db: SparkDatabase,
  taskId: string,
  projectId: string,
  agentId: string,
  title: string,
): string | null {
  const titleRows = db.raw
    .prepare('SELECT id FROM sessions WHERE project_id = ? AND agent_id = ? AND title = ?')
    .all(projectId, agentId, title) as Array<{ id: string }>
  const metadataRows = db.raw
    .prepare(
      'SELECT id, metadata_json FROM sessions WHERE project_id = ? AND agent_id = ? AND metadata_json LIKE ?',
    )
    .all(projectId, agentId, `%${taskId}%`) as Array<{ id: string; metadata_json: string }>

  const sessionIds = new Set(titleRows.map((row) => row.id))
  for (const row of metadataRows) {
    try {
      const metadata: unknown = JSON.parse(row.metadata_json)
      if (isRecord(metadata) && metadata.remoteAgentTaskId === taskId) {
        sessionIds.add(row.id)
      }
    } catch {
      // Ignore unrelated or malformed session metadata; the task marker must match exactly.
    }
  }

  if (sessionIds.size > 1) {
    throw new RemoteAgentRequestError(
      409,
      'TASK_ID_CONFLICT',
      '同一 taskId 对应多个本机会话，无法安全恢复',
    )
  }
  return sessionIds.values().next().value ?? null
}

function findAcceptedRemoteTaskTurn(
  db: SparkDatabase,
  sessionId: string,
  message: string,
): { turnId: string; status: 'accepted' | 'running' } | null {
  const turnRows = db.raw
    .prepare(
      'SELECT id, status, payload_json FROM turn_requests WHERE session_id = ? ORDER BY created_at DESC LIMIT 100',
    )
    .all(sessionId) as Array<{ id: string; status: string; payload_json: string }>
  for (const row of turnRows) {
    try {
      const payload: unknown = JSON.parse(row.payload_json)
      if (
        isRecord(payload) &&
        payload.turnSource === 'remote_user' &&
        payload.message === message &&
        (row.status === 'accepted' || row.status === 'running')
      ) {
        return { turnId: row.id, status: row.status }
      }
    } catch {
      // Ignore unrelated or malformed turn payloads.
    }
  }

  const eventRows = db.raw
    .prepare(
      `SELECT turn_id, event_json FROM agent_events
       WHERE session_id = ? AND event_type = 'user_message' AND turn_id IS NOT NULL
       ORDER BY rowid DESC LIMIT 100`,
    )
    .all(sessionId) as Array<{ turn_id: string; event_json: string }>
  for (const row of eventRows) {
    try {
      const event: unknown = JSON.parse(row.event_json)
      if (isRecord(event) && event.turnSource === 'remote_user' && event.content === message) {
        return { turnId: row.turn_id, status: 'running' }
      }
    } catch {
      // Ignore unrelated or malformed event payloads.
    }
  }
  return null
}

function decodeBase64(value: string): Buffer {
  if (
    value.length === 0 ||
    value.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  ) {
    throw new RemoteAgentRequestError(400, 'BAD_REQUEST', '共享附件数据格式无效')
  }
  const decoded = Buffer.from(value, 'base64')
  if (decoded.length === 0 || decoded.toString('base64') !== value) {
    throw new RemoteAgentRequestError(400, 'BAD_REQUEST', '共享附件数据为空或不完整')
  }
  return decoded
}

function readBoundedString(value: unknown, field: string, maxBytes: number): string {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > maxBytes) {
    throw new RemoteAgentRequestError(400, 'BAD_REQUEST', `${field} 无效或超出长度限制`)
  }
  return value
}

function parseAllowedAgentIds(value: string | null): string[] | null {
  if (value == null) return null
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === 'string')
      : null
  } catch {
    return null
  }
}

function isWorktree(metaJson: string | null): boolean {
  if (metaJson == null) return false
  try {
    const metadata = JSON.parse(metaJson) as { baseWorkspaceId?: unknown }
    return typeof metadata.baseWorkspaceId === 'string' && metadata.baseWorkspaceId.length > 0
  } catch {
    return false
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function toDispatchResponse(execution: RemoteAgentExecutionRow): RemoteAgentDispatchResponse {
  return {
    taskId: execution.task_id,
    remoteSessionId: execution.remote_session_id,
    turnId: execution.turn_id,
    status: execution.dispatch_status ?? 'dispatching',
  }
}
