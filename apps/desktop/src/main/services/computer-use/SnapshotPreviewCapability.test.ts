import { describe, expect, it } from 'vitest'
import { SnapshotPreviewCapabilityService } from './SnapshotPreviewCapability.js'

describe('SnapshotPreviewCapabilityService', () => {
  it('issues a short-lived bearer bound to one snapshot and owning Agent session', () => {
    let now = 1_000
    const capabilities = new SnapshotPreviewCapabilityService({
      now: () => now,
      createToken: () => 'a'.repeat(43),
      ttlMs: 60_000,
    })

    const issued = capabilities.issue({
      snapshotId: 'snapshot-1',
      sessionId: 'session-1',
      turnId: 'turn-1',
    })

    expect(issued.previewUrl).toBe(
      `spark-snapshot://snapshot/snapshot-1/preview?cap=${'a'.repeat(43)}`,
    )
    expect(capabilities.authorize('snapshot-1', issued.token)).toBe(true)
    expect(capabilities.authorize('snapshot-2', issued.token)).toBe(false)
    capabilities.revokeSession('session-2')
    expect(capabilities.authorize('snapshot-1', issued.token)).toBe(true)
    capabilities.revokeSession('session-1')
    expect(capabilities.authorize('snapshot-1', issued.token)).toBe(false)

    const expiring = capabilities.issue({
      snapshotId: 'snapshot-1',
      sessionId: 'session-1',
      turnId: 'turn-1',
    })
    now += 60_001
    expect(capabilities.authorize('snapshot-1', expiring.token)).toBe(false)
  })

  it('bounds retained capabilities and evicts the oldest grant', () => {
    let token = 0
    const capabilities = new SnapshotPreviewCapabilityService({
      createToken: () => `${++token}`.padStart(43, 'a'),
      maxGrants: 2,
    })
    const first = capabilities.issue({ snapshotId: 'one', sessionId: null, turnId: null })
    capabilities.issue({ snapshotId: 'two', sessionId: null, turnId: null })
    capabilities.issue({ snapshotId: 'three', sessionId: null, turnId: null })

    expect(capabilities.authorize('one', first.token)).toBe(false)
  })
})
