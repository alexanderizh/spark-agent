import type { ComputerDecisionModelConfig } from '@spark/agent-runtime'
import {
  ComputerTaskContractSchema,
  VerificationSpecSchema,
  type ComputerSession,
  type ComputerUseCapabilitySummary,
  type NativeHostCapabilityManifest,
  type NativeWindowDescriptor,
} from '@spark/protocol'
import { z } from 'zod'
import { createLogger } from '@spark/shared'
import { GenericComputerDecisionAdapter } from './ComputerDecisionAdapter.js'
import { ComputerTaskOperator, type ComputerTaskOperatorResult } from './ComputerTaskOperator.js'
import { ComputerUseBrokerError } from './ComputerUseBrokerError.js'
import { getComputerUseServices, type ComputerUseServices } from './ComputerUseServices.js'
import { getComputerUseV2FlagStore } from './computerUseV2Flags.js'

const log = createLogger('computer-use-agent-controller')

interface BoundAgentRuntime {
  turnId: string
  providerProfileId: string
  modelId: string
  permissionMode: string
}

interface OperatorRunState {
  status: 'running' | ComputerTaskOperatorResult['status']
  result?: ComputerTaskOperatorResult
}

const WAIT_RETURN_STATUSES = new Set<ComputerSession['status']>([
  'completed',
  'failed',
  'canceled',
  'paused',
  'waiting_approval',
  'handoff_required',
])

export class ComputerUseAgentController {
  private readonly getServices: () => ComputerUseServices
  private readonly resolveDecisionModel: (sessionId: string) => Promise<ComputerDecisionModelConfig>
  private readonly createAdapter: (
    model: ComputerDecisionModelConfig,
  ) => GenericComputerDecisionAdapter
  private readonly createOperator: (services: ComputerUseServices) => ComputerTaskOperator
  private readonly sessionContexts = new Map<string, BoundAgentRuntime>()
  private readonly runs = new Map<string, OperatorRunState>()
  private readonly runTokens = new Map<string, object>()
  private readonly runCompletions = new Map<string, Promise<void>>()

  constructor(
    options: {
      getServices?: () => ComputerUseServices
      resolveDecisionModel?: (sessionId: string) => Promise<ComputerDecisionModelConfig>
      createAdapter?: (model: ComputerDecisionModelConfig) => GenericComputerDecisionAdapter
      createOperator?: (services: ComputerUseServices) => ComputerTaskOperator
    } = {},
  ) {
    this.getServices = options.getServices ?? getComputerUseServices
    this.resolveDecisionModel =
      options.resolveDecisionModel ??
      (async () => {
        throw unavailable('The current Agent provider cannot be resolved for Computer Use')
      })
    this.createAdapter =
      options.createAdapter ?? ((model) => new GenericComputerDecisionAdapter({ model }))
    this.createOperator =
      options.createOperator ??
      ((services) => {
        if (services.evidence == null) {
          throw unavailable('Computer observation evidence is unavailable')
        }
        return new ComputerTaskOperator({
          sessions: services.sessions,
          broker: services.broker,
          evidence: services.evidence,
          verifications: services.verifications,
          windowInventory: services.backend,
          getAbortSignal: (computerSessionId) =>
            services.sessions.getAbortSignal(computerSessionId),
          timeline: services.timeline,
        })
      })
  }

  bindSessionContext(sessionId: string, context: BoundAgentRuntime): void {
    this.sessionContexts.set(sessionId, { ...context })
  }

  async stopOwnedSessions(sessionId: string): Promise<void> {
    const services = this.getServices()
    const ownedSessionIds = services.sessions
      .listActiveSessionIds()
      .filter(
        (computerSessionId) =>
          services.sessions.getSession(computerSessionId)?.sessionId === sessionId,
      )
    const results = await Promise.allSettled(
      ownedSessionIds.map(async (computerSessionId) => {
        await services.broker.stop(computerSessionId)
        services.coordinator.release(computerSessionId)
        this.invalidateRun(services, computerSessionId)
      }),
    )
    this.sessionContexts.delete(sessionId)
    const failures = results.filter((result) => result.status === 'rejected')
    if (failures.length > 0) {
      log.warn('Failed to stop one or more Computer Use sessions while revoking Agent control', {
        sessionId,
        failureCount: failures.length,
      })
    }
  }

