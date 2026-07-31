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
import { computerExecutionLaneForAction } from '@spark/protocol'
import { ComputerUseBrokerError } from './ComputerUseBrokerError.js'
import type { ComputerDecision, GenericComputerDecisionAdapter } from './ComputerDecisionAdapter.js'
import { ComputerVerificationEngine } from './ComputerVerificationEngine.js'
import { reconcileObservationTree } from './NativeHostTreeReconciler.js'
import { isActionBatchEnabled, isIncrementalTreeEnabled } from './computerUseV2Flags.js'
import { createLogger } from '@spark/shared'
import type { ComputerUseTimelineSink } from './ComputerUseTimelineStore.js'

const log = createLogger('computer-use-operator')

/**
 * When the V2 incremental-tree flag is on, decision steps request a diff tree
 * and the client-side reconciler (NativeHostTreeReconciler) rebuilds the full
 * tree text from the always-complete `elements` array — model input is
 * equivalent to a full request while saving the `tree.text` wire bytes. Off =
 * current behaviour (always request the full tree). The Host itself refuses to
 * diff when the previous treeVersion is stale, so recovery/first steps still
 * receive a full tree regardless of this flag.
 */
function shouldRequestFullDecisionTree(): boolean {
  return !isIncrementalTreeEnabled()
}

const APPROVAL_POLL_MS = 250
const MAX_APPROVAL_POLLS = 1_200
const MAX_TRANSIENT_RECOVERIES = 8
const MAX_DECISION_RECOVERIES = 2
const MAX_MODEL_HANDOFF_REPLANS = 2

