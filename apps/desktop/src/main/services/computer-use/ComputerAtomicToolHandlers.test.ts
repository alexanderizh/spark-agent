import type { ComputerObservation } from '@spark/protocol'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ComputerAtomicActionService } from './ComputerAtomicActionService.js'
import { ComputerAtomicToolHandlers, parseKeyChord } from './ComputerAtomicToolHandlers.js'
import type { ComputerUseServices } from './ComputerUseServices.js'
import { ComputerUseBrokerError } from './ComputerUseBrokerError.js'

const OBSERVATION: ComputerObservation = {
  frameId: 'frame-1',
  treeVersion: 'tree-1',
  capturedAt: '2026-09-05T00:00:00.000Z',
  display: { id: 'display-1', width: 3000, height: 2000, scaleFactor: 2 },
  foreground: {
    app: {
      id: 'app-1',
      name: 'Notes',
      processId: 42,
      bundleId: 'com.apple.Notes',
    },
    window: {
      id: 'window-1',
      title: 'Shopping list',
      bounds: { x: 100, y: 100, width: 1000, height: 600 },
    },
  },
  screenshot: { snapshotId: 'snapshot-1', width: 2000, height: 1200 },
  tree: { mode: 'full', text: '- window "Shopping list" [1]', elementCount: 2 },
  elements: [
    {
      id: '1',
      treeVersion: 'tree-1',
      role: 'AXWindow',
      name: 'Shopping list',
      bounds: { x: 100, y: 100, width: 1000, height: 600 },
      enabled: true,
      focused: false,
      actions: ['focus'],
    },
    {
      id: '7',
      treeVersion: 'tree-1',
      role: 'AXButton',
      name: 'Add item',
      bounds: { x: 500, y: 600, width: 200, height: 40 },
      enabled: true,
      focused: false,
      actions: ['invoke'],
    },
  ],
  loading: false,
  sensitiveRegions: [],
}

describe('parseKeyChord', () => {
  it('normalizes chord strings through the alias table', () => {
    expect(parseKeyChord('cmd+shift+t')).toEqual(['Meta', 'Shift', 't'])
    expect(parseKeyChord('ctrl+alt+del')).toEqual(['Control', 'Alt', 'Delete'])
    expect(parseKeyChord('option+equal')).toEqual(['Alt', 'equal'])
  })

  it('normalizes arrays, function keys, and arrows', () => {
    expect(parseKeyChord(['Meta', 'shift', 'T'])).toEqual(['Meta', 'Shift', 'T'])
    expect(parseKeyChord('f5')).toEqual(['F5'])
    expect(parseKeyChord('arrowdown')).toEqual(['ArrowDown'])
    expect(parseKeyChord('return')).toEqual(['Enter'])
  })

  it('rejects empty and oversized chords', () => {
    expect(() => parseKeyChord('+++')).toThrow(ComputerUseBrokerError)
    expect(() => parseKeyChord('a+b+c+d+e+f+g+h+i')).toThrow(ComputerUseBrokerError)
  })
})

