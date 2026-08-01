import type { IpcMainInvokeEvent } from 'electron'
import {
  ComputerAppIdentitySchema,
  ComputerUseSettingsSchema,
  NativeHostCapabilityManifestSchema,
  NativeWindowDescriptorSchema,
  VerificationSpecSchema,
} from '@spark/protocol'
import type {
  ComputerEnvironment,
  ComputerUseSettings,
  NativeWindowDescriptor,
} from '@spark/protocol'
import {
  ComputerVerificationRepository,
  SettingsRepository,
  type ComputerVerificationRow,
} from '@spark/storage'
import { getDatabase } from '../db.js'
import { ComputerUseBrokerError } from '../services/computer-use/ComputerUseBrokerError.js'
import {
  MY_DESKTOP_ENVIRONMENT_KEY,
  type CreateManagedComputerSessionInput,
} from '../services/computer-use/ComputerSessionManager.js'
import {
  getComputerUseServices,
  type ComputerUseServices,
} from '../services/computer-use/ComputerUseServices.js'
import { typedIpcHandle } from './typed-ipc.js'
import { safeComputerUseIpc } from './computerUseIpcError.js'
import { getMainWindow } from '../windows/index.js'

const SETTINGS_CATEGORY = 'computer-use'
const SETTINGS_KEY = 'settings'

export const DEFAULT_COMPUTER_USE_SETTINGS: ComputerUseSettings = ComputerUseSettingsSchema.parse({
  enabled: false,
  environments: {
    safeBrowser: false,
    safeDesktop: false,
    myDesktop: false,
  },
  allowedApps: [],
  redactSensitiveContent: true,
  fullRecordingEnabled: false,
  evidenceRetentionDays: 30,
  killSwitch: 'CommandOrControl+Shift+Esc',
  remote: {
    observe: false,
    approveL2: false,
    control: false,
  },
})

interface ComputerUseSettingsStore {
  get(category: string, key: string): unknown | null
  set(category: string, key: string, value: unknown): void
}

interface ComputerVerificationStore {
  get(id: string): ComputerVerificationRow | null
}

export interface RegisterComputerUseIpcOptions {
  settings?: ComputerUseSettingsStore
  verifications?: ComputerVerificationStore
  getServices?: () => ComputerUseServices
  authorizeRenderer?: (event: IpcMainInvokeEvent) => boolean
}

