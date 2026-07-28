import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => '/private/spark-agent' },
}))

import { SnapshotVaultMaintenance } from './SnapshotVaultMaintenance.js'

describe('SnapshotVaultMaintenance', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('expires TTL snapshots before collecting newly unreferenced blobs', async () => {
    const calls: string[] = []
    const repository = {
      listExpired: vi.fn(() => [{ id: 'snapshot-expired-1' }, { id: 'snapshot-expired-2' }]),
      delete: vi.fn((id: string) => {
        calls.push(`delete:${id}`)
        return []
      }),
      listUnreferencedBlobs: () => [],
      listBlobStorageKeys: () => [],
      deleteBlobRecordIfUnreferenced: () => null,
    }
    const vault = {
      cleanup: vi.fn(async () => {
        calls.push('vault-cleanup')
        return { unreferencedDeleted: 2, orphanFilesDeleted: 1 }
      }),
    }
    const maintenance = new SnapshotVaultMaintenance({
      repository,
      vault,
      now: () => new Date('2026-07-28T04:00:00.000Z'),
    })

    await expect(maintenance.runOnce()).resolves.toEqual({
      expiredSnapshotsDeleted: 2,
      unreferencedDeleted: 2,
      orphanFilesDeleted: 1,
    })
    expect(repository.listExpired).toHaveBeenCalledWith('2026-07-28T04:00:00.000Z', 200)
    expect(calls).toEqual([
      'delete:snapshot-expired-1',
      'delete:snapshot-expired-2',
      'vault-cleanup',
    ])
  })

  it('coalesces overlapping runs and stops scheduling after disposal', async () => {
    let finishCleanup:
      | ((value: { unreferencedDeleted: number; orphanFilesDeleted: number }) => void)
      | undefined
    const cleanup = vi.fn(
      () =>
        new Promise<{ unreferencedDeleted: number; orphanFilesDeleted: number }>((resolve) => {
          finishCleanup = resolve
        }),
    )
    const maintenance = new SnapshotVaultMaintenance({
      repository: {
        listExpired: () => [],
        delete: () => [],
        listUnreferencedBlobs: () => [],
        listBlobStorageKeys: () => [],
        deleteBlobRecordIfUnreferenced: () => null,
      },
      vault: { cleanup },
      intervalMs: 1_000,
    })

    maintenance.start()
    const overlapping = maintenance.runOnce()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(cleanup).toHaveBeenCalledTimes(1)

    const resolveCleanup = () => {
      if (finishCleanup == null) throw new Error('Expected an active cleanup')
      finishCleanup({ unreferencedDeleted: 0, orphanFilesDeleted: 0 })
    }
    resolveCleanup()
    await overlapping
    await vi.advanceTimersByTimeAsync(1_000)
    expect(cleanup).toHaveBeenCalledTimes(2)

    let disposalFinished = false
    const disposal = Promise.resolve(maintenance.dispose()).then(() => {
      disposalFinished = true
    })
    await Promise.resolve()
    expect(disposalFinished).toBe(false)
    resolveCleanup()
    await disposal
    await vi.advanceTimersByTimeAsync(2_000)
    expect(cleanup).toHaveBeenCalledTimes(2)
  })
})