  async promptCapabilities(): Promise<{
    platform: ComputerUseCapabilitySummary['platform']
    available: boolean
    executionAvailable: boolean
    unavailableReason?: string
  }> {
    const services = this.getServices()
    const capabilities = await services.backend.getCapabilities()
    const executionAvailable = supportsExecution(capabilities)
    return {
      platform: capabilities.platform,
      available: capabilities.available,
      executionAvailable,
      ...(capabilities.unavailableReason != null
        ? { unavailableReason: capabilities.unavailableReason }
        : !executionAvailable
          ? {
              unavailableReason: 'governed_task_execution_unavailable',
            }
          : {}),
    }
  }

  async invoke(sessionId: string, toolName: string, args: unknown): Promise<unknown> {
    const services = this.getServices()
    switch (toolName) {
      case 'get_capabilities': {
        const capabilities = await services.backend.getCapabilities()
        return {
          ...capabilities,
          releaseChannel: 'beta',
          executionAvailable: supportsExecution(capabilities),
          killSwitchArmed: services.killSwitch.isArmed(),
          v2Flags: getComputerUseV2FlagStore().snapshot(),
          taskTools: [
            'get_capabilities',
            'diagnose_native_host',
            'capture_app_snapshot',
            'start_task',
            'get_status',
            'wait_for_completion',
            'pause',
            'resume',
            'stop',
            'takeover',
            'bind_target',
          ],
        }
      }
      case 'diagnose_native_host':
        return services.diagnostics.collect()
      case 'get_status': {
        const computerSession = this.requireOwnedSession(services, sessionId, args)
        return this.statusPayload(computerSession)
      }
      case 'wait_for_completion': {
        const computerSession = this.requireOwnedSession(services, sessionId, args)
        const { timeoutMs } = parseWaitForCompletion(args)
        return this.waitForCompletion(services, computerSession, timeoutMs)
      }
      case 'bind_target': {
        const computerSession = this.requireOwnedSession(services, sessionId, args)
        if (computerSession.status !== 'paused') {
          throw new ComputerUseBrokerError(
            'action_not_allowed',
            'Pause the Computer Use task before changing its bound target window',
          )
        }
        const targetWindowId = readTargetWindowId(args)
        const target = requireTargetWindowById(await services.backend.listWindows(), targetWindowId)
        services.backend.bindSessionTarget?.({
          computerSessionId: computerSession.id,
          appId: target.app.id,
          windowId: target.window.id,
        })
        return { computerSession, targetWindowId: target.window.id }
      }
      case 'pause': {
        const computerSession = this.requireOwnedSession(services, sessionId, args)
        const paused = await services.broker.pause(computerSession.id)
        services.coordinator.release(computerSession.id)
        this.invalidateRun(services, computerSession.id)
        return { computerSession: paused }
      }
      case 'stop': {
        const computerSession = this.requireOwnedSession(services, sessionId, args)
        const stopped = await services.broker.stop(computerSession.id)
        services.coordinator.release(computerSession.id)
        this.invalidateRun(services, computerSession.id)
        return { computerSession: stopped }
      }
      case 'takeover': {
        const computerSession = this.requireOwnedSession(services, sessionId, args)
        const paused = await services.broker.pause(computerSession.id)
        services.coordinator.release(computerSession.id)
        this.invalidateRun(services, computerSession.id)
        return { computerSession: paused }
      }
      case 'resume': {
        const computerSession = this.requireOwnedSession(services, sessionId, args)
        const context = this.sessionContexts.get(sessionId)
        if (context == null) throw unavailable('Agent turn context is unavailable')
        if (computerSession.status !== 'paused') {
          throw new ComputerUseBrokerError(
            'action_not_allowed',
            'Only a paused Computer Use task can be resumed',
          )
        }
        const model = await this.resolveDecisionModel(sessionId)
        const operator = this.createOperator(services)
        const adapter = this.createAdapter(model)
        this.invalidateRun(services, computerSession.id)
        try {
          await services.coordinator.claim(computerSession.id)
          const resumed = services.broker.resume(computerSession.id)
          this.launchOperator(services, resumed, operator, adapter)
          return { computerSession: resumed, operatorStatus: 'running' }
        } catch (error) {
          try {
            await services.broker.pause(computerSession.id).catch(() => undefined)
          } finally {
            services.coordinator.release(computerSession.id)
          }
          throw error
        }
      }
      case 'capture_app_snapshot': {
        const context = this.sessionContexts.get(sessionId)
        if (context == null) throw unavailable('Agent turn context is unavailable')
        if (services.snapshots == null) {
          throw unavailable('Trusted application snapshot capture is unavailable')
        }
        const request = parseSnapshotCapture(args)
        const snapshot = await services.snapshots.captureFrontmost({
          sessionId,
          turnId: context.turnId,
          accessibleTextMode: request.accessibleTextMode,
        })
        if (snapshot.previewUrl == null) {
          throw unavailable('The application snapshot did not receive a preview capability')
        }
        return {
          snapshot,
          preview: {
            type: 'image',
            url: snapshot.previewUrl,
            alt: `${snapshot.app.name} — ${snapshot.window.title}`,
          },
        }
      }
      case 'start_task': {
        const capabilities = await getExecutionCapabilitiesWithPermissionRequest(services.backend)
        if (!supportsExecution(capabilities)) {
          throw executionUnavailable(capabilities)
        }
        const context = this.sessionContexts.get(sessionId)
        if (context == null) throw unavailable('Agent turn context is unavailable')
        const request = parseStartTask(args)
        if (request.environment !== 'my_desktop') {
          throw unavailable('This build currently provides governed execution only on My Desktop')
        }
        const windows = await services.backend.listWindows()
        const target = requireTargetWindow(windows, request.targetWindowId)
        const model = await this.resolveDecisionModel(sessionId)
        const successCriteria =
          request.successCriteria.length > 0
            ? request.successCriteria
            : deriveSuccessCriteria(request.goal, target)
        const taskContract = ComputerTaskContractSchema.parse({
          objective: request.goal,
          successCriteria,
          allowedApps: [],
          allowedDomains: [],
          allowedDataClasses: ['public', 'internal', 'personal'],
          forbiddenActions: [],
          maxSteps: 100,
          maxRuntimeMs: 20 * 60_000,
          maxConsecutiveNoops: 8,
          userPresence: 'required',
        })
        const computerSession = services.sessions.createSession({
          sessionId,
          turnId: context.turnId,
          workflowRunId: null,
          environment: request.environment,
          providerProfileId: model.providerProfileId,
          modelId: model.model,
          taskContract,
        })
        if (request.targetWindowId != null) {
          services.backend.bindSessionTarget?.({
            computerSessionId: computerSession.id,
            appId: target.app.id,
            windowId: target.window.id,
          })
        }
        try {
          await services.coordinator.claim(computerSession.id)
          const activeSession = services.sessions.activate(computerSession.id)
          const operator = this.createOperator(services)
          const adapter = this.createAdapter(model)
          this.launchOperator(services, activeSession, operator, adapter)
          return {
            computerSession: activeSession,
            operatorStatus: 'running',
          }
        } catch (error) {
          try {
            await services.broker.stop(computerSession.id).catch(() => undefined)
            await this.releaseOperatorResources(services, computerSession.id, 'failed')
          } finally {
            services.coordinator.release(computerSession.id)
          }
          throw error
        }
      }
      default:
        throw new ComputerUseBrokerError('action_not_allowed', 'Unknown Computer Use task tool')
    }
  }

