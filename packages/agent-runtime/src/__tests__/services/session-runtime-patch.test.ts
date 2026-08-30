import { describe, expect, it, vi } from 'vitest'
import {
  applySessionRuntimePatch,
  captureTurnRuntimeSelectionSnapshot,
} from '../../services/session/session-runtime-patch.js'
import {
  getRuntimePatch,
  pickGoalDrainableRuntimeSelection,
} from '../../services/session/session-pure-utils.js'

describe('queued session runtime patches', () => {
  it('keeps each submitted CLI model override in its own turn snapshot', () => {
    const secondTurn = getRuntimePatch({
      providerProfileId: 'local-codex-cli',
      modelId: 'codex cli',
      cliSparkOverride: { providerProfileId: 'provider-b', modelId: 'model-b' },
    })
    const thirdTurn = getRuntimePatch({
      providerProfileId: 'local-codex-cli',
      modelId: 'codex cli',
      cliSparkOverride: { providerProfileId: 'provider-c', modelId: 'model-c' },
    })
    const sessionRepo = {
      patchMetadata: vi.fn(),
      updateRuntime: vi.fn(),
    }

    applySessionRuntimePatch(sessionRepo as never, 'session-1', secondTurn)
    applySessionRuntimePatch(sessionRepo as never, 'session-1', thirdTurn)

    expect(sessionRepo.patchMetadata.mock.calls).toEqual([
      ['session-1', { cliSparkOverride: { providerProfileId: 'provider-b', modelId: 'model-b' } }],
      ['session-1', { cliSparkOverride: { providerProfileId: 'provider-c', modelId: 'model-c' } }],
    ])
    expect(secondTurn?.cliSparkOverride).toEqual({
      providerProfileId: 'provider-b',
      modelId: 'model-b',
    })
  })

  it('snapshots clearing a CLI override so an older queued turn cannot leak into it', () => {
    expect(getRuntimePatch({ cliSparkOverride: null })).toEqual({ cliSparkOverride: null })
  })

  it('freezes the turn runtime selection before a later queued turn mutates the session row', () => {
    const session = {
      provider_profile_id: 'provider-b',
      model_id: 'model-b',
      agent_adapter: 'codex',
      chat_mode: 'agent',
      metadata_json: JSON.stringify({
        cliSparkOverride: { providerProfileId: 'spark-b', modelId: 'spark-model-b' },
      }),
    }

    const snapshot = captureTurnRuntimeSelectionSnapshot(session)
    session.provider_profile_id = 'provider-c'
    session.model_id = 'model-c'
    session.agent_adapter = 'claude-sdk'
    session.metadata_json = JSON.stringify({
      cliSparkOverride: { providerProfileId: 'spark-c', modelId: 'spark-model-c' },
    })

    expect(snapshot).toEqual({
      providerProfileId: 'provider-b',
      modelId: 'model-b',
      agentAdapter: 'codex',
      chatMode: 'agent',
      cliSparkOverride: { providerProfileId: 'spark-b', modelId: 'spark-model-b' },
    })
    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(Object.isFrozen(snapshot.cliSparkOverride)).toBe(true)
  })

  it('lets goal iterations drain Composer full runtime snapshots but still rejects skill changes', () => {
    const fullSnapshot = {
      providerProfileId: 'provider-b',
      modelId: 'model-b',
      agentId: 'agent-b',
      agentAdapter: 'codex' as const,
      permissionMode: 'codex-auto-review' as const,
      chatMode: 'agent' as const,
      reasoningEffort: 'high' as const,
      cliSparkOverride: null,
    }

    expect(pickGoalDrainableRuntimeSelection(fullSnapshot, fullSnapshot)).toEqual(fullSnapshot)
    expect(
      pickGoalDrainableRuntimeSelection(
        { ...fullSnapshot, permissionMode: 'codex-full-access' },
        fullSnapshot,
      ),
    ).toBe(false)
    expect(
      pickGoalDrainableRuntimeSelection({ ...fullSnapshot, skillIds: ['skill-b'] }, fullSnapshot),
    ).toBe(false)
  })
})
