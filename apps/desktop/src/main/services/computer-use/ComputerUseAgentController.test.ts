import type { ComputerSession, ComputerUseCapabilitySummary } from '@spark/protocol'
import { describe, expect, it, vi } from 'vitest'
import { ComputerUseAgentController } from './ComputerUseAgentController.js'
import { ComputerUseBrokerError } from './ComputerUseBrokerError.js'

const CAPABILITIES: ComputerUseCapabilitySummary = {
  available: true,
  platform: 'windows',
  nativeHost: {
    protocolVersion: 1,
    hostVersion: '0.1.0',
    platform: 'windows',
    architecture: 'x64',
    backends: {
      screen: 'windows_graphics_capture',
      accessibility: 'uia',
      input: 'send_input',
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
      maxMessageBytes: 67_108_864,
      maxScreenshotWidth: 32_768,
      maxScreenshotHeight: 32_768,
      maxTreeElements: 100_000,
    },
  },
  permissions: { screen: 'granted', accessibility: 'granted', input: 'granted' },
}

describe('ComputerUseAgentController', () => {
  it('exposes composable desktop inventory and state tools without starting a task', async () => {
    const listApps = vi.fn(async () => [{ app: { id: 'app-1', name: 'Editor' } }])
    const listWindows = vi.fn(async () => [{ window: { id: 'window-1' } }])
    const getScreenState = vi.fn(async () => ({ foreground: { app: { id: 'app-1' } } }))
    const getAppState = vi.fn(async () => ({
      target: { app: { id: 'app-1', name: 'Editor' }, window: { id: 'window-1' } },
      state: { app: { id: 'app-1', name: 'Editor' }, running: true },
    }))
    const openApp = vi.fn(async () => ({
      target: { app: { id: 'app-1', name: 'Editor' }, window: { id: 'window-1' } },
      state: { app: { id: 'app-1', name: 'Editor' }, running: true },
    }))
    const desktopState = { listApps, listWindows, getScreenState, getAppState, openApp }
    const controller = new ComputerUseAgentController({
      getServices: () => ({ backend: {} }) as never,
      createDesktopState: () => desktopState as never,
    })

    await expect(controller.invoke('session-1', 'list_apps', {})).resolves.toMatchObject({
      count: 1,
    })
    await expect(
      controller.invoke('session-1', 'list_windows', { app: 'Editor' }),
    ).resolves.toMatchObject({ count: 1 })
    await expect(controller.invoke('session-1', 'get_screen_state', {})).resolves.toMatchObject({
      foreground: { app: { id: 'app-1' } },
    })
    await expect(
      controller.invoke('session-1', 'get_app_state', {
        app: 'Editor',
        includeSnapshot: false,
      }),
    ).resolves.toMatchObject({ state: { running: true }, snapshot: null })
    await expect(
      controller.invoke('session-1', 'open_app', { app: 'Editor' }),
    ).resolves.toMatchObject({ state: { running: true } })

    expect(listApps).toHaveBeenCalledWith({ includeWindows: true, scope: 'all' })
    expect(listWindows).toHaveBeenCalledWith({ app: 'Editor', includeMinimized: false })
    expect(getScreenState).toHaveBeenCalledWith({ includeWindows: true })
    expect(getAppState).toHaveBeenCalledWith({
      app: 'Editor',
      launchIfNeeded: true,
    })
    expect(openApp).toHaveBeenCalledWith('Editor')
  })

  it('waits on session status events instead of polling get_status', async () => {
    let current = computerSession('observing')
    let listener: ((session: ComputerSession) => void) | undefined
    const unsubscribe = vi.fn()
    const services = {
      sessions: {
        getSession: vi.fn(() => current),
        subscribeStatus: vi.fn((next: (session: ComputerSession) => void) => {
          listener = next
          return unsubscribe
        }),
      },
    }
    const controller = new ComputerUseAgentController({ getServices: () => services as never })

    const waiting = controller.invoke('session-1', 'wait_for_completion', {
      computerSessionId: current.id,
      timeoutMs: 1_000,
    })
    current = computerSession('completed')
    listener?.(current)

    await expect(waiting).resolves.toMatchObject({
      computerSession: { status: 'completed' },
      operator: { status: 'not_running' },
    })
    expect(services.sessions.subscribeStatus).toHaveBeenCalledTimes(1)
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('reports a failed task instead of directing the agent to an unverifiable fallback', async () => {
    const current = computerSession('failed')
    const services = {
      sessions: {
        getSession: vi.fn(() => current),
      },
    }
    const controller = new ComputerUseAgentController({ getServices: () => services as never })

    await expect(
      controller.invoke('session-1', 'wait_for_completion', {
        computerSessionId: current.id,
      }),
    ).resolves.toMatchObject({
      computerSession: { status: 'failed' },
      continuation: {
        action: 'report_computer_task_failure',
        askUserToChooseFallback: true,
      },
    })
  })

  it('waits for the operator result before returning a terminal session status', async () => {
    let current = computerSession('preflighting')
    let listener: ((session: ComputerSession) => void) | undefined
    let resolveRun:
      | ((result: { status: 'failed'; reason: 'decision_model_error' }) => void)
      | undefined
    let finishNativeCleanup: (() => void) | undefined
    const run = vi.fn(
      () =>
        new Promise<{ status: 'failed'; reason: 'decision_model_error' }>((resolve) => {
          resolveRun = resolve
        }),
    )
    const services = {
      backend: {
        getCapabilities: vi.fn(async () => CAPABILITIES),
        listWindows: vi.fn(async () => [
          {
            app: { id: 'app-1', name: 'Spark' },
            window: {
              id: 'window-1',
              title: 'Spark',
              bounds: { x: 0, y: 0, width: 800, height: 600 },
            },
            display: { id: 'display-1', width: 1920, height: 1080, scaleFactor: 1 },
            focused: true,
            minimized: false,
          },
        ]),
        cancelSession: vi.fn(
          () =>
            new Promise<void>((resolve) => {
              finishNativeCleanup = resolve
            }),
        ),
      },
      sessions: {
        createSession: vi.fn(() => current),
        activate: vi.fn(() => current),
        getSession: vi.fn(() => current),
        subscribeStatus: vi.fn((next: (session: ComputerSession) => void) => {
          listener = next
          return vi.fn()
        }),
      },
      coordinator: { claim: vi.fn(async () => undefined), release: vi.fn() },
      broker: { stop: vi.fn(async () => current) },
      approvals: {},
      evidence: { readLatestImage: vi.fn(), clearSession: vi.fn() },
      killSwitch: { isArmed: vi.fn(() => false) },
    }
    const controller = new ComputerUseAgentController({
      getServices: () => services as never,
      resolveDecisionModel: vi.fn(async () => ({
        providerProfileId: 'provider-1',
        providerType: 'openai',
        apiKey: 'secret',
        model: 'vision-model',
      })),
      createAdapter: vi.fn(() => ({ decide: vi.fn() }) as never),
      createOperator: vi.fn(() => ({ run }) as never),
    })
    controller.bindSessionContext('session-1', {
      turnId: 'turn-1',
      providerProfileId: 'provider-1',
      modelId: 'vision-model',
      permissionMode: 'codex-full-access',
    })

    await controller.invoke('session-1', 'start_task', {
      goal: 'Open Bilibili',
      environment: 'my_desktop',
    })
    current = computerSession('observing')
    await expect(
      controller.invoke('session-1', 'wait_for_completion', {
        computerSessionId: current.id,
        timeoutMs: 100,
      }),
    ).resolves.toMatchObject({
      timedOut: true,
      operator: { status: 'running' },
    })
    const waiting = controller.invoke('session-1', 'wait_for_completion', {
      computerSessionId: current.id,
      timeoutMs: 1_000,
    })
    current = computerSession('failed')
    listener?.(current)
    resolveRun?.({ status: 'failed', reason: 'decision_model_error' })
    const lateWaiting = controller.invoke('session-1', 'wait_for_completion', {
      computerSessionId: current.id,
      timeoutMs: 1_000,
    })

    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(services.coordinator.release).not.toHaveBeenCalled()
    finishNativeCleanup?.()

    await expect(waiting).resolves.toMatchObject({
      computerSession: { status: 'failed' },
      operator: {
        status: 'failed',
        result: { status: 'failed', reason: 'decision_model_error' },
      },
    })
    await expect(lateWaiting).resolves.toMatchObject({
      computerSession: { status: 'failed' },
      operator: { status: 'failed' },
    })
  })

  it('does not request operating-system permissions while starting a task', async () => {
    const unavailable = {
      ...CAPABILITIES,
      nativeHost: {
        ...CAPABILITIES.nativeHost!,
        features: {
          ...CAPABILITIES.nativeHost!.features,
          fullTree: false,
          semanticActions: false,
          absolutePointer: false,
          keyboard: false,
        },
      },
      permissions: {
        screen: 'not_determined' as const,
        accessibility: 'not_determined' as const,
        input: 'denied' as const,
      },
    }
    const getCapabilities = vi.fn(async () => unavailable)
    const requestPermissions = vi.fn()
    const controller = new ComputerUseAgentController({
      getServices: () => ({ backend: { getCapabilities, requestPermissions } }) as never,
    })

    await expect(
      controller.invoke('session-1', 'start_task', {
        goal: 'Open Bilibili',
        environment: 'my_desktop',
      }),
    ).rejects.toMatchObject({ code: 'screen_permission_denied' })
    expect(requestPermissions).not.toHaveBeenCalled()
  })

  it.each([
    {
      name: 'missing Native Host',
      capabilities: { ...CAPABILITIES, available: false, nativeHost: null },
      code: 'native_host_missing',
    },
    {
      name: 'screen permission denied',
      capabilities: {
        ...CAPABILITIES,
        permissions: { ...CAPABILITIES.permissions, screen: 'denied' as const },
        nativeHost: {
          ...CAPABILITIES.nativeHost!,
          permissions: { ...CAPABILITIES.nativeHost!.permissions, screen: 'denied' as const },
        },
      },
      code: 'screen_permission_denied',
    },
    {
      name: 'accessibility permission denied without coordinate fallback',
      capabilities: {
        ...CAPABILITIES,
        permissions: { ...CAPABILITIES.permissions, accessibility: 'denied' as const },
        nativeHost: {
          ...CAPABILITIES.nativeHost!,
          permissions: {
            ...CAPABILITIES.nativeHost!.permissions,
            accessibility: 'denied' as const,
          },
          features: {
            ...CAPABILITIES.nativeHost!.features,
            fullTree: false,
            semanticActions: false,
            absolutePointer: false,
            keyboard: false,
          },
        },
      },
      code: 'accessibility_permission_denied',
    },
    {
      name: 'input permission denied without semantic fallback',
      capabilities: {
        ...CAPABILITIES,
        permissions: { ...CAPABILITIES.permissions, input: 'denied' as const },
        nativeHost: {
          ...CAPABILITIES.nativeHost!,
          permissions: { ...CAPABILITIES.nativeHost!.permissions, input: 'denied' as const },
          features: {
            ...CAPABILITIES.nativeHost!.features,
            fullTree: false,
            semanticActions: false,
            absolutePointer: false,
            keyboard: false,
          },
        },
      },
      code: 'privilege_mismatch',
    },
  ])('returns a precise startup error for $name', async ({ capabilities, code }) => {
    const controller = new ComputerUseAgentController({
      getServices: () =>
        ({
          backend: { getCapabilities: vi.fn(async () => capabilities) },
        }) as never,
    })

    await expect(
      controller.invoke('session-1', 'start_task', {
        goal: 'Open Bilibili',
        environment: 'my_desktop',
      }),
    ).rejects.toMatchObject({ code })
  })

  it.each([
    'claude-ask',
    'claude-auto-edits',
    'claude-plan',
    'claude-auto',
    'claude-bypass',
    'codex-default',
    'codex-auto-review',
    'codex-full-access',
  ])('starts governed execution identically in %s mode', async (permissionMode) => {
    const computerSession = {
      id: 'computer-1',
      sessionId: 'session-1',
      turnId: 'turn-1',
      status: 'observing',
      taskContract: {},
    }
    const services = {
      backend: {
        getCapabilities: vi.fn(async () => CAPABILITIES),
        bindSessionTarget: vi.fn(),
        cancelSession: vi.fn(async () => undefined),
        listWindows: vi.fn(async () => [
          {
            app: {
              id: 'app-1',
              name: 'Editor',
              executableIdentity: 'signed:publisher/editor.exe',
            },
            window: {
              id: 'window-1',
              title: 'Document',
              bounds: { x: 0, y: 0, width: 800, height: 600 },
            },
            display: { id: 'display-1', width: 1920, height: 1080, scaleFactor: 1 },
            focused: true,
            minimized: false,
          },
          {
            app: { id: 'app-bilibili', name: 'bilibili', bundleId: 'tv.danmaku.bilianime' },
            window: {
              id: 'window-bilibili',
              title: 'bilibili',
              bounds: { x: 900, y: 0, width: 600, height: 800 },
            },
            display: { id: 'display-1', width: 1920, height: 1080, scaleFactor: 1 },
            focused: false,
            minimized: false,
          },
        ]),
      },
      sessions: {
        createSession: vi.fn(() => computerSession),
        activate: vi.fn(() => ({ ...computerSession, actuatorLeaseId: null })),
        getSession: vi.fn(() => ({ ...computerSession, actuatorLeaseId: null })),
      },
      coordinator: { claim: vi.fn(async () => undefined), release: vi.fn() },
      broker: {},
      approvals: {},
      evidence: { readLatestImage: vi.fn(), clearSession: vi.fn() },
      appControlBridge: { cancelSession: vi.fn() },
      killSwitch: { isArmed: vi.fn(() => false) },
    }
    const run = vi.fn(async (_input: unknown) => ({ status: 'completed' as const }))
    const controller = new ComputerUseAgentController({
      getServices: () => services as never,
      resolveDecisionModel: vi.fn(async () => ({
        providerProfileId: 'provider-1',
        providerType: 'openai',
        apiKey: 'secret',
        model: 'vision-model',
      })),
      createAdapter: vi.fn(() => ({ decide: vi.fn() }) as never),
      createOperator: vi.fn(() => ({ run }) as never),
    })
    controller.bindSessionContext('session-1', {
      turnId: 'turn-1',
      providerProfileId: 'provider-1',
      modelId: 'vision-model',
      permissionMode,
    })

    await expect(
      controller.invoke('session-1', 'start_task', {
        goal: '点击搜索框，输入 comfyui',
        environment: 'my_desktop',
        targetWindowId: 'window-bilibili',
      }),
    ).resolves.toMatchObject({
      computerSession: { id: 'computer-1', actuatorLeaseId: null },
      operatorStatus: 'running',
    })
    expect(services.sessions.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-1',
        turnId: 'turn-1',
        taskContract: expect.objectContaining({
          objective: '点击搜索框，输入 comfyui',
          allowedApps: [],
          successCriteria: [
            {
              kind: 'visual',
              assertion: { operator: 'text_present', expected: 'comfyui' },
            },
          ],
          maxSteps: 100,
          maxRuntimeMs: 1_200_000,
          maxConsecutiveNoops: 8,
        }),
      }),
    )
    expect(services.backend.bindSessionTarget).toHaveBeenCalledWith({
      computerSessionId: 'computer-1',
      appId: 'app-bilibili',
      windowId: 'window-bilibili',
    })
    expect(services.coordinator.claim).toHaveBeenCalledWith(computerSession.id)
    expect(services.sessions.activate).toHaveBeenCalledWith(computerSession.id)
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        session: expect.objectContaining({ id: computerSession.id, actuatorLeaseId: null }),
      }),
    )
    expect(run.mock.calls[0]?.[0]).not.toHaveProperty('lease')
    await Promise.resolve()
    expect(services.backend.cancelSession).toHaveBeenCalledWith(computerSession.id)
    expect(services.appControlBridge.cancelSession).toHaveBeenCalledWith(computerSession.id)
    expect(services.backend.cancelSession.mock.invocationCallOrder[0]).toBeLessThan(
      services.coordinator.release.mock.invocationCallOrder.at(-1) ?? Number.POSITIVE_INFINITY,
    )
  })

  it('starts an unbound desktop task that can follow the foreground window across applications', async () => {
    const computerSession = {
      id: 'computer-1',
      sessionId: 'session-1',
      turnId: 'turn-1',
      status: 'observing',
      taskContract: {},
    }
    const bindSessionTarget = vi.fn()
    const services = {
      backend: {
        getCapabilities: vi.fn(async () => CAPABILITIES),
        bindSessionTarget,
        listWindows: vi.fn(async () => [
          {
            app: { id: 'app-spark', name: 'Spark', bundleId: 'com.spark.desktop' },
            window: {
              id: 'window-spark',
              title: 'Spark',
              bounds: { x: 0, y: 0, width: 900, height: 800 },
            },
            display: { id: 'display-1', width: 1920, height: 1080, scaleFactor: 1 },
            focused: true,
            minimized: false,
          },
          {
            app: { id: 'app-browser', name: 'Browser', bundleId: 'com.browser.desktop' },
            window: {
              id: 'window-browser',
              title: 'Browser',
              bounds: { x: 900, y: 0, width: 800, height: 800 },
            },
            display: { id: 'display-1', width: 1920, height: 1080, scaleFactor: 1 },
            focused: false,
            minimized: false,
          },
        ]),
      },
      sessions: {
        createSession: vi.fn(() => computerSession),
        activate: vi.fn(() => ({ ...computerSession, actuatorLeaseId: null })),
        getSession: vi.fn(() => ({ ...computerSession, actuatorLeaseId: null })),
      },
      coordinator: { claim: vi.fn(async () => undefined), release: vi.fn() },
      broker: {},
      approvals: {},
      evidence: { readLatestImage: vi.fn(), clearSession: vi.fn() },
      killSwitch: { isArmed: vi.fn(() => false) },
    }
    const controller = new ComputerUseAgentController({
      getServices: () => services as never,
      resolveDecisionModel: vi.fn(async () => ({
        providerProfileId: 'provider-1',
        providerType: 'openai',
        apiKey: 'secret',
        model: 'vision-model',
      })),
      createAdapter: vi.fn(() => ({ decide: vi.fn() }) as never),
      createOperator: vi.fn(() => ({ run: vi.fn(async () => ({ status: 'completed' })) }) as never),
    })
    controller.bindSessionContext('session-1', {
      turnId: 'turn-1',
      providerProfileId: 'provider-1',
      modelId: 'vision-model',
      permissionMode: 'codex-full-access',
    })

    await controller.invoke('session-1', 'start_task', {
      goal: 'Open the browser and search for "Spark Agent"',
      environment: 'my_desktop',
    })

    expect(bindSessionTarget).not.toHaveBeenCalled()
    expect(services.sessions.createSession).toHaveBeenCalledWith(
      expect.objectContaining({
        taskContract: expect.objectContaining({
          allowedApps: [],
        }),
      }),
    )
  })

  it('stops a just-created task when preempting the previous desktop task fails', async () => {
    const computerSession = {
      id: 'computer-lease-conflict',
      sessionId: 'session-1',
      turnId: 'turn-1',
      status: 'preflighting',
      taskContract: {},
    }
    const stop = vi.fn(async () => ({ ...computerSession, status: 'canceled' }))
    const cancelSession = vi.fn(async () => undefined)
    const services = {
      backend: {
        getCapabilities: vi.fn(async () => CAPABILITIES),
        listWindows: vi.fn(async () => [
          {
            app: { id: 'app-1', name: 'Browser' },
            window: {
              id: 'window-1',
              title: 'Browser',
              bounds: { x: 0, y: 0, width: 800, height: 600 },
            },
            display: { id: 'display-1', width: 1920, height: 1080, scaleFactor: 1 },
            focused: true,
            minimized: false,
          },
        ]),
        cancelSession,
      },
      sessions: {
        createSession: vi.fn(() => computerSession),
        activate: vi.fn(),
      },
      coordinator: {
        claim: vi.fn(async () => {
          throw new Error('previous desktop cleanup failed')
        }),
        release: vi.fn(),
      },
      broker: { stop },
      approvals: {},
      evidence: { readLatestImage: vi.fn(), clearSession: vi.fn() },
      appControlBridge: { cancelSession: vi.fn() },
      killSwitch: { isArmed: vi.fn(() => false) },
    }
    const createOperator = vi.fn()
    const controller = new ComputerUseAgentController({
      getServices: () => services as never,
      resolveDecisionModel: vi.fn(async () => ({
        providerProfileId: 'provider-1',
        providerType: 'openai',
        apiKey: 'secret',
        model: 'vision-model',
      })),
      createAdapter: vi.fn(() => ({ decide: vi.fn() }) as never),
      createOperator,
    })
    controller.bindSessionContext('session-1', {
      turnId: 'turn-1',
      providerProfileId: 'provider-1',
      modelId: 'vision-model',
      permissionMode: 'codex-full-access',
    })

    await expect(
      controller.invoke('session-1', 'start_task', {
        goal: 'Search for ComfyUI tutorials',
        environment: 'my_desktop',
      }),
    ).rejects.toThrow('previous desktop cleanup failed')
    expect(stop).toHaveBeenCalledWith(computerSession.id)
    expect(cancelSession).toHaveBeenCalledWith(computerSession.id)
    expect(createOperator).not.toHaveBeenCalled()
  })

  it('keeps coordinator ownership until failed Agent startup cleanup finishes', async () => {
    const created = computerSession('preflighting')
    let finishStop: (() => void) | undefined
    const services = {
      backend: {
        getCapabilities: vi.fn(async () => CAPABILITIES),
        listWindows: vi.fn(async () => [
          {
            app: { id: 'app-1', name: 'Spark' },
            window: {
              id: 'window-1',
              title: 'Spark',
              bounds: { x: 0, y: 0, width: 800, height: 600 },
            },
            display: { id: 'display-1', width: 1920, height: 1080, scaleFactor: 1 },
            focused: true,
            minimized: false,
          },
        ]),
        cancelSession: vi.fn(async () => undefined),
      },
      sessions: {
        createSession: vi.fn(() => created),
        activate: vi.fn(() => {
          throw new ComputerUseBrokerError('session_canceled', 'Activation failed')
        }),
      },
      coordinator: { claim: vi.fn(async () => undefined), release: vi.fn() },
      broker: {
        stop: vi.fn(
          () =>
            new Promise((resolve) => {
              finishStop = () => resolve(computerSession('canceled'))
            }),
        ),
      },
      evidence: { readLatestImage: vi.fn(), clearSession: vi.fn() },
      appControlBridge: { cancelSession: vi.fn() },
      killSwitch: { isArmed: vi.fn(() => false) },
    }
    const controller = new ComputerUseAgentController({
      getServices: () => services as never,
      resolveDecisionModel: vi.fn(async () => ({
        providerProfileId: 'provider-1',
        providerType: 'openai',
        apiKey: 'secret',
        model: 'vision-model',
      })),
    })
    controller.bindSessionContext('session-1', {
      turnId: 'turn-1',
      providerProfileId: 'provider-1',
      modelId: 'vision-model',
      permissionMode: 'claude-ask',
    })

    const starting = controller.invoke('session-1', 'start_task', {
      goal: 'Open Bilibili',
      environment: 'my_desktop',
    })
    await vi.waitFor(() => expect(services.broker.stop).toHaveBeenCalledWith(created.id))
    expect(services.coordinator.release).not.toHaveBeenCalled()
    finishStop?.()

    await expect(starting).rejects.toMatchObject({ code: 'session_canceled' })
    expect(services.coordinator.release).toHaveBeenCalledWith(created.id)
  })

  it('resumes an owned paused task by reclaiming direct desktop control', async () => {
    const paused = computerSession('paused')
    const resumed = computerSession('observing')
    const services = {
      sessions: {
        getSession: vi.fn(() => paused),
      },
      coordinator: { claim: vi.fn(async () => undefined), release: vi.fn() },
      broker: {
        resume: vi.fn(() => resumed),
        pause: vi.fn(async () => paused),
      },
      approvals: {},
      evidence: {
        readLatestImage: vi.fn(),
        clearSession: vi.fn(),
      },
      killSwitch: { isArmed: vi.fn(() => true) },
    }
    const run = vi.fn(async (_input: unknown) => ({ status: 'completed' as const }))
    const resolveDecisionModel = vi.fn(async () => ({
      providerProfileId: 'provider-1',
      providerType: 'openai' as const,
      apiKey: 'secret',
      model: 'vision-model',
    }))
    const controller = new ComputerUseAgentController({
      getServices: () => services as never,
      resolveDecisionModel,
      createAdapter: vi.fn(() => ({ decide: vi.fn() }) as never),
      createOperator: vi.fn(() => ({ run }) as never),
    })
    controller.bindSessionContext('session-1', {
      turnId: 'turn-1',
      providerProfileId: 'provider-1',
      modelId: 'vision-model',
      permissionMode: 'codex-full-access',
    })

    await expect(
      controller.invoke('session-1', 'resume', { computerSessionId: paused.id }),
    ).resolves.toMatchObject({
      computerSession: { id: paused.id, status: 'observing' },
      operatorStatus: 'running',
    })
    expect(resolveDecisionModel).toHaveBeenCalledWith('session-1')
    expect(services.broker.resume).toHaveBeenCalledWith(paused.id)
    expect(services.coordinator.claim).toHaveBeenCalledWith(paused.id)
    expect(services.evidence.clearSession).toHaveBeenCalledWith(paused.id)
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ session: resumed }))
    expect(run.mock.calls[0]?.[0]).not.toHaveProperty('lease')
  })

  it('explicitly rebinds an owned paused task to a window from any application', async () => {
    const session = computerSession('paused')
    const bindSessionTarget = vi.fn()
    const services = {
      sessions: { getSession: vi.fn(() => session) },
      backend: {
        listWindows: vi.fn(async () => [
          {
            app: { id: 'app-1', name: 'Editor' },
            window: {
              id: 'window-2',
              title: 'New document',
              bounds: { x: 0, y: 0, width: 800, height: 600 },
            },
            display: { id: 'display-1', width: 1920, height: 1080, scaleFactor: 1 },
            focused: false,
            minimized: false,
          },
        ]),
        bindSessionTarget,
      },
    }
    const controller = new ComputerUseAgentController({
      getServices: () => services as never,
      resolveDecisionModel: vi.fn(),
      createAdapter: vi.fn(),
      createOperator: vi.fn(),
    })

    await expect(
      controller.invoke('session-1', 'bind_target', {
        computerSessionId: session.id,
        targetWindowId: 'window-2',
      }),
    ).resolves.toMatchObject({ targetWindowId: 'window-2' })
    expect(bindSessionTarget).toHaveBeenCalledWith({
      computerSessionId: session.id,
      appId: 'app-1',
      windowId: 'window-2',
    })
    services.sessions.getSession.mockReturnValue({ ...session, status: 'observing' })
    bindSessionTarget.mockClear()
    await expect(
      controller.invoke('session-1', 'bind_target', {
        computerSessionId: session.id,
        targetWindowId: 'window-2',
      }),
    ).rejects.toMatchObject({ code: 'action_not_allowed' })
    expect(bindSessionTarget).not.toHaveBeenCalled()
  })

  it('reports native execution as available when the optional emergency shortcut is not armed', async () => {
    const services = {
      backend: {
        getCapabilities: vi.fn(async () => CAPABILITIES),
      },
      killSwitch: { isArmed: vi.fn(() => false) },
    }
    const controller = new ComputerUseAgentController({
      getServices: () => services as never,
    })
    await expect(controller.promptCapabilities()).resolves.toMatchObject({
      available: true,
      executionAvailable: true,
    })
    await expect(controller.invoke('session-1', 'get_capabilities', {})).resolves.toMatchObject({
      executionAvailable: true,
      killSwitchArmed: false,
    })
  })

  it('returns the copyable native host diagnostic report through the Agent tool', async () => {
    const report = {
      correlationId: 'diagnostic-1',
      result: { diagnosticCode: 'native_host_ready', stage: 'handshake' },
    }
    const collect = vi.fn(async () => report)
    const controller = new ComputerUseAgentController({
      getServices: () => ({ diagnostics: { collect } }) as never,
    })

    await expect(controller.invoke('session-1', 'diagnose_native_host', {})).resolves.toBe(report)
    expect(collect).toHaveBeenCalledOnce()
  })

  it('advertises governed execution when semantic actions work without coordinate input permission', async () => {
    const capabilities: ComputerUseCapabilitySummary = {
      ...CAPABILITIES,
      nativeHost: {
        ...CAPABILITIES.nativeHost!,
        backends: { ...CAPABILITIES.nativeHost!.backends, input: 'unavailable' },
        features: {
          ...CAPABILITIES.nativeHost!.features,
          absolutePointer: false,
          keyboard: false,
        },
        permissions: { ...CAPABILITIES.nativeHost!.permissions, input: 'denied' },
      },
      permissions: { ...CAPABILITIES.permissions, input: 'denied' },
    }
    const controller = new ComputerUseAgentController({
      getServices: () =>
        ({
          backend: { getCapabilities: vi.fn(async () => capabilities) },
          killSwitch: { isArmed: vi.fn(() => true) },
        }) as never,
    })

    await expect(controller.invoke('session-1', 'get_capabilities', {})).resolves.toMatchObject({
      executionAvailable: true,
    })
  })

  it('advertises screenshot-coordinate execution when an application exposes no accessibility tree', async () => {
    const capabilities: ComputerUseCapabilitySummary = {
      ...CAPABILITIES,
      nativeHost: {
        ...CAPABILITIES.nativeHost!,
        backends: { ...CAPABILITIES.nativeHost!.backends, accessibility: 'unavailable' },
        features: {
          ...CAPABILITIES.nativeHost!.features,
          fullTree: false,
          diffTree: false,
          semanticActions: false,
        },
        permissions: { ...CAPABILITIES.nativeHost!.permissions, accessibility: 'denied' },
      },
      permissions: { ...CAPABILITIES.permissions, accessibility: 'denied' },
    }
    const controller = new ComputerUseAgentController({
      getServices: () =>
        ({
          backend: { getCapabilities: vi.fn(async () => capabilities) },
          killSwitch: { isArmed: vi.fn(() => true) },
        }) as never,
    })

    await expect(controller.invoke('session-1', 'get_capabilities', {})).resolves.toMatchObject({
      executionAvailable: true,
    })
  })

  it('captures an Agent-owned application snapshot and returns explicit image preview metadata', async () => {
    const previewUrl = `spark-snapshot://snapshot/snapshot-1/preview?cap=${'a'.repeat(43)}`
    const snapshot = {
      id: 'snapshot-1',
      kind: 'user_context' as const,
      sessionId: 'session-1',
      turnId: 'turn-1',
      computerSessionId: null,
      app: { id: 'app-1', name: 'Editor' },
      window: {
        id: 'window-1',
        title: 'Document',
        bounds: { x: 0, y: 0, width: 800, height: 600 },
      },
      display: { id: 'display-1', width: 1920, height: 1080, scaleFactor: 1 },
      capturedAt: '2026-07-28T00:00:00.000Z',
      previewUrl,
      accessibleTextMode: 'visible_only' as const,
      redaction: { applied: false, reasonCodes: [], regionCount: 0 },
      imageSha256: 'a'.repeat(64),
    }
    const captureFrontmost = vi.fn(async () => snapshot)
    const controller = new ComputerUseAgentController({
      getServices: () => ({ snapshots: { captureFrontmost } }) as never,
    })
    controller.bindSessionContext('session-1', {
      turnId: 'turn-1',
      providerProfileId: 'provider-1',
      modelId: 'vision-model',
      permissionMode: 'claude-ask',
    })

    await expect(
      controller.invoke('session-1', 'capture_app_snapshot', {
        accessibleTextMode: 'visible_only',
      }),
    ).resolves.toEqual({
      snapshot,
      preview: {
        type: 'image',
        url: previewUrl,
        alt: 'Editor — Document',
      },
    })
    expect(captureFrontmost).toHaveBeenCalledWith({
      sessionId: 'session-1',
      turnId: 'turn-1',
      accessibleTextMode: 'visible_only',
    })
  })

  it.each(['pause', 'stop', 'takeover'] as const)(
    '%s clears cached evidence and prevents an obsolete operator result from becoming current',
    async (toolName) => {
      let resolveRun: ((value: { status: 'failed'; reason: string }) => void) | undefined
      const runPromise = new Promise<{ status: 'failed'; reason: string }>((resolve) => {
        resolveRun = resolve
      })
      const running = computerSession('observing')
      const paused = computerSession('paused')
      const canceled = computerSession('canceled')
      const services = {
        backend: {
          getCapabilities: vi.fn(async () => CAPABILITIES),
          listWindows: vi.fn(async () => [
            {
              app: { id: 'app-1', name: 'Editor', executableIdentity: 'signed:editor.exe' },
              window: {
                id: 'window-1',
                title: 'Document',
                bounds: { x: 0, y: 0, width: 800, height: 600 },
              },
              display: { id: 'display-1', width: 1920, height: 1080, scaleFactor: 1 },
              focused: true,
              minimized: false,
            },
          ]),
        },
        sessions: {
          createSession: vi.fn(() => running),
          getSession: vi.fn(() => (toolName === 'stop' ? canceled : paused)),
          activate: vi.fn(() => running),
        },
        coordinator: { claim: vi.fn(async () => undefined), release: vi.fn() },
        broker: {
          pause: vi.fn(async () => paused),
          stop: vi.fn(async () => canceled),
        },
        approvals: {},
        evidence: { readLatestImage: vi.fn(), clearSession: vi.fn() },
        killSwitch: { isArmed: vi.fn(() => true) },
      }
      const controller = new ComputerUseAgentController({
        getServices: () => services as never,
        resolveDecisionModel: vi.fn(async () => ({
          providerProfileId: 'provider-1',
          providerType: 'openai',
          apiKey: 'secret',
          model: 'vision-model',
        })),
        createAdapter: vi.fn(() => ({ decide: vi.fn() }) as never),
        createOperator: vi.fn(() => ({ run: vi.fn(() => runPromise) }) as never),
      })
      controller.bindSessionContext('session-1', {
        turnId: 'turn-1',
        providerProfileId: 'provider-1',
        modelId: 'vision-model',
        permissionMode: 'claude-ask',
      })
      await controller.invoke('session-1', 'start_task', {
        goal: 'Save the document',
        environment: 'my_desktop',
        acceptanceCriteria: ['Saved'],
      })

      await controller.invoke('session-1', toolName, { computerSessionId: running.id })
      resolveRun?.({ status: 'failed', reason: 'session_paused' })
      await runPromise
      await Promise.resolve()

      expect(services.evidence.clearSession).toHaveBeenCalledWith(running.id)
      await expect(
        controller.invoke('session-1', 'get_status', { computerSessionId: running.id }),
      ).resolves.toMatchObject({ operator: { status: 'not_running' } })
      if (toolName === 'stop') expect(services.broker.stop).toHaveBeenCalledWith(running.id)
      else expect(services.broker.pause).toHaveBeenCalledWith(running.id)
    },
  )

  it('stops every active Computer Use task owned by a revoked Agent session', async () => {
    const owned = computerSession('observing')
    const other = { ...computerSession('observing'), id: 'computer-2', sessionId: 'session-2' }
    const stop = vi.fn(async () => computerSession('canceled'))
    const clearSession = vi.fn()
    const sessionsById = new Map([
      [owned.id, owned],
      [other.id, other],
    ])
    const services = {
      sessions: {
        listActiveSessionIds: vi.fn(() => [owned.id, other.id]),
        getSession: vi.fn((id: string) => sessionsById.get(id) ?? null),
      },
      broker: { stop },
      evidence: { clearSession },
      coordinator: { claim: vi.fn(async () => undefined), release: vi.fn() },
    }
    const controller = new ComputerUseAgentController({
      getServices: () => services as never,
    })
    controller.bindSessionContext('session-1', {
      turnId: 'turn-1',
      providerProfileId: 'provider-1',
      modelId: 'vision-model',
      permissionMode: 'codex-full-access',
    })

    await controller.stopOwnedSessions('session-1')

    expect(stop).toHaveBeenCalledTimes(1)
    expect(stop).toHaveBeenCalledWith(owned.id)
    expect(clearSession).toHaveBeenCalledWith(owned.id)
  })
})

function computerSession(status: ComputerSession['status']): ComputerSession {
  return {
    id: 'computer-1',
    sessionId: 'session-1',
    turnId: 'turn-1',
    workflowRunId: null,
    environment: 'my_desktop',
    status,
    providerProfileId: 'provider-1',
    modelId: 'vision-model',
    taskContract: {
      objective: 'Save the document',
      successCriteria: [
        { kind: 'visual', assertion: { operator: 'text_present', expected: 'Saved' } },
      ],
      allowedApps: [{ kind: 'app_id', value: 'app-1' }],
      allowedDomains: [],
      allowedDataClasses: ['public'],
      forbiddenActions: [],
      maxSteps: 50,
      maxRuntimeMs: 600_000,
      maxConsecutiveNoops: 3,
      userPresence: 'required',
    },
    actuatorLeaseId: status === 'paused' ? null : 'lease-1',
    createdAt: '2026-07-28T00:00:00.000Z',
    updatedAt: '2026-07-28T00:00:01.000Z',
  }
}
