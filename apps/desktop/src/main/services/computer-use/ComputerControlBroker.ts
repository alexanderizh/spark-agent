import type {
  ComputerActionEnvelope,
  ComputerApprovalTicket,
  ComputerObservation,
  ComputerRiskLevel,
  ComputerSession,
} from '@spark/protocol'
import {
  ComputerActionEnvelopeSchema,
  ComputerObservationSchema,
  ComputerUseErrorCodeSchema,
} from '@spark/protocol'
import type { ComputerActionRow, CreateComputerActionParams } from '@spark/storage'
import type { ComputerApprovalService } from './ComputerApprovalService.js'
import type { ComputerPolicyService } from './ComputerPolicyService.js'
import type { ComputerSessionManager } from './ComputerSessionManager.js'
import type { ManagedComputerSessionPhase } from './ComputerSessionManager.js'
import type { ComputerExecutorBackend, ComputerObserverBackend } from './ComputerUseBackend.js'
import { ComputerUseBrokerError } from './ComputerUseBrokerError.js'
import type { ComputerUseTimelineSink } from './ComputerUseTimelineStore.js'
import type { ComputerUseV2RolloutController } from './ComputerUseV2RolloutController.js'

export interface ComputerSessionController {
  assertDispatchAllowed(envelope: ComputerActionEnvelope): {
    session: ComputerSession
    signal: AbortSignal
  }
  getAbortSignal(computerSessionId: string): AbortSignal
  setPhase(computerSessionId: string, phase: ManagedComputerSessionPhase): ComputerSession
  pause(computerSessionId: string): ComputerSession
  resume(computerSessionId: string): ComputerSession
  cancel(computerSessionId: string): ComputerSession
}

export interface ComputerApprovalController {
  request(
    envelope: ComputerActionEnvelope,
    riskLevel: Extract<ComputerRiskLevel, 'L2' | 'L3'>,
  ): { id: string }
  consume(
    ticket: ComputerApprovalTicket,
    envelope: ComputerActionEnvelope,
    riskLevel: Extract<ComputerRiskLevel, 'L2' | 'L3'>,
  ): void
  cancelPending(computerSessionId: string): number
}

export interface ComputerActionStore {
  get(id: string): ComputerActionRow | null
  nextStepIndex(computerSessionId: string): number
  create(params: CreateComputerActionParams): ComputerActionRow
  startExecuting(id: string, approvalTicketId: string | null): ComputerActionRow | null
  complete(
    id: string,
    params: {
      status: 'blocked' | 'executed' | 'failed' | 'canceled'
      afterFrameId: string | null
      errorCode: string | null
      completedAt: string
    },
  ): ComputerActionRow | null
}

export interface ComputerControlBrokerOptions {
  sessions: ComputerSessionController | ComputerSessionManager
  policy: ComputerPolicyService
  approvals: ComputerApprovalController | ComputerApprovalService
  actions: ComputerActionStore
  observer: ComputerObserverBackend
  executor: ComputerExecutorBackend
  /** Optional live timeline sink. Absent keeps broker behavior unchanged. */
  timeline?: ComputerUseTimelineSink
  /** Flushes the current before-frame only for L2/L3 actions before ticket consumption. */
  flushHighRiskEvidence?: (computerSessionId: string) => Promise<void>
  rollout?: Pick<ComputerUseV2RolloutController, 'recordAction' | 'recordTakeoverStop'>
  now?: () => Date
}

export class ComputerControlBroker {
  private readonly sessions: ComputerSessionController
  private readonly policy: ComputerPolicyService
  private readonly approvals: ComputerApprovalController
  private readonly actions: ComputerActionStore
  private readonly observer: ComputerObserverBackend
  private readonly executor: ComputerExecutorBackend
  private readonly timeline: ComputerUseTimelineSink | undefined
  private readonly rollout:
    | Pick<ComputerUseV2RolloutController, 'recordAction' | 'recordTakeoverStop'>
    | undefined
  private readonly now: () => Date
  private readonly observations = new Map<string, ComputerObservation>()
  private readonly activeDispatches = new Set<string>()

