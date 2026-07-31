import { describe, expect, it } from 'vitest'
import { ComputerUseV2FlagStore, isActionBatchEnabled } from './computerUseV2Flags.js'

describe('ComputerUseV2FlagStore', () => {
  it('keeps experimental paths off and landed product paths on by default', () => {
    const store = new ComputerUseV2FlagStore({})

    expect(store.snapshot()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'hostSupervisor', enabled: false, source: 'default' }),
        expect.objectContaining({ name: 'actionBatch', enabled: false, source: 'default' }),
        expect.objectContaining({ name: 'activityTimeline', enabled: true, source: 'default' }),
      ]),
    )
  })

  it('honors explicit environment values and legacy wrapper call sites', () => {
    const env = { SPARK_COMPUTER_USE_V2_ACTION_BATCH: '1' }
    const store = new ComputerUseV2FlagStore(env)

    expect(store.isEnabled('actionBatch')).toBe(true)
    expect(isActionBatchEnabled(env)).toBe(true)
    expect(store.snapshot()).toContainEqual({
      name: 'actionBatch',
      enabled: true,
      source: 'environment',
    })
  })

  it('applies an in-process rollback without mutating configuration', () => {
    const store = new ComputerUseV2FlagStore({ SPARK_COMPUTER_USE_V2_ACTION_BATCH: 'true' })

    expect(store.disableForRuntime('actionBatch', 'error_action_rate_exceeded')).toBe(true)
    expect(store.isEnabled('actionBatch')).toBe(false)
    expect(store.snapshot()).toContainEqual({
      name: 'actionBatch',
      enabled: false,
      source: 'runtime_rollback',
      rollbackReason: 'error_action_rate_exceeded',
    })
  })
})