  private launchOperator(
    services: ComputerUseServices,
    session: ComputerSession,
    operator: ComputerTaskOperator,
    adapter: GenericComputerDecisionAdapter,
  ): void {
    const token = {}
    this.runTokens.set(session.id, token)
    this.runs.set(session.id, { status: 'running' })
    const run = operator.run({ session, adapter })
    const completion = run.then(
      async (result) => {
        if (this.runTokens.get(session.id) !== token) return
        this.runTokens.delete(session.id)
        await this.releaseOperatorResources(services, session.id, 'finished')
        services.coordinator.release(session.id)
        this.runs.set(session.id, { status: result.status, result })
        this.trimRunStates()
      },
      async (error) => {
        if (this.runTokens.get(session.id) !== token) return
        this.runTokens.delete(session.id)
        await this.releaseOperatorResources(services, session.id, 'failed')
        services.coordinator.release(session.id)
        const result: ComputerTaskOperatorResult = {
          status: 'failed',
          reason:
            error instanceof ComputerUseBrokerError
              ? error.code
              : error instanceof Error && error.message.trim().length > 0
                ? error.message.slice(0, 500)
                : 'operator_failed',
        }
        this.runs.set(session.id, { status: result.status, result })
        this.trimRunStates()
      },
    )
    this.runCompletions.set(session.id, completion)
    void completion.finally(() => {
      if (this.runCompletions.get(session.id) === completion) {
        this.runCompletions.delete(session.id)
      }
    })
  }