interface OperatorSessions {
  heartbeatLease(input: {
    computerSessionId: string
    leaseId: string
    operatorId: string
  }): ComputerActuatorLease
  setPhase(computerSessionId: string, phase: 'planning' | 'verifying' | 'handoff_required'): unknown
  completeVerified(computerSessionId: string, verificationIds?: string[]): unknown
  fail(computerSessionId: string, errorCode?: 'environment_unavailable'): unknown
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
  permissionMode: string
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
  private readonly getAbortSignal: ((computerSessionId: string) => AbortSignal) | undefined
  private readonly timeline: ComputerUseTimelineSink | undefined

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
    getAbortSignal?: (computerSessionId: string) => AbortSignal
    timeline?: ComputerUseTimelineSink
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
    this.getAbortSignal = options.getAbortSignal
    this.timeline = options.timeline
  }

  async run(input: {
    session: ComputerSession
    lease: ComputerActuatorLease
    adapter: DecisionAdapter
    permissionMode?: string
  }): Promise<ComputerTaskOperatorResult> {
    let observation: ComputerObservation
    let consecutiveNoops = 0
    let consecutiveTransientFailures = 0
    let modelHandoffReplans = 0
    let successfulActions = 0
    const abortSignal = this.getAbortSignal?.(input.session.id)
    try {
      observation = await this.observeWithRecovery(
        input.session.id,
        shouldRequestFullDecisionTree(),
      )
      for (let stepIndex = 0; stepIndex < input.session.taskContract.maxSteps; stepIndex += 1) {
        if (abortSignal?.aborted) {
          return { status: 'failed', reason: 'session_canceled' }
        }
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
        let decision: ComputerDecision
        try {
          decision = await input.adapter.decide({
            objective: input.session.taskContract.objective,
            successCriteria: input.session.taskContract.successCriteria,
            observation,
            screenshot,
            stepIndex,
            allowBatch: isActionBatchEnabled(),
          })
          consecutiveTransientFailures = 0
        } catch (error) {
          consecutiveTransientFailures += 1
          if (consecutiveTransientFailures > MAX_DECISION_RECOVERIES) throw error
          await this.wait(recoveryDelay(consecutiveTransientFailures))
          observation = await this.observeWithRecovery(
            input.session.id,
            shouldRequestFullDecisionTree(),
          )
          continue
        }
        if (decision.type === 'handoff') {
          if (
            modelHandoffReplans < MAX_MODEL_HANDOFF_REPLANS &&
            !requiresImmediateHandoff(decision.reason)
          ) {
            modelHandoffReplans += 1
            await this.wait(recoveryDelay(modelHandoffReplans))
            observation = await this.observeWithRecovery(
              input.session.id,
              shouldRequestFullDecisionTree(),
            )
            continue
          }
          this.sessions.setPhase(input.session.id, 'handoff_required')
          return { status: 'handoff_required', reason: decision.reason }
        }
        modelHandoffReplans = 0
        if (decision.type === 'ready_for_verification') {
          if (
            successfulActions === 0 &&
            requiresObservableProgress(input.session.taskContract.successCriteria)
          ) {
            observation = await this.observeWithRecovery(
              input.session.id,
              shouldRequestFullDecisionTree(),
            )
            continue
          }
          this.sessions.setPhase(input.session.id, 'verifying')
          if (observation.tree.mode !== 'full') {
            observation = await this.observeWithRecovery(
              input.session.id,
              shouldRequestFullDecisionTree(),
            )
          }
          const windows = await this.windowInventory?.listWindows()
          const verification = this.verification.verify(
            input.session.taskContract.successCriteria,
            observation,
            {
              ...(windows == null ? {} : { windows }),
              modelVisualApproval: successfulActions > 0,
            },
          )
          const verificationId = this.createId()
          const completedAt = new Date(this.now()).toISOString()
          this.timeline?.record({
            type: 'computer_verification_started',
            sessionId: input.session.sessionId,
            turnId: input.session.turnId,
            computerSessionId: input.session.id,
            verificationId,
          })
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
          if (record == null) {
            // The verification record could not be persisted, but the verification outcome
            // is valid in-memory. Surface the storage fault for observability and proceed on
            // the outcome instead of killing the whole turn over a non-action disk error.
            log.warn('Computer verification record could not be persisted', { verificationId })
          }
          this.timeline?.record({
            type: 'computer_verification_completed',
            sessionId: input.session.sessionId,
            turnId: input.session.turnId,
            computerSessionId: input.session.id,
            verificationId,
            status: verification.passed ? 'passed' : 'failed',
          })
          if (verification.passed) {
            this.sessions.completeVerified(input.session.id, [verificationId])
            return { status: 'completed', verification }
          }
          continue
        }

        if (decision.type === 'actions') {
          // codex-style batch: execute the planned actions sequentially, re-checking the
          // target before every step (dispatchWithApproval re-validates the envelope against
          // the latest observation). Element ids are globally unique per element, so a later
          // step's id either still resolves to the intended element or fails cleanly — it can
          // never collide with a different element. Any step failure stops the batch and lets
          // the outer loop re-observe + re-plan against fresh state.
          let stopped = false
          for (const action of decision.actions) {
            if (abortSignal?.aborted) {
              return { status: 'failed', reason: 'session_canceled' }
            }
            const stepDecision: ComputerDecision = {
              type: 'action',
              action,
              intent: decision.intent,
            }
            const stepEnvelope = createEnvelope(
              input.session,
              input.lease,
              observation,
              stepDecision,
              this.createId(),
            )
            try {
              const stepResult = await this.dispatchWithApproval(
                input.session,
                stepEnvelope,
                input.lease,
                input.permissionMode ?? 'claude-ask',
                abortSignal,
              )
              consecutiveNoops = 0
              consecutiveTransientFailures = 0
              successfulActions += 1
              observation = stepResult.observation
            } catch (error) {
              if (!(error instanceof ComputerUseBrokerError)) throw error
              if (error.code === 'session_canceled') throw error
              if (error.code === 'action_noop') {
                consecutiveNoops += 1
                if (consecutiveNoops >= input.session.taskContract.maxConsecutiveNoops) {
                  this.sessions.fail(input.session.id)
                  return { status: 'failed', reason: 'maximum_consecutive_noops_reached' }
                }
                stopped = true
                break
              }
              if (error.code === 'stale_frame') {
                // A later step's target drifted. Stop and re-plan — do not retry the stale step.
                stopped = true
                break
              }
              if (isRecoverableExecutionError(error)) {
                consecutiveTransientFailures += 1
                if (consecutiveTransientFailures > MAX_TRANSIENT_RECOVERIES) throw error
                await this.wait(recoveryDelay(consecutiveTransientFailures))
                stopped = true
                break
              }
              throw error
            }
          }
          if (stopped) {
            observation = await this.observeWithRecovery(
              input.session.id,
              shouldRequestFullDecisionTree(),
            )
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
          const result = await this.dispatchWithApproval(
            input.session,
            envelope,
            input.lease,
            input.permissionMode ?? 'claude-ask',
            abortSignal,
          )
          consecutiveNoops = 0
          consecutiveTransientFailures = 0
          successfulActions += 1
          observation = result.observation
        } catch (error) {
          if (!(error instanceof ComputerUseBrokerError)) {
            throw error
          }
          if (error.code === 'action_noop') {
            consecutiveNoops += 1
            if (consecutiveNoops >= input.session.taskContract.maxConsecutiveNoops) {
              this.sessions.fail(input.session.id)
              return { status: 'failed', reason: 'maximum_consecutive_noops_reached' }
            }
          } else if (isRecoverableExecutionError(error)) {
            consecutiveTransientFailures += 1
            if (consecutiveTransientFailures > MAX_TRANSIENT_RECOVERIES) throw error
            await this.wait(recoveryDelay(consecutiveTransientFailures))
          } else {
            throw error
          }
          observation = await this.observeWithRecovery(
            input.session.id,
            shouldRequestFullDecisionTree(),
          )
        }
      }
      this.sessions.fail(input.session.id)
      return { status: 'failed', reason: 'maximum_steps_reached' }
    } catch (error) {
      if (error instanceof ComputerUseBrokerError && error.code === 'handoff_required') {
        this.sessions.setPhase(input.session.id, 'handoff_required')
        this.timeline?.record({
          type: 'computer_handoff_required',
          sessionId: input.session.sessionId,
          turnId: input.session.turnId,
          computerSessionId: input.session.id,
          errorCode: 'handoff_required',
        })
        return { status: 'handoff_required', reason: 'user_takeover' }
      }
      // A session_canceled error means an external authority (user stop / pause) already
      // settled the session; do not re-mark it failed. Surface it with a distinct reason so the
      // caller can present "canceled" rather than a generic operator failure.
      if (error instanceof ComputerUseBrokerError && error.code === 'session_canceled') {
        return { status: 'failed', reason: 'session_canceled' }
      }
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

  private async observeWithRecovery(
    computerSessionId: string,
    fullTree: boolean,
  ): Promise<ComputerObservation> {
    let lastError: unknown
    for (let attempt = 0; attempt <= MAX_TRANSIENT_RECOVERIES; attempt += 1) {
      try {
        const observation = await this.broker.observe(computerSessionId, fullTree)
        // Reconcile a diff tree into a full tree before any decision/verification
        // consumer sees it. When the incremental-tree flag is off the Host always
        // returns full mode, so this is a no-op; when it is on, the diff response
        // is rebuilt from the always-complete `elements` array (see
        // NativeHostTreeReconciler), keeping model input equivalent to a full
        // request while saving the `tree.text` wire bytes.
        return reconcileObservationTree(observation)
      } catch (error) {
        lastError = error
        if (
          !(error instanceof ComputerUseBrokerError) ||
          !isRecoverableExecutionError(error) ||
          attempt === MAX_TRANSIENT_RECOVERIES
        ) {
          throw error
        }
        await this.wait(recoveryDelay(attempt + 1))
      }
    }
    throw lastError
  }

  private async dispatchWithApproval(
    session: ComputerSession,
    envelope: ComputerActionEnvelope,
    lease: ComputerActuatorLease,
    permissionMode: string,
    abortSignal?: AbortSignal,
  ): Promise<{ observation: ComputerObservation; noop: boolean }> {
    try {
      return await this.broker.dispatch(envelope)
    } catch (error) {
      // L0/L1 path: the action was dispatched without an approval ticket. A stale_frame here
      // usually means the decision-time frame drifted while the target window stayed put, so
      // try one local re-observe + retry with the refreshed frame before bubbling the
      // recoverable error up to the model loop. This stays safe precisely because there is no
      // approval ticket: the refreshed observedFrameId changes actionDigest (which covers
      // observedFrameId), which would invalidate an L2/L3 ticket — but this branch has none.
      if (error instanceof ComputerUseBrokerError && error.code === 'stale_frame') {
        const relocated = await this.relocateStaleFrame(envelope)
        if (relocated != null) return relocated
      }
      if (!(error instanceof ComputerUseBrokerError) || error.code !== 'approval_required') {
        throw error
      }
      const approvalId = error.details?.approvalId
      const riskLevel = error.details?.riskLevel
      if (approvalId == null || (riskLevel !== 'L2' && riskLevel !== 'L3')) {
        throw error
      }
      if (this.requestApproval != null) {
        // Race the (possibly blocking, native-dialog-backed) approval await against the session
        // abort signal so a user-initiated stop can interrupt the wait. Interrupting here stays
        // fail-closed: the action has NOT been dispatched yet, so no L2/L3 effect occurs — the
        // user declines-by-cancelling instead of being trapped on the dialog with no way out.
        if (abortSignal?.aborted) throw sessionCanceled()
        const ticket = await raceApprovalAgainstAbort(
          this.requestApproval({
            session,
            envelope,
            approvalId,
            riskLevel,
            permissionMode,
          }),
          abortSignal,
        )
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

  /**
   * Local deterministic recovery for a stale frame on a non-approval-bound action. Re-observes
   * the same window; if the foreground app/window identity is unchanged it rebuilds the envelope
   * against the refreshed frame and retries the exact same action once. If the foreground
   * navigated away (real window change) it gives up and returns null so the caller re-throws
   * stale_frame for the model loop to re-decide. The caller guarantees this only runs on the
   * L0/L1 dispatch path, so the refreshed observedFrameId (which mutates actionDigest) cannot
   * invalidate any approval ticket.
   */
  private async relocateStaleFrame(
    envelope: ComputerActionEnvelope,
  ): Promise<{ observation: ComputerObservation; noop: boolean } | null> {
    const observation = await this.broker.observe(envelope.computerSessionId, false)
    if (
      observation.foreground.app.id !== envelope.targetAppId ||
      observation.foreground.window.id !== envelope.targetWindowId
    ) {
      return null
    }
    const refreshedEnvelope: ComputerActionEnvelope = {
      ...envelope,
      observedFrameId: observation.frameId,
      observedTreeVersion: observation.treeVersion,
    }
    return this.broker.dispatch(refreshedEnvelope)
  }

  private heartbeat(computerSessionId: string, lease: ComputerActuatorLease): void {
    this.sessions.heartbeatLease({
      computerSessionId,
      leaseId: lease.id,
      operatorId: lease.operatorId,
    })
  }
}

function sessionCanceled(): ComputerUseBrokerError {
  return new ComputerUseBrokerError('session_canceled', 'Computer session was canceled')
}

/**
 * Resolves with the approval result, or rejects with session_canceled the instant the abort
 * signal fires. Lets a user-initiated stop interrupt a blocking approval dialog await without
 * first resolving the dialog. The approval promise itself is never cancelled — its eventual
 * resolution is simply ignored once the session has been aborted.
 */
function raceApprovalAgainstAbort<T>(
  approval: Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T> {
  if (signal == null) return approval
  if (signal.aborted) throw sessionCanceled()
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(sessionCanceled())
    signal.addEventListener('abort', onAbort, { once: true })
    approval.then(
      (result) => {
        signal.removeEventListener('abort', onAbort)
        resolve(result)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}

function isRecoverableExecutionError(error: ComputerUseBrokerError): boolean {
  return new Set([
    'action_noop',
    'action_timeout',
    'stale_frame',
    'stale_tree',
    'focus_mismatch',
    'native_host_incompatible',
    'environment_unavailable',
  ]).has(error.code)
}

function recoveryDelay(attempt: number): number {
  return Math.min(2_000, 150 * 2 ** Math.max(0, attempt - 1))
}

function requiresImmediateHandoff(reason: string): boolean {
  return /(credential|password|secure|privacy|system prompt|系统权限|密码|凭据|用户确认|user confirmation)/iu.test(
    reason,
  )
}

function requiresObservableProgress(
  criteria: ComputerSession['taskContract']['successCriteria'],
): boolean {
  return criteria.every(
    (criterion) =>
      criterion.kind === 'application_state' &&
      criterion.assertion.operator === 'frontmost' &&
      criterion.assertion.expected === true,
  )
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
    executionLane: computerExecutionLaneForAction(decision.action),
    policyContext: policyContextFor(decision.action, observation, decision.intent),
    intent: decision.intent,
  }
}

function policyContextFor(
  action: ComputerAction,
  observation: ComputerObservation,
  intent: string,
): ComputerPolicyContext {
  const elementId =
    'elementId' in action && typeof action.elementId === 'string' ? action.elementId : null
  const readOnly =
    action.type === 'observe' ||
    action.type === 'move' ||
    action.type === 'scroll' ||
    action.type === 'wait_for'
  const localWrite = action.type === 'type_text' || action.type === 'set_value'
  const committingIntent =
    /\b(send|submit|publish|post|purchase|buy|pay|delete|remove|confirm|book|order)\b|发送|提交|发布|购买|支付|删除|确认|预订|下单/iu.test(
      intent,
    )
  const reversibleLocal =
    localWrite ||
    action.type === 'focus_window' ||
    action.type === 'select_text' ||
    action.type === 'click' ||
    action.type === 'drag' ||
    action.type === 'keypress' ||
    (action.type === 'invoke_element' && action.action != null && action.action !== 'invoke')
  const sensitive = localWrite && action.sensitive === true
  return {
    effect: readOnly
      ? 'read_only'
      : committingIntent
        ? 'external_write'
        : reversibleLocal
          ? 'reversible_local'
          : 'external_write',
    target: elementId
      ? { kind: 'element', id: elementId }
      : { kind: 'window', id: observation.foreground.window.id },
    dataClasses: localWrite ? (sensitive ? ['credential'] : ['public']) : [],
  }
}
