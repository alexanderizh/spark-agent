import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { SessionRepository } from '@spark/storage'
import type { SessionPermissionMode } from '@spark/protocol'
import type { SessionService } from '../session.service.js'
import { normalizeAgentAdapter } from './engine-kinds.js'

type DispatchResult =
  | { accepted: true; sessionId: string; turnId: string }
  | { accepted: false; sessionId: string; error: string }

function unacceptedDispatch(sessionId: string): DispatchResult {
  return {
    accepted: false,
    sessionId,
    error:
      'Session created but task was not accepted. Retry with the same request key, title and task.',
  }
}

function dispatchSessionId(sourceId: string, requestKey: string): string {
  // RFC 9562 UUIDv8: deterministic SHA-256 identity with UUID version/variant bits.
  const bytes = createHash('sha256')
    .update(JSON.stringify(['session-dispatch', sourceId, requestKey]))
    .digest()
  bytes[6] = (bytes[6]! & 0x0f) | 0x80
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  return [
    bytes.subarray(0, 4),
    bytes.subarray(4, 6),
    bytes.subarray(6, 8),
    bytes.subarray(8, 10),
    bytes.subarray(10, 16),
  ]
    .map((part) => part.toString('hex'))
    .join('-')
}

function dispatchPermission(
  adapter: ReturnType<typeof normalizeAgentAdapter>,
  sourceMode: string,
): SessionPermissionMode {
  if (adapter === 'codex') return 'codex-default'
  if (adapter === 'spark') return sourceMode === 'spark-plan' ? 'spark-plan' : 'spark-default'
  return sourceMode === 'claude-plan' ? 'claude-plan' : 'claude-ask'
}

export class SessionDispatchAuthorization {
  private readonly secret = randomBytes(32)

  issue(sessionId: string): string {
    return createHmac('sha256', this.secret).update(sessionId).digest('hex')
  }

  verify(sessionId: string, token: unknown): void {
    if (
      typeof token !== 'string' ||
      !/^[0-9a-f]{64}$/.test(token) ||
      !timingSafeEqual(Buffer.from(token, 'hex'), Buffer.from(this.issue(sessionId), 'hex'))
    ) {
      throw new Error('Session dispatch authorization is missing or invalid')
    }
  }
}

export class SessionDispatch {
  private readonly inflight = new Map<
    string,
    { fingerprint: string; result: Promise<DispatchResult> }
  >()

  constructor(
    private readonly sessions: Pick<
      SessionRepository,
      'get' | 'getWorkspaceIds' | 'getMetadata' | 'patchMetadata'
    >,
    private readonly runtime: Pick<SessionService, 'createSession' | 'submitTurn'>,
    private readonly onCreated: (sessionId: string) => void,
  ) {}

  async dispatch(input: {
    sourceId: string
    requestKey: string
    title: string
    task: string
  }): Promise<DispatchResult> {
    const { sourceId, requestKey, title, task } = input
    // Keep the retry identity without persisting a source-session reference.
    const sessionId = dispatchSessionId(sourceId, requestKey)
    const fingerprint = createHash('sha256')
      .update(JSON.stringify([title, task]))
      .digest('hex')
    const pending = this.inflight.get(sessionId)
    if (pending != null) {
      if (pending.fingerprint !== fingerprint)
        throw new Error('Dispatch request key already used for a different task')
      return pending.result
    }
    const result = this.dispatchOnce(sourceId, sessionId, fingerprint, title, task)
    this.inflight.set(sessionId, { fingerprint, result })
    try {
      return await result
    } finally {
      this.inflight.delete(sessionId)
    }
  }

  private async dispatchOnce(
    sourceId: string,
    sessionId: string,
    fingerprint: string,
    title: string,
    task: string,
  ): Promise<DispatchResult> {
    const source = this.sessions.get(sourceId)
    const sourceMetadata = this.sessions.getMetadata(sourceId)
    if (
      source?.kind !== 'agent' ||
      source.archived_at != null ||
      sourceMetadata.remoteAgentLinkId != null ||
      sourceMetadata.remoteAgentTaskId != null
    ) {
      throw new Error('Dispatch requires an active local agent session')
    }

    const target = this.sessions.get(sessionId)
    if (target != null) {
      const metadata = this.sessions.getMetadata(sessionId)
      if (metadata.dispatchFingerprint !== fingerprint)
        throw new Error('Dispatch request key already used for a different task')
      if (typeof metadata.dispatchAcceptedTurnId === 'string') {
        return { accepted: true, sessionId, turnId: metadata.dispatchAcceptedTurnId }
      }
      if (target.archived_at != null) throw new Error('Dispatch target session is archived')
    } else {
      const workspaceId = this.sessions.getWorkspaceIds(sourceId)[0]
      const agentAdapter = normalizeAgentAdapter(source.agent_adapter)
      const mode = source.chat_mode
      const chatMode = mode === 'ask' || mode === 'edit' || mode === 'review' ? mode : 'agent'
      try {
        await this.runtime.createSession(
          {
            title,
            ...(workspaceId != null ? { workspaceId } : {}),
            ...(source.agent_id ? { agentId: source.agent_id } : {}),
            providerProfileId: source.provider_profile_id ?? '',
            ...(source.model_id != null ? { modelId: source.model_id } : {}),
            agentAdapter,
            chatMode,
            permissionMode: dispatchPermission(agentAdapter, source.permission_mode),
            workflowBinding: { mode: 'disabled' },
          },
          { sessionId, dispatchFingerprint: fingerprint },
        )
      } catch (error) {
        // createSession may fail preparing the response after its database commit.
        if (this.sessions.getMetadata(sessionId).dispatchFingerprint !== fingerprint) throw error
        this.notifySessionList(sessionId)
        return unacceptedDispatch(sessionId)
      }
    }

    this.notifySessionList(sessionId)
    try {
      const { turnId } = await this.runtime.submitTurn(
        { sessionId, message: task },
        {
          onAccepted: (id) =>
            this.sessions.patchMetadata(sessionId, { dispatchAcceptedTurnId: id }),
        },
      )
      return { accepted: true, sessionId, turnId }
    } catch {
      // A failure after the acceptance transaction is not a failed submission.
      const { dispatchAcceptedTurnId } = this.sessions.getMetadata(sessionId)
      if (typeof dispatchAcceptedTurnId === 'string') {
        return { accepted: true, sessionId, turnId: dispatchAcceptedTurnId }
      }
      return unacceptedDispatch(sessionId)
    }
  }

  private notifySessionList(sessionId: string): void {
    try {
      this.onCreated(sessionId)
    } catch {
      // The next session list load will pick up the persisted session.
    }
  }
}