  private invalidateRun(services: ComputerUseServices, computerSessionId: string): void {
    this.runTokens.delete(computerSessionId)
    this.runs.delete(computerSessionId)
    services.evidence?.clearSession(computerSessionId)
    services.coordinator.release(computerSessionId)
  }

  private async releaseOperatorResources(
    services: ComputerUseServices,
    computerSessionId: string,
    outcome: 'finished' | 'failed',
  ): Promise<void> {
    services.evidence?.clearSession(computerSessionId)
    services.appControlBridge?.cancelSession(computerSessionId)
    if (services.backend == null || typeof services.backend.cancelSession !== 'function') return
    await services.backend.cancelSession(computerSessionId).catch((error) =>
      log.warn(`Failed to release Native Host resources after Computer Use ${outcome}`, {
        computerSessionId,
        error: error instanceof Error ? error.message : String(error),
      }),
    )
  }

  private statusPayload(
    computerSession: ComputerSession,
    timedOut = false,
  ): Record<string, unknown> {
    const operator = this.runs.get(computerSession.id) ?? { status: 'not_running' as const }
    return {
      computerSession,
      operator,
      ...(timedOut ? { timedOut: true } : {}),
      ...(operator.status === 'failed' || computerSession.status === 'failed'
        ? {
            continuation: {
              action: 'report_computer_task_failure',
              askUserToChooseFallback: true,
            },
          }
        : {}),
    }
  }

  private waitForCompletion(
    services: ComputerUseServices,
    initial: ComputerSession,
    timeoutMs: number,
  ): Promise<Record<string, unknown>> {
    if (WAIT_RETURN_STATUSES.has(initial.status) && !this.runCompletions.has(initial.id)) {
      return Promise.resolve(this.statusPayload(initial))
    }
    return new Promise((resolve) => {
      let settled = false
      let unsubscribe = (): void => undefined
      const finish = (session: ComputerSession, timedOut = false) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        unsubscribe()
        resolve(
          this.statusPayload(services.sessions.getSession(initial.id) ?? session, timedOut),
        )
      }
      const finishAfterCleanup = async (session: ComputerSession) => {
        await this.runCompletions.get(initial.id)
        finish(session)
      }
      unsubscribe = services.sessions.subscribeStatus((session) => {
        if (session.id === initial.id && WAIT_RETURN_STATUSES.has(session.status)) {
          const projectionTimer = setTimeout(() => void finishAfterCleanup(session), 0)
          projectionTimer.unref?.()
        }
      })
      const timer = setTimeout(() => {
        finish(services.sessions.getSession(initial.id) ?? initial, true)
      }, timeoutMs)
      timer.unref?.()
      const current = services.sessions.getSession(initial.id)
      if (current != null && WAIT_RETURN_STATUSES.has(current.status)) {
        const projectionTimer = setTimeout(() => void finishAfterCleanup(current), 0)
        projectionTimer.unref?.()
      }
    })
  }

  private trimRunStates(): void {
    while (this.runs.size > 1_000) {
      const oldest = this.runs.keys().next().value
      if (oldest == null) break
      this.runs.delete(oldest)
    }
  }

  private requireOwnedSession(
    services: ComputerUseServices,
    sessionId: string,
    args: unknown,
  ): ComputerSession {
    const computerSessionId = readComputerSessionId(args)
    const computerSession = services.sessions.getSession(computerSessionId)
    if (computerSession == null || computerSession.sessionId !== sessionId) {
      throw new ComputerUseBrokerError(
        'action_not_allowed',
        'Computer Use session does not belong to this Agent session',
      )
    }
    return computerSession
  }
}

const StartTaskSchema = z
  .object({
    goal: z.string().trim().min(1).max(4_000),
    environment: z.literal('my_desktop'),
    successCriteria: z.array(VerificationSpecSchema).min(1).max(100).optional(),
    acceptanceCriteria: z.array(z.string().trim().min(1).max(1_000)).min(1).max(50).optional(),
    targetWindowId: z.string().trim().min(1).max(256).optional(),
  })
  .strict()

