import { randomUUID } from 'node:crypto'
import type {
  ComputerAction,
  ComputerActionEnvelope,
  ComputerActuatorLease,
  ComputerApprovalTicket,
  ComputerExecutionChannel,
  ComputerObservation,
  ComputerPolicyContext,
  ComputerSession,
  ComputerUseErrorCode,
  NativeWindowDescriptor,
} from '@spark/protocol'
import { computerExecutionLaneForAction } from '@spark/protocol'
import { ComputerUseBrokerError } from './ComputerUseBrokerError.js'
import type {
  ComputerActionFailureContext,
  ComputerDecision,
  ComputerInteractionStrategy,
  ComputerRecentAction,
  ComputerVerificationFailureContext,
  GenericComputerDecisionAdapter,
} from './ComputerDecisionAdapter.js'
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

const MAX_TRANSIENT_RECOVERIES = 8
const MAX_DECISION_RECOVERIES = 2

interface OperatorSessions {
  setPhase(computerSessionId: string, phase: 'planning' | 'verifying' | 'handoff_required'): unknown
  completeVerified(computerSessionId: string, verificationIds?: string[]): unknown
  fail(computerSessionId: string, errorCode?: ComputerUseErrorCode): unknown
}

interface OperatorBroker {
  observe(computerSessionId: string, fullTree?: boolean): Promise<ComputerObservation>
  dispatch(envelope: ComputerActionEnvelope): Promise<{
    observation: ComputerObservation
    noop: boolean
    /** Reported by the native host backend; absent for non-native executors. */
    executionChannel?: ComputerExecutionChannel | null
  }>
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

/** @deprecated Persisted approval UI compatibility; direct execution never creates this. */
export interface ComputerActionApprovalRequest {
  session: ComputerSession
  envelope: ComputerActionEnvelope
  approvalId: string
  riskLevel: 'L2' | 'L3'
  permissionMode: string
}

interface OperatorApprovals {
  takeApprovedTicket(approvalId: string): ComputerApprovalTicket | null
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
  private readonly evidence: OperatorEvidence
  private readonly verifications: OperatorVerifications
  private readonly windowInventory: { listWindows(): Promise<NativeWindowDescriptor[]> } | null
  private readonly verification: ComputerVerificationEngine
  private readonly createId: () => string
  private readonly wait: (milliseconds: number) => Promise<void>
  private readonly now: () => number
  private readonly getAbortSignal: ((computerSessionId: string) => AbortSignal) | undefined
  private readonly timeline: ComputerUseTimelineSink | undefined

