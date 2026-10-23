import { createHash } from 'node:crypto'
import type {
  MobileBridgeEvent,
  RemoteAgentApprovalRequest,
  RemoteAgentArtifactFetchRequest,
  RemoteAgentArtifactFile,
  RemoteAgentArtifactListResponse,
  RemoteAgentDispatchRequest,
  RemoteAgentDispatchResponse,
  RemoteAgentDispatchStatusResponse,
  RemoteAgentTask,
  RemoteAgentTaskActionRequest,
  RemoteAgentTaskDispatchRequest,
  RemoteAgentTaskEvent,
  RemoteAgentTaskHistoryResponse,
  RemoteAgentTaskStatus,
  RemoteAgentTransportState,
  RemoteAgentDeviceListResponse,
  RemoteAgentRelayStatus,
} from '@spark/protocol'
import { serializeRemoteAgentInputFingerprintPayload } from '@spark/protocol'
import {
  RemoteAgentTaskConflictError,
  RemoteAgentTaskRepository,
  type UpdateRemoteAgentTaskParams,
} from '@spark/storage'
import type { SparkDatabase } from '@spark/storage'
import { createLogger } from '@spark/shared'
import { RemoteAgentRelayClient, RemoteAgentRelayError } from './RemoteAgentRelayClient.js'
import { RemoteAgentArtifactStore } from './RemoteAgentArtifactStore.js'
import { getRemoteAgentDispatchRecoveryAction } from './RemoteAgentDispatchRecovery.js'
import {
  isRecord,
  isValidRemoteAgentTaskId,
  requireBoundedString,
  validateDispatchInput,
} from './RemoteAgentCoordinator.validation.js'

const log = createLogger('remote-agent:coordinator')
const MAX_HISTORY_EVENTS = 5_000
const TERMINAL_SUBSCRIPTION_GRACE_MS = 1_500
const DISPATCH_RECOVERY_RETRY_DELAY_MS = 5_000
const MAX_DISPATCH_RECOVERY_RETRIES = 12
const TERMINAL_STATUSES = new Set<RemoteAgentTaskStatus>([
  'completed',
  'failed',
  'rejected',
  'cancelled',
])

interface RemoteAgentHistorySnapshot {
  events: MobileBridgeEvent[]
  running: boolean
}

interface RemoteAgentInteractionsSnapshot {
  approvals: Array<{ requestId: string; createdAt: string }>
}

export interface RemoteAgentCoordinatorDeps {
  getDatabase(): SparkDatabase
  getCurrentUserId(): string | null
  getRelayClient(): RemoteAgentRelayClient
  getArtifactRoot(): string
  onTaskUpdated(task: RemoteAgentTask): void
  onTaskEvents(events: RemoteAgentTaskEvent[]): void
}

export class RemoteAgentCoordinator {
  private readonly subscriptions = new Map<string, () => void>()
  private readonly terminalCleanupTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly dispatchRecoveryTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly dispatchRecoveryAttempts = new Map<string, number>()
  private readonly artifacts: RemoteAgentArtifactStore
  private readonly eventQueues = new Map<string, Promise<void>>()
  private resumePromise: Promise<void> | null = null

  constructor(private readonly deps: RemoteAgentCoordinatorDeps) {
    this.artifacts = new RemoteAgentArtifactStore(deps.getArtifactRoot)
  }

  list(sourceSessionId: string): RemoteAgentTask[] {
    const accountUserId = this.requireAccountUserId()
    if (!sourceSessionId.trim()) throw new Error('sourceSessionId 不能为空')
    const tasks = this.repository().listBySourceSession(accountUserId, sourceSessionId)
    if (tasks.some((task) => !isTerminal(task.status))) {
      void this.ensureRelayAndResume().catch((error) => {
        log.warn('remote task background recovery failed', {
          phase: 'resume',
          errorCode: relayErrorCode(error),
        })
      })
    }
    return tasks
  }

  async get(taskId: string, reconcile = true): Promise<RemoteAgentTask | null> {
    const accountUserId = this.requireAccountUserId()
    const task = this.repository().get(accountUserId, this.requireTaskId(taskId))
    if (task == null || !reconcile || isTerminal(task.status)) return task
    await this.reconcileTask(accountUserId, task.taskId)
    return this.repository().get(accountUserId, task.taskId)
  }

  async dispatch(rawRequest: RemoteAgentTaskDispatchRequest): Promise<RemoteAgentTask> {
    const accountUserId = this.requireAccountUserId()
    const request = validateDispatchInput(rawRequest)
    const startedAt = Date.now()
    const requestFingerprint = createHash('sha256')
      .update(serializeRemoteAgentInputFingerprintPayload(request))
      .digest('hex')
    let task: RemoteAgentTask

    try {
      const result = this.repository().getOrCreate({
        accountUserId,
        taskId: request.taskId,
        requestFingerprint,
        sourceSessionId: request.sourceSessionId,
        targetDeviceId: request.targetDeviceId,
        targetProjectId: request.targetProjectId,
        targetAgentId: request.targetAgentId,
      })
      task = result.task
      this.deps.onTaskUpdated(task)
    } catch (error) {
      if (error instanceof RemoteAgentTaskConflictError) {
        throw new Error('taskId 已用于不同的来源或目标', { cause: error })
      }
      throw error
    }

    if (isTerminal(task.status)) return task
    if (task.status !== 'dispatching') {
      await this.reconcileTask(accountUserId, task.taskId)
      return this.repository().get(accountUserId, task.taskId) ?? task
    }

    const client = this.deps.getRelayClient()
    await client.start()
    if (!client.getStatus().connected) {
      return (
        this.updateTask(accountUserId, task.taskId, {
          transportState: 'unreachable',
          errorCode: 'DEVICE_UNREACHABLE',
        }) ?? task
      )
    }

    const relayRequest: RemoteAgentDispatchRequest = {
      taskId: request.taskId,
      requestFingerprint,
      sourceSessionId: request.sourceSessionId,
      targetProjectId: request.targetProjectId,
      targetAgentId: request.targetAgentId,
      instruction: request.instruction,
      sharedContext: request.sharedContext,
    }
    try {
      const response = await client.request(
        request.targetDeviceId,
        'POST',
        '/v1/remote-agent/tasks',
        relayRequest,
      )
      const accepted =
        response.status >= 200 && response.status < 300
          ? parseDispatchResponse(response.body)
          : null
      if (accepted == null || accepted.status === 'dispatching') {
        if (isDefinitiveDispatchRejection(response.status, response.body)) {
          return this.applyRemoteDispatchError(accountUserId, task, response.status, response.body)
        }
        return this.recoverAfterDispatchUncertainty(accountUserId, task, client, relayRequest)
      }
      task = this.updateFromDispatch(accountUserId, task, accepted)
      this.ensureSubscription(accountUserId, task)
      await this.reconcileTask(accountUserId, task.taskId)
      log.info('remote task dispatch reconciled', {
        taskId: task.taskId,
        deviceId: task.targetDeviceId,
        phase: 'dispatch',
        durationMs: Date.now() - startedAt,
        status: this.repository().get(accountUserId, task.taskId)?.status,
      })
      return this.repository().get(accountUserId, task.taskId) ?? task
    } catch (error) {
      const recovered = await this.recoverAfterDispatchUncertainty(
        accountUserId,
        task,
        client,
        relayRequest,
      )
      log.warn('remote task dispatch response unavailable', {
        taskId: task.taskId,
        deviceId: task.targetDeviceId,
        phase: 'dispatch-recovery',
        durationMs: Date.now() - startedAt,
        errorCode: relayErrorCode(error),
      })
      return recovered
    }
  }

