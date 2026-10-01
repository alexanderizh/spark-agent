import { randomUUID } from 'node:crypto'
import type {
  ComputerAction,
  ComputerActionEnvelope,
  ComputerExecutionChannel,
  ComputerObservation,
  ComputerSession,
  ComputerSessionStatus,
} from '@spark/protocol'
import { ComputerTaskContractSchema } from '@spark/protocol'
import { createLogger } from '@spark/shared'
import { policyContextFor } from './ComputerActionPolicyContext.js'
import { ComputerUseBrokerError } from './ComputerUseBrokerError.js'
import type { ComputerUseServices } from './ComputerUseServices.js'

const log = createLogger('computer-use-atomic')

/** Error codes worth one re-observe + retry before surfacing to the model. */
const STALE_ERROR_CODES = new Set(['stale_frame', 'stale_tree', 'focus_mismatch'])

/**
 * Statuses under which an implicit computer session can serve another atomic
 * tool call. Mirrors the session manager's executable set — note there is no
 * "active" status in the schema, so testing for one silently discarded the
 * session on every call and leaked one dangling session per tool call.
 */
const REUSABLE_STATUSES: ReadonlySet<ComputerSessionStatus> = new Set([
  'preflighting',
  'observing',
  'planning',
  'waiting_approval',
  'acting',
])

/**
 * How long the implicit session stays armed after the last atomic tool call.
 * The conversational model owns no background loop: once it stops calling
 * tools (turn finished, aborted, or just thinking for a long while) nothing
 * will drive this session again soon, while the native host keeps a screen
 * capture stream alive and the PIP panel shows "observing" until it is
 * stopped. Releasing on idle closes both; the next tool call transparently
 * re-arms a fresh session.
 *
 * Generous on purpose: reasoning models routinely think for minutes between
 * tool calls, and a short timer visibly tears the task card down and up
 * mid-task ("断断续续") while forcing a stream restart on every call. The
 * macOS capture stream outlives the session and parks on its own frame-idle
 * timeout (300s, aligned with this release window) — it clears the screen
 * sharing indicator in lockstep with the session teardown instead of
 * restarting mid-task.
 */
const IDLE_RELEASE_MS = 300_000

const ATOMIC_TASK_CONTRACT = ComputerTaskContractSchema.parse({
  objective: 'Agent-directed atomic desktop control',
  successCriteria: [
    {
      kind: 'application_state' as const,
      appId: 'desktop',
      assertion: { operator: 'running' as const, expected: true },
    },
  ],
  allowedApps: [],
  allowedDomains: [],
  allowedDataClasses: ['public', 'internal', 'personal'],
  forbiddenActions: [],
  maxSteps: 2_000,
  maxRuntimeMs: 12 * 60 * 60_000,
  maxConsecutiveNoops: 20,
  userPresence: 'required',
})

interface AtomicSessionState {
  computerSessionId: string
  lastObservation: ComputerObservation | null
}

export interface AtomicDispatchResult {
  observation: ComputerObservation
  noop: boolean
  executionChannel: ComputerExecutionChannel | null
}

/**
 * Gives the session model direct, governed access to desktop actions: one
 * implicit computer session per agent session, each tool call dispatches a
 * single action through the broker (policy → native host → skyshot) and
 * returns the fresh post-action state. This is the Codex-style decision
 * architecture — the conversational model IS the computer-use agent — while
 * `start_task` remains available as the delegated autonomous loop.
 */
export class ComputerAtomicActionService {
  private readonly states = new Map<string, AtomicSessionState>()
  private readonly idleTimers = new Map<string, NodeJS.Timeout>()

  constructor(
    private readonly services: ComputerUseServices,
    private readonly options: {
      resolveModel?: (sessionId: string) => Promise<{ providerProfileId: string; model: string }>
      createId?: () => string
      idleReleaseMs?: number
    } = {},
  ) {}

  /** Releases the implicit computer session of an agent session (agent teardown). */
  async releaseAgentSession(sessionId: string): Promise<void> {
    const state = this.states.get(sessionId)
    if (state == null) return
    this.states.delete(sessionId)
    this.clearIdleTimer(sessionId)
    try {
      await this.services.broker.stop(state.computerSessionId)
    } catch (error) {
      log.warn('Failed to stop implicit atomic computer session', { sessionId, error })
    } finally {
      this.services.coordinator.release(state.computerSessionId)
    }
  }