describe('ComputerAtomicToolHandlers', () => {
  let dispatched: Array<{ action: unknown; intent: string }>
  let services: ComputerUseServices

  beforeEach(() => {
    dispatched = []
    services = {
      sessions: {
        createSession: vi.fn(() => ({
          id: 'computer-1',
          sessionId: 'agent-1',
          turnId: 'turn-1',
          workflowRunId: null,
          environment: 'my_desktop',
          status: 'active',
          providerProfileId: 'unknown',
          modelId: 'unknown',
          taskContract: {},
          actuatorLeaseId: null,
          createdAt: '2026-09-05T00:00:00.000Z',
          updatedAt: '2026-09-05T00:00:00.000Z',
        })),
        activate: vi.fn((id: string) => ({ ...OBSERVATION, id })),
        getSession: vi.fn(() => ({ status: 'active' })),
      },
      broker: {
        observe: vi.fn(async () => OBSERVATION),
        dispatch: vi.fn(async (envelope: { action: unknown; intent: string }) => {
          dispatched.push({ action: envelope.action, intent: envelope.intent })
          return { observation: OBSERVATION, noop: false, executionChannel: 'background_ax' }
        }),
        stop: vi.fn(async () => undefined),
      },
      coordinator: { release: vi.fn(), claim: vi.fn() },
      evidence: {
        readLatestImage: vi.fn(async () => ({
          bytes: Buffer.from('png'),
          width: OBSERVATION.screenshot.width,
          height: OBSERVATION.screenshot.height,
          mimeType: 'image/png' as const,
        })),
      },
    } as unknown as ComputerUseServices
  })

  function handlers(): ComputerAtomicToolHandlers {
    const atomic = new ComputerAtomicActionService(services)
    return new ComputerAtomicToolHandlers(atomic, services)
  }

  it('clicks an element at its bounds center in window-relative coordinates', async () => {
    const result = (await handlers().handle('click', 'agent-1', 'turn-1', {
      at: { elementId: '7' },
    })) as Record<string, unknown>
    // Element center: x = 500+100 = 600 screen → (600-100)/1000 = 0.5;
    // y = 600+20 = 620 → (620-100)/600 ≈ 0.8667.
    expect(dispatched[0]?.action).toEqual({ type: 'click', point: { x: 0.5, y: 520 / 600 } })
    expect(result['status']).toBe('executed')
    expect(result['tree']).toBe(OBSERVATION.tree.text)
    expect(result['executionChannel']).toBe('background_ax')
  })

  it('converts screenshot pixel coordinates to normalized points', async () => {
    await handlers().handle('click', 'agent-1', 'turn-1', { at: { coordinate: [1000, 600] } })
    expect(dispatched[0]?.action).toEqual({ type: 'click', point: { x: 0.5, y: 0.5 } })
  })

  it('reports stale_tree for unknown element ids with recovery guidance', async () => {
    await expect(
      handlers().handle('click', 'agent-1', 'turn-1', { at: { elementId: '999' } }),
    ).rejects.toMatchObject({ code: 'stale_tree' })
    expect(dispatched).toHaveLength(0)
  })

  it('supports double click and right click variants', async () => {
    const tool = handlers()
    await tool.handle('click', 'agent-1', 'turn-1', {
      at: { elementId: '7' },
      clickCount: 2,
    })
    await tool.handle('perform_secondary_action', 'agent-1', 'turn-1', {
      at: { elementId: '7' },
    })
    expect(dispatched[0]?.action).toMatchObject({ count: 2 })
    expect(dispatched[1]?.action).toMatchObject({ button: 'right' })
  })

  it('type_text with into + submit runs focus → type → enter in order', async () => {
    const result = (await handlers().handle('type_text', 'agent-1', 'turn-1', {
      text: 'milk',
      into: { elementId: '7' },
      submit: true,
    })) as Record<string, unknown>
    expect(dispatched.map((entry) => (entry.action as { type: string }).type)).toEqual([
      'click',
      'type_text',
      'keypress',
    ])
    expect(dispatched[1]?.action).toMatchObject({ text: 'milk' })
    expect(result['status']).toBe('executed')
  })

  it('scroll uses the element target and rejects zero deltas', async () => {
    await handlers().handle('scroll', 'agent-1', 'turn-1', {
      deltaY: 400,
      at: { elementId: '7' },
    })
    expect(dispatched[0]?.action).toMatchObject({ elementId: '7', deltaY: 400 })
    await expect(
      handlers().handle('scroll', 'agent-1', 'turn-1', { deltaX: 0, deltaY: 0 }),
    ).rejects.toMatchObject({ code: 'action_not_allowed' })
  })

  it('screenshot observes and returns the tree without dispatching', async () => {
    const result = (await handlers().handle('screenshot', 'agent-1', 'turn-1', {})) as Record<
      string,
      unknown
    >
    expect(dispatched).toHaveLength(0)
    expect(result['frameId']).toBe('frame-1')
    expect(result['screenshot']).toMatchObject({
      mimeType: 'image/png',
      data: 'cG5n',
      width: OBSERVATION.screenshot.width,
      height: OBSERVATION.screenshot.height,
    })
  })
})