  async reconcile(request: RemoteAgentTaskActionRequest): Promise<RemoteAgentTask | null> {
    const accountUserId = this.requireAccountUserId()
    const taskId = this.requireTaskId(request?.taskId)
    await this.reconcileTask(accountUserId, taskId)
    return this.repository().get(accountUserId, taskId)
  }

  async approve(request: RemoteAgentApprovalRequest): Promise<RemoteAgentTask> {
    const accountUserId = this.requireAccountUserId()
    const taskId = this.requireTaskId(request?.taskId)
    const approvalId = requireBoundedString(request?.approvalId, 'approvalId', 256)
    if (request.decision !== 'allow-once' && request.decision !== 'deny') {
      throw new Error('远程审批只支持本次批准或拒绝')
    }
    const task = this.requireTask(accountUserId, taskId)
    const startedAt = Date.now()
    if (
      task.status !== 'awaiting_approval' ||
      task.remoteSessionId == null ||
      task.pendingApprovalId !== approvalId
    ) {
      throw new Error('审批已结束或不属于当前远程任务，请先刷新任务状态')
    }

    const client = this.deps.getRelayClient()
    try {
      const interactions = await this.requestInteractions(client, task)
      if (!interactions.approvals.some((approval) => approval.requestId === approvalId)) {
        await this.reconcileTask(accountUserId, taskId)
        throw new Error('审批已结束或不存在，请刷新任务状态')
      }
      const path = `/v1/sessions/${encodeURIComponent(task.remoteSessionId)}/approvals/${encodeURIComponent(approvalId)}/resolve`
      const response = await client.request(task.targetDeviceId, 'POST', path, {
        decision: request.decision,
      })
      if (
        response.status < 200 ||
        response.status >= 300 ||
        !isRecord(response.body) ||
        response.body.ok !== true
      ) {
        throw new Error('目标电脑未确认审批结果')
      }
      if (request.decision === 'deny') {
        this.updateTask(accountUserId, taskId, {
          status: 'rejected',
          pendingApprovalId: null,
          completedAt: new Date().toISOString(),
          transportState: 'reachable',
        })
        this.scheduleTerminalSubscriptionCleanup(
          accountUserId,
          this.requireTask(accountUserId, taskId),
        )
      } else {
        this.updateTask(accountUserId, taskId, {
          pendingApprovalId: null,
          transportState: 'reachable',
        })
        await this.reconcileTask(accountUserId, taskId)
      }
      log.info('remote task approval confirmed', {
        taskId,
        deviceId: task.targetDeviceId,
        phase: 'approval',
        durationMs: Date.now() - startedAt,
      })
    } catch (error) {
      if (isRelayFailure(error)) this.markUnreachable(accountUserId, taskId)
      log.warn('remote task approval failed', {
        taskId,
        deviceId: task.targetDeviceId,
        phase: 'approval',
        durationMs: Date.now() - startedAt,
        errorCode: relayErrorCode(error),
      })
      throw error
    }
    return this.requireTask(accountUserId, taskId)
  }

  async cancel(request: RemoteAgentTaskActionRequest): Promise<RemoteAgentTask> {
    const accountUserId = this.requireAccountUserId()
    const taskId = this.requireTaskId(request?.taskId)
    const task = this.requireTask(accountUserId, taskId)
    const startedAt = Date.now()
    if (isTerminal(task.status)) return task
    if (task.remoteSessionId == null) {
      const pending =
        this.updateTask(accountUserId, taskId, {
          status: 'cancel_requested',
          pendingApprovalId: null,
        }) ?? task
      await this.reconcileTask(accountUserId, taskId)
      return this.repository().get(accountUserId, taskId) ?? pending
    }

    this.updateTask(accountUserId, taskId, {
      status: 'cancel_requested',
      pendingApprovalId: null,
    })
    const client = this.deps.getRelayClient()
    try {
      const response = await client.request(
        task.targetDeviceId,
        'POST',
        `/v1/sessions/${encodeURIComponent(task.remoteSessionId)}/cancel`,
        {},
      )
      if (
        response.status < 200 ||
        response.status >= 300 ||
        !isRecord(response.body) ||
        response.body.cancelled !== true
      ) {
        this.updateTask(accountUserId, taskId, {
          errorCode: 'REMOTE_CANCEL_REJECTED',
          transportState: 'reachable',
        })
        log.warn('remote task cancellation rejected', {
          taskId,
          deviceId: task.targetDeviceId,
          phase: 'cancel',
          durationMs: Date.now() - startedAt,
          errorCode: 'REMOTE_CANCEL_REJECTED',
        })
        return this.requireTask(accountUserId, taskId)
      }
      this.updateTask(accountUserId, taskId, {
        errorCode: null,
        transportState: 'reachable',
      })
      await this.reconcileTask(accountUserId, taskId, true)
      log.info('remote task cancellation acknowledged', {
        taskId,
        deviceId: task.targetDeviceId,
        phase: 'cancel',
        durationMs: Date.now() - startedAt,
      })
    } catch (error) {
      if (isRelayFailure(error)) this.markUnreachable(accountUserId, taskId)
      log.warn('remote task cancellation failed', {
        taskId,
        deviceId: task.targetDeviceId,
        phase: 'cancel',
        durationMs: Date.now() - startedAt,
        errorCode: relayErrorCode(error),
      })
      throw error
    }
    return this.requireTask(accountUserId, taskId)
  }