  constructor(options: ComputerControlBrokerOptions) {
    this.sessions = options.sessions
    this.policy = options.policy
    this.approvals = options.approvals
    this.actions = options.actions
    this.observer = options.observer
    this.executor = options.executor
    this.timeline = options.timeline
    this.rollout = options.rollout
    this.now = options.now ?? (() => new Date())
  }

  async observe(computerSessionId: string, fullTree = false): Promise<ComputerObservation> {
    const signal = this.sessions.getAbortSignal(computerSessionId)
    let rawObservation: ComputerObservation
    try {
      rawObservation = await this.observer.observe({ computerSessionId, fullTree, signal })
    } catch (error) {
      if (signal.aborted) throw sessionCanceled()
      if (error instanceof ComputerUseBrokerError) throw error
      throw backendIncompatible()
    }
    const parsedObservation = ComputerObservationSchema.safeParse(rawObservation)
    if (!parsedObservation.success) throw backendIncompatible()
    const observation = parsedObservation.data
    if (signal.aborted) throw sessionCanceled()
    this.observations.set(computerSessionId, observation)
    const session = this.sessions.setPhase(computerSessionId, 'observing')
    this.timeline?.record({
      type: 'computer_observation_created',
      sessionId: session.sessionId,
      turnId: session.turnId,
      computerSessionId,
      frameId: observation.frameId,
      treeVersion: observation.treeVersion,
    })
    return observation
  }

  async dispatch(
    envelopeInput: ComputerActionEnvelope,
    _ticket?: ComputerApprovalTicket,
  ): Promise<{ observation: ComputerObservation; noop: boolean }> {
    const parsedEnvelope = ComputerActionEnvelopeSchema.safeParse(envelopeInput)
    if (!parsedEnvelope.success) {
      throw new ComputerUseBrokerError('action_not_allowed', 'Computer action payload is invalid')
    }
    const envelope = parsedEnvelope.data
    if (this.activeDispatches.has(envelope.computerSessionId)) {
      throw new ComputerUseBrokerError(
        'environment_unavailable',
        'Another computer action is still completing in this session',
        undefined,
        { retryable: true },
      )
    }
    this.activeDispatches.add(envelope.computerSessionId)
    try {
      return await this.dispatchExclusive(envelope)
    } finally {
      this.activeDispatches.delete(envelope.computerSessionId)
    }
  }

