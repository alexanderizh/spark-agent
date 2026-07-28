import type { ComputerSession, ComputerUseCapabilitySummary } from '@spark/protocol'
import { describe, expect, it, vi } from 'vitest'
import { ComputerUseAgentController } from './ComputerUseAgentController.js'

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
  it('creates an owned governed session and starts the internal operator instead of exposing actions', async () => {
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
        ]),
      },
      sessions: {
        createSession: vi.fn(() => computerSession),
        acquireLease: vi.fn(() => lease),
      },
      broker: {},
      approvals: {},
      evidence: { readLatestImage: vi.fn(), clearSession: vi.fn() },
      killSwitch: { isArmed: vi.fn(() => true) },
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
    })

    await expect(
      controller.invoke('session-1', 'start_task', {
        goal: 'Save the document',
        environment: 'my_desktop',
        successCriteria: [
          { kind: 'visual', assertion: { operator: 'text_present', expected: 'Saved' } },
        ],
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
          objective: 'Save the document',
          allowedApps: [{ kind: 'executable_identity', value: 'signed:publisher/editor.exe' }],
        }),
      }),
    )
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ session: computerSession, lease }))
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

  it('refuses My Desktop execution when the global emergency stop is not armed', async () => {
    const services = {
      backend: {
        getCapabilities: vi.fn(async () => CAPABILITIES),
      },
      killSwitch: { isArmed: vi.fn(() => false) },
    }
    const controller = new ComputerUseAgentController({
      getServices: () => services as never,
    })
    controller.bindSessionContext('session-1', {
      turnId: 'turn-1',
      providerProfileId: 'provider-1',
      modelId: 'vision-model',
    })

    await expect(
      controller.invoke('session-1', 'start_task', {
        goal: 'Save the document',
        environment: 'my_desktop',
        acceptanceCriteria: ['Saved'],
      }),
    ).rejects.toMatchObject({ code: 'action_not_allowed' })
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