  constructor(options: {
    sessions: OperatorSessions
    broker: OperatorBroker
    /** @deprecated Test and persisted UI compatibility; never read by direct execution. */
    approvals?: OperatorApprovals
    evidence: OperatorEvidence
    verifications: OperatorVerifications
    windowInventory?: { listWindows(): Promise<NativeWindowDescriptor[]> }
    verification?: ComputerVerificationEngine
    createId?: () => string
    wait?: (milliseconds: number) => Promise<void>
    now?: () => number
    getAbortSignal?: (computerSessionId: string) => AbortSignal
    timeline?: ComputerUseTimelineSink
  }) {
    this.sessions = options.sessions
    this.broker = options.broker
    this.evidence = options.evidence
    this.verifications = options.verifications
    this.windowInventory = options.windowInventory ?? null
    this.verification = options.verification ?? new ComputerVerificationEngine()
    this.createId = options.createId ?? randomUUID
    this.wait =
      options.wait ??
      ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)))
    this.now = options.now ?? Date.now
    this.getAbortSignal = options.getAbortSignal
    this.timeline = options.timeline
  }

  async run(input: {
    session: ComputerSession
    /** @deprecated Compatibility-only. Direct execution no longer uses persisted leases. */
    lease?: ComputerActuatorLease
    adapter: DecisionAdapter
  }): Promise<ComputerTaskOperatorResult> {
    let observation: ComputerObservation
    let consecutiveNoops = 0
    let consecutiveTransientFailures = 0
    let successfulActions = 0
    let attemptedActions = 0
    let lastAutoVerifiedActionCount = 0
    let previousActionFailure: ComputerActionFailureContext | undefined
    let previousVerificationFailure: ComputerVerificationFailureContext | undefined
    const recentActions: ComputerRecentAction[] = []
    const failedStrategies = new Set<ComputerInteractionStrategy>()
    const abortSignal = this.getAbortSignal?.(input.session.id)
    const startedAt = this.now()
    try {
      observation = await this.observeWithRecovery(
        input.session.id,
        shouldRequestFullDecisionTree(),
      )
      for (let stepIndex = 0; ; stepIndex += 1) {
        if (abortSignal?.aborted) {
          return { status: 'failed', reason: 'session_canceled' }
        }
        this.assertRuntimeBudget(input.session, startedAt)
        if (successfulActions > lastAutoVerifiedActionCount) {
          lastAutoVerifiedActionCount = successfulActions
          this.sessions.setPhase(input.session.id, 'verifying')
          const verification = await this.verifyCurrentState(input.session, observation, false)
          if (verification.passed) {
            this.sessions.completeVerified(input.session.id)
            return { status: 'completed' }
          }
        }
        const decisionEvidence = await this.readDecisionEvidence(input.session.id, observation)
        observation = decisionEvidence.observation
        const screenshot = decisionEvidence.screenshot
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
            ...(previousActionFailure == null ? {} : { previousActionFailure }),
            ...(previousVerificationFailure == null ? {} : { previousVerificationFailure }),
            ...(recentActions.length === 0 ? {} : { recentActions: [...recentActions] }),
          })
          consecutiveTransientFailures = 0
        } catch (error) {
          if (
            error instanceof ComputerUseBrokerError &&
            error.code === 'decision_model_error' &&
            !error.retryable
          ) {
            throw error
          }
          consecutiveTransientFailures += 1
          if (consecutiveTransientFailures > MAX_DECISION_RECOVERIES) throw error
          await this.wait(recoveryDelay(consecutiveTransientFailures))
          observation = await this.observeWithRecovery(
            input.session.id,
            shouldRequestFullDecisionTree(),
          )
          continue
        }
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
          this.assertRuntimeBudget(input.session, startedAt)
          this.sessions.setPhase(input.session.id, 'verifying')
          const verification = await this.verifyCurrentState(input.session, observation, true)
          if (!verification.passed) {
            previousVerificationFailure = verificationFailureContext(verification)
            observation = await this.observeWithRecovery(
              input.session.id,
              shouldRequestFullDecisionTree(),
            )
            continue
          }
          previousVerificationFailure = undefined
          this.sessions.completeVerified(input.session.id)
          return { status: 'completed' }
        }

        if (decision.type === 'actions') {
          // codex-style batch: execute the planned actions sequentially, re-checking the
          // target before every step (the Broker re-validates the envelope against
          // the latest observation). Element ids are globally unique per element, so a later
          // step's id either still resolves to the intended element or fails cleanly — it can
          // never collide with a different element. Any step failure stops the batch and lets
          // the outer loop re-observe + re-plan against fresh state.
          let stopped = false
          for (const action of decision.actions) {
            if (abortSignal?.aborted) {
              return { status: 'failed', reason: 'session_canceled' }
            }
            this.assertRuntimeBudget(input.session, startedAt)
            this.assertActionBudget(input.session, attemptedActions)
            attemptedActions += 1
            const stepDecision: ComputerDecision = {
              type: 'action',
              action,
              intent: decision.intent,
            }
            const stepEnvelope = createEnvelope(
              input.session,
              observation,
              stepDecision,
              this.createId(),
            )
            try {
              const stepResult = await this.dispatchDirectly(stepEnvelope)
              consecutiveNoops = 0
              consecutiveTransientFailures = 0
              successfulActions += 1
              previousActionFailure = undefined
              previousVerificationFailure = undefined
              failedStrategies.clear()
              observation = stepResult.observation
              rememberRecentAction(
                recentActions,
                action,
                decision.intent,
                'executed',
                observation,
                undefined,
                stepResult.executionChannel,
              )
            } catch (error) {
              if (!(error instanceof ComputerUseBrokerError)) throw error
              if (error.code === 'session_canceled' || error.code === 'handoff_required')
                throw error
              rememberRecentAction(
                recentActions,
                action,
                decision.intent,
                'failed',
                observation,
                error.code,
              )
              if (error.code === 'action_noop') {
                consecutiveNoops += 1
                const exhaustedNoopWindow =
                  consecutiveNoops >= input.session.taskContract.maxConsecutiveNoops
                failedStrategies.add(interactionStrategyFor(action))
                previousActionFailure = actionFailureContext(
                  error,
                  action,
                  consecutiveNoops,
                  failedStrategies,
                  true,
                )
                if (exhaustedNoopWindow) consecutiveNoops = 0
                stopped = true
                break
              }
              if (error.code === 'stale_frame') {
                failedStrategies.add(interactionStrategyFor(action))
                previousActionFailure = actionFailureContext(
                  error,
                  action,
                  consecutiveTransientFailures + 1,
                  failedStrategies,
                  true,
                )
                // A later step's target drifted. Stop and re-plan — do not retry the stale step.
                stopped = true
                break
              }
              if (isRecoverableExecutionError(error)) {
                consecutiveTransientFailures += 1
                failedStrategies.add(interactionStrategyFor(action))
                previousActionFailure = actionFailureContext(
                  error,
                  action,
                  consecutiveTransientFailures,
                  failedStrategies,
                  true,
                )
                if (consecutiveTransientFailures > MAX_TRANSIENT_RECOVERIES) throw error
                await this.wait(recoveryDelay(consecutiveTransientFailures))
                stopped = true
                break
              }
              // 不可恢复的执行错误也不立即终止任务：反馈给模型，让下一轮换一种方案；
              // 只有连续失败次数用尽才放弃，避免真环境故障导致无限循环。
              consecutiveTransientFailures += 1
              failedStrategies.add(interactionStrategyFor(action))
              previousActionFailure = actionFailureContext(
                error,
                action,
                consecutiveTransientFailures,
                failedStrategies,
                true,
              )
              if (consecutiveTransientFailures > MAX_TRANSIENT_RECOVERIES) throw error
              stopped = true
              break
            }
          }
          if (stopped) {
            observation = await this.observeWithRecovery(
              input.session.id,
              previousActionFailure?.requiredAlternative === true
                ? true
                : shouldRequestFullDecisionTree(),
            )
          }
          continue
        }

        this.assertRuntimeBudget(input.session, startedAt)
        this.assertActionBudget(input.session, attemptedActions)
        attemptedActions += 1
        const envelope = createEnvelope(input.session, observation, decision, this.createId())
        try {
          const result = await this.dispatchDirectly(envelope)
          consecutiveNoops = 0
          consecutiveTransientFailures = 0
          successfulActions += 1
          previousActionFailure = undefined
          previousVerificationFailure = undefined
          failedStrategies.clear()
          observation = result.observation
          rememberRecentAction(
            recentActions,
            decision.action,
            decision.intent,
            'executed',
            observation,
            undefined,
            result.executionChannel,
          )
        } catch (error) {
          if (!(error instanceof ComputerUseBrokerError)) {
            throw error
          }
          if (error.code === 'session_canceled' || error.code === 'handoff_required') throw error
          rememberRecentAction(
            recentActions,
            decision.action,
            decision.intent,
            'failed',
            observation,
            error.code,
          )
          if (error.code === 'action_noop') {
            consecutiveNoops += 1
            const exhaustedNoopWindow =
              consecutiveNoops >= input.session.taskContract.maxConsecutiveNoops
            failedStrategies.add(interactionStrategyFor(decision.action))
            previousActionFailure = actionFailureContext(
              error,
              decision.action,
              consecutiveNoops,
              failedStrategies,
              true,
            )
            if (exhaustedNoopWindow) consecutiveNoops = 0
          } else if (isRecoverableExecutionError(error)) {
            consecutiveTransientFailures += 1
            failedStrategies.add(interactionStrategyFor(decision.action))
            previousActionFailure = actionFailureContext(
              error,
              decision.action,
              consecutiveTransientFailures,
              failedStrategies,
              true,
            )
            if (consecutiveTransientFailures > MAX_TRANSIENT_RECOVERIES) throw error
            await this.wait(recoveryDelay(consecutiveTransientFailures))
          } else {
            // 不可恢复的执行错误也反馈给模型换方案，连续失败用尽才放弃。
            consecutiveTransientFailures += 1
            failedStrategies.add(interactionStrategyFor(decision.action))
            previousActionFailure = actionFailureContext(
              error,
              decision.action,
              consecutiveTransientFailures,
              failedStrategies,
              true,
            )
            if (consecutiveTransientFailures > MAX_TRANSIENT_RECOVERIES) throw error
          }
          observation = await this.observeWithRecovery(
            input.session.id,
            previousActionFailure?.requiredAlternative === true
              ? true
              : shouldRequestFullDecisionTree(),
          )
        }
      }
      // The loop is bounded by the session runtime and action budgets above.
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
        this.sessions.fail(
          input.session.id,
          error instanceof ComputerUseBrokerError ? error.code : 'environment_unavailable',
        )
      } catch {
        // The session may already have been paused, stopped, or completed by another authority.
      }
      return {
        status: 'failed',
        reason: error instanceof ComputerUseBrokerError ? error.code : 'operator_failed',
      }
    }
  }

  private assertRuntimeBudget(session: ComputerSession, startedAt: number): void {
    if (this.now() - startedAt < session.taskContract.maxRuntimeMs) return
    throw new ComputerUseBrokerError(
      'task_runtime_exceeded',
      'Computer task runtime budget was exceeded',
      undefined,
      {
        diagnostic: {
          diagnosticCode: 'computer_task_runtime_exceeded',
          stage: 'verify_task',
          repairAction: 'retry_with_a_smaller_task_or_increase_the_time_budget',
        },
      },
    )
  }

  private assertActionBudget(session: ComputerSession, attemptedActions: number): void {
    if (attemptedActions < session.taskContract.maxSteps) return
    throw new ComputerUseBrokerError(
      'task_step_limit_exceeded',
      'Computer task action budget was exceeded',
      undefined,
      {
        diagnostic: {
          diagnosticCode: 'computer_task_step_limit_exceeded',
          stage: 'verify_task',
          repairAction: 'retry_with_a_smaller_task_or_increase_the_step_budget',
        },
      },
    )
  }

  private async verifyCurrentState(
    session: ComputerSession,
    observation: ComputerObservation,
    modelVisualApproval: boolean,
  ): Promise<ReturnType<ComputerVerificationEngine['verify']>> {
    let windows: NativeWindowDescriptor[] | undefined
    if (this.windowInventory != null) {
      try {
        windows = await this.windowInventory.listWindows()
      } catch (error) {
        log.warn('Computer window inventory unavailable during verification', {
          computerSessionId: session.id,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
    return this.verification.verify(session.taskContract.successCriteria, observation, {
      ...(windows == null ? {} : { windows }),
      // The model only reaches this branch after visually inspecting the latest screenshot.
      // The engine may use that approval for visual-only criteria when the native tree has no
      // evidence, while accessibility and application-state assertions remain deterministic.
      modelVisualApproval,
    })
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

  private async readDecisionEvidence(
    computerSessionId: string,
    initialObservation: ComputerObservation,
  ): Promise<{ observation: ComputerObservation; screenshot: Buffer }> {
    let observation = initialObservation
    for (let attempt = 0; attempt <= MAX_DECISION_RECOVERIES; attempt += 1) {
      try {
        return {
          observation,
          screenshot: await this.evidence.readLatestImage(
            computerSessionId,
            observation.screenshot.snapshotId,
          ),
        }
      } catch (error) {
        if (attempt === MAX_DECISION_RECOVERIES) {
          log.warn('Computer screenshot evidence unavailable; continuing with AX state', {
            computerSessionId,
            error: error instanceof Error ? error.message : String(error),
          })
          return { observation, screenshot: Buffer.alloc(0) }
        }
        observation = await this.observeWithRecovery(computerSessionId, true)
      }
    }
    return { observation, screenshot: Buffer.alloc(0) }
  }

  private async dispatchDirectly(envelope: ComputerActionEnvelope): Promise<{
    observation: ComputerObservation
    noop: boolean
    executionChannel?: ComputerExecutionChannel | null
  }> {
    try {
      return await this.broker.dispatch(envelope)
    } catch (error) {
      // The decision-time frame may drift while the target window stays put. Re-observe and
      // retry the same action once against the refreshed frame before returning the recoverable
      // error to the model loop.
      if (error instanceof ComputerUseBrokerError && error.code === 'stale_frame') {
        const relocated = await this.relocateStaleFrame(envelope)
        if (relocated != null) return relocated
      }
      throw error
    }
  }

  /**
   * Local deterministic recovery for a stale frame. Re-observes the same window; if the
   * foreground app/window identity is unchanged it rebuilds the envelope against the refreshed
   * frame and retries the exact same action once. A real window change returns control to the
   * model loop for a new decision.
   */
  private async relocateStaleFrame(envelope: ComputerActionEnvelope): Promise<{
    observation: ComputerObservation
    noop: boolean
    executionChannel?: ComputerExecutionChannel | null
  } | null> {
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

function actionFailureContext(
  error: ComputerUseBrokerError,
  action: ComputerAction,
  consecutiveFailures: number,
  failedStrategies: Set<ComputerInteractionStrategy>,
  requiredAlternative: boolean,
): ComputerActionFailureContext {
  return {
    code: error.code,
    actionType: action.type,
    consecutiveFailures,
    failedStrategies: [...failedStrategies],
    requiredAlternative,
  }
}

function verificationFailureContext(
  verification: ReturnType<ComputerVerificationEngine['verify']>,
): ComputerVerificationFailureContext {
  return {
    failedCriteria: verification.results.reduce<string[]>((failed, result, index) => {
      if (!result.passed) failed.push(`${index}:${result.reason}`)
      return failed
    }, []),
    unsupportedCriteria: verification.results.filter(
      (result) => result.reason === 'unsupported_evidence',
    ).length,
  }
}

function interactionStrategyFor(action: ComputerAction): ComputerInteractionStrategy {
  switch (action.type) {
    case 'invoke_element':
    case 'set_value':
    case 'select_text':
      return 'accessibility'
    case 'click':
    case 'move':
    case 'drag':
    case 'scroll':
      return 'pointer'
    case 'keypress':
    case 'type_text':
      return 'keyboard'
    case 'focus_window':
      return 'window_focus'
    case 'app_command':
      return 'native_command'
    case 'observe':
    case 'wait_for':
      return 'wait'
  }
  return 'wait'
}

function recoveryDelay(attempt: number): number {
  return Math.min(2_000, 150 * 2 ** Math.max(0, attempt - 1))
}

const MAX_RECENT_ACTIONS = 12

function rememberRecentAction(
  history: ComputerRecentAction[],
  action: ComputerAction,
  intent: string,
  outcome: ComputerRecentAction['outcome'],
  observation: ComputerObservation,
  errorCode?: string,
  executionChannel?: ComputerExecutionChannel | null,
): void {
  history.push({
    action: summarizeAction(action),
    intent: intent.slice(0, 300),
    outcome,
    resultingAppId: observation.foreground.app.id,
    resultingWindowId: observation.foreground.window.id,
    ...(errorCode == null ? {} : { errorCode }),
    ...(executionChannel == null ? {} : { executionChannel }),
  })
  if (history.length > MAX_RECENT_ACTIONS) history.splice(0, history.length - MAX_RECENT_ACTIONS)
}

function summarizeAction(action: ComputerAction): Readonly<Record<string, unknown>> {
  switch (action.type) {
    case 'type_text':
      return { type: action.type, textLength: action.text.length }
    case 'set_value':
      return { type: action.type, elementId: action.elementId, valueLength: action.value.length }
    case 'select_text':
      return { type: action.type, elementId: action.elementId, textLength: action.text.length }
    case 'app_command':
      return { type: action.type, name: action.command.name }
    default:
      return action
  }
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
  observation: ComputerObservation,
  decision: Extract<ComputerDecision, { type: 'action' }>,
  actionId: string,
): ComputerActionEnvelope {
  return {
    computerSessionId: session.id,
    actionId,
    actuatorLeaseId: session.id,
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
  const appPrefill = action.type === 'app_command' && action.command.name === 'prefill_composer'
  const localWrite = action.type === 'type_text' || action.type === 'set_value' || appPrefill
  const committingIntent =
    /\b(send|submit|publish|post|purchase|buy|pay|delete|remove|confirm|book|order)\b|发送|提交|发布|购买|支付|删除|确认|预订|下单/iu.test(
      intent,
    )
  const reversibleLocal =
    localWrite ||
    action.type === 'app_command' ||
    action.type === 'focus_window' ||
    action.type === 'select_text' ||
    action.type === 'click' ||
    action.type === 'drag' ||
    action.type === 'keypress' ||
    (action.type === 'invoke_element' && action.action != null && action.action !== 'invoke')
  const sensitive =
    action.type === 'type_text' || action.type === 'set_value'
      ? action.sensitive === true
      : action.type === 'app_command' &&
        action.command.name === 'prefill_composer' &&
        action.command.sensitive === true
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