  async getHistory(request: RemoteAgentTaskActionRequest): Promise<RemoteAgentTaskHistoryResponse> {
    const accountUserId = this.requireAccountUserId()
    const task = this.requireTask(accountUserId, this.requireTaskId(request?.taskId))
    await this.reconcileTask(accountUserId, task.taskId)
    const refreshed = this.requireTask(accountUserId, task.taskId)
    if (refreshed.remoteSessionId == null) {
      return { taskId: task.taskId, events: [], running: false }
    }
    const snapshot = await this.fetchHistory(this.deps.getRelayClient(), refreshed)
    await this.applyHistoryEvents(accountUserId, refreshed, snapshot.events)
    this.artifacts.markFullyIndexed(task.taskId)
    return {
      taskId: task.taskId,
      events: snapshot.events.map((event) => this.artifacts.toSafeEvent(task.taskId, event)),
      running: snapshot.running,
    }
  }

  async listArtifacts(
    request: RemoteAgentTaskActionRequest,
  ): Promise<RemoteAgentArtifactListResponse> {
    const accountUserId = this.requireAccountUserId()
    const task = this.requireTask(accountUserId, this.requireTaskId(request?.taskId))
    if (!isTerminal(task.status)) {
      await this.reconcileTask(accountUserId, task.taskId)
    }
    await this.loadArtifactReferences(this.requireTask(accountUserId, task.taskId))
    return {
      taskId: task.taskId,
      artifacts: this.artifacts.list(task.taskId),
    }
  }

  async fetchArtifact(request: RemoteAgentArtifactFetchRequest): Promise<RemoteAgentArtifactFile> {
    const accountUserId = this.requireAccountUserId()
    const taskId = this.requireTaskId(request?.taskId)
    const artifactId = requireBoundedString(request?.artifactId, 'artifactId', 64)
    await this.reconcileTask(accountUserId, taskId)
    const task = this.requireTask(accountUserId, taskId)
    await this.loadArtifactReferences(task)
    const remotePath = this.artifacts.getRemotePath(taskId, artifactId)
    if (task.remoteSessionId == null || remotePath == null) {
      throw new Error('远程产物不存在或已不可用')
    }

    const client = this.deps.getRelayClient()
    try {
      const response = await client.request(
        task.targetDeviceId,
        'GET',
        `/v1/attachments/content?path=${encodeURIComponent(remotePath)}`,
        undefined,
        180_000,
      )
      if (response.status < 200 || response.status >= 300 || !isRecord(response.body)) {
        throw new Error('目标电脑未能读取该产物，文件可能已移出允许访问的目录')
      }
      const base64 = response.body.base64
      const mimeType =
        typeof response.body.mimeType === 'string'
          ? response.body.mimeType
          : 'application/octet-stream'
      if (typeof base64 !== 'string') throw new Error('远程产物大小或格式无效')
      return await this.artifacts.save(taskId, task.targetDeviceId, artifactId, mimeType, base64)
    } catch (error) {
      if (isRelayFailure(error)) this.markUnreachable(accountUserId, taskId)
      throw error
    }
  }

  handleRelayStatus(status: RemoteAgentRelayStatus): void {
    if (status.connected) {
      void this.resumeRecoverableTasks().catch((error) => {
        log.warn('remote task background recovery failed', {
          phase: 'resume',
          errorCode: relayErrorCode(error),
        })
      })
      return
    }
    if (status.state === 'stopped') this.clearSubscriptions()
    const accountUserId = this.deps.getCurrentUserId()
    if (accountUserId == null) return
    const transportState: RemoteAgentTransportState =
      status.state === 'stopped' ? 'unknown' : 'unreachable'
    for (const task of this.repository().listRecoverable(accountUserId)) {
      this.updateTask(accountUserId, task.taskId, { transportState })
    }
  }

  handleDevicesChange(response: RemoteAgentDeviceListResponse): void {
    const accountUserId = this.deps.getCurrentUserId()
    if (accountUserId == null) return
    const onlineDeviceIds = new Set(
      response.devices.filter((device) => device.online).map((device) => device.deviceId),
    )
    const tasks = this.repository().listRecoverable(accountUserId)
    for (const task of tasks) {
      const state: RemoteAgentTransportState = onlineDeviceIds.has(task.targetDeviceId)
        ? 'reachable'
        : 'unreachable'
      this.updateTask(accountUserId, task.taskId, { transportState: state })
      if (state === 'reachable') {
        void this.reconcileTask(accountUserId, task.taskId).catch((error) => {
          log.warn('remote task presence recovery failed', {
            taskId: task.taskId,
            deviceId: task.targetDeviceId,
            phase: 'presence-reconcile',
            errorCode: relayErrorCode(error),
          })
        })
      }
    }
  }

  private async ensureRelayAndResume(): Promise<void> {
    const client = this.deps.getRelayClient()
    await client.start()
    if (client.getStatus().connected) await this.resumeRecoverableTasks()
  }

