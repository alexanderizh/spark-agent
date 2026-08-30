import { describe, expect, it } from 'vitest'
import { ComputerUseMetricsCollector } from './ComputerUseMetricsCollector.js'

const DIMENSIONS = {
  platform: 'macos',
  architecture: 'arm64',
  appVersion: '0.8.14',
  hostVersion: '0.1.0',
  trustMode: 'signed',
} as const

describe('ComputerUseMetricsCollector', () => {
  it('summarizes content-free duration samples by release dimensions', () => {
    const collector = new ComputerUseMetricsCollector()
    for (let value = 1; value <= 100; value += 1) {
      collector.record('observation_ms', value, DIMENSIONS, value !== 100)
    }

    expect(collector.snapshot()).toEqual([
      expect.objectContaining({
        name: 'observation_ms',
        dimensions: DIMENSIONS,
        count: 100,
        failures: 1,
        minMs: 1,
        maxMs: 100,
        averageMs: 50.5,
        p50Ms: 50,
        p95Ms: 95,
        p99Ms: 99,
      }),
    ])
  })

  it('ignores invalid durations and clears all buckets', () => {
    const collector = new ComputerUseMetricsCollector()
    collector.record('action_ms', Number.NaN, DIMENSIONS)
    collector.record('action_ms', -1, DIMENSIONS)
    expect(collector.snapshot()).toEqual([])

    collector.record('action_ms', 12, DIMENSIONS)
    collector.clear()
    expect(collector.snapshot()).toEqual([])
  })

  it('tracks per-channel execution outcomes with background share and success rates', () => {
    const collector = new ComputerUseMetricsCollector()
    collector.recordExecutionOutcome('background_ax', true)
    collector.recordExecutionOutcome('background_ax', true)
    collector.recordExecutionOutcome('background_ax', false)
    collector.recordExecutionOutcome('foreground_cg', true)
    collector.recordExecutionOutcome('unset', false)

    const snapshot = collector.executionChannelSnapshot()
    expect(snapshot.total).toBe(5)
    expect(snapshot.backgroundShare).toBeCloseTo(0.6)
    expect(snapshot.channels).toEqual([
      { channel: 'background_ax', count: 3, failures: 1, successRate: 2 / 3, share: 3 / 5 },
      { channel: 'foreground_cg', count: 1, failures: 0, successRate: 1, share: 1 / 5 },
      { channel: 'unset', count: 1, failures: 1, successRate: 0, share: 1 / 5 },
    ])

    collector.clear()
    expect(collector.executionChannelSnapshot()).toEqual({
      total: 0,
      backgroundShare: 0,
      channels: [],
    })
  })
})
