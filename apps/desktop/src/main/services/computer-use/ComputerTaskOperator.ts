import { randomUUID } from 'node:crypto'
import type {
  ComputerAction,
  ComputerActionEnvelope,
  ComputerActuatorLease,
  ComputerApprovalTicket,
  ComputerObservation,
  ComputerPolicyContext,
  ComputerSession,
  NativeWindowDescriptor,
} from '@spark/protocol'
import { ComputerUseBrokerError } from './ComputerUseBrokerError.js'
import type { ComputerDecision, GenericComputerDecisionAdapter } from './ComputerDecisionAdapter.js'
import { ComputerVerificationEngine } from './ComputerVerificationEngine.js'

const APPROVAL_POLL_MS = 250
const MAX_APPROVAL_POLLS = 1_200

interface OperatorSessions {
  heartbeatLease(input: {
    computerSessionId: string
    leaseId: string
    operatorId: string
  }): ComputerActuatorLease
  setPhase(computerSessionId: string, phase: 'planning' | 'verifying' | 'handoff_required'): unknown
  completeVerified(computerSessionId: string): unknown
  fail(computerSessionId: string): unknown
}

interface OperatorBroker {
  observe(computerSessionId: string, fullTree?: boolean): Promise<ComputerObservation>
  dispatch(
    envelope: ComputerActionEnvelope,
    ticket?: ComputerApprovalTicket,
  ): Promise<{ observation: ComputerObservation; noop: boolean }>
}

interface OperatorApprovals {
  takeApprovedTicket(approvalId: string): ComputerApprovalTicket | null
}

interface OperatorEvidence {
  readLatestImage(computerSessionId: string, snapshotId: string): Promise<Buffer>
}

interface OperatorVerifications {
  create(input: {
    id: string
    computerSessionId: string
    spec: Record<string, unknown>
    verifierModelId: string | null
    createdAt: string
  }): unknown
  complete(
    id: string,
    input: {
      status: 'passed' | 'failed' | 'inconclusive'
      evidence: unknown[]
      confidence: number | null
      completedAt: string
    },
  ): unknown | null
}

export interface ComputerActionApprovalRequest {
  session: ComputerSession
  envelope: ComputerActionEnvelope
  approvalId: string
  riskLevel: 'L2' | 'L3'
}

interface DecisionAdapter {
  decide(input: Parameters<GenericComputerDecisionAdapter['decide']>[0]): Promise<ComputerDecision>
}

export interface ComputerTaskOperatorResult {
  status: 'completed' | 'failed' | 'handoff_required'
  verification?: ReturnType<ComputerVerificationEngine['verify']>
  reason?: string
}

export class ComputerTaskOperator {
  private readonly sessions: OperatorSessions
  private readonly broker: OperatorBroker
  private readonly approvals: OperatorApprovals
  private readonly evidence: OperatorEvidence
  private readonly verifications: OperatorVerifications
  private readonly windowInventory: { listWindows(): Promise<NativeWindowDescriptor[]> } | null
  private readonly verification: ComputerVerificationEngine
  private readonly createId: () => string
  private readonly wait: (milliseconds: number) => Promise<void>
  private readonly now: () => number
  private readonly requestApproval:
    | ((request: ComputerActionApprovalRequest) => Promise<ComputerApprovalTicket | null>)
    | undefined

