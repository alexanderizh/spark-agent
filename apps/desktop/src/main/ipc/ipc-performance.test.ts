import { describe, expect, it } from 'vitest'
import { IpcPerformanceTracker } from './ipc-performance.js'

describe('IpcPerformanceTracker', () => {
  it('calculates rolling latency percentiles without retaining payloads', () => {
    const tracker = new IpcPerformanceTracker({
      maxSamplesPerChannel: 4,
      reportEvery: 100,
      budgetsMs: { 'session:list': 50 },
    })

    for (const duration of [10, 20, 30, 40, 90]) {
      tracker.record('session:list', duration, 'ok')
    }

    expect(tracker.snapshot()).toEqual([
      {
        channel: 'session:list',
        samples: 4,
        errors: 0,
        p50Ms: 30,
        p95Ms: 90,
        maxMs: 90,
        budgetMs: 50,
      },
    ])
  })

  it('warns only for configured interaction budgets', () => {
    const tracker = new IpcPerformanceTracker({
      reportEvery: 100,
      budgetsMs: { 'session:update': 100 },
    })

    expect(tracker.record('session:update', 100.1, 'ok')).toMatchObject({
      durationMs: 100.1,
      budgetMs: 100,
      slow: true,
    })
    expect(tracker.record('long-running:operation', 10_000, 'ok')).toMatchObject({
      budgetMs: null,
      slow: false,
    })
  })

  it('reports a bounded set of recently active channels', () => {
    const tracker = new IpcPerformanceTracker({
      reportEvery: 3,
      maxReportedChannels: 2,
      budgetsMs: {},
    })

    expect(tracker.record('fast', 10, 'ok').report).toBeNull()
    expect(tracker.record('failed', 30, 'error').report).toBeNull()
    expect(tracker.record('slow', 50, 'ok').report).toEqual([
      expect.objectContaining({ channel: 'slow', p95Ms: 50 }),
      expect.objectContaining({ channel: 'failed', errors: 1 }),
    ])
    expect(tracker.record('fast', 5, 'ok').report).toBeNull()
  })
})
