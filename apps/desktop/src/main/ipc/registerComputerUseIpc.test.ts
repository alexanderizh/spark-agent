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

const DEFAULT_SETTINGS: ComputerUseSettings = {
  enabled: false,
  environments: { safeBrowser: false, safeDesktop: false, myDesktop: false },
  allowedApps: [],
  redactSensitiveContent: true,
  fullRecordingEnabled: false,
  evidenceRetentionDays: 30,
  killSwitch: 'CommandOrControl+Shift+Escape',
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
    createSession: vi.fn(() => ({ ...SESSION, actuatorLeaseId: null, status: 'preflighting' })),
    acquireLease: vi.fn(() => ({ id: 'lease-1' })),
    getSession: vi.fn(() => SESSION),
    listActiveSessionIds: vi.fn((): string[] => []),
  }
  const broker = {
    pause: vi.fn(async () => ({ ...SESSION, status: 'paused', actuatorLeaseId: null })),
    resume: vi.fn(() => ({ ...SESSION, actuatorLeaseId: null })),
    stop: vi.fn(async () => ({ ...SESSION, status: 'canceled', actuatorLeaseId: null })),
  }
  const approvals = {
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
  }
  return {
    sessions,
    broker,
    approvals,
    backend,
    killSwitch: { isArmed: vi.fn(() => true), disarm: vi.fn() },
    armKillSwitch: vi.fn(() => true),
    verifications: { get: vi.fn(() => null) },
    ...overrides,
  }
}

function register(
  options: {
    settings?: ReturnType<typeof createSettingsStore>
    services?: any
    verifications?: { get(id: string): ComputerVerificationRow | null }
    authorizeRenderer?: (event: any) => boolean
  } = {},
) {
  const settings = options.settings ?? createSettingsStore()
  const services = options.services ?? createServices()
  registerComputerUseIpc({
    settings,
    getServices: () => services,
    authorizeRenderer: options.authorizeRenderer ?? (() => true),
    ...(options.verifications == null ? {} : { verifications: options.verifications }),
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
        'computer-use:get-settings',
        'computer-use:update-settings',
        'computer-use:start',
        'computer-use:get-status',
        'computer-use:pause',
        'computer-use:resume',
        'computer-use:stop',
        'computer-use:takeover',
        'computer-use:approve-action',
        'computer-use:deny-action',
        'computer-use:list-apps',
        'computer-use:list-windows',
        'computer-use:get-timeline',
        'computer-use:get-verification',
      ].sort(),
    )
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

  it('persists My Desktop only after the global kill switch is armed', async () => {
    const services = createServices({ armKillSwitch: vi.fn(() => false) })
    const { settings } = register({ services })

    await expect(
      harness.handlers.get('computer-use:update-settings')!(
        {
          enabled: true,
          environments: { safeBrowser: false, safeDesktop: false, myDesktop: true },
        },
        event(),
      ),
    ).rejects.toMatchObject({ code: 'action_not_allowed' })
    expect(settings.set).not.toHaveBeenCalled()

    services.armKillSwitch.mockReturnValue(true)
    const updated = await harness.handlers.get('computer-use:update-settings')!(
      {
        enabled: true,
        environments: { safeBrowser: false, safeDesktop: false, myDesktop: true },
      },
      event(),
    )
    expect(updated.enabled).toBe(true)
    expect(updated.environments.myDesktop).toBe(true)
    expect(settings.set).toHaveBeenCalledWith('computer-use', 'settings', updated)
  })

  it('does not create a session while Computer Use is disabled', async () => {
    const services = createServices()
    register({ services })

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
    expect(services.killSwitch.disarm).toHaveBeenCalledTimes(1)
    expect(settings.set).toHaveBeenCalledWith(
      'computer-use',
      'settings',
      expect.objectContaining({ enabled: false }),
    )
  })

  it('fails closed when kill switch reconfiguration removes the previous shortcut', async () => {
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

    await expect(
      harness.handlers.get('computer-use:update-settings')!(
        { killSwitch: 'CommandOrControl+Alt+Escape' },
        event(),
      ),
    ).rejects.toMatchObject({ code: 'action_not_allowed' })

    expect(services.broker.stop).toHaveBeenCalledWith(SESSION.id)
    expect(settings.set).toHaveBeenLastCalledWith(
      'computer-use',
      'settings',
      expect.objectContaining({
        enabled: false,
        environments: expect.objectContaining({ myDesktop: false }),
      }),
    )
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

  it('binds the actuator lease to the calling renderer and canonical desktop key', async () => {
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
    ).resolves.toEqual({ computerSession: SESSION })
    expect(services.sessions.acquireLease).toHaveBeenCalledWith({
      computerSessionId: SESSION.id,
      environmentKey: 'my-desktop:local',
      operatorId: 'renderer:41',
    })
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
    ).resolves.toEqual({ computerSession: SESSION })
    expect(services.sessions.acquireLease).toHaveBeenLastCalledWith({
      computerSessionId: SESSION.id,
      environmentKey: 'my-desktop:local',
      operatorId: 'renderer:99',
    })
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

  it('fails closed for timeline until the durable audit store is installed', async () => {
    register()

    await expect(
      harness.handlers.get('computer-use:get-timeline')!(
        { computerSessionId: SESSION.id },
        event(),
      ),
    ).rejects.toMatchObject({ code: 'environment_unavailable' })
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