  private async resumeRecoverableTasks(): Promise<void> {
    if (this.resumePromise != null) return this.resumePromise
    const accountUserId = this.deps.getCurrentUserId()
    if (accountUserId == null) return
    const client = this.deps.getRelayClient()
    if (!client.getStatus().connected) return
    this.resumePromise = (async () => {
      const tasks = this.repository().listRecoverable(accountUserId)
      for (let index = 0; index < tasks.length; index += 4) {
        const batch = tasks.slice(index, index + 4)
        await Promise.all(batch.map((task) => this.reconcileTask(accountUserId, task.taskId)))
      }
    })().finally(() => {
      this.resumePromise = null
    })
    return this.resumePromise
  }

  private async recoverAfterDispatchUncertainty(
    accountUserId: string,
    task: RemoteAgentTask,
    client: RemoteAgentRelayClient,
    relayRequest: RemoteAgentDispatchRequest,
  ): Promise<RemoteAgentTask> {
    try {
      const response = await client.request(
        task.targetDeviceId,
        'GET',
        `/v1/remote-agent/tasks/${encodeURIComponent(task.taskId)}`,
        undefined,
        20_000,
      )
      const snapshot =
        response.status >= 200 && response.status < 300 ? parseDispatchStatus(response.body) : null
      if (snapshot != null) {
        const action = getRemoteAgentDispatchRecoveryAction(snapshot, true)
        if (action === 'adopt') {
          const recovered = this.updateFromDispatch(accountUserId, task, snapshot.task!)
          this.ensureSubscription(accountUserId, recovered)
          await this.reconcileTask(accountUserId, task.taskId)
          return this.requireTask(accountUserId, task.taskId)
        }
        if (action === 'wait') {
          this.scheduleDispatchReconcile(accountUserId, task.taskId)
          const recovered =
            snapshot.task == null
              ? task
              : this.updateFromDispatch(accountUserId, task, snapshot.task)
          if (recovered.remoteSessionId != null) this.ensureSubscription(accountUserId, recovered)
          return (
            this.updateTask(accountUserId, task.taskId, {
              transportState: 'reachable',
              errorCode: null,
            }) ?? recovered
          )
        }
      } else if (
        response.status !== 404 &&
        isDefinitiveDispatchRejection(response.status, response.body)
      ) {
        return this.applyRemoteDispatchError(accountUserId, task, response.status, response.body)
      } else if (response.status >= 400 && response.status < 500 && response.status !== 404) {
        return (
          this.updateTask(accountUserId, task.taskId, {
            transportState: 'reachable',
            errorCode: 'REMOTE_EXECUTION_FAILED',
          }) ?? task
        )
      }

      // A reservation can exist without a submitted turn. Replaying the exact body with
      // the same taskId is safe: B serializes that key and resumes its durable phases.
      return await this.retryDispatchOnce(accountUserId, task, client, relayRequest)
    } catch (recoveryError) {
      return (
        this.updateTask(accountUserId, task.taskId, {
          transportState: isRelayFailure(recoveryError) ? 'unreachable' : 'reachable',
          errorCode: relayErrorCode(recoveryError),
        }) ?? task
      )
    }
  }

  private async retryDispatchOnce(
    accountUserId: string,
    task: RemoteAgentTask,
    client: RemoteAgentRelayClient,
    relayRequest: RemoteAgentDispatchRequest,
  ): Promise<RemoteAgentTask> {
    const response = await client.request(
      task.targetDeviceId,
      'POST',
      '/v1/remote-agent/tasks',
      relayRequest,
    )
    const accepted =
      response.status >= 200 && response.status < 300 ? parseDispatchResponse(response.body) : null
    if (accepted != null && accepted.status !== 'dispatching') {
      const recovered = this.updateFromDispatch(accountUserId, task, accepted)
      this.ensureSubscription(accountUserId, recovered)
      await this.reconcileTask(accountUserId, task.taskId)
      return this.requireTask(accountUserId, task.taskId)
    }
    if (isDefinitiveDispatchRejection(response.status, response.body)) {
      return this.applyRemoteDispatchError(accountUserId, task, response.status, response.body)
    }

    const statusResponse = await client.request(
      task.targetDeviceId,
      'GET',
      `/v1/remote-agent/tasks/${encodeURIComponent(task.taskId)}`,
      undefined,
      20_000,
    )
    const snapshot =
      statusResponse.status >= 200 && statusResponse.status < 300
        ? parseDispatchStatus(statusResponse.body)
        : null
    if (snapshot != null) {
      const action = getRemoteAgentDispatchRecoveryAction(snapshot, false)
      if (action === 'adopt') {
        const recovered = this.updateFromDispatch(accountUserId, task, snapshot.task!)
        this.ensureSubscription(accountUserId, recovered)
        await this.reconcileTask(accountUserId, task.taskId)
        return this.requireTask(accountUserId, task.taskId)
      }
      if (action === 'wait') {
        this.scheduleDispatchReconcile(accountUserId, task.taskId)
        const recovered =
          snapshot.task == null ? task : this.updateFromDispatch(accountUserId, task, snapshot.task)
        if (recovered.remoteSessionId != null) this.ensureSubscription(accountUserId, recovered)
        return (
          this.updateTask(accountUserId, task.taskId, {
            transportState: 'reachable',
            errorCode: null,
          }) ?? recovered
        )
      }
      return this.markDispatchInterrupted(accountUserId, task.taskId)
    }
    if (statusResponse.status === 404) {
      return this.markDispatchInterrupted(accountUserId, task.taskId)
    }
    return (
      this.updateTask(accountUserId, task.taskId, {
        transportState: 'reachable',
        errorCode: 'REMOTE_EXECUTION_FAILED',
      }) ?? task
    )
  }