/** Registers the main-process Computer Use IPC surface. */
export function registerComputerUseIpc(options: RegisterComputerUseIpcOptions = {}): void {
  const settingsStore = options.settings ?? new SettingsRepository(getDatabase())
  const verificationStore =
    options.verifications ?? new ComputerVerificationRepository(getDatabase())
  const services = options.getServices ?? getComputerUseServices
  const authorizeRenderer = options.authorizeRenderer ?? isTrustedComputerUseRenderer
  const assertRenderer = (event: IpcMainInvokeEvent): void => {
    if (!authorizeRenderer(event)) {
      throw new ComputerUseBrokerError(
        'action_not_allowed',
        'Computer Use is available only to the trusted top-level app renderer',
      )
    }
  }
  const owners = new Map<string, string>()

  reconcilePersistedKillSwitch(settingsStore, services)
  services().timeline.subscribe((activityEvent) => {
    const mainWindow = getMainWindow()
    if (mainWindow == null || mainWindow.isDestroyed()) return
    mainWindow.webContents.send('stream:computer-use:activity-event', activityEvent)
  })

  typedIpcHandle('computer-use:get-capabilities', async (_request, event) =>
    safeComputerUseIpc(() => {
      assertRenderer(event)
      return services().backend.getCapabilities()
    }),
  )

  typedIpcHandle('computer-use:diagnose-native-host', async (_request, event) =>
    safeComputerUseIpc(() => {
      assertRenderer(event)
      return services().diagnostics.collect()
    }),
  )

  typedIpcHandle('computer-use:get-settings', async (_request, event) => {
    assertRenderer(event)
    return loadSettings(settingsStore)
  })

  typedIpcHandle('computer-use:update-settings', async (patch, event) =>
    safeComputerUseIpc(async () => {
      assertRenderer(event)
      const current = loadSettings(settingsStore)
      const next = ComputerUseSettingsSchema.parse({ ...current, ...patch })
      const runtime = services()
      armKillSwitchBestEffort(next, runtime)
      await applyDisabledEnvironmentTransition(current, next, runtime)
      settingsStore.set(SETTINGS_CATEGORY, SETTINGS_KEY, next)
      return next
    }),
  )

  typedIpcHandle('computer-use:start', async (request, event) =>
    safeComputerUseIpc(async () => {
      assertRenderer(event)
      const configured = loadSettings(settingsStore)
      assertEnvironmentEnabled(configured, request.environment)
      const runtime = services()
      const capabilities = await runtime.backend.getCapabilities()
      if (!capabilities.available) {
        throw new ComputerUseBrokerError(
          capabilities.nativeHost == null ? 'native_host_missing' : 'native_host_incompatible',
          'A trusted Computer Use native host is unavailable',
        )
      }
      const manifest = requireUsableNativeHost(capabilities)
      requireComputerPermissions(manifest.permissions)

      const target =
        request.targetWindowId == null
          ? null
          : requireTargetWindowById(await validatedWindows(runtime), request.targetWindowId)

      const input: CreateManagedComputerSessionInput = request
      const created = runtime.sessions.createSession(input)
      if (target != null) {
        runtime.backend.bindSessionTarget?.({
          computerSessionId: created.id,
          appId: target.app.id,
          windowId: target.window.id,
        })
      }
      const operatorId = rendererOperatorId(event.sender.id)
      try {
        runtime.sessions.acquireLease({
          computerSessionId: created.id,
          environmentKey: environmentKey(request.environment, created.id),
          operatorId,
        })
      } catch (error) {
        await runtime.broker.stop(created.id).catch(() => undefined)
        throw error
      }
      owners.set(created.id, operatorId)
      const active = runtime.sessions.getSession(created.id)
      if (active == null) {
        await runtime.broker.stop(created.id).catch(() => undefined)
        throw new ComputerUseBrokerError(
          'session_canceled',
          'Computer session disappeared during startup',
        )
      }
      return { computerSession: active }
    }),
  )

  typedIpcHandle('computer-use:get-status', async ({ computerSessionId }, event) => {
    assertRenderer(event)
    return { computerSession: services().sessions.getSession(computerSessionId) }
  })

  typedIpcHandle('computer-use:pause', async ({ computerSessionId }, event) =>
    safeComputerUseIpc(async () => {
      assertRenderer(event)
      return { computerSession: await services().broker.pause(computerSessionId) }
    }),
  )

  typedIpcHandle('computer-use:resume', async ({ computerSessionId }, event) =>
    safeComputerUseIpc(() => {
      assertRenderer(event)
      const runtime = services()
      const operatorId = rendererOperatorId(event.sender.id)
      if (owners.get(computerSessionId) !== operatorId) {
        throw new ComputerUseBrokerError(
          'action_not_allowed',
          'This renderer must take over the Computer Use session before resuming it',
        )
      }
      const resumed = runtime.broker.resume(computerSessionId)
      runtime.sessions.acquireLease({
        computerSessionId,
        environmentKey: environmentKey(resumed.environment, computerSessionId),
        operatorId,
      })
      const active = runtime.sessions.getSession(computerSessionId)
      if (active == null) throw new ComputerUseBrokerError('session_canceled', 'Session not found')
      return { computerSession: active }
    }),
  )

  typedIpcHandle('computer-use:stop', async ({ computerSessionId }, event) =>
    safeComputerUseIpc(async () => {
      assertRenderer(event)
      const computerSession = await services().broker.stop(computerSessionId)
      owners.delete(computerSessionId)
      return { computerSession }
    }),
  )

  typedIpcHandle('computer-use:takeover', async ({ computerSessionId }, event) =>
    safeComputerUseIpc(async () => {
      assertRenderer(event)
      const computerSession = await services().broker.pause(computerSessionId)
      owners.set(computerSessionId, rendererOperatorId(event.sender.id))
      return { computerSession }
    }),
  )

  typedIpcHandle('computer-use:bind-target', async ({ computerSessionId, targetWindowId }, event) =>
    safeComputerUseIpc(async () => {
      assertRenderer(event)
      const runtime = services()
      const operatorId = rendererOperatorId(event.sender.id)
      if (owners.get(computerSessionId) !== operatorId) {
        throw new ComputerUseBrokerError(
          'action_not_allowed',
          'Only the owning renderer can change the bound target window',
        )
      }
      const session = runtime.sessions.getSession(computerSessionId)
      if (session == null) {
        throw new ComputerUseBrokerError('session_canceled', 'Computer session not found')
      }
      if (session.status !== 'paused') {
        throw new ComputerUseBrokerError(
          'action_not_allowed',
          'Pause the Computer Use session before changing its bound target window',
        )
      }
      const target = requireTargetWindowById(await validatedWindows(runtime), targetWindowId)
      runtime.backend.bindSessionTarget?.({
        computerSessionId,
        appId: target.app.id,
        windowId: target.window.id,
      })
      return { computerSession: session, targetWindowId: target.window.id }
    }),
  )

  typedIpcHandle('computer-use:resolve-app-command', async (result, event) =>
    safeComputerUseIpc(() => {
      assertRenderer(event)
      return { accepted: services().appControlBridge.resolve(result) }
    }),
  )

  typedIpcHandle('computer-use:approve-action', async (request, event) =>
    safeComputerUseIpc(() => {
      assertRenderer(event)
      void request
      throw new ComputerUseBrokerError(
        'action_not_allowed',
        'Computer actions can be approved only through the native one-time confirmation surface',
      )
    }),
  )

  typedIpcHandle('computer-use:deny-action', async (request, event) =>
    safeComputerUseIpc(() => {
      assertRenderer(event)
      const runtime = services()
      const approval = runtime.approvals.get(request.approvalId)
      const accepted = runtime.approvals.deny(request.approvalId, request.computerSessionId)
      const session = runtime.sessions.getSession(request.computerSessionId)
      if (
        accepted &&
        approval != null &&
        approval.computer_session_id === request.computerSessionId &&
        session != null
      ) {
        runtime.timeline.record({
          type: 'computer_approval_resolved',
          sessionId: session.sessionId,
          turnId: session.turnId,
          computerSessionId: session.id,
          approvalId: approval.id,
          actionId: approval.action_id,
          decision: 'denied',
        })
      }
      return { accepted }
    }),
  )

  typedIpcHandle('computer-use:list-apps', async (_request, event) =>
    safeComputerUseIpc(async () => {
      assertRenderer(event)
      const windows = await validatedWindows(services())
      const apps = new Map<string, (typeof windows)[number]['app']>()
      for (const descriptor of windows) {
        const app = ComputerAppIdentitySchema.parse(descriptor.app)
        const existing = apps.get(app.id)
        if (existing != null && JSON.stringify(existing) !== JSON.stringify(app)) {
          throw new ComputerUseBrokerError(
            'native_host_incompatible',
            'Native host returned conflicting application identities',
          )
        }
        apps.set(app.id, app)
      }
      return { apps: [...apps.values()] }
    }),
  )

  typedIpcHandle('computer-use:list-windows', async ({ appId }, event) =>
    safeComputerUseIpc(async () => {
      assertRenderer(event)
      const windows = await validatedWindows(services())
      return { windows: appId == null ? windows : windows.filter((item) => item.app.id === appId) }
    }),
  )

  typedIpcHandle('computer-use:list-sessions', async ({ sessionId, limit }, event) =>
    safeComputerUseIpc(() => {
      assertRenderer(event)
      return { computerSessions: services().sessions.listBySession(sessionId, limit) }
    }),
  )

  typedIpcHandle(
    'computer-use:get-timeline',
    async ({ computerSessionId, afterSeq, limit }, event) =>
      safeComputerUseIpc(() => {
        assertRenderer(event)
        return services().timeline.read(computerSessionId, afterSeq, limit)
      }),
  )

  typedIpcHandle(
    'computer-use:get-verification',
    async ({ computerSessionId, verificationId }, event) =>
      safeComputerUseIpc(() => {
        assertRenderer(event)
        return {
          verification: toVerificationRecord(
            verificationStore.get(verificationId),
            computerSessionId,
          ),
        }
      }),
  )
}

