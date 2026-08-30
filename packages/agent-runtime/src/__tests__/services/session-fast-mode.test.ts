import { describe, expect, it, vi } from 'vitest'
import {
  getFastModeFromMetadata,
  supportsOpenAIFastMode,
} from '../../services/session/session-pure-utils.js'
import { applySessionRuntimePatch } from '../../services/session/session-runtime-patch.js'

describe('session Fast mode', () => {
  it('reads only an explicit true preference from session metadata', () => {
    expect(getFastModeFromMetadata('{"fastMode":true}')).toBe(true)
    expect(getFastModeFromMetadata('{"fastMode":false}')).toBe(false)
    expect(getFastModeFromMetadata('{"fastMode":"true"}')).toBe(false)
    expect(getFastModeFromMetadata('broken')).toBe(false)
    expect(getFastModeFromMetadata(null)).toBe(false)
  })

  it('persists Fast mode separately from ordinary runtime columns', () => {
    const patchMetadata = vi.fn()
    const updateRuntime = vi.fn()

    applySessionRuntimePatch({ patchMetadata, updateRuntime }, 'session-1', {
      reasoningEffort: 'high',
      fastMode: true,
    })

    expect(patchMetadata).toHaveBeenCalledWith('session-1', { fastMode: true })
    expect(updateRuntime).toHaveBeenCalledWith('session-1', {
      reasoningEffort: 'high',
      fastMode: true,
    })
  })

  it('enables Fast mode only for an effective OpenAI-protocol transport', () => {
    expect(
      supportsOpenAIFastMode({
        isLocalCli: false,
        providerType: 'openai-compatible',
        codexApiKind: 'chat',
      }),
    ).toBe(true)
    expect(
      supportsOpenAIFastMode({
        isLocalCli: true,
        hasCliSparkOverride: true,
        providerType: 'openai',
        codexApiKind: 'responses',
      }),
    ).toBe(true)
    expect(
      supportsOpenAIFastMode({
        isLocalCli: true,
        isLocalCodexCli: true,
        providerType: 'openai',
        codexApiKind: 'responses',
      }),
    ).toBe(true)
    expect(
      supportsOpenAIFastMode({
        isLocalCli: true,
        isLocalCodexCli: false,
        providerType: 'anthropic',
        codexApiKind: 'responses',
      }),
    ).toBe(false)
    expect(
      supportsOpenAIFastMode({
        isLocalCli: false,
        providerType: 'anthropic',
        codexApiKind: 'responses',
      }),
    ).toBe(false)
    expect(
      supportsOpenAIFastMode({
        isLocalCli: false,
        providerType: 'openai',
        codexApiKind: 'embedding',
      }),
    ).toBe(false)
  })
})
