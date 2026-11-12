import { BaseRepository } from './base.repository.js'
import type { SparkDatabase } from '../database.js'
import type { RemoteCollaborationOperationStatus } from '@spark/protocol'

export interface RemoteAgentCollaborationLinkRow {
  account_user_id: string
  link_id: string
  source_device_id: string
  source_session_id: string
  target_device_id: string
  target_project_id: string
  target_agent_id: string
  remote_session_id: string | null
  status: 'opening' | 'ready' | 'unreachable'
  created_at: string
  updated_at: string
}

export interface RemoteAgentCollaborationOperationRow {
  account_user_id: string
  operation_id: string
  link_id: string
  request_fingerprint: string
  turn_id: string | null
  delivery_turn_id: string | null
  status: RemoteCollaborationOperationStatus
  delivery_state: 'pending' | 'submitted' | 'suppressed' | 'failed'
  created_at: string
  updated_at: string
}

export interface RemoteAgentCollaborationArtifactRow {
  account_user_id: string
  artifact_ref: string
  link_id: string
  direction: 'input' | 'output'
  remote_path: string | null
  name: string
  mime_type: string
  size_bytes: number
  sha256: string | null
  created_at: string
}

export interface CreateRemoteAgentCollaborationLinkParams {
  accountUserId: string
  linkId: string
  sourceDeviceId: string
  sourceSessionId: string
  targetDeviceId: string
  targetProjectId: string
  targetAgentId: string
}

export class RemoteAgentCollaborationConflictError extends Error {
  constructor(id: string, kind: 'link' | 'operation' | 'artifact') {
    super(`远程协作 ${kind} 标识已绑定到其他内容：${id}`)
    this.name = 'RemoteAgentCollaborationConflictError'
  }
}

const TERMINAL_OPERATION_STATUSES = new Set<RemoteCollaborationOperationStatus>([
  'completed',
  'failed',
  'cancelled',
])

export class RemoteAgentCollaborationRepository extends BaseRepository {
  constructor(db: SparkDatabase) {
    super(db, 'remote_agent_collaboration_links')
  }

  getLink(accountUserId: string, linkId: string): RemoteAgentCollaborationLinkRow | null {
    const row = this.raw
      .prepare(
        'SELECT * FROM remote_agent_collaboration_links WHERE account_user_id = ? AND link_id = ?',
      )
      .get(accountUserId, linkId) as RemoteAgentCollaborationLinkRow | undefined
    return row ?? null
  }

  getOrCreateLink(params: CreateRemoteAgentCollaborationLinkParams): {
    link: RemoteAgentCollaborationLinkRow
    created: boolean
  } {
    const now = new Date().toISOString()
    const result = this.raw
      .prepare(
        `INSERT INTO remote_agent_collaboration_links (
           account_user_id, link_id, source_device_id, source_session_id, target_device_id,
           target_project_id, target_agent_id, status, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 'opening', ?, ?)
         ON CONFLICT(account_user_id, link_id) DO NOTHING`,
      )
      .run(
        params.accountUserId,
        params.linkId,
        params.sourceDeviceId,
        params.sourceSessionId,
        params.targetDeviceId,
        params.targetProjectId,
        params.targetAgentId,
        now,
        now,
      )
    const link = this.getLink(params.accountUserId, params.linkId)
    if (link == null) throw new Error(`远程协作关联写入后未找到：${params.linkId}`)
    if (
      link.source_device_id !== params.sourceDeviceId ||
      link.source_session_id !== params.sourceSessionId ||
      link.target_device_id !== params.targetDeviceId ||
      link.target_project_id !== params.targetProjectId ||
      link.target_agent_id !== params.targetAgentId
    ) {
      throw new RemoteAgentCollaborationConflictError(params.linkId, 'link')
    }
    return { link, created: result.changes > 0 }
  }

  listLinks(
    accountUserId: string,
    sourceSessionId: string,
    targetDeviceId?: string,
    limit = 100,
  ): RemoteAgentCollaborationLinkRow[] {
    const boundedLimit = Math.max(
      1,
      Math.min(500, Math.trunc(Number.isFinite(limit) ? limit : 100)),
    )
    if (targetDeviceId != null) {
      return this.raw
        .prepare(
          `SELECT * FROM remote_agent_collaboration_links
           WHERE account_user_id = ? AND source_session_id = ? AND target_device_id = ?
           ORDER BY updated_at DESC, link_id ASC LIMIT ?`,
        )
        .all(
          accountUserId,
          sourceSessionId,
          targetDeviceId,
          boundedLimit,
        ) as RemoteAgentCollaborationLinkRow[]
    }
    return this.raw
      .prepare(
        `SELECT * FROM remote_agent_collaboration_links
         WHERE account_user_id = ? AND source_session_id = ?
         ORDER BY updated_at DESC, link_id ASC LIMIT ?`,
      )
      .all(accountUserId, sourceSessionId, boundedLimit) as RemoteAgentCollaborationLinkRow[]
  }

