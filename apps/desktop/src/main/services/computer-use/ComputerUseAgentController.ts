import type { ComputerDecisionModelConfig } from '@spark/agent-runtime'
import {
  ComputerTaskContractSchema,
  VerificationSpecSchema,
  type ComputerApprovalTicket,
  type ComputerActuatorLease,
  type ComputerSession,
  type ComputerUseCapabilitySummary,
  type NativeHostCapabilityManifest,
  type NativeWindowDescriptor,
} from '@spark/protocol'
import { z } from 'zod'
import { GenericComputerDecisionAdapter } from './ComputerDecisionAdapter.js'
import { ComputerTaskOperator, type ComputerTaskOperatorResult } from './ComputerTaskOperator.js'
import type { ComputerActionApprovalRequest } from './ComputerTaskOperator.js'
import { ComputerUseBrokerError } from './ComputerUseBrokerError.js'
import { getComputerUseServices, type ComputerUseServices } from './ComputerUseServices.js'
import { MY_DESKTOP_ENVIRONMENT_KEY } from './ComputerSessionManager.js'

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

export class ComputerUseAgentController {
  private readonly getServices: () => ComputerUseServices
  private readonly resolveDecisionModel: (sessionId: string) => Promise<ComputerDecisionModelConfig>
  private readonly createAdapter: (
    model: ComputerDecisionModelConfig,
  ) => GenericComputerDecisionAdapter
  private readonly createOperator: (services: ComputerUseServices) => ComputerTaskOperator
  private readonly requestActionApproval:
    | ((request: ComputerActionApprovalRequest) => Promise<ComputerApprovalTicket | null>)
    | undefined
  private readonly sessionContexts = new Map<string, BoundAgentRuntime>()
  private readonly runs = new Map<string, OperatorRunState>()
  private readonly runTokens = new Map<string, object>()

  constructor(
    options: {
      getServices?: () => ComputerUseServices
      resolveDecisionModel?: (sessionId: string) => Promise<ComputerDecisionModelConfig>
      createAdapter?: (model: ComputerDecisionModelConfig) => GenericComputerDecisionAdapter
      createOperator?: (services: ComputerUseServices) => ComputerTaskOperator
      requestActionApproval?: (
        request: ComputerActionApprovalRequest,
      ) => Promise<ComputerApprovalTicket | null>
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
    this.requestActionApproval = options.requestActionApproval
    this.createOperator =
      options.createOperator ??
      ((services) => {
        if (services.evidence == null) {
          throw unavailable('Computer observation evidence is unavailable')
        }
        return new ComputerTaskOperator({
          sessions: services.sessions,
          broker: services.broker,
          approvals: services.approvals,
          evidence: services.evidence,
          verifications: services.verifications,
          windowInventory: services.backend,
          ...(this.requestActionApproval == null
            ? {}
            : { requestApproval: this.requestActionApproval }),
        })
      })
  }

  bindSessionContext(sessionId: string, context: BoundAgentRuntime): void {
    this.sessionContexts.set(sessionId, { ...context })
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
          executionAvailable: supportsExecution(capabilities),
          killSwitchArmed: services.killSwitch.isArmed(),
          taskTools: [
            'get_capabilities',
            'capture_app_snapshot',
            'start_task',
            'get_status',
            'pause',
            'resume',
            'stop',
            'takeover',
          ],
        }
      }
      case 'get_status': {
        const computerSession = this.requireOwnedSession(services, sessionId, args)
        return {
          computerSession,
          operator: this.runs.get(computerSession.id) ?? { status: 'not_running' },
        }
      }
      case 'pause': {
        const computerSession = this.requireOwnedSession(services, sessionId, args)
        const paused = await services.broker.pause(computerSession.id)
        this.invalidateRun(services, computerSession.id)
        return { computerSession: paused }
      }
      case 'stop': {
        const computerSession = this.requireOwnedSession(services, sessionId, args)
        const stopped = await services.broker.stop(computerSession.id)
        this.invalidateRun(services, computerSession.id)
        return { computerSession: stopped }
      }
      case 'takeover': {
        const computerSession = this.requireOwnedSession(services, sessionId, args)
        const paused = await services.broker.pause(computerSession.id)
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
        const resumed = services.broker.resume(computerSession.id)
        let lease: ComputerActuatorLease
        try {
          lease = services.sessions.acquireLease({
            computerSessionId: computerSession.id,
            environmentKey: MY_DESKTOP_ENVIRONMENT_KEY,
            operatorId: `agent:${sessionId}`,
          })
        } catch (error) {
          await services.broker.pause(computerSession.id).catch(() => undefined)
          throw error
        }
        this.launchOperator(services, resumed, lease, operator, adapter, context.permissionMode)
        return { computerSession: resumed, operatorStatus: 'running' }
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
          throw unavailable(
            capabilities.unavailableReason ??
              'The trusted Native Host does not advertise governed observation and input',
          )
        }
        const context = this.sessionContexts.get(sessionId)
        if (context == null) throw unavailable('Agent turn context is unavailable')
        const request = parseStartTask(args)
        if (request.environment !== 'my_desktop') {
          throw unavailable('This build currently provides governed execution only on My Desktop')
        }
        const windows = await services.backend.listWindows()
        const target = requireFocusedWindow(windows)
        const model = await this.resolveDecisionModel(sessionId)
        const successCriteria =
          request.successCriteria.length > 0
            ? request.successCriteria
            : deriveSuccessCriteria(request.goal, target)
        const taskContract = ComputerTaskContractSchema.parse({
          objective: request.goal,
          successCriteria,
          allowedApps: allowedAppRules(target, windows),
          allowedDomains: [],
          allowedDataClasses: ['public', 'internal', 'personal'],
          forbiddenActions: [],
          maxSteps: 50,
          maxRuntimeMs: 10 * 60_000,
          maxConsecutiveNoops: 3,
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
        const lease = services.sessions.acquireLease({
          computerSessionId: computerSession.id,
          environmentKey: MY_DESKTOP_ENVIRONMENT_KEY,
          operatorId: `agent:${sessionId}`,
        })
        const operator = this.createOperator(services)
        const adapter = this.createAdapter(model)
        this.launchOperator(
          services,
          computerSession,
          lease,
          operator,
          adapter,
          context.permissionMode,
        )
        return { computerSession, operatorStatus: 'running' }
      }
      default:
        throw new ComputerUseBrokerError('action_not_allowed', 'Unknown Computer Use task tool')
    }
  }

  private launchOperator(
    services: ComputerUseServices,
    session: ComputerSession,
    lease: ComputerActuatorLease,
    operator: ComputerTaskOperator,
    adapter: GenericComputerDecisionAdapter,
    permissionMode: string,
  ): void {
    const token = {}
    this.runTokens.set(session.id, token)
    this.runs.set(session.id, { status: 'running' })
    const run = operator.run({ session, lease, adapter, permissionMode })
    void run.then(
      (result) => {
        if (this.runTokens.get(session.id) !== token) return
        this.runTokens.delete(session.id)
        services.evidence?.clearSession(session.id)
        this.runs.set(session.id, { status: result.status, result })
        this.trimRunStates()
      },
      () => {
        if (this.runTokens.get(session.id) !== token) return
        this.runTokens.delete(session.id)
        services.evidence?.clearSession(session.id)
        const result: ComputerTaskOperatorResult = {
          status: 'failed',
          reason: 'operator_failed',
        }
        this.runs.set(session.id, { status: result.status, result })
        this.trimRunStates()
      },
    )
  }

  private invalidateRun(services: ComputerUseServices, computerSessionId: string): void {
    this.runTokens.delete(computerSessionId)
    this.runs.delete(computerSessionId)
    services.evidence?.clearSession(computerSessionId)
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
  })
  .strict()