const SnapshotCaptureSchema = z
  .object({
    accessibleTextMode: z.enum(['visible_only', 'app_exposed']).default('visible_only'),
  })
  .strict()

const WaitForCompletionSchema = z
  .object({
    computerSessionId: z.string().trim().min(1).max(200),
    timeoutMs: z.number().int().min(100).max(300_000).default(120_000),
  })
  .strict()

function parseWaitForCompletion(args: unknown): z.infer<typeof WaitForCompletionSchema> {
  const parsed = WaitForCompletionSchema.safeParse(args)
  if (!parsed.success) throw invalidArguments()
  return parsed.data
}

function parseSnapshotCapture(args: unknown): z.infer<typeof SnapshotCaptureSchema> {
  const parsed = SnapshotCaptureSchema.safeParse(args)
  if (!parsed.success) throw invalidArguments()
  return parsed.data
}

function parseStartTask(args: unknown): {
  goal: string
  environment: 'safe_browser' | 'safe_desktop' | 'my_desktop'
  successCriteria: z.infer<typeof VerificationSpecSchema>[]
  targetWindowId?: string
} {
  const parsed = StartTaskSchema.safeParse(args)
  if (!parsed.success) throw invalidArguments()
  return {
    goal: parsed.data.goal,
    environment: parsed.data.environment,
    ...(parsed.data.targetWindowId == null ? {} : { targetWindowId: parsed.data.targetWindowId }),
    successCriteria:
      parsed.data.successCriteria ??
      (parsed.data.acceptanceCriteria ?? []).map((expected) => ({
        kind: 'visual' as const,
        assertion: { operator: 'text_present' as const, expected },
      })),
  }
}

function deriveSuccessCriteria(
  goal: string,
  target: NativeWindowDescriptor,
): z.infer<typeof VerificationSpecSchema>[] {
  const quotedText = [...goal.matchAll(/"([^"\n]{1,200})"|“([^”\n]{1,200})”/g)]
    .map((match) => (match[1] ?? match[2] ?? '').trim())
    .filter((value) => value.length > 0)
    .sort((left, right) => right.length - left.length)[0]
  const expectedText = quotedText ?? inferExpectedVisibleText(goal)
  if (expectedText != null) {
    return [
      {
        kind: 'visual',
        assertion: { operator: 'text_present', expected: expectedText },
      },
    ]
  }
  return [
    {
      kind: 'application_state',
      appId: target.app.id,
      assertion: { operator: 'frontmost', expected: true },
    },
  ]
}

function inferExpectedVisibleText(goal: string): string | null {
  const candidates = [
    /(?:输入|键入|填写|选择)\s*[:：]?\s*([\p{L}\p{N}][^，。！？,!?\n]{0,199})/u,
    /(?:搜索|查找)(?!框|栏|按钮)\s*[:：]?\s*([\p{L}\p{N}][^，。！？,!?\n]{0,199})/u,
    /\b(?:search(?:\s+for)?|find|type|enter|fill(?:\s+in)?)\s+(.{1,200}?)(?=\s+(?:in|on|into)\b|[.!?\n]|$)/iu,
  ]
  for (const pattern of candidates) {
    const value = pattern.exec(goal)?.[1]?.trim().replace(/\s+/g, ' ')
    if (value != null && value.length > 0) return value.slice(0, 200)
  }
  return null
}

function requireTargetWindow(
  windows: NativeWindowDescriptor[],
  targetWindowId?: string,
): NativeWindowDescriptor {
  if (targetWindowId != null) {
    const target = windows.find(
      (window) => window.window.id === targetWindowId && !window.minimized,
    )
    if (target != null) return target
    throw unavailable('The selected target window is unavailable')
  }
  const focused = windows.filter((window) => window.focused && !window.minimized)
  if (focused[0] != null) return largestWindow(focused)
  const visible = windows.filter((window) => !window.minimized)
  if (visible.length > 0) return largestWindow(visible)
  throw new ComputerUseBrokerError('focus_mismatch', 'No controllable window was found')
}

function requireTargetWindowById(
  windows: NativeWindowDescriptor[],
  targetWindowId: string,
): NativeWindowDescriptor {
  const target = windows.find((window) => window.window.id === targetWindowId && !window.minimized)
  if (target == null) throw unavailable('The selected target window is unavailable')
  return target
}

