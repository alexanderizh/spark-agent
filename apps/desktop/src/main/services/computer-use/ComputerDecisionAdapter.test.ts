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
})