  private async reconcileTask(
    accountUserId: string,
    taskId: string,
    skipPendingCancel = false,
  ): Promise<void> {
    let task = this.repository().get(accountUserId, taskId)
    if (task == null || isTerminal(task.status)) return
    const client = this.deps.getRelayClient()
    if (!client.getStatus().connected) {
      this.markUnreachable(accountUserId, taskId)
      return
    }

    try {
      if (task.remoteSessionId == null || task.status === 'dispatching') {
        const response = await client.request(
          task.targetDeviceId,
          'GET',
          `/v1/remote-agent/tasks/${encodeURIComponent(task.taskId)}`,
        )
        if (response.status === 404) {
          this.markDispatchInterrupted(accountUserId, taskId)
          return
        }
        const snapshot =
          response.status >= 200 && response.status < 300
            ? parseDispatchStatus(response.body)
            : null
        if (snapshot == null) {
          this.applyRemoteDispatchError(accountUserId, task, response.status, response.body)
          return
        }
        const action = getRemoteAgentDispatchRecoveryAction(snapshot, false)
        if (action === 'interrupted') {
          this.markDispatchInterrupted(accountUserId, taskId)
          return
        }
        if (action === 'wait') {
          this.scheduleDispatchReconcile(accountUserId, taskId)
          if (snapshot.task != null) {
            task = this.updateFromDispatch(accountUserId, task, snapshot.task)
            if (task.remoteSessionId != null) this.ensureSubscription(accountUserId, task)
          }
          this.updateTask(accountUserId, taskId, { transportState: 'reachable' })
          return
        }
        if (snapshot.task == null) {
          this.markDispatchInterrupted(accountUserId, taskId)
          return
        }
        task = this.updateFromDispatch(accountUserId, task, snapshot.task)
      }

      if (task.remoteSessionId == null) {
        this.updateTask(accountUserId, taskId, { transportState: 'reachable' })
        return
      }
      this.ensureSubscription(accountUserId, task)
      if (task.status === 'cancel_requested' && !skipPendingCancel) {
        const cancelResponse = await client.request(
          task.targetDeviceId,
          'POST',
          `/v1/sessions/${encodeURIComponent(task.remoteSessionId)}/cancel`,
          {},
        )
        if (
          cancelResponse.status < 200 ||
          cancelResponse.status >= 300 ||
          !isRecord(cancelResponse.body) ||
          cancelResponse.body.cancelled !== true
        ) {
          this.updateTask(accountUserId, taskId, {
            errorCode: 'REMOTE_CANCEL_REJECTED',
            transportState: 'reachable',
          })
          return
        }
        this.updateTask(accountUserId, taskId, {
          errorCode: null,
          transportState: 'reachable',
        })
      }
      const [history, interactions] = await Promise.all([
        this.fetchHistory(client, task),
        this.requestInteractions(client, task),
      ])
      await this.applyHistoryEvents(accountUserId, task, history.events)
      this.artifacts.markFullyIndexed(taskId)
      const latestCursor = this.repository().getLastEventSeq(accountUserId, taskId)
      const historyCursor = history.events.reduce((max, event) => Math.max(max, event.seq), -1)
      const current = this.requireTask(accountUserId, taskId)
      const patch: UpdateRemoteAgentTaskParams = {
        transportState: 'reachable',
        errorCode: null,
      }
      const approval = interactions.approvals
        .slice()
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))[0]
      if (approval != null && current.status !== 'cancel_requested') {
        patch.status = 'awaiting_approval'
        patch.pendingApprovalId = approval.requestId
      } else if (current.status === 'awaiting_approval' && current.pendingApprovalId != null) {
        patch.pendingApprovalId = null
      }

