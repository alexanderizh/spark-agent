import { createHash } from 'node:crypto'
import {
  AgentRepository,
  RemoteAgentExecutionConflictError,
  RemoteAgentExecutionRepository,
  SessionRepository,
  WorkspaceRepository,
  type RemoteAgentExecutionRow,
} from '@spark/storage'
import type {
  MobileBridgeAttachment,
  RemoteAgentDispatchRequest,
  RemoteAgentDispatchResponse,
  RemoteAgentDispatchStatusResponse,
  RemoteAgentRemoteAgentListResponse,
  RemoteAgentRemoteProjectListResponse,
  RemoteAgentSharedContextItem,
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
        (agent) => allowedIds == null || allowedIds.length === 0 || allowedIds.includes(agent.id),
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
