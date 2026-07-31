import { describe, expect, it, vi } from 'vitest'
import { ComputerUseV2RolloutController } from './ComputerUseV2RolloutController.js'
import { ComputerUseV2FlagStore } from './computerUseV2Flags.js'

describe('ComputerUseV2RolloutController', () => {
  it('rolls back only the implicated feature after the minimum sample gate', () => {
    const flags = new ComputerUseV2FlagStore({
      SPARK_COMPUTER_USE_V2_HOST_SUPERVISOR: '1',
      SPARK_COMPUTER_USE_V2_ACTION_BATCH: '1',
    })
    const rollout = new ComputerUseV2RolloutController({
      flags,
      thresholds: { minimumHostSessionSamples: 4, hostCrashRate: 0.25 },
    })
    const listener = vi.fn()
    rollout.subscribe(listener)

    rollout.recordHostSession(false)
    rollout.recordHostSession(false)
    rollout.recordHostSession(false)
    expect(flags.isEnabled('hostSupervisor')).toBe(true)
    rollout.recordHostSession(true)
    expect(flags.isEnabled('hostSupervisor')).toBe(true)
    rollout.recordHostSession(true)

    expect(flags.isEnabled('hostSupervisor')).toBe(false)
    expect(flags.isEnabled('actionBatch')).toBe(true)
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ flag: 'hostSupervisor', reason: 'host_crash_rate_exceeded' }),
    )
  })

  it('uses bounded P99 takeover latency to disable batching without disabling Computer Use', () => {
    const flags = new ComputerUseV2FlagStore({ SPARK_COMPUTER_USE_V2_ACTION_BATCH: '1' })
    const rollout = new ComputerUseV2RolloutController({
      flags,
      thresholds: { minimumLatencySamples: 3, takeoverP99Ms: 500 },
    })

    rollout.recordTakeoverStop(100)
    rollout.recordTakeoverStop(200)
    rollout.recordTakeoverStop(700)

    expect(flags.isEnabled('actionBatch')).toBe(false)
    expect(flags.isEnabled('activityTimeline')).toBe(true)
  })
})