  setRemoteSessionId(
    accountUserId: string,
    linkId: string,
    remoteSessionId: string,
  ): RemoteAgentCollaborationLinkRow {
    this.raw
      .prepare(
        `UPDATE remote_agent_collaboration_links
         SET remote_session_id = ?, status = 'ready', updated_at = ?
         WHERE account_user_id = ? AND link_id = ?
           AND (remote_session_id IS NULL OR remote_session_id = ?)`,
      )
      .run(remoteSessionId, new Date().toISOString(), accountUserId, linkId, remoteSessionId)
    const link = this.getLink(accountUserId, linkId)
    if (link == null) throw new Error(`远程协作关联不存在：${linkId}`)
    if (link.remote_session_id !== remoteSessionId) {
      throw new RemoteAgentCollaborationConflictError(linkId, 'link')
    }
    return link
  }

  setLinkStatus(
    accountUserId: string,
    linkId: string,
    status: RemoteAgentCollaborationLinkRow['status'],
  ): void {
    this.raw
      .prepare(
        'UPDATE remote_agent_collaboration_links SET status = ?, updated_at = ? WHERE account_user_id = ? AND link_id = ?',
      )
      .run(status, new Date().toISOString(), accountUserId, linkId)
  }

  reserveOperation(
    accountUserId: string,
    operationId: string,
    linkId: string,
    requestFingerprint: string,
  ): { operation: RemoteAgentCollaborationOperationRow; created: boolean } {
    if (!/^[0-9a-f]{64}$/.test(requestFingerprint)) {
      throw new Error('远程协作 requestFingerprint 必须是 64 位小写 SHA-256')
    }
    const now = new Date().toISOString()
    const result = this.raw
      .prepare(
        `INSERT INTO remote_agent_collaboration_operations (
           account_user_id, operation_id, link_id, request_fingerprint, status, created_at, updated_at
         ) VALUES (?, ?, ?, ?, 'submitting', ?, ?)
         ON CONFLICT(account_user_id, operation_id) DO NOTHING`,
      )
      .run(accountUserId, operationId, linkId, requestFingerprint, now, now)
    const operation = this.getOperation(accountUserId, operationId)
    if (operation == null) throw new Error(`远程协作操作写入后未找到：${operationId}`)
    if (operation.link_id !== linkId || operation.request_fingerprint !== requestFingerprint) {
      throw new RemoteAgentCollaborationConflictError(operationId, 'operation')
    }
    return { operation, created: result.changes > 0 }
  }

  getOperation(
    accountUserId: string,
    operationId: string,
  ): RemoteAgentCollaborationOperationRow | null {
    const row = this.raw
      .prepare(
        'SELECT * FROM remote_agent_collaboration_operations WHERE account_user_id = ? AND operation_id = ?',
      )
      .get(accountUserId, operationId) as RemoteAgentCollaborationOperationRow | undefined
    return row ?? null
  }

  listOperationsByLink(
    accountUserId: string,
    linkId: string,
    limit = 100,
  ): RemoteAgentCollaborationOperationRow[] {
    const boundedLimit = Math.max(
      1,
      Math.min(500, Math.trunc(Number.isFinite(limit) ? limit : 100)),
    )
    return this.raw
      .prepare(
        `SELECT * FROM remote_agent_collaboration_operations
         WHERE account_user_id = ? AND link_id = ?
         ORDER BY created_at DESC, operation_id ASC LIMIT ?`,
      )
      .all(accountUserId, linkId, boundedLimit) as RemoteAgentCollaborationOperationRow[]
  }

  setOperationState(
    accountUserId: string,
    operationId: string,
    patch: { status: RemoteCollaborationOperationStatus; turnId?: string | null },
  ): RemoteAgentCollaborationOperationRow {
    const current = this.getOperation(accountUserId, operationId)
    if (current == null) throw new Error(`远程协作操作不存在：${operationId}`)
    if (TERMINAL_OPERATION_STATUSES.has(current.status)) return current
    this.raw
      .prepare(
        `UPDATE remote_agent_collaboration_operations
         SET status = ?, turn_id = COALESCE(?, turn_id), updated_at = ?
         WHERE account_user_id = ? AND operation_id = ?`,
      )
      .run(patch.status, patch.turnId ?? null, new Date().toISOString(), accountUserId, operationId)
    const updated = this.getOperation(accountUserId, operationId)
    if (updated == null) throw new Error(`远程协作操作更新后未找到：${operationId}`)
    return updated
  }

  listPendingDeliveries(accountUserId: string): Array<{
    operation: RemoteAgentCollaborationOperationRow
    link: RemoteAgentCollaborationLinkRow
  }> {
    const operations = this.raw
      .prepare(
        `SELECT * FROM remote_agent_collaboration_operations
         WHERE account_user_id = ? AND delivery_state = 'pending'
         ORDER BY updated_at ASC, operation_id ASC LIMIT 500`,
      )
      .all(accountUserId) as RemoteAgentCollaborationOperationRow[]
    return operations.flatMap((operation) => {
      const link = this.getLink(accountUserId, operation.link_id)
      return link?.remote_session_id != null ? [{ operation, link }] : []
    })
  }