  private armIdleTimer(sessionId: string): void {
    this.clearIdleTimer(sessionId)
    const delay = this.options.idleReleaseMs ?? IDLE_RELEASE_MS
    const timer = setTimeout(() => {
      this.idleTimers.delete(sessionId)
      void this.releaseAgentSession(sessionId)
    }, delay)
    timer.unref?.()
    this.idleTimers.set(sessionId, timer)
  }

  private clearIdleTimer(sessionId: string): void {
    const timer = this.idleTimers.get(sessionId)
    if (timer == null) return
    clearTimeout(timer)
    this.idleTimers.delete(sessionId)
  }

  /** The implicit computer session id backing an agent session, when armed. */
  computerSessionIdFor(sessionId: string): string | null {
    return this.states.get(sessionId)?.computerSessionId ?? null
  }

  /**
   * The application the implicit session is currently observing, when armed.
   * Used as the resolution preference when the model re-binds by display name:
   * among same-named applications (dev vs packaged build) the one the session
   * already controls must win instead of whoever happens to hold focus.
   */
  boundAppIdFor(sessionId: string): string | null {
    return this.states.get(sessionId)?.lastObservation?.foreground.app.id ?? null
  }

  /**
   * Process id of the app the implicit session is observing, when armed.
   * Same-bundle applications (dev Electron vs another com.github.Electron
   * app) share one app id — the pid is the disambiguator that never misses.
   */
  boundProcessIdFor(sessionId: string): number | null {
    return this.states.get(sessionId)?.lastObservation?.foreground.app.processId ?? null
  }

  /**
   * Observes a window and refreshes the cached observation.
   *
   * `target` binds the implicit session to a specific app/window BEFORE the
   * observe, which is what makes a multi-app session work: the session contract
   * is "sticky app binding", so once bound, later observes and actions stay on
   * THAT app even while the user clicks around elsewhere. Passing an explicit
   * target is also how an observation tool (`get_app_state`, `screenshot
   * app=...`) hands its frame to the atomic tools: the tree the model is shown
   * is then literally the frame the next action resolves against, instead of two
   * independently-captured frames that disagree and surface as `stale_tree`.
   */
  async observe(
    sessionId: string,
    turnId: string,
    target?: { appId: string; windowId: string },
  ): Promise<ComputerObservation> {
    // Disarm on entry: a timer armed by the previous call must never abort an
    // in-flight observe/dispatch (slow reasoning models routinely think longer
    // than the idle window — the timer fired mid-action surfaced as a bogus
    // session_canceled).
    this.clearIdleTimer(sessionId)
    const state = await this.ensureSession(sessionId, turnId)
    if (target != null) this.bindTarget(state, target)
    const observation = await this.services.broker.observe(state.computerSessionId, true)
    state.lastObservation = observation
    this.armIdleTimer(sessionId)
    return observation
  }

  /**
   * Explicitly binds the implicit session to an app/window and drops the cached
   * frame so the next action re-observes the new target. This is the atomic
   * counterpart of `bind_target`, available without a delegated task: without it
   * the only way to change which app an atomic session controls was to let the
   * implicit session lapse and re-acquire whatever happened to be frontmost.
   */
  private bindTarget(state: AtomicSessionState, target: { appId: string; windowId: string }): void {
    this.services.backend.bindSessionTarget?.({
      computerSessionId: state.computerSessionId,
      appId: target.appId,
      windowId: target.windowId,
    })
    if (state.lastObservation?.foreground.window.id !== target.windowId) {
      state.lastObservation = null
    }
  }

  /** Binds by agent session id, arming the implicit session if needed. */
  async bindAgentSessionTarget(
    sessionId: string,
    turnId: string,
    target: { appId: string; windowId: string },
  ): Promise<void> {
    this.clearIdleTimer(sessionId)
    const state = await this.ensureSession(sessionId, turnId)
    this.bindTarget(state, target)
    this.armIdleTimer(sessionId)
  }

