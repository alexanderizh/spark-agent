import type { ComputerObservation, ComputerTaskContract } from '@spark/protocol'
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
    const generate = vi.fn(async () => ({
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
    ).rejects.toMatchObject({ code: 'action_not_allowed' })
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
    const generate = vi.fn(async () => ({
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
    const generate = vi.fn(async () => ({
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
    ).rejects.toMatchObject({ code: 'action_not_allowed' })
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
          actions: [
            { type: 'click', x: 1, y: 1 },
            { type: 'shell' },
          ],
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
    ).rejects.toMatchObject({ code: 'action_not_allowed' })
  })
})