  ensureDeliveryTurnId(
    accountUserId: string,
    operationId: string,
    deliveryTurnId: string,
  ): RemoteAgentCollaborationOperationRow {
    this.raw
      .prepare(
        `UPDATE remote_agent_collaboration_operations
         SET delivery_turn_id = COALESCE(delivery_turn_id, ?), updated_at = ?
         WHERE account_user_id = ? AND operation_id = ?`,
      )
      .run(deliveryTurnId, new Date().toISOString(), accountUserId, operationId)
    const operation = this.getOperation(accountUserId, operationId)
    if (operation == null || operation.delivery_turn_id !== deliveryTurnId) {
      throw new RemoteAgentCollaborationConflictError(operationId, 'operation')
    }
    return operation
  }

  markDeliveryState(
    accountUserId: string,
    operationId: string,
    state: Exclude<RemoteAgentCollaborationOperationRow['delivery_state'], 'pending'>,
  ): void {
    this.raw
      .prepare(
        `UPDATE remote_agent_collaboration_operations
         SET delivery_state = ?, updated_at = ?
         WHERE account_user_id = ? AND operation_id = ? AND delivery_state = 'pending'`,
      )
      .run(state, new Date().toISOString(), accountUserId, operationId)
  }

  insertArtifact(params: {
    accountUserId: string
    artifactRef: string
    linkId: string
    direction: 'input' | 'output'
    remotePath: string | null
    name: string
    mimeType: string
    sizeBytes: number
    sha256: string | null
  }): RemoteAgentCollaborationArtifactRow {
    if (
      (params.sha256 != null && !/^[0-9a-f]{64}$/.test(params.sha256)) ||
      !Number.isSafeInteger(params.sizeBytes) ||
      params.sizeBytes < 0
    ) {
      throw new Error('远程协作附件元数据无效')
    }
    const now = new Date().toISOString()
    this.raw
      .prepare(
        `INSERT INTO remote_agent_collaboration_artifacts (
           account_user_id, artifact_ref, link_id, direction, remote_path,
           name, mime_type, size_bytes, sha256, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(account_user_id, artifact_ref) DO NOTHING`,
      )
      .run(
        params.accountUserId,
        params.artifactRef,
        params.linkId,
        params.direction,
        params.remotePath,
        params.name,
        params.mimeType,
        params.sizeBytes,
        params.sha256,
        now,
      )
    const artifact = this.getArtifact(params.accountUserId, params.artifactRef)
    if (artifact == null) throw new Error(`远程协作附件写入后未找到：${params.artifactRef}`)
    if (
      artifact.link_id !== params.linkId ||
      artifact.direction !== params.direction ||
      (params.sha256 != null && artifact.sha256 !== params.sha256) ||
      artifact.name !== params.name ||
      artifact.mime_type !== params.mimeType ||
      artifact.size_bytes !== params.sizeBytes ||
      (params.remotePath != null && artifact.remote_path !== params.remotePath)
    ) {
      throw new RemoteAgentCollaborationConflictError(params.artifactRef, 'artifact')
    }
    return artifact
  }

  setArtifactContentMetadata(
    accountUserId: string,
    artifactRef: string,
    sizeBytes: number,
    sha256: string,
    mimeType: string,
  ): void {
    if (
      !Number.isSafeInteger(sizeBytes) ||
      sizeBytes < 0 ||
      !/^[0-9a-f]{64}$/.test(sha256) ||
      !mimeType.trim()
    ) {
      throw new Error('远程协作产物元数据无效')
    }
    this.raw
      .prepare(
        `UPDATE remote_agent_collaboration_artifacts
         SET size_bytes = ?, sha256 = ?, mime_type = ?
         WHERE account_user_id = ? AND artifact_ref = ? AND direction = 'output'`,
      )
      .run(sizeBytes, sha256, mimeType, accountUserId, artifactRef)
  }

  getArtifact(
    accountUserId: string,
    artifactRef: string,
  ): RemoteAgentCollaborationArtifactRow | null {
    const row = this.raw
      .prepare(
        'SELECT * FROM remote_agent_collaboration_artifacts WHERE account_user_id = ? AND artifact_ref = ?',
      )
      .get(accountUserId, artifactRef) as RemoteAgentCollaborationArtifactRow | undefined
    return row ?? null
  }

  listArtifacts(
    accountUserId: string,
    linkId: string,
    direction?: 'input' | 'output',
  ): RemoteAgentCollaborationArtifactRow[] {
    if (direction != null) {
      return this.raw
        .prepare(
          `SELECT * FROM remote_agent_collaboration_artifacts
           WHERE account_user_id = ? AND link_id = ? AND direction = ?
           ORDER BY created_at ASC, artifact_ref ASC`,
        )
        .all(accountUserId, linkId, direction) as RemoteAgentCollaborationArtifactRow[]
    }
    return this.raw
      .prepare(
        `SELECT * FROM remote_agent_collaboration_artifacts
         WHERE account_user_id = ? AND link_id = ? ORDER BY created_at ASC, artifact_ref ASC`,
      )
      .all(accountUserId, linkId) as RemoteAgentCollaborationArtifactRow[]
  }
}