function isTrustedComputerUseRenderer(event: IpcMainInvokeEvent): boolean {
  const mainWindow = getMainWindow()
  return (
    mainWindow != null &&
    !mainWindow.isDestroyed() &&
    !event.sender.isDestroyed() &&
    event.sender.id === mainWindow.webContents.id &&
    event.senderFrame != null &&
    event.senderFrame === event.sender.mainFrame
  )
}

function loadSettings(store: ComputerUseSettingsStore): ComputerUseSettings {
  const parsed = ComputerUseSettingsSchema.safeParse(store.get(SETTINGS_CATEGORY, SETTINGS_KEY))
  return parsed.success ? parsed.data : structuredClone(DEFAULT_COMPUTER_USE_SETTINGS)
}

function armKillSwitchBestEffort(
  settings: ComputerUseSettings,
  services: ComputerUseServices,
): void {
  if (!settings.enabled || !settings.environments.myDesktop) return
  if (settings.killSwitch != null) services.armKillSwitch(settings.killSwitch)
}

async function applyDisabledEnvironmentTransition(
  current: ComputerUseSettings,
  next: ComputerUseSettings,
  services: ComputerUseServices,
): Promise<void> {
  const disabledAll = current.enabled && !next.enabled
  const disabledEnvironments = new Set<ComputerEnvironment>()
  if (current.environments.safeBrowser && !next.environments.safeBrowser) {
    disabledEnvironments.add('safe_browser')
  }
  if (current.environments.safeDesktop && !next.environments.safeDesktop) {
    disabledEnvironments.add('safe_desktop')
  }
  if (current.environments.myDesktop && !next.environments.myDesktop) {
    disabledEnvironments.add('my_desktop')
  }

  for (const computerSessionId of services.sessions.listActiveSessionIds()) {
    const session = services.sessions.getSession(computerSessionId)
    if (session != null && (disabledAll || disabledEnvironments.has(session.environment))) {
      await services.broker.stop(computerSessionId)
    }
  }
  if (!next.enabled || !next.environments.myDesktop) services.killSwitch.disarm()
}

