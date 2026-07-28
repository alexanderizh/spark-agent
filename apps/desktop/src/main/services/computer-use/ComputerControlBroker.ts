import type {
  ComputerActionEnvelope,
  ComputerActuatorLease,
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

export interface ComputerSessionController {
  assertDispatchAllowed(envelope: ComputerActionEnvelope): {
    session: ComputerSession
    lease: ComputerActuatorLease
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
  now?: () => Date
}

export class ComputerControlBroker {
  private readonly sessions: ComputerSessionController
  private readonly policy: ComputerPolicyService
  private readonly approvals: ComputerApprovalController
  private readonly actions: ComputerActionStore
  private readonly observer: ComputerObserverBackend
  private readonly executor: ComputerExecutorBackend
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
    this.sessions.setPhase(computerSessionId, 'observing')
    return observation
  }

  async dispatch(
    envelopeInput: ComputerActionEnvelope,
    ticket?: ComputerApprovalTicket,
  ): Promise<{ observation: ComputerObservation; noop: boolean }> {
    const parsedEnvelope = ComputerActionEnvelopeSchema.safeParse(envelopeInput)
    if (!parsedEnvelope.success) {
      throw new ComputerUseBrokerError('action_not_allowed', 'Computer action payload is invalid')
    }
    const envelope = parsedEnvelope.data
    if (this.activeDispatches.has(envelope.computerSessionId)) {
      throw new ComputerUseBrokerError(
        'actuator_lease_conflict',
        'Another computer action is already executing in this session',
      )
    }
    this.activeDispatches.add(envelope.computerSessionId)
    try {
      return await this.dispatchExclusive(envelope, ticket)
    } finally {
      this.activeDispatches.delete(envelope.computerSessionId)
    }
  }

  private async dispatchExclusive(
    envelope: ComputerActionEnvelope,
    ticket?: ComputerApprovalTicket,
  ): Promise<{ observation: ComputerObservation; noop: boolean }> {
    const context = this.sessions.assertDispatchAllowed(envelope)
    const observation = this.requireCurrentObservation(envelope)
    this.assertWithinRuntimeAndStepLimits(context.session)

    const policyDecision = this.policy.evaluate(
      envelope,
      context.session.taskContract,
      observation.foreground.app,
    )
    const actionRow = this.persistRequestedAction(envelope, policyDecision)
    if (policyDecision.decision === 'deny') {
      const errorCode = toComputerUseErrorCode(policyDecision.reasonCode)
      this.blockAction(actionRow.id, errorCode)
      throw new ComputerUseBrokerError(errorCode, 'Computer action was denied by policy')
    }
    if (policyDecision.decision === 'require_handoff') {
      this.blockAction(actionRow.id, 'handoff_required')
      this.sessions.setPhase(envelope.computerSessionId, 'handoff_required')
      throw new ComputerUseBrokerError('handoff_required', 'Computer action requires user takeover')
    }

    let approvalTicketId: string | null = null
    if (policyDecision.decision === 'require_approval') {
      const riskLevel = requireApprovalRisk(policyDecision.riskLevel)
      if (ticket == null) {
        const approval = this.approvals.request(envelope, riskLevel)
        this.sessions.setPhase(envelope.computerSessionId, 'waiting_approval')
        throw new ComputerUseBrokerError(
          'approval_required',
          'Computer action requires exact user approval',
          { approvalId: approval.id, riskLevel },
        )
      }
      this.approvals.consume(ticket, envelope, riskLevel)
      approvalTicketId = ticket.id
    }

    if (this.actions.startExecuting(envelope.actionId, approvalTicketId) == null) {
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
      this.actions.complete(envelope.actionId, {
        status: context.signal.aborted ? 'canceled' : 'failed',
        afterFrameId: null,
        errorCode: brokerError.code,
        completedAt: this.now().toISOString(),
      })
      if (!context.signal.aborted) this.sessions.pause(envelope.computerSessionId)
      throw brokerError
    }

    this.observations.set(envelope.computerSessionId, result.observation)
    if (result.noop) {
      this.actions.complete(envelope.actionId, {
        status: 'failed',
        afterFrameId: result.observation.frameId,
        errorCode: 'action_noop',
        completedAt: this.now().toISOString(),
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
    return this.stop(computerSessionId)
  }

  private requireCurrentObservation(envelope: ComputerActionEnvelope): ComputerObservation {
    const observation = this.observations.get(envelope.computerSessionId)
    if (observation == null || observation.frameId !== envelope.observedFrameId) {
      throw new ComputerUseBrokerError('stale_frame', 'Computer action references a stale frame')
    }
    if (observation.treeVersion !== envelope.observedTreeVersion) {
      throw new ComputerUseBrokerError('stale_tree', 'Computer action references a stale tree')
    }
    if (
      observation.foreground.app.id !== envelope.targetAppId ||
      observation.foreground.window.id !== envelope.targetWindowId
    ) {
      throw new ComputerUseBrokerError(
        'focus_mismatch',
        'Computer foreground application or window changed',
      )
    }
    return observation
  }

  private assertWithinRuntimeAndStepLimits(session: ComputerSession): void {
    const elapsedMs = this.now().getTime() - Date.parse(session.createdAt)
    if (elapsedMs >= session.taskContract.maxRuntimeMs) {
      throw new ComputerUseBrokerError('action_not_allowed', 'Computer task runtime limit reached')
    }
    if (this.actions.nextStepIndex(session.id) >= session.taskContract.maxSteps) {
      throw new ComputerUseBrokerError('action_not_allowed', 'Computer task step limit reached')
    }
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

function requireApprovalRisk(
  riskLevel: ComputerRiskLevel,
): Extract<ComputerRiskLevel, 'L2' | 'L3'> {
  if (riskLevel === 'L2' || riskLevel === 'L3') return riskLevel
  throw new ComputerUseBrokerError(
    'approval_mismatch',
    'Computer approval was requested for an invalid risk level',
  )
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