const SnapshotCaptureSchema = z
  .object({
    accessibleTextMode: z.enum(['visible_only', 'app_exposed']).default('visible_only'),
  })
  .strict()

function parseSnapshotCapture(args: unknown): z.infer<typeof SnapshotCaptureSchema> {
  const parsed = SnapshotCaptureSchema.safeParse(args)
  if (!parsed.success) throw invalidArguments()
  return parsed.data
}

function parseStartTask(args: unknown): {
  goal: string
  environment: 'safe_browser' | 'safe_desktop' | 'my_desktop'
  successCriteria: z.infer<typeof VerificationSpecSchema>[]
} {
  const parsed = StartTaskSchema.safeParse(args)
  if (!parsed.success) throw invalidArguments()
  return {
    goal: parsed.data.goal,
    environment: parsed.data.environment,
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
  if (quotedText != null) {
    return [
      {
        kind: 'visual',
        assertion: { operator: 'text_present', expected: quotedText },
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

function requireFocusedWindow(windows: NativeWindowDescriptor[]): NativeWindowDescriptor {
  const focused = windows.filter((window) => window.focused && !window.minimized)
  if (focused.length !== 1 || focused[0] == null) {
    throw new ComputerUseBrokerError(
      focused.length === 0 ? 'focus_mismatch' : 'native_host_incompatible',
      focused.length === 0
        ? 'No focused controllable window was found'
        : 'Native Host returned more than one focused window',
    )
  }
  return focused[0]
}

function strongestAppRule(
  target: NativeWindowDescriptor,
): ComputerSession['taskContract']['allowedApps'][number] {
  if (target.app.signingIdentity != null) {
    return { kind: 'signing_identity', value: target.app.signingIdentity }
  }
  if (target.app.bundleId != null) return { kind: 'bundle_id', value: target.app.bundleId }
  if (target.app.executableIdentity != null) {
    return { kind: 'executable_identity', value: target.app.executableIdentity }
  }
  return { kind: 'app_id', value: target.app.id }
}

function allowedAppRules(
  focused: NativeWindowDescriptor,
  windows: NativeWindowDescriptor[],
): ComputerSession['taskContract']['allowedApps'] {
  const rules: ComputerSession['taskContract']['allowedApps'] = []
  const seen = new Set<string>()
  for (const window of [focused, ...windows]) {
    const rule = strongestAppRule(window)
    const key = `${rule.kind}:${rule.value}`
    if (seen.has(key)) continue
    seen.add(key)
    rules.push(rule)
    if (rules.length >= 200) break
  }
  return rules
}

function supportsExecution(capabilities: ComputerUseCapabilitySummary): boolean {
  const features = capabilities.nativeHost?.features
  const semanticExecution = features?.semanticActions === true
  const coordinateExecution =
    capabilities.permissions.input === 'granted' && features?.absolutePointer === true
  const keyboardExecution =
    capabilities.permissions.input === 'granted' && features?.keyboard === true
  return (
    capabilities.available &&
    features != null &&
    features.fullTree &&
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

function invalidArguments(): ComputerUseBrokerError {
  return new ComputerUseBrokerError(
    'action_not_allowed',
    'Invalid Computer Use tool arguments. For start_task use at least {"goal":"...","environment":"my_desktop"}; for status/control tools pass {"computerSessionId":"..."}.',
  )
}

function unavailable(message: string): ComputerUseBrokerError {
  return new ComputerUseBrokerError('environment_unavailable', message)
}