function reconcilePersistedKillSwitch(
  store: ComputerUseSettingsStore,
  getServices: () => ComputerUseServices,
): void {
  const parsed = ComputerUseSettingsSchema.safeParse(store.get(SETTINGS_CATEGORY, SETTINGS_KEY))
  if (!parsed.success || !parsed.data.enabled || !parsed.data.environments.myDesktop) return
  const accelerator = parsed.data.killSwitch
  if (accelerator != null) getServices().armKillSwitch(accelerator)
}

function assertEnvironmentEnabled(
  settings: ComputerUseSettings,
  environment: ComputerEnvironment,
): void {
  if (!settings.enabled) {
    throw new ComputerUseBrokerError('computer_disabled', 'Computer Use is disabled')
  }
  const enabled =
    environment === 'safe_browser'
      ? settings.environments.safeBrowser
      : environment === 'safe_desktop'
        ? settings.environments.safeDesktop
        : settings.environments.myDesktop
  if (!enabled) {
    throw new ComputerUseBrokerError(
      'environment_unavailable',
      'The requested Computer Use environment is disabled',
    )
  }
}

function rendererOperatorId(senderId: number): string {
  return `renderer:${senderId}`
}

function environmentKey(environment: ComputerEnvironment, computerSessionId: string): string {
  if (environment === 'my_desktop') return MY_DESKTOP_ENVIRONMENT_KEY
  return `${environment === 'safe_browser' ? 'safe-browser' : 'safe-desktop'}:${computerSessionId}`
}

