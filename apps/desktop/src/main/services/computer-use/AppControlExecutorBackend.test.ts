import type { ComputerActionEnvelope, ComputerObservation } from '@spark/protocol'
import { describe, expect, it, vi } from 'vitest'
import { AppControlExecutorBackend } from './AppControlExecutorBackend.js'

const OBSERVATION = {
  frameId: 'frame-1',
  treeVersion: 'tree-1',
  capturedAt: '2026-07-31T00:00:00.000Z',
  display: { id: 'display-1', width: 100, height: 100, scaleFactor: 1 },
  foreground: {
    app: { id: 'com.spark-agent.desktop', name: 'SparkWork' },
    window: { id: 'window-1', title: 'SparkWork', bounds: { x: 0, y: 0, width: 100, height: 100 } },
  },
  screenshot: { snapshotId: 'snapshot-1', width: 100, height: 100 },
  tree: { mode: 'full', text: '', elementCount: 0 },
  elements: [],
  loading: false,
  sensitiveRegions: [],
} satisfies ComputerObservation

function envelope(targetAppId = 'com.spark-agent.desktop'): ComputerActionEnvelope {
  return {
    computerSessionId: 'computer-1',
    actionId: 'action-1',
    actuatorLeaseId: 'lease-1',
    observedFrameId: 'frame-1',
    observedTreeVersion: 'tree-1',
    targetAppId,
    targetWindowId: 'window-1',
    action: { type: 'app_command', command: { name: 'set_theme', theme: 'dark' } },
    executionLane: 'background_semantic',
    policyContext: {
      effect: 'reversible_local',
      target: { kind: 'window', id: 'window-1' },
      dataClasses: [],
    },
    intent: 'Switch SparkWork to dark theme',
  }
}

describe('AppControlExecutorBackend', () => {
  it('uses the bridge only for SparkWork and re-observes after acknowledgement', async () => {
    const execute = vi.fn(async () => ({
      commandId: 'command-1',
      computerSessionId: 'computer-1',
      actionId: 'action-1',
      status: 'applied' as const,
      uiRevision: 1,
    }))
    const observer = { observe: vi.fn(async () => OBSERVATION) }
    const native = { execute: vi.fn(), cancelSession: vi.fn(async () => undefined) }
    const backend = new AppControlExecutorBackend(
      native,
      observer,
      { execute, cancelSession: vi.fn() },
      new Set(['com.spark-agent.desktop']),
    )

    await expect(
      backend.execute({
        envelope: envelope(),
        observation: OBSERVATION,
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({ observation: OBSERVATION, noop: false })
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ actionId: 'action-1' }))
    expect(native.execute).not.toHaveBeenCalled()
  })

  it('rejects app commands aimed at another application', async () => {
    const backend = new AppControlExecutorBackend(
      { execute: vi.fn(), cancelSession: vi.fn(async () => undefined) },
      { observe: vi.fn() },
      { execute: vi.fn(), cancelSession: vi.fn() },
      new Set(['com.spark-agent.desktop']),
    )
    await expect(
      backend.execute({
        envelope: envelope('com.example.other'),
        observation: OBSERVATION,
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: 'action_not_allowed' })
  })
})