      if (historyCursor >= latestCursor) {
        const eventStatus = getTerminalEventStatus(history.events, current.status, history.running)
        if (eventStatus != null) {
          patch.status = eventStatus
          patch.completedAt = new Date().toISOString()
          patch.pendingApprovalId = null
          if (eventStatus === 'failed') patch.errorCode = 'REMOTE_EXECUTION_FAILED'
        } else if (history.running) {
          if (current.status !== 'cancel_requested') patch.status = 'running'
        } else if (
          !interactions.approvals.length &&
          current.status !== 'cancel_requested' &&
          current.status !== 'awaiting_approval' &&
          current.status === 'dispatching'
        ) {
          patch.status = 'queued'
        }
      }
      const updated = this.updateTask(accountUserId, taskId, patch)
      if (updated != null && isTerminal(updated.status)) {
        this.scheduleTerminalSubscriptionCleanup(accountUserId, updated)
      }
    } catch (error) {
      if (isRelayFailure(error)) this.markUnreachable(accountUserId, taskId)
      else this.updateTask(accountUserId, taskId, { transportState: 'reachable' })
      log.warn('remote task reconciliation unavailable', {
        taskId,
        deviceId: task.targetDeviceId,
        phase: 'reconcile',
        errorCode: relayErrorCode(error),
      })
    }
  }

  private async fetchHistory(
    client: RemoteAgentRelayClient,
    task: RemoteAgentTask,
  ): Promise<RemoteAgentHistorySnapshot> {
    if (task.remoteSessionId == null) return { events: [], running: false }
    const response = await client.request(
      task.targetDeviceId,
      'GET',
      `/v1/sessions/${encodeURIComponent(task.remoteSessionId)}/messages?limit=400&turnLimit=50&eventLimit=${MAX_HISTORY_EVENTS}`,
    )
    if (
      response.status < 200 ||
      response.status >= 300 ||
      !isRecord(response.body) ||
      !Array.isArray(response.body.events) ||
      typeof response.body.running !== 'boolean'
    ) {
      throw new Error('目标电脑未返回有效会话历史')
    }
    return {
      events: response.body.events.filter(isMobileBridgeEvent),
      running: response.body.running,
    }
  }

  private async requestInteractions(
    client: RemoteAgentRelayClient,
    task: RemoteAgentTask,
  ): Promise<RemoteAgentInteractionsSnapshot> {
    if (task.remoteSessionId == null) return { approvals: [] }
    const response = await client.request(
      task.targetDeviceId,
      'GET',
      `/v1/sessions/${encodeURIComponent(task.remoteSessionId)}/interactions`,
    )
    if (response.status < 200 || response.status >= 300 || !isRecord(response.body)) {
      throw new Error('目标电脑未返回有效的挂起审批')
    }
    if (!Array.isArray(response.body.approvals)) {
      throw new Error('目标电脑返回的挂起审批格式无效')
    }
    const approvals = response.body.approvals.flatMap((value) => {
      if (
        !isRecord(value) ||
        typeof value.requestId !== 'string' ||
        !value.requestId.trim() ||
        value.requestId.length > 256
      )
        return []
      return [
        {
          requestId: value.requestId,
          createdAt: typeof value.createdAt === 'string' ? value.createdAt : '',
        },
      ]
    })
    if (approvals.length !== response.body.approvals.length) {
      throw new Error('目标电脑返回的挂起审批格式无效')
    }
    return { approvals }
  }

  private async applyHistoryEvents(
    accountUserId: string,
    task: RemoteAgentTask,
    events: MobileBridgeEvent[],
  ): Promise<void> {
    if (this.deps.getCurrentUserId() !== accountUserId) return
    const validEvents = events.filter(isMobileBridgeEvent)
    if (validEvents.length > 0) this.artifacts.invalidateIndex(task.taskId)
    await this.enqueueEvents(task.taskId, async () => {
      if (this.deps.getCurrentUserId() !== accountUserId) return
      const current = this.repository().get(accountUserId, task.taskId)
      if (current == null) return
      const cursor = this.repository().getLastEventSeq(accountUserId, task.taskId)
      const sorted = validEvents.slice().sort((left, right) => left.seq - right.seq)
      const newEvents: RemoteAgentTaskEvent[] = []
      let nextCursor = cursor
      let nextStatus: RemoteAgentTaskStatus | undefined
      let summary: string | undefined
      let completedAt: string | undefined
      for (const event of sorted) {
        this.artifacts.indexEvent(task.taskId, event)
        if (event.seq <= nextCursor) continue
        nextCursor = event.seq
        const status = statusFromEvent(event)
        if (
          status != null &&
          !isTerminal(current.status) &&
          (current.status !== 'cancel_requested' || isTerminal(status))
        ) {
          nextStatus = status
          if (isTerminal(status)) completedAt = event.timestamp
        }
        if (
          event.type === 'assistant_message' &&
          event.isFinal &&
          typeof event.content === 'string'
        ) {
          summary = truncate(event.content.trim(), 2_000)
        }
        newEvents.push(this.artifacts.toSafeEvent(task.taskId, event))
      }
      if (nextCursor > cursor || nextStatus != null || summary != null) {
        const patch: UpdateRemoteAgentTaskParams = { lastEventSeq: nextCursor }
        if (nextStatus != null) patch.status = nextStatus
        if (summary != null) patch.resultSummary = summary
        if (completedAt != null) patch.completedAt = completedAt
        if (isTerminal(nextStatus ?? current.status)) patch.pendingApprovalId = null
        this.updateTask(accountUserId, task.taskId, patch)
      }
      if (newEvents.length > 0) this.deps.onTaskEvents(newEvents)
    })
  }

  private async loadArtifactReferences(task: RemoteAgentTask): Promise<void> {
    if (task.remoteSessionId == null || this.artifacts.isFullyIndexed(task.taskId)) return
    const snapshot = await this.fetchHistory(this.deps.getRelayClient(), task)
    for (const event of snapshot.events) this.artifacts.indexEvent(task.taskId, event)
    this.artifacts.markFullyIndexed(task.taskId)
  }

  private ensureSubscription(accountUserId: string, task: RemoteAgentTask): void {
    if (task.remoteSessionId == null || this.subscriptions.has(task.taskId)) return
    const unsubscribe = this.deps
      .getRelayClient()
      .subscribe(task.targetDeviceId, task.remoteSessionId, (events) => {
        void this.applyHistoryEvents(accountUserId, task, events)
          .then(() => {
            const current = this.repository().get(accountUserId, task.taskId)
            if (current != null && isTerminal(current.status)) {
              this.scheduleTerminalSubscriptionCleanup(accountUserId, current)
            } else if (
              events.some((event) => {
                const status = statusFromEvent(event)
                return status != null && isTerminal(status)
              })
            ) {
              void this.reconcileTask(accountUserId, task.taskId)
            }
            if (
              events.some(
                (event) => event.type === 'agent_status' && event.status === 'waiting_permission',
              )
            ) {
              void this.reconcileTask(accountUserId, task.taskId)
            }
            if (events.some((event) => event.type === 'agent_status' && event.status === 'idle')) {
              void this.reconcileTask(accountUserId, task.taskId)
            }
          })
          .catch((error) => {
            log.warn('remote task event processing failed', {
              taskId: task.taskId,
              deviceId: task.targetDeviceId,
              phase: 'event',
              errorCode: relayErrorCode(error),
            })
          })
      })
    this.subscriptions.set(task.taskId, unsubscribe)
  }

  private removeSubscription(taskId: string): void {
    const timer = this.terminalCleanupTimers.get(taskId)
    if (timer != null) clearTimeout(timer)
    this.terminalCleanupTimers.delete(taskId)
    this.subscriptions.get(taskId)?.()
    this.subscriptions.delete(taskId)
  }

  private clearSubscriptions(): void {
    for (const timer of this.terminalCleanupTimers.values()) clearTimeout(timer)
    this.terminalCleanupTimers.clear()
    for (const unsubscribe of this.subscriptions.values()) unsubscribe()
    this.subscriptions.clear()
  }

  private scheduleDispatchReconcile(accountUserId: string, taskId: string): void {
    if (this.dispatchRecoveryTimers.has(taskId)) return
    const attempts = this.dispatchRecoveryAttempts.get(taskId) ?? 0
    if (attempts >= MAX_DISPATCH_RECOVERY_RETRIES) return
    this.dispatchRecoveryAttempts.set(taskId, attempts + 1)
    const timer = setTimeout(() => {
      this.dispatchRecoveryTimers.delete(taskId)
      void this.reconcileTask(accountUserId, taskId).catch((error) => {
        log.warn('remote task dispatch recovery retry failed', {
          taskId,
          phase: 'dispatch-recovery',
          errorCode: relayErrorCode(error),
        })
      })
    }, DISPATCH_RECOVERY_RETRY_DELAY_MS)
    this.dispatchRecoveryTimers.set(taskId, timer)
  }

  private clearDispatchReconcile(taskId: string): void {
    const timer = this.dispatchRecoveryTimers.get(taskId)
    if (timer != null) clearTimeout(timer)
    this.dispatchRecoveryTimers.delete(taskId)
    this.dispatchRecoveryAttempts.delete(taskId)
  }

  private scheduleTerminalSubscriptionCleanup(accountUserId: string, task: RemoteAgentTask): void {
    const previous = this.terminalCleanupTimers.get(task.taskId)
    if (previous != null) clearTimeout(previous)
    const timer = setTimeout(() => {
      this.terminalCleanupTimers.delete(task.taskId)
      const latest = this.repository().get(accountUserId, task.taskId)
      if (latest != null) {
        void this.loadArtifactReferences(latest)
          .catch((error) => {
            log.warn('final remote artifact index refresh failed', {
              taskId: task.taskId,
              deviceId: task.targetDeviceId,
              phase: 'artifact-index',
              errorCode: relayErrorCode(error),
            })
          })
          .finally(() => this.removeSubscription(task.taskId))
        return
      }
      this.removeSubscription(task.taskId)
    }, TERMINAL_SUBSCRIPTION_GRACE_MS)
    this.terminalCleanupTimers.set(task.taskId, timer)
  }

  private updateFromDispatch(
    accountUserId: string,
    current: RemoteAgentTask,
    remote: RemoteAgentDispatchResponse,
  ): RemoteAgentTask {
    if (remote.taskId !== current.taskId) throw new Error('目标电脑返回了不匹配的 taskId')
    if (remote.status !== 'dispatching') this.clearDispatchReconcile(current.taskId)
    return (
      this.updateTask(accountUserId, current.taskId, {
        remoteSessionId: remote.remoteSessionId,
        ...(current.status === 'dispatching' && remote.status !== 'dispatching'
          ? { status: remote.status }
          : {}),
        transportState: 'reachable',
        errorCode: null,
      }) ?? current
    )
  }

  private applyRemoteDispatchError(
    accountUserId: string,
    current: RemoteAgentTask,
    status: number,
    body: unknown,
  ): RemoteAgentTask {
    const code = readRemoteErrorCode(body)
    if (status === 404 && code === 'REMOTE_TARGET_NOT_FOUND') {
      return (
        this.updateTask(accountUserId, current.taskId, {
          status: 'failed',
          errorCode: 'REMOTE_TARGET_NOT_FOUND',
          completedAt: new Date().toISOString(),
          transportState: 'reachable',
        }) ?? current
      )
    }
    if (status === 409 && code === 'TASK_ID_CONFLICT') {
      return (
        this.updateTask(accountUserId, current.taskId, {
          status: 'failed',
          errorCode: 'TASK_ID_CONFLICT',
          completedAt: new Date().toISOString(),
          transportState: 'reachable',
        }) ?? current
      )
    }
    if (status === 401) {
      return (
        this.updateTask(accountUserId, current.taskId, {
          status: 'failed',
          completedAt: new Date().toISOString(),
          transportState: 'reachable',
          errorCode: 'REMOTE_AUTH_REQUIRED',
        }) ?? current
      )
    }
    if (status >= 400 && status < 500) {
      return (
        this.updateTask(accountUserId, current.taskId, {
          status: 'failed',
          completedAt: new Date().toISOString(),
          transportState: 'reachable',
          errorCode: 'REMOTE_EXECUTION_FAILED',
        }) ?? current
      )
    }
    return (
      this.updateTask(accountUserId, current.taskId, {
        transportState: 'reachable',
        errorCode: 'REMOTE_EXECUTION_FAILED',
      }) ?? current
    )
  }

  private markDispatchInterrupted(accountUserId: string, taskId: string): RemoteAgentTask {
    const current = this.repository().get(accountUserId, taskId)
    if (current == null) throw new Error('远程任务不存在或不属于当前 Spark 平台账号')
    if (isTerminal(current.status)) return current
    this.clearDispatchReconcile(taskId)
    const task = this.updateTask(accountUserId, taskId, {
      status: 'failed',
      pendingApprovalId: null,
      errorCode: 'REMOTE_DISPATCH_INTERRUPTED',
      completedAt: new Date().toISOString(),
      transportState: 'reachable',
    })
    if (task != null) {
      log.warn('remote task dispatch interrupted before submission', {
        taskId,
        deviceId: task.targetDeviceId,
        phase: 'dispatch-recovery',
        errorCode: 'REMOTE_DISPATCH_INTERRUPTED',
      })
      return task
    }
    return this.requireTask(accountUserId, taskId)
  }

  private markUnreachable(accountUserId: string, taskId: string): void {
    this.updateTask(accountUserId, taskId, { transportState: 'unreachable' })
  }

  private updateTask(
    accountUserId: string,
    taskId: string,
    patch: UpdateRemoteAgentTaskParams,
  ): RemoteAgentTask | null {
    const before = this.repository().get(accountUserId, taskId)
    const task = this.repository().update(accountUserId, taskId, patch)
    if (task != null) {
      if (task.status !== 'dispatching') this.clearDispatchReconcile(taskId)
      this.deps.onTaskUpdated(task)
      if (before != null && before.status !== task.status) {
        log.info('remote task lifecycle status changed', {
          taskId,
          deviceId: task.targetDeviceId,
          phase: 'status',
          status: task.status,
        })
      }
    }
    return task
  }

  private requireTask(accountUserId: string, taskId: string): RemoteAgentTask {
    const task = this.repository().get(accountUserId, taskId)
    if (task == null) throw new Error('远程任务不存在或不属于当前 Spark 平台账号')
    return task
  }

  private requireAccountUserId(): string {
    const userId = this.deps.getCurrentUserId()
    if (userId == null || !userId.trim()) throw new Error('请先登录 Spark 平台账号')
    return userId
  }

  private requireTaskId(value: unknown): string {
    const taskId = requireBoundedString(value, 'taskId', 64)
    if (!isValidRemoteAgentTaskId(taskId)) throw new Error('taskId 必须是 UUID')
    return taskId
  }

  private repository(): RemoteAgentTaskRepository {
    return new RemoteAgentTaskRepository(this.deps.getDatabase())
  }

  private enqueueEvents(taskId: string, work: () => Promise<void>): Promise<void> {
    const previous = this.eventQueues.get(taskId) ?? Promise.resolve()
    const next = previous.catch(() => undefined).then(work)
    this.eventQueues.set(taskId, next)
    void next
      .finally(() => {
        if (this.eventQueues.get(taskId) === next) this.eventQueues.delete(taskId)
      })
      .catch(() => undefined)
    return next
  }
}