function largestWindow(windows: NativeWindowDescriptor[]): NativeWindowDescriptor {
  return [...windows].sort(
    (left, right) =>
      right.window.bounds.width * right.window.bounds.height -
      left.window.bounds.width * left.window.bounds.height,
  )[0] as NativeWindowDescriptor
}

function supportsExecution(capabilities: ComputerUseCapabilitySummary): boolean {
  const features = capabilities.nativeHost?.features
  const screenAvailable =
    capabilities.permissions.screen === 'granted' && features?.captureWindow === true
  const semanticExecution = features?.fullTree === true && features.semanticActions === true
  const coordinateExecution =
    capabilities.permissions.input === 'granted' && features?.absolutePointer === true
  const keyboardExecution =
    capabilities.permissions.input === 'granted' && features?.keyboard === true
  return (
    capabilities.available &&
    screenAvailable &&
    features != null &&
    (semanticExecution || coordinateExecution || keyboardExecution)
  )
}

export async function getExecutionCapabilitiesWithPermissionRequest(backend: {
  getCapabilities(): Promise<ComputerUseCapabilitySummary>
  requestPermissions?: (
    permissions: Array<'screen' | 'accessibility'>,
  ) => Promise<NativeHostCapabilityManifest>
}): Promise<ComputerUseCapabilitySummary> {
  const initial = await backend.getCapabilities()
  if (
    supportsExecution(initial) ||
    initial.nativeHost == null ||
    backend.requestPermissions == null
  ) {
    return initial
  }
  const permissions: Array<'screen' | 'accessibility'> = []
  if (initial.permissions.screen !== 'granted') permissions.push('screen')
  if (initial.permissions.accessibility !== 'granted' || initial.permissions.input !== 'granted') {
    permissions.push('accessibility')
  }
  if (permissions.length === 0) return initial
  try {
    await backend.requestPermissions(permissions)
  } catch {
    // A denied OS prompt is an unavailable capability, not a reason to abort fallback routing.
  }
  return backend.getCapabilities().catch(() => initial)
}

function readComputerSessionId(args: unknown): string {
  if (args == null || typeof args !== 'object' || Array.isArray(args)) throw invalidArguments()
  const value = (args as Record<string, unknown>).computerSessionId
  if (typeof value !== 'string' || value.trim() === '' || value.length > 200) {
    throw invalidArguments()
  }
  return value
}

function readTargetWindowId(args: unknown): string {
  if (args == null || typeof args !== 'object' || Array.isArray(args)) throw invalidArguments()
  const value = (args as Record<string, unknown>).targetWindowId
  if (typeof value !== 'string' || value.trim() === '' || value.length > 256) {
    throw invalidArguments()
  }
  return value
}

function invalidArguments(): ComputerUseBrokerError {
  return new ComputerUseBrokerError(
    'action_not_allowed',
    'Invalid Computer Use tool arguments. For start_task use at least {"goal":"...","environment":"my_desktop"}; for status/control tools pass {"computerSessionId":"..."}.',
  )
}

function unavailable(message: string): ComputerUseBrokerError {
  return new ComputerUseBrokerError('environment_unavailable', message)
}

function executionUnavailable(capabilities: ComputerUseCapabilitySummary): ComputerUseBrokerError {
  if (capabilities.nativeHost == null) {
    return new ComputerUseBrokerError(
      'native_host_missing',
      'The trusted Computer Use Native Host is unavailable',
    )
  }
  if (capabilities.permissions.screen !== 'granted') {
    return new ComputerUseBrokerError(
      'screen_permission_denied',
      'Screen Recording permission is required for Computer Use',
    )
  }
  if (capabilities.permissions.accessibility !== 'granted') {
    return new ComputerUseBrokerError(
      'accessibility_permission_denied',
      'Accessibility permission is required for this Computer Use task',
    )
  }
  if (capabilities.permissions.input !== 'granted') {
    return new ComputerUseBrokerError(
      'privilege_mismatch',
      'Input control permission is required for this Computer Use task',
    )
  }
  return new ComputerUseBrokerError(
    'native_host_incompatible',
    capabilities.unavailableReason ??
      'The trusted Native Host does not advertise compatible observation and input features',
  )
}