  private async dispatchExclusive(
    envelope: ComputerActionEnvelope,
  ): Promise<{ observation: ComputerObservation; noop: boolean }> {
    const context = this.sessions.assertDispatchAllowed(envelope)
    const observation = this.requireCurrentObservation(envelope)

    const policyDecision = this.policy.evaluate(
      envelope,
      context.session.taskContract,
      observation.foreground.app,
    )
    const actionRow = this.persistRequestedAction(envelope, policyDecision)
    this.timeline?.record({
      type: 'computer_action_requested',
      sessionId: context.session.sessionId,
      turnId: context.session.turnId,
      computerSessionId: envelope.computerSessionId,
      actionId: envelope.actionId,
      riskLevel: policyDecision.riskLevel,
    })
    if (policyDecision.decision === 'deny') {
      const errorCode = toComputerUseErrorCode(policyDecision.reasonCode)
      this.blockAction(actionRow.id, errorCode)
      this.timeline?.record({
        type: 'computer_action_blocked',
        sessionId: context.session.sessionId,
        turnId: context.session.turnId,
        computerSessionId: envelope.computerSessionId,
        actionId: envelope.actionId,
        errorCode,
      })
      throw new ComputerUseBrokerError(errorCode, 'Computer action was denied by policy')
    }
    if (this.actions.startExecuting(envelope.actionId, null) == null) {
      throw new ComputerUseBrokerError(
        'action_not_allowed',
        'Computer action is no longer executable',
      )
    }
    this.sessions.setPhase(envelope.computerSessionId, 'acting')

    let result: { observation: ComputerObservation; noop: boolean }
    try {
      const backendResult = await this.executor.execute({
        envelope,
        observation,
        signal: context.signal,
      })
      if (context.signal.aborted) throw sessionCanceled()
      result = {
        observation: ComputerObservationSchema.parse(backendResult.observation),
        noop: backendResult.noop,
      }
    } catch (error) {
      const brokerError = normalizeExecutionError(error)
      if (brokerError.code !== 'session_canceled' && brokerError.code !== 'handoff_required') {
        this.rollout?.recordAction(true)
      }
      this.actions.complete(envelope.actionId, {
        status: context.signal.aborted ? 'canceled' : 'failed',
        afterFrameId: null,
        errorCode: brokerError.code,
        completedAt: this.now().toISOString(),
      })
      if (!context.signal.aborted) {
        this.timeline?.record({
          type: 'computer_action_failed',
          sessionId: context.session.sessionId,
          turnId: context.session.turnId,
          computerSessionId: envelope.computerSessionId,
          actionId: envelope.actionId,
          errorCode: brokerError.code,
        })
        // Never auto-pause/abort on an execution failure: a single failed action must not
        // interrupt the task. Surface the error to the operator/agent so it can choose an
        // alternative approach. Only an external authority (user stop / kill switch) cancels.
        this.sessions.setPhase(envelope.computerSessionId, 'observing')
      }
      throw brokerError
    }

    this.observations.set(envelope.computerSessionId, result.observation)
    if (result.noop) {
      this.rollout?.recordAction(true)
      this.actions.complete(envelope.actionId, {
        status: 'failed',
        afterFrameId: result.observation.frameId,
        errorCode: 'action_noop',
        completedAt: this.now().toISOString(),
      })
      this.timeline?.record({
        type: 'computer_action_failed',
        sessionId: context.session.sessionId,
        turnId: context.session.turnId,
        computerSessionId: envelope.computerSessionId,
        actionId: envelope.actionId,
        errorCode: 'action_noop',
      })
      this.sessions.setPhase(envelope.computerSessionId, 'observing')
      throw new ComputerUseBrokerError('action_noop', 'Computer action made no observable change')
    }

    const completed = this.actions.complete(envelope.actionId, {
      status: 'executed',
      afterFrameId: result.observation.frameId,
      errorCode: null,
      completedAt: this.now().toISOString(),
    })
    if (completed == null) {
      throw new ComputerUseBrokerError(
        'action_not_allowed',
        'Computer action completion could not be persisted',
      )
    }
    this.timeline?.record({
      type: 'computer_action_executed',
      sessionId: context.session.sessionId,
      turnId: context.session.turnId,
      computerSessionId: envelope.computerSessionId,
      actionId: envelope.actionId,
      beforeFrameId: envelope.observedFrameId,
      afterFrameId: result.observation.frameId,
    })
    this.rollout?.recordAction(false)
    this.sessions.setPhase(envelope.computerSessionId, 'observing')
    return result
  }

  async pause(computerSessionId: string): Promise<ComputerSession> {
    const paused = this.sessions.pause(computerSessionId)
    this.observations.delete(computerSessionId)
    this.approvals.cancelPending(computerSessionId)
    await this.executor.cancelSession(computerSessionId)
    return paused
  }

  resume(computerSessionId: string): ComputerSession {
    this.observations.delete(computerSessionId)
    return this.sessions.resume(computerSessionId)
  }

  async stop(computerSessionId: string): Promise<ComputerSession> {
    const canceled = this.sessions.cancel(computerSessionId)
    this.observations.delete(computerSessionId)
    this.approvals.cancelPending(computerSessionId)
    await this.executor.cancelSession(computerSessionId)
    return canceled
  }

