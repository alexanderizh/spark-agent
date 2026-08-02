import type { ComputerObservation, ComputerTaskContract } from '@spark/protocol'
import type { GenerateCanvasTextParams } from '@spark/agent-runtime'
import { describe, expect, it, vi } from 'vitest'
import { GenericComputerDecisionAdapter } from './ComputerDecisionAdapter.js'

const OBSERVATION = {
  frameId: 'frame-1',
  treeVersion: 'tree-1',
  capturedAt: '2026-07-28T08:00:00.000Z',
  display: { id: 'display-1', width: 1920, height: 1080, scaleFactor: 1 },
  foreground: {
    app: { id: 'app-1', name: 'Editor' },
    window: {
      id: 'window-1',
      title: 'Document',
      bounds: { x: 0, y: 0, width: 800, height: 600 },
    },
  },
  screenshot: { snapshotId: 'snapshot-1', width: 800, height: 600 },
  tree: { mode: 'full', text: 'button "Save" id=button-1', elementCount: 0 },
  elements: [],
  loading: false,
  sensitiveRegions: [],
} satisfies ComputerObservation

describe('GenericComputerDecisionAdapter', () => {
  it('sends the persisted screenshot and untrusted UI tree to the current Agent model', async () => {
    const generate = vi.fn(async (_params: GenerateCanvasTextParams) => ({
      text: JSON.stringify({
        type: 'action',
        intent: 'Save the document',
        action: { type: 'invoke_element', elementId: 'button-1', action: 'invoke' },
      }),
    }))
    const adapter = new GenericComputerDecisionAdapter({
      model: {
        providerProfileId: 'provider-1',
        providerType: 'openai',
        apiKey: 'secret',
        model: 'vision-model',
      },
      generate,
    })

    await expect(
      adapter.decide({
        objective: 'Save this document',
        successCriteria: [] as ComputerTaskContract['successCriteria'],
        observation: OBSERVATION,
        screenshot: Buffer.from('png'),
        stepIndex: 0,
      }),
    ).resolves.toEqual({
      type: 'action',
      intent: 'Save the document',
      action: { type: 'invoke_element', elementId: 'button-1', action: 'invoke' },
    })
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'vision-model',
        responseFormat: 'json',
        images: [{ dataUrl: 'data:image/png;base64,cG5n', mimeType: 'image/png' }],
        prompt: expect.stringContaining('button "Save" id=button-1'),
      }),
    )
  })

  it('fails closed when the model returns an unrecognized action', async () => {
    const adapter = new GenericComputerDecisionAdapter({
      model: {
        providerProfileId: 'provider-1',
        providerType: 'openai',
        apiKey: 'secret',
        model: 'vision-model',
      },
      generate: async () => ({
        text: '{"type":"action","intent":"escape","action":{"type":"shell"}}',
      }),
    })

    await expect(
      adapter.decide({
        objective: 'Save',
        successCriteria: [] as ComputerTaskContract['successCriteria'],
        observation: OBSERVATION,
        screenshot: Buffer.from('png'),
        stepIndex: 0,
      }),
    ).rejects.toMatchObject({ code: 'decision_model_error' })
  })

  it('describes the platform action schema and normalizes common launcher key aliases', async () => {
    const generate = vi.fn(async (_params: GenerateCanvasTextParams) => ({
      text: JSON.stringify({
        type: 'action',
        intent: 'Open the operating-system launcher',
        action: { type: 'keypress', keys: ['WIN', 'Space'] },
      }),
    }))
    const adapter = new GenericComputerDecisionAdapter({
      model: {
        providerProfileId: 'provider-1',
        providerType: 'openai',
        apiKey: 'secret',
        model: 'vision-model',
      },
      platform: 'darwin',
      generate,
    })

    await expect(
      adapter.decide({
        objective: 'Open Bilibili',
        successCriteria: [],
        observation: OBSERVATION,
        screenshot: Buffer.from('png'),
        stepIndex: 0,
      }),
    ).resolves.toMatchObject({
      type: 'action',
      action: { type: 'keypress', keys: ['Meta', 'Space'] },
    })
    expect(generate.mock.calls[0]?.[0].system).toContain('Current desktop platform: macOS')
    expect(generate.mock.calls[0]?.[0].system).toContain(
      'keypress: {"type":"keypress","keys":["Meta","Space"]}',
    )
    expect(generate.mock.calls[0]?.[0].system).toContain(
      'click: {"type":"click","point":{"x":0.5,"y":0.5}',
    )
    expect(generate.mock.calls[0]?.[0].system).toContain(
      'select_text: {"type":"select_text","elementId":"<id>"',
    )
    expect(generate.mock.calls[0]?.[0].system).not.toContain('hands control to the user')
  })

  it('tells the model to switch away from a failed Electron semantic action', async () => {
    const generate = vi.fn(async (_params: GenerateCanvasTextParams) => ({
      text: JSON.stringify({
        type: 'action',
        intent: 'Use the visible search field',
        action: { type: 'click', point: { x: 0.5, y: 0.1 } },
      }),
    }))
    const adapter = new GenericComputerDecisionAdapter({
      model: {
        providerProfileId: 'provider-1',
        providerType: 'openai',
        apiKey: 'secret',
        model: 'vision-model',
      },
      generate,
    })

    await adapter.decide({
      objective: 'Search in the app',
      successCriteria: [],
      observation: OBSERVATION,
      screenshot: Buffer.from('png'),
      stepIndex: 2,
      previousActionFailure: {
        code: 'action_noop',
        actionType: 'invoke_element',
        consecutiveFailures: 3,
        failedStrategies: ['accessibility'],
        requiredAlternative: true,
      },
    })

    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining(
          'Previous action failure: {"code":"action_noop","actionType":"invoke_element","consecutiveFailures":3,"failedStrategies":["accessibility"],"requiredAlternative":true}',
        ),
      }),
    )
  })

  it('continues with accessibility state when no screenshot is available', async () => {
    const generate = vi.fn(async (_params: GenerateCanvasTextParams) => ({
      text: JSON.stringify({
        type: 'action',
        intent: 'Use the accessible save element',
        action: { type: 'invoke_element', elementId: 'save-button', action: 'invoke' },
      }),
    }))
    const adapter = new GenericComputerDecisionAdapter({
      model: {
        providerProfileId: 'provider-1',
        providerType: 'openai',
        apiKey: 'secret',
        model: 'vision-model',
      },
      generate,
    })

    await adapter.decide({
      objective: 'Save the document',
      successCriteria: [],
      observation: OBSERVATION,
      screenshot: Buffer.alloc(0),
      stepIndex: 0,
    })

    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('Screenshot available: false'),
      }),
    )
    expect(generate.mock.calls[0]?.[0]).not.toHaveProperty('images')
  })

  it('rejects model-requested handoff because task authorization is already complete', async () => {
    const adapter = new GenericComputerDecisionAdapter({
      model: {
        providerProfileId: 'provider-1',
        providerType: 'openai',
        apiKey: 'secret',
        model: 'vision-model',
      },
      generate: vi.fn(async () => ({
        text: JSON.stringify({ type: 'handoff', reason: 'Credentials require user confirmation' }),
      })),
      wait: vi.fn(async () => undefined),
    })

    await expect(
      adapter.decide({
        objective: 'Fill the authorized form',
        successCriteria: [],
        observation: OBSERVATION,
        screenshot: Buffer.from('png'),
        stepIndex: 0,
      }),
    ).rejects.toMatchObject({ code: 'decision_model_error' })
  })

  it('accepts only a typed allowlisted SparkWork app command', async () => {
    const adapter = new GenericComputerDecisionAdapter({
      model: {
        providerProfileId: 'provider-1',
        providerType: 'openai',
        apiKey: 'secret',
        model: 'vision-model',
      },
      generate: async () => ({
        text: JSON.stringify({
          type: 'action',
          intent: 'Open SparkWork settings',
          action: { type: 'app_command', command: { name: 'navigate', view: 'settings' } },
        }),
      }),
    })

    await expect(
      adapter.decide({
        objective: 'Open settings',
        successCriteria: [],
        observation: OBSERVATION,
        screenshot: Buffer.from('png'),
        stepIndex: 0,
      }),
    ).resolves.toMatchObject({
      type: 'action',
      action: { type: 'app_command', command: { name: 'navigate', view: 'settings' } },
    })
  })

  it('repairs an invalid provider response and supports explicit window recovery actions', async () => {
    const generate = vi
      .fn()
      .mockResolvedValueOnce({ text: 'not-json' })
      .mockResolvedValueOnce({
        text: JSON.stringify({
          type: 'action',
          intent: 'Restore the task window',
          action: { type: 'focus_window', windowId: 'window-1' },
        }),
      })
    const adapter = new GenericComputerDecisionAdapter({
      model: {
        providerProfileId: 'provider-1',
        providerType: 'openai',
        apiKey: 'secret',
        model: 'vision-model',
      },
      generate,
      wait: vi.fn(async () => undefined),
    })

    await expect(
      adapter.decide({
        objective: 'Continue in the task window',
        successCriteria: [] as ComputerTaskContract['successCriteria'],
        observation: OBSERVATION,
        screenshot: Buffer.from('png'),
        stepIndex: 1,
      }),
    ).resolves.toMatchObject({
      type: 'action',
      action: { type: 'focus_window', windowId: 'window-1' },
    })
    expect(generate).toHaveBeenCalledTimes(2)
    expect(generate.mock.calls[1]?.[0].prompt).toContain('previous provider response failed')
  })

  it('parses a valid batch of actions when allowBatch is on', async () => {
    const generate = vi.fn(async (_params: GenerateCanvasTextParams) => ({
      text: JSON.stringify({
        type: 'actions',
        intent: 'Type the sign-off',
        actions: [
          { type: 'click', point: { x: 0.1, y: 0.2 } },
          { type: 'type_text', text: 'Thanks' },
        ],
      }),
    }))
    const adapter = new GenericComputerDecisionAdapter({
      model: {
        providerProfileId: 'provider-1',
        providerType: 'openai',
        apiKey: 'secret',
        model: 'vision-model',
      },
      generate,
    })

    await expect(
      adapter.decide({
        objective: 'Sign off',
        successCriteria: [] as ComputerTaskContract['successCriteria'],
        observation: OBSERVATION,
        screenshot: Buffer.from('png'),
        stepIndex: 0,
        allowBatch: true,
      }),
    ).resolves.toEqual({
      type: 'actions',
      intent: 'Type the sign-off',
      actions: [
        { type: 'click', point: { x: 0.1, y: 0.2 } },
        { type: 'type_text', text: 'Thanks' },
      ],
    })
    // allowBatch must switch the system prompt to the batch variant.
    expect(generate.mock.calls[0]?.[0].system).toContain('"type":"actions"')
  })

  it('keeps the single-action system prompt when allowBatch is off', async () => {
    const generate = vi.fn(async (_params: GenerateCanvasTextParams) => ({
      text: JSON.stringify({
        type: 'action',
        intent: 'Save',
        action: { type: 'invoke_element', elementId: 'button-1', action: 'invoke' },
      }),
    }))
    const adapter = new GenericComputerDecisionAdapter({
      model: {
        providerProfileId: 'provider-1',
        providerType: 'openai',
        apiKey: 'secret',
        model: 'vision-model',
      },
      generate,
    })

    await adapter.decide({
      objective: 'Save',
      successCriteria: [] as ComputerTaskContract['successCriteria'],
      observation: OBSERVATION,
      screenshot: Buffer.from('png'),
      stepIndex: 0,
    })

    expect(generate.mock.calls[0]?.[0].system).not.toContain('"type":"actions"')
  })

  it('rejects a batch below the minimum size', async () => {
    const adapter = new GenericComputerDecisionAdapter({
      model: {
        providerProfileId: 'provider-1',
        providerType: 'openai',
        apiKey: 'secret',
        model: 'vision-model',
      },
      generate: async () => ({
        text: JSON.stringify({
          type: 'actions',
          intent: 'One',
          actions: [{ type: 'click', x: 1, y: 1 }],
        }),
      }),
    })
    await expect(
      adapter.decide({
        objective: 'x',
        successCriteria: [] as ComputerTaskContract['successCriteria'],
        observation: OBSERVATION,
        screenshot: Buffer.from('png'),
        stepIndex: 0,
        allowBatch: true,
      }),
    ).rejects.toMatchObject({ code: 'decision_model_error' })
  })

  it('rejects a batch containing an unsupported action', async () => {
    const adapter = new GenericComputerDecisionAdapter({
      model: {
        providerProfileId: 'provider-1',
        providerType: 'openai',
        apiKey: 'secret',
        model: 'vision-model',
      },
      generate: async () => ({
        text: JSON.stringify({
          type: 'actions',
          intent: 'Risky',
          actions: [{ type: 'click', x: 1, y: 1 }, { type: 'shell' }],
        }),
      }),
    })
    await expect(
      adapter.decide({
        objective: 'x',
        successCriteria: [] as ComputerTaskContract['successCriteria'],
        observation: OBSERVATION,
        screenshot: Buffer.from('png'),
        stepIndex: 0,
        allowBatch: true,
      }),
    ).rejects.toMatchObject({ code: 'decision_model_error' })
  })
})
