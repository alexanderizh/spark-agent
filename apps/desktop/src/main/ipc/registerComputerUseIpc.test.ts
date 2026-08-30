/* eslint-disable @typescript-eslint/no-non-null-assertion -- registered handlers are the test subject */
import type {
  ComputerSession,
  ComputerUseCapabilitySummary,
  ComputerUseSettings,
  NativeHostCapabilityManifest,
  NativeWindowDescriptor,
} from '@spark/protocol'
import type { ComputerVerificationRow } from '@spark/storage'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ComputerUseBrokerError } from '../services/computer-use/ComputerUseBrokerError.js'

const harness = vi.hoisted(() => ({
  handlers: new Map<string, (request: any, event: any) => Promise<any>>(),
}))

vi.mock('./typed-ipc.js', () => ({
  typedIpcHandle: (channel: string, handler: (request: any, event: any) => Promise<any>) => {
    harness.handlers.set(channel, handler)
  },
}))

vi.mock('../db.js', () => ({
  getDatabase: vi.fn(),
}))

import { registerComputerUseIpc } from './registerComputerUseIpc.js'
import { ComputerUseTimelineStore } from '../services/computer-use/ComputerUseTimelineStore.js'

const DEFAULT_SETTINGS: ComputerUseSettings = {
  enabled: true,
  environments: { safeBrowser: false, safeDesktop: false, myDesktop: true },
  allowedApps: [],
  redactSensitiveContent: true,
  fullRecordingEnabled: false,
  evidenceRetentionDays: 30,
  killSwitch: 'CommandOrControl+Shift+Esc',
  remote: { observe: false, approveL2: false, control: false },
}

const NATIVE_HOST: NativeHostCapabilityManifest = {
  protocolVersion: 1,
  hostVersion: '1.0.0',
  platform: 'macos',
  architecture: 'arm64',
  backends: {
    screen: 'screen_capture_kit',
    accessibility: 'axui_element',
    input: 'cg_event',
  },
  features: {
    listWindows: true,
    captureWindow: true,
    fullTree: true,
    diffTree: true,
    semanticActions: true,
    absolutePointer: true,
    keyboard: true,
    clipboard: false,
  },
  permissions: { screen: 'granted', accessibility: 'granted', input: 'granted' },
  limits: {
    maxMessageBytes: 1_048_576,
    maxScreenshotWidth: 8_192,
    maxScreenshotHeight: 8_192,
    maxTreeElements: 100_000,
  },
}

const CAPABILITIES: ComputerUseCapabilitySummary = {
  available: true,
  platform: 'macos',
  nativeHost: NATIVE_HOST,
  permissions: { screen: 'granted', accessibility: 'granted', input: 'granted' },
}

const SESSION: ComputerSession = {
  id: 'computer-session-1',
  sessionId: 'session-1',
  turnId: 'turn-1',
  workflowRunId: null,
  environment: 'my_desktop',
  status: 'observing',
  providerProfileId: 'provider-1',
  modelId: 'model-1',
  taskContract: {
    objective: 'Open the approved application',
    successCriteria: [
      {
        kind: 'application_state',
        appId: 'com.spark.Test',
        assertion: { operator: 'window_title_contains', expected: 'Ready' },
      },
    ],
    allowedApps: [{ kind: 'bundle_id', value: 'com.spark.Test' }],
    allowedDomains: [],
    allowedDataClasses: ['public'],
    forbiddenActions: [],
    maxSteps: 10,
    maxRuntimeMs: 60_000,
    maxConsecutiveNoops: 3,
    userPresence: 'required',
  },
  actuatorLeaseId: 'lease-1',
  createdAt: '2026-07-28T05:00:00.000Z',
  updatedAt: '2026-07-28T05:00:00.000Z',
}

const WINDOW: NativeWindowDescriptor = {
  app: { id: 'app-1', name: 'Test App', bundleId: 'com.spark.Test' },
  window: { id: 'window-1', title: 'Ready', bounds: { x: 0, y: 0, width: 800, height: 600 } },
  display: { id: 'display-1', width: 1512, height: 982, scaleFactor: 2 },
  focused: true,
  minimized: false,
}