  constructor(options: {
    sessions: OperatorSessions
    broker: OperatorBroker
    approvals: OperatorApprovals
    evidence: OperatorEvidence
    verifications: OperatorVerifications
    windowInventory?: { listWindows(): Promise<NativeWindowDescriptor[]> }
    verification?: ComputerVerificationEngine
    createId?: () => string
    wait?: (milliseconds: number) => Promise<void>
    now?: () => number
    requestApproval?: (
      request: ComputerActionApprovalRequest,
    ) => Promise<ComputerApprovalTicket | null>
  }) {
    this.sessions = options.sessions
    this.broker = options.broker
    this.approvals = options.approvals
    this.evidence = options.evidence
    this.verifications = options.verifications
    this.windowInventory = options.windowInventory ?? null
    this.verification = options.verification ?? new ComputerVerificationEngine()
    this.createId = options.createId ?? randomUUID
    this.wait =
      options.wait ??
      ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)))
    this.now = options.now ?? Date.now
    this.requestApproval = options.requestApproval
  }

  async run(input: {
    session: ComputerSession
    lease: ComputerActuatorLease
    adapter: DecisionAdapter
  }): Promise<ComputerTaskOperatorResult> {
    let observation: ComputerObservation
    let consecutiveNoops = 0
    try {
      observation = await this.broker.observe(input.session.id, true)
      for (let stepIndex = 0; stepIndex < input.session.taskContract.maxSteps; stepIndex += 1) {
        if (
          this.now() - Date.parse(input.session.createdAt) >=
          input.session.taskContract.maxRuntimeMs
        ) {
          this.sessions.fail(input.session.id)
          return { status: 'failed', reason: 'maximum_runtime_reached' }
        }
        this.heartbeat(input.session.id, input.lease)
        const screenshot = await this.evidence.readLatestImage(
          input.session.id,
          observation.screenshot.snapshotId,
        )
        this.sessions.setPhase(input.session.id, 'planning')
        const decision = await input.adapter.decide({
          objective: input.session.taskContract.objective,
          successCriteria: input.session.taskContract.successCriteria,
          observation,
          screenshot,
          stepIndex,
        })
        if (decision.type === 'handoff') {
          this.sessions.setPhase(input.session.id, 'handoff_required')
          return { status: 'handoff_required', reason: decision.reason }
        }
        if (decision.type === 'ready_for_verification') {
          this.sessions.setPhase(input.session.id, 'verifying')
          if (observation.tree.mode !== 'full') {
            observation = await this.broker.observe(input.session.id, true)
          }
          const windows = await this.windowInventory?.listWindows()
          const verification = this.verification.verify(
            input.session.taskContract.successCriteria,
            observation,
            { ...(windows == null ? {} : { windows }) },
          )
          const verificationId = this.createId()
          const completedAt = new Date(this.now()).toISOString()
          this.verifications.create({
            id: verificationId,
            computerSessionId: input.session.id,
            spec: { criteria: input.session.taskContract.successCriteria },
            verifierModelId: input.session.modelId,
            createdAt: completedAt,
          })
          const record = this.verifications.complete(verificationId, {
            status: verification.passed ? 'passed' : 'failed',
            evidence: verification.results,
            confidence: verification.passed ? 1 : 0,
            completedAt,
          })
          if (record == null) throw new Error('Verification record did not complete')
          if (verification.passed) {
            this.sessions.completeVerified(input.session.id)
            return { status: 'completed', verification }
          }
          continue
        }

        const envelope = createEnvelope(
          input.session,
          input.lease,
          observation,
          decision,
          this.createId(),
        )
        try {
          const result = await this.dispatchWithApproval(input.session, envelope, input.lease)
          consecutiveNoops = 0
          observation = result.observation
        } catch (error) {
          if (!(error instanceof ComputerUseBrokerError) || error.code !== 'action_noop') {
            throw error
          }
          consecutiveNoops += 1
          if (consecutiveNoops >= input.session.taskContract.maxConsecutiveNoops) {
            this.sessions.fail(input.session.id)
            return { status: 'failed', reason: 'maximum_consecutive_noops_reached' }
          }
          observation = await this.broker.observe(input.session.id, true)
        }
      }
      this.sessions.fail(input.session.id)
      return { status: 'failed', reason: 'maximum_steps_reached' }
    } catch (error) {
      try {
        this.sessions.fail(input.session.id)
      } catch {
        // The session may already have been paused, stopped, or completed by another authority.
      }
      return {
        status: 'failed',
        reason: error instanceof ComputerUseBrokerError ? error.code : 'operator_failed',
      }
    }
  }

  private async dispatchWithApproval(
    session: ComputerSession,
    envelope: ComputerActionEnvelope,
    lease: ComputerActuatorLease,
  ): Promise<{ observation: ComputerObservation; noop: boolean }> {
    try {
      return await this.broker.dispatch(envelope)
    } catch (error) {
      if (!(error instanceof ComputerUseBrokerError) || error.code !== 'approval_required') {
        throw error
      }
      const approvalId = error.details?.approvalId
      const riskLevel = error.details?.riskLevel
      if (approvalId == null || (riskLevel !== 'L2' && riskLevel !== 'L3')) {
        throw error
      }
      if (this.requestApproval != null) {
        const ticket = await this.requestApproval({
          session,
          envelope,
          approvalId,
          riskLevel,
        })
        if (ticket == null) {
          throw new ComputerUseBrokerError(
            'action_not_allowed',
            'The user denied the exact Computer Use action',
          )
        }
        return this.broker.dispatch(envelope, ticket)
      }
      for (let poll = 0; poll < MAX_APPROVAL_POLLS; poll += 1) {
        const ticket = this.approvals.takeApprovedTicket(approvalId)
        if (ticket != null) return this.broker.dispatch(envelope, ticket)
        await this.wait(APPROVAL_POLL_MS)
        this.heartbeat(envelope.computerSessionId, lease)
      }
      throw new ComputerUseBrokerError('approval_expired', 'Computer action approval expired')
    }
  }

  private heartbeat(computerSessionId: string, lease: ComputerActuatorLease): void {
    this.sessions.heartbeatLease({
      computerSessionId,
      leaseId: lease.id,
      operatorId: lease.operatorId,
    })
  }
}

function createEnvelope(
  session: ComputerSession,
  lease: ComputerActuatorLease,
  observation: ComputerObservation,
  decision: Extract<ComputerDecision, { type: 'action' }>,
  actionId: string,
): ComputerActionEnvelope {
  return {
    computerSessionId: session.id,
    actionId,
    actuatorLeaseId: lease.id,
    observedFrameId: observation.frameId,
    observedTreeVersion: observation.treeVersion,
    targetAppId: observation.foreground.app.id,
    targetWindowId: observation.foreground.window.id,
    action: decision.action,
    policyContext: policyContextFor(decision.action, observation),
    intent: decision.intent,
  }
}

function policyContextFor(
  action: ComputerAction,
  observation: ComputerObservation,
): ComputerPolicyContext {
  const elementId =
    'elementId' in action && typeof action.elementId === 'string' ? action.elementId : null
  const readOnly =
    action.type === 'observe' ||
    action.type === 'move' ||
    action.type === 'scroll' ||
    action.type === 'wait_for'
  const localWrite = action.type === 'type_text' || action.type === 'set_value'
  const reversibleLocal =
    localWrite ||
    action.type === 'focus_window' ||
    action.type === 'select_text' ||
    (action.type === 'invoke_element' && action.action != null && action.action !== 'invoke')
  const sensitive = localWrite && action.sensitive === true
  return {
    effect: readOnly ? 'read_only' : reversibleLocal ? 'reversible_local' : 'external_write',
    target: elementId
      ? { kind: 'element', id: elementId }
      : { kind: 'window', id: observation.foreground.window.id },
    dataClasses: localWrite ? (sensitive ? ['credential'] : ['personal']) : [],
  }
}