async function validatedWindows(services: ComputerUseServices): Promise<NativeWindowDescriptor[]> {
  const capabilities = await services.backend.getCapabilities()
  if (!capabilities.available) {
    throw new ComputerUseBrokerError('native_host_missing', 'Trusted native host is unavailable')
  }
  const manifest = requireUsableNativeHost(capabilities)
  if (!manifest.features.listWindows) {
    throw new ComputerUseBrokerError(
      'environment_unavailable',
      'Trusted native host does not support window inventory',
    )
  }
  const parsed = NativeWindowDescriptorSchema.array()
    .max(10_000)
    .safeParse(await services.backend.listWindows())
  if (!parsed.success) {
    throw new ComputerUseBrokerError(
      'native_host_incompatible',
      'Native host returned an invalid window inventory',
    )
  }
  return parsed.data
}

function requireTargetWindowById(
  windows: NativeWindowDescriptor[],
  targetWindowId: string,
): NativeWindowDescriptor {
  const target = windows.find((window) => window.window.id === targetWindowId && !window.minimized)
  if (target == null) {
    throw new ComputerUseBrokerError('focus_mismatch', 'The selected target window is unavailable')
  }
  return target
}

function requireUsableNativeHost(
  capabilities: Awaited<ReturnType<ComputerUseServices['backend']['getCapabilities']>>,
) {
  const manifest = NativeHostCapabilityManifestSchema.safeParse(capabilities.nativeHost)
  if (
    !capabilities.available ||
    !manifest.success ||
    manifest.data.platform !== capabilities.platform ||
    manifest.data.permissions.screen !== capabilities.permissions.screen ||
    manifest.data.permissions.accessibility !== capabilities.permissions.accessibility ||
    manifest.data.permissions.input !== capabilities.permissions.input
  ) {
    throw new ComputerUseBrokerError(
      'native_host_incompatible',
      'Trusted native host returned contradictory capabilities',
    )
  }
  return manifest.data
}

function requireComputerPermissions(
  permissions: Awaited<
    ReturnType<ComputerUseServices['backend']['getCapabilities']>
  >['permissions'],
): void {
  if (permissions.screen !== 'granted') {
    throw new ComputerUseBrokerError(
      'screen_permission_denied',
      'Screen capture permission is required before Computer Use can start',
    )
  }
  if (permissions.accessibility !== 'granted') {
    throw new ComputerUseBrokerError(
      'accessibility_permission_denied',
      'Accessibility permission is required before Computer Use can start',
    )
  }
  if (permissions.input !== 'granted') {
    throw new ComputerUseBrokerError(
      'privilege_mismatch',
      'Input control permission is required before Computer Use can start',
    )
  }
}

function toVerificationRecord(row: ComputerVerificationRow | null, computerSessionId: string) {
  if (row == null || row.computer_session_id !== computerSessionId) return null
  try {
    const evidence = JSON.parse(row.evidence_json) as unknown
    if (!Array.isArray(evidence) || !evidence.every((id) => typeof id === 'string')) {
      throw new Error('invalid verification evidence')
    }
    if (
      (row.status === 'pending' &&
        (row.completed_at !== null || row.confidence !== null || evidence.length !== 0)) ||
      (row.status !== 'pending' && row.completed_at === null)
    ) {
      throw new Error('inconsistent verification lifecycle')
    }
    return {
      id: row.id,
      computerSessionId: row.computer_session_id,
      spec: VerificationSpecSchema.parse(JSON.parse(row.spec_json) as unknown),
      status: row.status,
      evidenceSnapshotIds: evidence,
      confidence: row.confidence,
      createdAt: row.created_at,
      completedAt: row.completed_at,
    }
  } catch {
    throw new ComputerUseBrokerError(
      'native_host_incompatible',
      'Stored Computer Use verification metadata is invalid',
    )
  }
}