function createSettingsStore(initial: unknown = null) {
  let value = initial
  return {
    get: vi.fn(() => value),
    set: vi.fn((_category: string, _key: string, next: unknown) => {
      value = next
    }),
  }
}

function createServices(overrides: Record<string, unknown> = {}) {
  const sessions = {
    createSession: vi.fn(
      (): ComputerSession => ({ ...SESSION, actuatorLeaseId: null, status: 'preflighting' }),
    ),
    acquireLease: vi.fn(() => ({ id: 'lease-1' })),
    activate: vi.fn(() => ({ ...SESSION, actuatorLeaseId: null, status: 'observing' })),
    getSession: vi.fn((): ComputerSession => ({ ...SESSION, actuatorLeaseId: null })),
    listActiveSessionIds: vi.fn((): string[] => []),
    listBySession: vi.fn(() => [SESSION]),
  }
  const broker = {
    pause: vi.fn(async () => ({ ...SESSION, status: 'paused', actuatorLeaseId: null })),
    resume: vi.fn(() => ({ ...SESSION, actuatorLeaseId: null })),
    stop: vi.fn(async () => ({ ...SESSION, status: 'canceled', actuatorLeaseId: null })),
  }
  const approvals = {
    get: vi.fn(() => ({
      id: 'approval-1',
      computer_session_id: SESSION.id,
      action_id: 'action-1',
    })),
    approve: vi.fn(() => ({
      id: 'approval-1',
      computerSessionId: SESSION.id,
      actionId: 'action-1',
    })),
    deny: vi.fn(() => true),
  }
  const backend = {
    getCapabilities: vi.fn(async () => CAPABILITIES),
    listWindows: vi.fn(async () => [WINDOW]),
    bindSessionTarget: vi.fn(),
  }
  return {
    sessions,
    broker,
    approvals,
    backend,
    coordinator: { claim: vi.fn(async () => undefined), release: vi.fn() },
    killSwitch: { isArmed: vi.fn(() => true), disarm: vi.fn() },
    armKillSwitch: vi.fn(() => true),
    verifications: { get: vi.fn(() => null) },
    timeline: new ComputerUseTimelineStore(),
    appControlBridge: { resolve: vi.fn(() => true) },
    diagnostics: {
      collect: vi.fn(async () => ({
        generatedAt: '2026-07-31T00:00:00.000Z',
        correlationId: 'diagnostic-1',
        app: { version: '0.8.14', packaged: true },
        runtime: { platform: 'macos', architecture: 'arm64', osRelease: '25.0.0' },
        host: {
          available: true,
          version: '1.0.0',
          protocolVersion: 1,
          platform: 'macos',
          architecture: 'arm64',
          permissions: NATIVE_HOST.permissions,
        },
        result: {
          diagnosticCode: 'native_host_ready',
          stage: 'handshake',
          repairAction: null,
          errorCode: null,
          message: 'Trusted Native Host verification and handshake succeeded',
        },
        metrics: [],
      })),
    },
    ...overrides,
  }
}

function register(
  options: {
    settings?: ReturnType<typeof createSettingsStore>
    services?: any
    verifications?: { get(id: string): ComputerVerificationRow | null }
    authorizeRenderer?: (event: any) => boolean
    openSystemSettings?: (permission: 'screen' | 'accessibility') => Promise<{ opened: boolean }>
  } = {},
) {
  const settings = options.settings ?? createSettingsStore()
  const services = options.services ?? createServices()
  registerComputerUseIpc({
    settings,
    getServices: () => services,
    authorizeRenderer: options.authorizeRenderer ?? (() => true),
    ...(options.verifications == null ? {} : { verifications: options.verifications }),
    ...(options.openSystemSettings == null
      ? {}
      : { openSystemSettings: options.openSystemSettings }),
  })
  return { settings, services }
}

function event(senderId = 41) {
  return { sender: { id: senderId } }
}