describe('ComputerAtomicActionService stale recovery', () => {
  it('re-observes once on stale_frame and retries the dispatch', async () => {
    let calls = 0
    const services = {
      sessions: {
        createSession: vi.fn(() => ({ id: 'computer-1' })),
        activate: vi.fn((id: string) => ({ id })),
        getSession: vi.fn(() => ({ status: 'observing' })),
      },
      broker: {
        observe: vi.fn(async () => OBSERVATION),
        dispatch: vi.fn(async () => {
          calls += 1
          if (calls === 1) throw new ComputerUseBrokerError('stale_frame', 'stale')
          return { observation: OBSERVATION, noop: false, executionChannel: null }
        }),
        stop: vi.fn(async () => undefined),
      },
      coordinator: { release: vi.fn(), claim: vi.fn(async () => undefined) },
      evidence: null,
    } as unknown as ComputerUseServices
    const service = new ComputerAtomicActionService(services)
    const result = await service.dispatch(
      'agent-1',
      'turn-1',
      () => ({ type: 'keypress', keys: ['Enter'] }),
      'retry me',
    )
    expect(result.executionChannel).toBeNull()
    expect(services.broker.observe).toHaveBeenCalledTimes(2)
  })
})

describe('ComputerAtomicActionService lifecycle', () => {
  function createLifecycleFixture(status: string) {
    const created: string[] = []
    const envelopes: Array<{ computerSessionId: string }> = []
    const services = {
      sessions: {
        createSession: vi.fn(() => {
          const id = `computer-${created.length + 1}`
          created.push(id)
          return { id }
        }),
        activate: vi.fn((id: string) => ({ id })),
        getSession: vi.fn(() => ({ status })),
      },
      broker: {
        observe: vi.fn(async () => OBSERVATION),
        dispatch: vi.fn(async (envelope: { computerSessionId: string }) => {
          envelopes.push(envelope)
          return { observation: OBSERVATION, noop: false, executionChannel: null }
        }),
        stop: vi.fn(async () => undefined),
      },
      coordinator: { release: vi.fn(), claim: vi.fn(async () => undefined) },
      evidence: null,
    } as unknown as ComputerUseServices
    return { services, created, envelopes }
  }

  it('reuses one implicit computer session across consecutive tool calls', async () => {
    const { services, created, envelopes } = createLifecycleFixture('observing')
    const service = new ComputerAtomicActionService(services)
    await service.dispatch(
      'agent-1',
      'turn-1',
      () => ({ type: 'click', point: { x: 1, y: 2 } }) as never,
      'first',
    )
    await service.dispatch(
      'agent-1',
      'turn-1',
      () => ({ type: 'keypress', keys: ['Enter'] }) as never,
      'second',
    )
    // The old "active"-status check discarded the session on every call and
    // leaked one dangling computer session (stuck "in progress" card, live
    // capture stream) per tool call.
    expect(created).toHaveLength(1)
    expect(envelopes.map((envelope) => envelope.computerSessionId)).toEqual([
      'computer-1',
      'computer-1',
    ])
  })

  it('releases the implicit session after the idle window and re-arms on the next call', async () => {
    vi.useFakeTimers()
    try {
      const { services, created } = createLifecycleFixture('observing')
      const service = new ComputerAtomicActionService(services, { idleReleaseMs: 50 })
      await service.dispatch(
        'agent-1',
        'turn-1',
        () => ({ type: 'keypress', keys: ['Enter'] }) as never,
        'go',
      )
      expect(services.broker.stop).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(80)
      expect(services.broker.stop).toHaveBeenCalledWith('computer-1')
      expect(services.coordinator.release).toHaveBeenCalledWith('computer-1')
      // The next tool call transparently arms a fresh session.
      await service.dispatch(
        'agent-1',
        'turn-1',
        () => ({ type: 'keypress', keys: ['Enter'] }) as never,
        'again',
      )
      expect(created).toHaveLength(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('claims the desktop lane when arming a session', async () => {
    const { services } = createLifecycleFixture('observing')
    const service = new ComputerAtomicActionService(services)
    await service.dispatch(
      'agent-1',
      'turn-1',
      () => ({ type: 'keypress', keys: ['Enter'] }) as never,
      'go',
    )
    expect(services.coordinator.claim).toHaveBeenCalledWith('computer-1')
  })
})