  /**
   * Dispatches one action built against the freshest observation. Stale
   * frames (UI moved between steps) transparently re-observe once and retry,
   * so the model does not burn a round trip on staleness recovery.
   */
  async dispatch(
    sessionId: string,
    turnId: string,
    buildAction: (observation: ComputerObservation) => ComputerAction,
    intent: string,
  ): Promise<AtomicDispatchResult> {
    // See observe(): disarm while an action is in flight.
    this.clearIdleTimer(sessionId)
    try {
      const state = await this.ensureSession(sessionId, turnId)
      if (state.lastObservation == null) {
        state.lastObservation = await this.services.broker.observe(state.computerSessionId, true)
      }
      try {
        return await this.dispatchOnce(state, buildAction, intent)
      } catch (error) {
        // Stale frame/tree AND focus_mismatch are all "the world moved under the
        // action" conditions: observe now self-heals onto the app's live window,
        // so one transparent re-observe + rebuild + retry recovers window churn
        // (Electron apps recreating windows) without burning a model round trip.
        if (error instanceof ComputerUseBrokerError && STALE_ERROR_CODES.has(error.code)) {
          state.lastObservation = await this.services.broker.observe(state.computerSessionId, true)
          return await this.dispatchOnce(state, buildAction, intent)
        }
        throw error
      }
    } finally {
      // Re-arm on BOTH success and failure: an abandoned-after-error task must
      // still release its session (and the capture stream behind it) once the
      // idle window lapses, instead of hanging "observing" forever.
      this.armIdleTimer(sessionId)
    }
  }

  private async dispatchOnce(
    state: AtomicSessionState,
    buildAction: (observation: ComputerObservation) => ComputerAction,
    intent: string,
  ): Promise<AtomicDispatchResult> {
    const observation = state.lastObservation
    if (observation == null) throw new ComputerUseBrokerError('stale_frame', 'No observation')
    const action = buildAction(observation)
    const envelope: ComputerActionEnvelope = {
      computerSessionId: state.computerSessionId,
      actionId: this.options.createId?.() ?? randomUUID(),
      actuatorLeaseId: state.computerSessionId,
      observedFrameId: observation.frameId,
      observedTreeVersion: observation.treeVersion,
      targetAppId: observation.foreground.app.id,
      targetWindowId: observation.foreground.window.id,
      action,
      // The native host infers the lane itself (macOS and Windows differ —
      // Windows rides the PostMessage background lane); sending a lane would
      // pin one platform's inference onto the other.
      policyContext: policyContextFor(action, observation, intent),
      intent,
    }
    const result = await this.services.broker.dispatch(envelope)
    state.lastObservation = result.observation
    return result
  }

  private async ensureSession(sessionId: string, turnId: string): Promise<AtomicSessionState> {
    const existing = this.states.get(sessionId)
    if (existing != null && this.isSessionAlive(existing.computerSessionId)) return existing
    if (existing != null) this.states.delete(sessionId)
    const model = await this.resolveModelSafely(sessionId)
    const created: ComputerSession = this.services.sessions.createSession({
      sessionId,
      turnId,
      workflowRunId: null,
      environment: 'my_desktop',
      providerProfileId: model.providerProfileId,
      modelId: model.model,
      taskContract: ATOMIC_TASK_CONTRACT,
    })
    this.services.sessions.activate(created.id)
    // Join the single desktop input lane. The agent-session lineage lets the
    // coordinator tell "my own start_task is running" (lane transfers, task
    // survives) from "another agent owns the desktop" (eviction), and release
    // on teardown/idle keeps the lane coherent with the kill switch.
    await this.services.coordinator.claim(created.id, sessionId)
    const state: AtomicSessionState = { computerSessionId: created.id, lastObservation: null }
    this.states.set(sessionId, state)
    return state
  }

  private isSessionAlive(computerSessionId: string): boolean {
    const session = this.services.sessions.getSession(computerSessionId)
    return session != null && REUSABLE_STATUSES.has(session.status)
  }

  private async resolveModelSafely(sessionId: string) {
    try {
      const model = await this.options.resolveModel?.(sessionId)
      if (model != null) return model
    } catch {
      // The atomic path does not depend on a decision model — the session
      // record keeps whatever identity is resolvable and proceeds regardless.
    }
    return { providerProfileId: 'unknown', model: 'unknown' }
  }
}
