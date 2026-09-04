import { describe, expect, it } from 'vitest'
import {
  applyQueueRuntimeSelection,
  pickQueueRuntimeSelection,
  QueueErrorPauseGate,
  recoverQueueErrorPause,
} from './queue-error-pause-gate.js'

describe('QueueErrorPauseGate', () => {
  it('blocks only the failed session while queued turns remain', () => {
    const gate = new QueueErrorPauseGate()
    gate.pause('session-1', {
      reason: 'turn_error',
      failedTurnId: 'turn-failed',
      errorMessage: 'upstream unavailable',
      pausedAt: '2026-09-05T00:00:00.000Z',
    })

    expect(gate.isBlocked('session-1', 2)).toBe(true)
    expect(gate.isBlocked('session-2', 2)).toBe(false)
    expect(gate.getPause('session-1', 2)?.failedTurnId).toBe('turn-failed')
  })

  it('resolves explicitly and clears itself when the queue becomes empty', () => {
    const gate = new QueueErrorPauseGate()
    const pause = { reason: 'turn_error', pausedAt: '2026-09-05T00:00:00.000Z' } as const

    gate.pause('session-1', pause)
    gate.resolve('session-1')
    expect(gate.isBlocked('session-1', 1)).toBe(false)

    gate.pause('session-1', pause)
    expect(gate.getPause('session-1', 0)).toBeNull()
    expect(gate.isBlocked('session-1', 1)).toBe(false)
  })
})

describe('queue runtime re-snapshot', () => {
  it('overrides only provider/model and preserves the rest of the turn runtime', () => {
    const turn = {
      turnId: 'turn-queued',
      runtimePatch: {
        providerProfileId: 'provider-old',
        modelId: 'model-old',
        agentId: 'agent-keep',
        permissionMode: 'codex-full-access' as const,
        fastMode: true,
      },
    }

    expect(
      applyQueueRuntimeSelection(turn, {
        providerProfileId: 'provider-new',
        modelId: 'model-new',
      }),
    ).toEqual({
      turnId: 'turn-queued',
      runtimePatch: {
        providerProfileId: 'provider-new',
        modelId: 'model-new',
        agentId: 'agent-keep',
        permissionMode: 'codex-full-access',
        fastMode: true,
      },
    })
  })

  it('ignores unrelated runtime fields when selecting the queue model override', () => {
    expect(
      pickQueueRuntimeSelection({
        providerProfileId: 'provider-new',
        modelId: null,
        cliSparkOverride: { providerProfileId: 'spark-provider', modelId: 'spark-model' },
        agentId: 'agent-ignore',
        fastMode: true,
      }),
    ).toEqual({
      providerProfileId: 'provider-new',
      modelId: null,
      cliSparkOverride: { providerProfileId: 'spark-provider', modelId: 'spark-model' },
    })
  })
})

describe('recoverQueueErrorPause', () => {
  it('uses the latest valid persisted error and tolerates malformed history', () => {
    expect(
      recoverQueueErrorPause(
        [
          { event_json: '{bad-json' },
          {
            event_json: JSON.stringify({
              status: 'error',
              turnId: 'turn-failed',
              message: 'provider unavailable',
              timestamp: '2026-09-05T01:02:03.000Z',
            }),
          },
        ],
        '2026-09-05T00:00:00.000Z',
      ),
    ).toEqual({
      reason: 'turn_error',
      failedTurnId: 'turn-failed',
      errorMessage: 'provider unavailable',
      pausedAt: '2026-09-05T01:02:03.000Z',
    })
  })
})