  async killSwitch(computerSessionId: string): Promise<ComputerSession> {
    const startedAt = this.now().getTime()
    try {
      return await this.stop(computerSessionId)
    } finally {
      this.rollout?.recordTakeoverStop(Math.max(0, this.now().getTime() - startedAt))
    }
  }

  private requireCurrentObservation(envelope: ComputerActionEnvelope): ComputerObservation {
    const observation = this.observations.get(envelope.computerSessionId)
    if (observation == null || observation.frameId !== envelope.observedFrameId) {
      throw new ComputerUseBrokerError('stale_frame', 'Computer action references a stale frame')
    }
    if (observation.treeVersion !== envelope.observedTreeVersion) {
      throw new ComputerUseBrokerError('stale_tree', 'Computer action references a stale tree')
    }
    // Intentionally NOT checking foreground app/window against envelope targets: a bound task
    // must keep operating its target window even when the user focuses another app. The
    // executor always drives the envelope's targetAppId/targetWindowId, so a foreground change
    // is normal and must not interrupt the task.
    return observation
  }

  private persistRequestedAction(
    envelope: ComputerActionEnvelope,
    policyDecision: ReturnType<ComputerPolicyService['evaluate']>,
  ): ComputerActionRow {
    const payload = persistedActionPayload(envelope)
    const existing = this.actions.get(envelope.actionId)
    if (existing != null) {
      if (
        existing.computer_session_id !== envelope.computerSessionId ||
        existing.status !== 'requested' ||
        existing.action_json !== JSON.stringify(payload) ||
        existing.before_frame_id !== envelope.observedFrameId ||
        existing.risk_level !== policyDecision.riskLevel ||
        existing.policy_decision !== policyDecision.decision
      ) {
        throw new ComputerUseBrokerError(
          'approval_mismatch',
          'Computer action identifier was reused with different parameters',
        )
      }
      return existing
    }
    return this.actions.create({
      id: envelope.actionId,
      computerSessionId: envelope.computerSessionId,
      stepIndex: this.actions.nextStepIndex(envelope.computerSessionId),
      action: payload,
      intent: envelope.intent,
      riskLevel: policyDecision.riskLevel,
      policyDecision: policyDecision.decision,
      approvalTicketId: null,
      beforeFrameId: envelope.observedFrameId,
      expectedPostcondition:
        envelope.expectedPostcondition == null ? null : envelope.expectedPostcondition,
      createdAt: this.now().toISOString(),
    })
  }

  private blockAction(actionId: string, errorCode: string): void {
    this.actions.complete(actionId, {
      status: 'blocked',
      afterFrameId: null,
      errorCode,
      completedAt: this.now().toISOString(),
    })
  }
}

function persistedActionPayload(envelope: ComputerActionEnvelope): Record<string, unknown> {
  return {
    action: envelope.action,
    policyContext: envelope.policyContext,
    targetAppId: envelope.targetAppId,
    targetWindowId: envelope.targetWindowId,
    observedTreeVersion: envelope.observedTreeVersion,
  }
}

function normalizeExecutionError(error: unknown): ComputerUseBrokerError {
  if (error instanceof ComputerUseBrokerError) return error
  if (error instanceof Error && error.name === 'AbortError') return sessionCanceled()
  return backendIncompatible()
}

function sessionCanceled(): ComputerUseBrokerError {
  return new ComputerUseBrokerError('session_canceled', 'Computer session is canceled')
}

function backendIncompatible(): ComputerUseBrokerError {
  return new ComputerUseBrokerError(
    'native_host_incompatible',
    'Trusted Computer Use backend returned an invalid response',
  )
}

function toComputerUseErrorCode(value: string) {
  const parsed = ComputerUseErrorCodeSchema.safeParse(value)
  return parsed.success ? parsed.data : 'action_not_allowed'
}