function parseDispatchResponse(value: unknown): RemoteAgentDispatchResponse | null {
  if (
    !isRecord(value) ||
    typeof value.taskId !== 'string' ||
    !(value.remoteSessionId == null || typeof value.remoteSessionId === 'string') ||
    !(value.turnId == null || typeof value.turnId === 'string') ||
    (value.status !== 'dispatching' && value.status !== 'queued' && value.status !== 'running') ||
    (value.status !== 'dispatching' &&
      (typeof value.remoteSessionId !== 'string' || value.remoteSessionId.length === 0))
  ) {
    return null
  }
  return {
    taskId: value.taskId,
    remoteSessionId: value.remoteSessionId ?? null,
    turnId: value.turnId ?? null,
    status: value.status,
  }
}

function parseDispatchStatus(value: unknown): RemoteAgentDispatchStatusResponse | null {
  if (!isRecord(value) || !('task' in value)) return null
  const task = value.task == null ? null : parseDispatchResponse(value.task)
  if (value.task != null && task == null) return null
  return {
    task,
    ...(typeof value.dispatchActive === 'boolean' ? { dispatchActive: value.dispatchActive } : {}),
  }
}

function isDefinitiveDispatchRejection(status: number, body: unknown): boolean {
  if (status < 400 || status >= 500) return false
  const code = readRemoteErrorCode(body)
  return code !== 'REMOTE_REQUEST_TIMEOUT'
}