describe('registerComputerUseIpc', () => {
  beforeEach(() => {
    harness.handlers.clear()
  })

  it('registers the complete Computer Use IPC contract', () => {
    register()

    expect([...harness.handlers.keys()].sort()).toEqual(
      [
        'computer-use:get-capabilities',
        'computer-use:diagnose-native-host',
        'computer-use:get-settings',
        'computer-use:update-settings',
        'computer-use:start',
        'computer-use:get-status',
        'computer-use:pause',
        'computer-use:resume',
        'computer-use:stop',
        'computer-use:takeover',
        'computer-use:bind-target',
        'computer-use:resolve-app-command',
        'computer-use:approve-action',
        'computer-use:deny-action',
        'computer-use:list-apps',
        'computer-use:list-windows',
        'computer-use:open-system-settings',
        'computer-use:list-sessions',
        'computer-use:get-timeline',
        'computer-use:get-verification',
      ].sort(),
    )
  })

  it('returns a copyable native host diagnostic report to the trusted renderer', async () => {
    const { services } = register()

    await expect(
      harness.handlers.get('computer-use:diagnose-native-host')!({}, event()),
    ).resolves.toMatchObject({
      correlationId: 'diagnostic-1',
      result: { diagnosticCode: 'native_host_ready', stage: 'handshake' },
    })
    expect(services.diagnostics.collect).toHaveBeenCalledOnce()
  })

  it('opens the requested operating-system privacy pane through a fixed main-process action', async () => {
    const openSystemSettings = vi.fn(async () => ({ opened: true }))
    register({ openSystemSettings })

    await expect(
      harness.handlers.get('computer-use:open-system-settings')!({ permission: 'screen' }, event()),
    ).resolves.toEqual({ opened: true })
    expect(openSystemSettings).toHaveBeenCalledWith('screen')
  })

  it('rejects every privileged Computer Use channel from an untrusted renderer', async () => {
    const { services, settings } = register({ authorizeRenderer: () => false })
    const attacker = event(999)

    for (const [channel, handler] of harness.handlers) {
      await expect(handler({}, attacker)).rejects.toMatchObject({ code: 'action_not_allowed' })
      expect(channel).toMatch(/^computer-use:/)
    }
    expect(settings.set).not.toHaveBeenCalled()
    expect(services.sessions.createSession).not.toHaveBeenCalled()
    expect(services.approvals.approve).not.toHaveBeenCalled()
  })

  it('loads fail-closed defaults when settings are missing or malformed', async () => {
    register({ settings: createSettingsStore({ enabled: true, environments: {} }) })

    await expect(harness.handlers.get('computer-use:get-settings')!({}, event())).resolves.toEqual(
      DEFAULT_SETTINGS,
    )
  })

  it('keeps persisted My Desktop enabled when startup cannot arm the optional shortcut', async () => {
    const enabled = {
      ...DEFAULT_SETTINGS,
      enabled: true,
      environments: { ...DEFAULT_SETTINGS.environments, myDesktop: true },
    }
    const settings = createSettingsStore(enabled)
    const services = createServices({ armKillSwitch: vi.fn(() => false) })

    register({ settings, services })

    await expect(harness.handlers.get('computer-use:get-settings')!({}, event())).resolves.toEqual(
      enabled,
    )
    expect(settings.set).not.toHaveBeenCalled()
  })

  it('persists My Desktop when the optional global kill switch cannot be armed', async () => {
    const services = createServices({ armKillSwitch: vi.fn(() => false) })
    const { settings } = register({ services })

    const updated = await harness.handlers.get('computer-use:update-settings')!(
      {
        enabled: true,
        environments: { safeBrowser: false, safeDesktop: false, myDesktop: true },
      },
      event(),
    )
    expect(updated.enabled).toBe(true)
    expect(updated.environments.myDesktop).toBe(true)
    expect(services.armKillSwitch).toHaveBeenCalledWith(DEFAULT_SETTINGS.killSwitch)
    expect(settings.set).toHaveBeenCalledWith('computer-use', 'settings', updated)
  })

  it('does not create a session while Computer Use is disabled', async () => {
    const services = createServices()
    const settings = createSettingsStore({
      ...DEFAULT_SETTINGS,
      enabled: false,
      environments: { ...DEFAULT_SETTINGS.environments, myDesktop: false },
    })
    register({ services, settings })

    await expect(
      harness.handlers.get('computer-use:start')!(
        {
          sessionId: SESSION.sessionId,
          turnId: SESSION.turnId,
          workflowRunId: null,
          environment: SESSION.environment,
          providerProfileId: SESSION.providerProfileId,
          modelId: SESSION.modelId,
          taskContract: SESSION.taskContract,
        },
        event(),
      ),
    ).rejects.toMatchObject({ code: 'computer_disabled' })
    expect(services.sessions.createSession).not.toHaveBeenCalled()
  })

  it('stops active sessions before disabling Computer Use and disarming its kill switch', async () => {
    const services = createServices()
    services.sessions.listActiveSessionIds = vi.fn(() => [SESSION.id])
    const enabled = {
      ...DEFAULT_SETTINGS,
      enabled: true,
      environments: { ...DEFAULT_SETTINGS.environments, myDesktop: true },
    }
    const settings = createSettingsStore(enabled)
    register({ settings, services })

    await harness.handlers.get('computer-use:update-settings')!({ enabled: false }, event())

    expect(services.broker.stop).toHaveBeenCalledWith(SESSION.id)
    expect(services.coordinator.release).toHaveBeenCalledWith(SESSION.id)
    expect(services.killSwitch.disarm).toHaveBeenCalledTimes(1)
    expect(settings.set).toHaveBeenCalledWith(
      'computer-use',
      'settings',
      expect.objectContaining({ enabled: false }),
    )
  })

  it('keeps Computer Use enabled when kill switch reconfiguration removes the previous shortcut', async () => {
    const services = createServices()
    services.sessions.listActiveSessionIds.mockReturnValue([SESSION.id])
    services.armKillSwitch.mockReturnValueOnce(true).mockReturnValueOnce(false)
    const enabled = {
      ...DEFAULT_SETTINGS,
      enabled: true,
      environments: { ...DEFAULT_SETTINGS.environments, myDesktop: true },
    }
    const settings = createSettingsStore(enabled)
    register({ settings, services })

    const updated = await harness.handlers.get('computer-use:update-settings')!(
      { killSwitch: 'CommandOrControl+Alt+Escape' },
      event(),
    )

    expect(services.broker.stop).not.toHaveBeenCalled()
    expect(updated.enabled).toBe(true)
    expect(updated.environments.myDesktop).toBe(true)
    expect(settings.set).toHaveBeenLastCalledWith(
      'computer-use',
      'settings',
      expect.objectContaining({
        enabled: true,
        environments: expect.objectContaining({ myDesktop: true }),
      }),
    )
  })

  it('starts My Desktop when the optional global kill switch is not armed', async () => {
    const services = createServices({
      killSwitch: { isArmed: vi.fn(() => false), disarm: vi.fn() },
    })
    const enabled = {
      ...DEFAULT_SETTINGS,
      enabled: true,
      environments: { ...DEFAULT_SETTINGS.environments, myDesktop: true },
    }
    register({ settings: createSettingsStore(enabled), services })

    await expect(
      harness.handlers.get('computer-use:start')!(
        {
          sessionId: SESSION.sessionId,
          turnId: SESSION.turnId,
          workflowRunId: null,
          environment: SESSION.environment,
          providerProfileId: SESSION.providerProfileId,
          modelId: SESSION.modelId,
          taskContract: SESSION.taskContract,
        },
        event(),
      ),
    ).resolves.toMatchObject({ computerSession: { id: SESSION.id } })
    expect(services.sessions.createSession).toHaveBeenCalledOnce()
  })

  it('binds an explicitly selected window only when its strong app identity is allowed', async () => {
    const services = createServices()
    const enabled = {
      ...DEFAULT_SETTINGS,
      enabled: true,
      environments: { ...DEFAULT_SETTINGS.environments, myDesktop: true },
    }
    register({ settings: createSettingsStore(enabled), services })

    await expect(
      harness.handlers.get('computer-use:start')!(
        {
          sessionId: SESSION.sessionId,
          turnId: SESSION.turnId,
          workflowRunId: null,
          environment: SESSION.environment,
          providerProfileId: SESSION.providerProfileId,
          modelId: SESSION.modelId,
          taskContract: SESSION.taskContract,
          targetWindowId: WINDOW.window.id,
        },
        event(),
      ),
    ).resolves.toMatchObject({ computerSession: { id: SESSION.id } })
    expect(services.backend.bindSessionTarget).toHaveBeenCalledWith({
      computerSessionId: SESSION.id,
      appId: WINDOW.app.id,
      windowId: WINDOW.window.id,
    })
  })

  it('allows an explicitly selected window from any application', async () => {
    const services = createServices()
    services.backend.listWindows.mockResolvedValue([
      {
        ...WINDOW,
        app: { id: 'app-2', name: 'Other App', bundleId: 'com.other.App' },
        window: { ...WINDOW.window, id: 'window-2' },
      },
    ])
    const enabled = {
      ...DEFAULT_SETTINGS,
      enabled: true,
      environments: { ...DEFAULT_SETTINGS.environments, myDesktop: true },
    }
    register({ settings: createSettingsStore(enabled), services })

    await expect(
      harness.handlers.get('computer-use:start')!(
        {
          sessionId: SESSION.sessionId,
          turnId: SESSION.turnId,
          workflowRunId: null,
          environment: SESSION.environment,
          providerProfileId: SESSION.providerProfileId,
          modelId: SESSION.modelId,
          taskContract: SESSION.taskContract,
          targetWindowId: 'window-2',
        },
        event(),
      ),
    ).resolves.toMatchObject({ computerSession: { id: SESSION.id } })
    expect(services.sessions.createSession).toHaveBeenCalledTimes(1)
    expect(services.backend.bindSessionTarget).toHaveBeenCalledWith({
      computerSessionId: SESSION.id,
      appId: 'app-2',
      windowId: 'window-2',
    })
  })

  it('allows only the owning renderer to bind any visible application window', async () => {
    const services = createServices()
    const enabled = {
      ...DEFAULT_SETTINGS,
      enabled: true,
      environments: { ...DEFAULT_SETTINGS.environments, myDesktop: true },
    }
    register({ settings: createSettingsStore(enabled), services })
    const owner = event()
    await harness.handlers.get('computer-use:start')!(
      {
        sessionId: SESSION.sessionId,
        turnId: SESSION.turnId,
        workflowRunId: null,
        environment: SESSION.environment,
        providerProfileId: SESSION.providerProfileId,
        modelId: SESSION.modelId,
        taskContract: SESSION.taskContract,
      },
      owner,
    )
    services.backend.listWindows.mockResolvedValue([
      { ...WINDOW, window: { ...WINDOW.window, id: 'window-2', title: 'New window' } },
    ])
    services.sessions.getSession.mockReturnValue({ ...SESSION, status: 'paused' })

    await expect(
      harness.handlers.get('computer-use:bind-target')!(
        { computerSessionId: SESSION.id, targetWindowId: 'window-2' },
        owner,
      ),
    ).resolves.toMatchObject({ targetWindowId: 'window-2' })
    expect(services.backend.bindSessionTarget).toHaveBeenCalledWith({
      computerSessionId: SESSION.id,
      appId: WINDOW.app.id,
      windowId: 'window-2',
    })
    await expect(
      harness.handlers.get('computer-use:bind-target')!(
        { computerSessionId: SESSION.id, targetWindowId: 'window-2' },
        event(999),
      ),
    ).rejects.toMatchObject({ code: 'action_not_allowed' })
  })

  it('preflights the native host before creating and leasing a session', async () => {
    const unavailable = createServices()
    unavailable.backend.getCapabilities.mockResolvedValue({
      ...CAPABILITIES,
      available: false,
      nativeHost: null,
      unavailableReason: 'trusted native host is missing',
    })
    const enabled = {
      ...DEFAULT_SETTINGS,
      enabled: true,
      environments: { ...DEFAULT_SETTINGS.environments, myDesktop: true },
    }
    register({ settings: createSettingsStore(enabled), services: unavailable })

    await expect(
      harness.handlers.get('computer-use:start')!(
        {
          sessionId: SESSION.sessionId,
          turnId: SESSION.turnId,
          workflowRunId: null,
          environment: SESSION.environment,
          providerProfileId: SESSION.providerProfileId,
          modelId: SESSION.modelId,
          taskContract: SESSION.taskContract,
        },
        event(),
      ),
    ).rejects.toMatchObject({ code: 'native_host_missing' })
    expect(unavailable.sessions.createSession).not.toHaveBeenCalled()
  })

  it('rejects contradictory capability claims from the native boundary', async () => {
    const services = createServices()
    services.backend.getCapabilities.mockResolvedValue({ ...CAPABILITIES, nativeHost: null })
    const enabled = {
      ...DEFAULT_SETTINGS,
      enabled: true,
      environments: { ...DEFAULT_SETTINGS.environments, myDesktop: true },
    }
    register({ settings: createSettingsStore(enabled), services })

    await expect(
      harness.handlers.get('computer-use:start')!(
        {
          sessionId: SESSION.sessionId,
          turnId: SESSION.turnId,
          workflowRunId: null,
          environment: SESSION.environment,
          providerProfileId: SESSION.providerProfileId,
          modelId: SESSION.modelId,
          taskContract: SESSION.taskContract,
        },
        event(),
      ),
    ).rejects.toMatchObject({ code: 'native_host_incompatible' })
    expect(services.sessions.createSession).not.toHaveBeenCalled()
  })

  it('does not create a session before required operating-system permissions are granted', async () => {
    const services = createServices()
    services.backend.getCapabilities.mockResolvedValue({
      ...CAPABILITIES,
      nativeHost: {
        ...NATIVE_HOST,
        permissions: { ...NATIVE_HOST.permissions, screen: 'denied' },
      },
      permissions: { ...CAPABILITIES.permissions, screen: 'denied' },
    })
    const enabled = {
      ...DEFAULT_SETTINGS,
      enabled: true,
      environments: { ...DEFAULT_SETTINGS.environments, myDesktop: true },
    }
    register({ settings: createSettingsStore(enabled), services })

    await expect(
      harness.handlers.get('computer-use:start')!(
        {
          sessionId: SESSION.sessionId,
          turnId: SESSION.turnId,
          workflowRunId: null,
          environment: SESSION.environment,
          providerProfileId: SESSION.providerProfileId,
          modelId: SESSION.modelId,
          taskContract: SESSION.taskContract,
        },
        event(),
      ),
    ).rejects.toMatchObject({ code: 'screen_permission_denied' })
    expect(services.sessions.createSession).not.toHaveBeenCalled()
  })

  it('claims and activates direct desktop control without a persistent lease', async () => {
    const services = createServices()
    const enabled = {
      ...DEFAULT_SETTINGS,
      enabled: true,
      environments: { ...DEFAULT_SETTINGS.environments, myDesktop: true },
    }
    register({ settings: createSettingsStore(enabled), services })

    await expect(
      harness.handlers.get('computer-use:start')!(
        {
          sessionId: SESSION.sessionId,
          turnId: SESSION.turnId,
          workflowRunId: null,
          environment: SESSION.environment,
          providerProfileId: SESSION.providerProfileId,
          modelId: SESSION.modelId,
          taskContract: SESSION.taskContract,
        },
        event(),
      ),
    ).resolves.toMatchObject({ computerSession: { id: SESSION.id, actuatorLeaseId: null } })
    expect(services.coordinator.claim).toHaveBeenCalledWith(SESSION.id)
    expect(services.sessions.activate).toHaveBeenCalledWith(SESSION.id)
    expect(services.sessions.acquireLease).not.toHaveBeenCalled()
  })

  it('finishes startup cleanup before releasing coordinator ownership', async () => {
    const services = createServices()
    let finishStop: (() => void) | undefined
    services.sessions.activate.mockImplementationOnce(() => {
      throw new ComputerUseBrokerError('session_canceled', 'Activation failed')
    })
    services.broker.stop.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishStop = () => resolve({ ...SESSION, status: 'canceled', actuatorLeaseId: null })
        }),
    )
    const enabled = {
      ...DEFAULT_SETTINGS,
      enabled: true,
      environments: { ...DEFAULT_SETTINGS.environments, myDesktop: true },
    }
    register({ settings: createSettingsStore(enabled), services })

    const starting = harness.handlers.get('computer-use:start')!(
      {
        sessionId: SESSION.sessionId,
        turnId: SESSION.turnId,
        workflowRunId: null,
        environment: SESSION.environment,
        providerProfileId: SESSION.providerProfileId,
        modelId: SESSION.modelId,
        taskContract: SESSION.taskContract,
      },
      event(),
    )
    await vi.waitFor(() => expect(services.broker.stop).toHaveBeenCalledWith(SESSION.id))
    expect(services.coordinator.release).not.toHaveBeenCalled()
    finishStop?.()

    await expect(starting).rejects.toMatchObject({ code: 'session_canceled' })
    expect(services.coordinator.release).toHaveBeenCalledWith(SESSION.id)
    expect(services.broker.stop.mock.invocationCallOrder[0]).toBeLessThan(
      services.coordinator.release.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    )
  })

  it('requires takeover before another renderer can resume a paused session', async () => {
    const services = createServices()
    const enabled = {
      ...DEFAULT_SETTINGS,
      enabled: true,
      environments: { ...DEFAULT_SETTINGS.environments, myDesktop: true },
    }
    register({ settings: createSettingsStore(enabled), services })

    await expect(
      harness.handlers.get('computer-use:resume')!({ computerSessionId: SESSION.id }, event(99)),
    ).rejects.toMatchObject({ code: 'action_not_allowed' })
    await harness.handlers.get('computer-use:takeover')!(
      { computerSessionId: SESSION.id },
      event(99),
    )
    await expect(
      harness.handlers.get('computer-use:resume')!({ computerSessionId: SESSION.id }, event(99)),
    ).resolves.toMatchObject({ computerSession: { id: SESSION.id, actuatorLeaseId: null } })
    expect(services.coordinator.claim).toHaveBeenCalledWith(SESSION.id)
    expect(services.sessions.acquireLease).not.toHaveBeenCalled()
  })

  it('releases coordinator ownership when renderer resume fails', async () => {
    const services = createServices()
    const enabled = {
      ...DEFAULT_SETTINGS,
      enabled: true,
      environments: { ...DEFAULT_SETTINGS.environments, myDesktop: true },
    }
    register({ settings: createSettingsStore(enabled), services })
    await harness.handlers.get('computer-use:takeover')!(
      { computerSessionId: SESSION.id },
      event(99),
    )
    services.coordinator.release.mockClear()
    services.broker.resume.mockImplementationOnce(() => {
      throw new ComputerUseBrokerError('session_canceled', 'Session is terminal')
    })

    await expect(
      harness.handlers.get('computer-use:resume')!({ computerSessionId: SESSION.id }, event(99)),
    ).rejects.toMatchObject({ code: 'session_canceled' })
    expect(services.coordinator.release).toHaveBeenCalledWith(SESSION.id)
  })

  it('accepts an app-command acknowledgement only through the trusted renderer IPC', async () => {
    const services = createServices()
    register({ services })
    const result = {
      commandId: 'command-1',
      computerSessionId: SESSION.id,
      actionId: 'action-1',
      status: 'applied' as const,
      uiRevision: 1,
    }

    await expect(
      harness.handlers.get('computer-use:resolve-app-command')!(result, event()),
    ).resolves.toEqual({ accepted: true })
    expect(services.appControlBridge.resolve).toHaveBeenCalledWith(result)
  })

  it('never treats an ordinary Renderer IPC call as trusted local-user approval', async () => {
    const services = createServices()
    register({ services })
    const digest = 'a'.repeat(64)

    await expect(
      harness.handlers.get('computer-use:approve-action')!(
        {
          computerSessionId: SESSION.id,
          approvalId: 'approval-1',
          actionDigest: digest,
          targetDigest: digest,
          dataClassDigest: null,
        },
        event(),
      ),
    ).rejects.toMatchObject({ code: 'action_not_allowed' })
    expect(services.approvals.approve).not.toHaveBeenCalled()
  })

  it('derives app inventory from validated native window descriptors', async () => {
    register()

    await expect(harness.handlers.get('computer-use:list-apps')!({}, event())).resolves.toEqual({
      apps: [WINDOW.app],
    })
    await expect(
      harness.handlers.get('computer-use:list-windows')!({ appId: WINDOW.app.id }, event()),
    ).resolves.toEqual({ windows: [WINDOW] })
  })

  it('returns the live action timeline with cursor pagination', async () => {
    const services = createServices()
    register({ services })

    services.timeline.record({
      type: 'computer_action_requested',
      sessionId: 'session-1',
      turnId: 'turn-1',
      computerSessionId: SESSION.id,
      actionId: 'action-1',
      riskLevel: 'L1',
    })
    services.timeline.record({
      type: 'computer_action_executed',
      sessionId: 'session-1',
      turnId: 'turn-1',
      computerSessionId: SESSION.id,
      actionId: 'action-1',
      beforeFrameId: 'frame-1',
      afterFrameId: 'frame-2',
    })

    const first = await harness.handlers.get('computer-use:get-timeline')!(
      { computerSessionId: SESSION.id, limit: 1 },
      event(),
    )
    expect(first.events).toHaveLength(1)
    expect(first.events[0].type).toBe('computer_action_requested')
    expect(first.events[0].seq).toBe(0)
    expect(first.nextSeq).toBe(0)

    const second = await harness.handlers.get('computer-use:get-timeline')!(
      { computerSessionId: SESSION.id, afterSeq: first.nextSeq! },
      event(),
    )
    expect(second.events).toHaveLength(1)
    expect(second.events[0].type).toBe('computer_action_executed')
    expect(second.events[0].seq).toBe(1)
    expect(second.nextSeq).toBe(1)
  })

  it('lists the computer sessions attached to a chat session for timeline replay', async () => {
    const services = createServices()
    register({ services })

    await expect(
      harness.handlers.get('computer-use:list-sessions')!(
        { sessionId: 'session-1', limit: 20 },
        event(),
      ),
    ).resolves.toEqual({ computerSessions: [SESSION] })
    expect(services.sessions.listBySession).toHaveBeenCalledWith('session-1', 20)
  })

  it('returns an empty timeline for a session with no recorded events', async () => {
    register()

    await expect(
      harness.handlers.get('computer-use:get-timeline')!(
        { computerSessionId: 'never-started' },
        event(),
      ),
    ).resolves.toEqual({ events: [], nextSeq: null })
  })

  it('returns only session-bound, internally consistent verification records', async () => {
    const row: ComputerVerificationRow = {
      id: 'verification-1',
      computer_session_id: SESSION.id,
      spec_json: JSON.stringify(SESSION.taskContract.successCriteria[0]),
      status: 'pending',
      evidence_json: '[]',
      confidence: null,
      verifier_model_id: null,
      created_at: SESSION.createdAt,
      completed_at: SESSION.createdAt,
    }
    const verifications = { get: vi.fn(() => row) }
    register({ verifications })

    await expect(
      harness.handlers.get('computer-use:get-verification')!(
        { computerSessionId: SESSION.id, verificationId: row.id },
        event(),
      ),
    ).rejects.toMatchObject({ code: 'native_host_incompatible' })

    verifications.get.mockReturnValue({ ...row, completed_at: null })
    await expect(
      harness.handlers.get('computer-use:get-verification')!(
        { computerSessionId: SESSION.id, verificationId: row.id },
        event(),
      ),
    ).resolves.toEqual({
      verification: expect.objectContaining({
        id: row.id,
        computerSessionId: SESSION.id,
        status: 'pending',
        evidenceSnapshotIds: [],
        completedAt: null,
      }),
    })
  })
})
