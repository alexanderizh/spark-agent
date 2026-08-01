import type { ComputerSession, ComputerUseCapabilitySummary } from '@spark/protocol'
import { describe, expect, it, vi } from 'vitest'
import {
  ComputerUseAgentController,
  getExecutionCapabilitiesWithPermissionRequest,
} from './ComputerUseAgentController.js'

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

  it('requests missing operating-system permissions before declaring execution unavailable', async () => {
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
    const getCapabilities = vi
      .fn()
      .mockResolvedValueOnce(unavailable)
      .mockResolvedValueOnce(CAPABILITIES)
    const requestPermissions = vi.fn(async () => CAPABILITIES.nativeHost!)

    await expect(
      getExecutionCapabilitiesWithPermissionRequest({ getCapabilities, requestPermissions }),
    ).resolves.toBe(CAPABILITIES)
    expect(requestPermissions).toHaveBeenCalledWith(['screen', 'accessibility'])
  })

  it('starts governed execution when the optional emergency shortcut is unavailable', async () => {
    const computerSession = {
      id: 'computer-1',
      sessionId: 'session-1',
      turnId: 'turn-1',
      status: 'observing',
      taskContract: {},
    }
    const lease = { id: 'lease-1', operatorId: 'agent:session-1' }
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
        acquireLease: vi.fn(() => lease),
      },
      broker: {},
      approvals: {},
      evidence: { readLatestImage: vi.fn(), clearSession: vi.fn() },
      appControlBridge: { cancelSession: vi.fn() },
      killSwitch: { isArmed: vi.fn(() => false) },
    }
    const run = vi.fn(async () => ({ status: 'completed' as const }))
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
      permissionMode: 'claude-ask',
    })

    await expect(
      controller.invoke('session-1', 'start_task', {
        goal: '点击搜索框，输入 comfyui',
        environment: 'my_desktop',
        targetWindowId: 'window-bilibili',
      }),
    ).resolves.toMatchObject({
      computerSession: { id: 'computer-1' },
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
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ session: computerSession, lease }))
    await Promise.resolve()
    expect(services.backend.cancelSession).toHaveBeenCalledWith(computerSession.id)
    expect(services.appControlBridge.cancelSession).toHaveBeenCalledWith(computerSession.id)
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
        acquireLease: vi.fn(() => ({ id: 'lease-1', operatorId: 'agent:session-1' })),
      },
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

  it('stops a just-created task when the desktop actuator lease is unavailable', async () => {
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
        acquireLease: vi.fn(() => {
          throw new Error('active lease conflict')
        }),
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
    ).rejects.toThrow('active lease conflict')
    expect(stop).toHaveBeenCalledWith(computerSession.id)
    expect(cancelSession).toHaveBeenCalledWith(computerSession.id)
    expect(createOperator).not.toHaveBeenCalled()
  })

  it('resumes an owned paused task with a fresh lease and a new full-observation operator run', async () => {
    const paused = computerSession('paused')
    const resumed = computerSession('observing')
    const lease = { id: 'lease-resumed', operatorId: 'agent:session-1' }
    const services = {
      sessions: {
        getSession: vi.fn(() => paused),
        acquireLease: vi.fn(() => lease),
      },
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
    const run = vi.fn(async () => ({ status: 'completed' as const }))
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
    expect(services.sessions.acquireLease).toHaveBeenCalledWith({
      computerSessionId: paused.id,
      environmentKey: 'my-desktop:local',
      operatorId: 'agent:session-1',
    })
    expect(services.evidence.clearSession).toHaveBeenCalledWith(paused.id)
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ session: resumed, lease }))
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
          acquireLease: vi.fn(() => ({ id: 'lease-1', operatorId: 'agent:session-1' })),
        },
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