function readRemoteErrorCode(value: unknown): string | null {
  if (!isRecord(value) || !isRecord(value.error) || typeof value.error.code !== 'string')
    return null
  return value.error.code
}

function isMobileBridgeEvent(value: unknown): value is MobileBridgeEvent {
  if (!isRecord(value)) return false
  const baseIsValid =
    typeof value.id === 'string' &&
    typeof value.seq === 'number' &&
    Number.isSafeInteger(value.seq) &&
    typeof value.turnId === 'string' &&
    typeof value.timestamp === 'string'
  if (!baseIsValid) return false
  if (
    value.type !== 'user_message' &&
    value.type !== 'assistant_message' &&
    value.type !== 'agent_thinking' &&
    value.type !== 'tool_call' &&
    value.type !== 'tool_result' &&
    value.type !== 'agent_status' &&
    value.type !== 'agent_error' &&
    value.type !== 'presented_files'
  ) {
    return false
  }
  if ('content' in value && typeof value.content !== 'string') return false
  if ('status' in value && typeof value.status !== 'string') return false
  if (value.type === 'presented_files' && value.files != null) {
    if (
      !Array.isArray(value.files) ||
      !value.files.every(
        (file) =>
          isRecord(file) &&
          typeof file.path === 'string' &&
          (file.title == null || typeof file.title === 'string'),
      )
    ) {
      return false
    }
  }
  if (value.type === 'user_message' && value.attachments != null) {
    if (
      !Array.isArray(value.attachments) ||
      !value.attachments.every(
        (attachment) =>
          isRecord(attachment) &&
          (attachment.type === 'image' || attachment.type === 'file') &&
          typeof attachment.path === 'string' &&
          (attachment.name == null || typeof attachment.name === 'string'),
      )
    ) {
      return false
    }
  }
  return true
}

function statusFromEvent(event: MobileBridgeEvent): RemoteAgentTaskStatus | null {
  if (event.type !== 'agent_status') return null
  switch (event.status) {
    case 'thinking':
    case 'calling_tool':
      return 'running'
    case 'waiting_permission':
      return 'awaiting_approval'
    case 'completed':
      return 'completed'
    case 'error':
      return 'failed'
    case 'cancelled':
      return 'cancelled'
    default:
      return null
  }
}

function getTerminalEventStatus(
  events: MobileBridgeEvent[],
  currentStatus: RemoteAgentTaskStatus,
  running: boolean,
): RemoteAgentTaskStatus | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event == null || event.type !== 'agent_status') continue
    const status = statusFromEvent(event)
    if (status != null && isTerminal(status)) return status
    if (event.status === 'idle' && !running) {
      for (let previousIndex = index - 1; previousIndex >= 0; previousIndex -= 1) {
        const previous = events[previousIndex]
        if (
          previous == null ||
          previous.type !== 'agent_status' ||
          previous.turnId !== event.turnId
        )
          continue
        const previousStatus = statusFromEvent(previous)
        if (previousStatus != null && isTerminal(previousStatus)) return previousStatus
      }
      if (currentStatus === 'cancel_requested') return 'cancelled'
      if (events.some((candidate) => candidate.type === 'assistant_message' && candidate.isFinal)) {
        return 'completed'
      }
    }
    return null
  }
  return null
}

function isTerminal(status: RemoteAgentTaskStatus): boolean {
  return TERMINAL_STATUSES.has(status)
}

function isRelayFailure(error: unknown): boolean {
  return error instanceof RemoteAgentRelayError
}

function relayErrorCode(error: unknown): RemoteAgentTask['errorCode'] {
  if (error instanceof RemoteAgentRelayError) {
    return error.code === 'TIMEOUT' ? 'REMOTE_REQUEST_TIMEOUT' : 'DEVICE_UNREACHABLE'
  }
  return 'REMOTE_EXECUTION_FAILED'
}

function truncate(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}…`
}
