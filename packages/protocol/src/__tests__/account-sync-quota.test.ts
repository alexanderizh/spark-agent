import { describe, expect, it } from 'vitest'
import {
  ACCOUNT_SYNC_FALLBACK_MAX_PAYLOAD_BYTES,
  computeAccountSyncQuota,
  formatAccountSyncPayloadSize,
} from '../account-sync-quota'
import { AccountSyncIpcSchemaRegistry } from '../account-sync'
import type { AccountSyncStatus } from '../account-sync'

function status(overrides: Partial<AccountSyncStatus> = {}): AccountSyncStatus {
  return {
    maxPayloadBytes: 20 * 1024 * 1024,
    lastPayloadBytes: null,
    lastSyncAt: null,
    lastStatus: null,
    lastDeviceLabel: null,
    source: 'server',
    ...overrides,
  }
}

describe('account sync quota math', () => {
  it('formats payload sizes with a stable MiB/KB/B ladder', () => {
    expect(formatAccountSyncPayloadSize(null)).toBe('—')
    expect(formatAccountSyncPayloadSize(-1)).toBe('—')
    expect(formatAccountSyncPayloadSize(Number.NaN)).toBe('—')
    expect(formatAccountSyncPayloadSize(512)).toBe('512 B')
    expect(formatAccountSyncPayloadSize(2048)).toBe('2 KB')
    expect(formatAccountSyncPayloadSize(3.4 * 1024 * 1024)).toBe('3.4 MiB')
    expect(formatAccountSyncPayloadSize(15 * 1024 * 1024)).toBe('15 MiB')
  })

  it('reports an empty quota when the account never synced', () => {
    const quota = computeAccountSyncQuota(status())
    expect(quota).toMatchObject({
      basis: 'none',
      level: 'empty',
      usedBytes: 0,
      remainingBytes: 20 * 1024 * 1024,
      ratio: 0,
    })
  })

  it('falls back to the last synced payload when no local estimate exists', () => {
    const quota = computeAccountSyncQuota(status({ lastPayloadBytes: 3_565_158 }))
    expect(quota.basis).toBe('last')
    expect(quota.level).toBe('ok')
    expect(formatAccountSyncPayloadSize(quota.usedBytes)).toBe('3.4 MiB')
    expect(formatAccountSyncPayloadSize(quota.remainingBytes)).toBe('16.6 MiB')
  })

  it('prefers the pending measurement over the last synced payload', () => {
    const quota = computeAccountSyncQuota(
      status({ lastPayloadBytes: 1 * 1024 * 1024 }),
      19 * 1024 * 1024,
    )
    expect(quota.basis).toBe('pending')
    expect(quota.level).toBe('warn')
    expect(quota.remainingBytes).toBe(1024 * 1024)
  })

  it('flags an over-limit payload and clamps the remaining amount at zero', () => {
    const quota = computeAccountSyncQuota(status({ lastPayloadBytes: 25 * 1024 * 1024 }))
    expect(quota.level).toBe('over')
    expect(quota.remainingBytes).toBe(0)
    expect(quota.ratio).toBeGreaterThan(1)
  })

  it('uses the conservative fallback limit when the server status is unavailable', () => {
    const quota = computeAccountSyncQuota(null, 2 * 1024 * 1024)
    expect(quota.maxBytes).toBe(ACCOUNT_SYNC_FALLBACK_MAX_PAYLOAD_BYTES)
    expect(quota.level).toBe('ok')
    // 余量触到 20% 阈值即转警告态
    expect(computeAccountSyncQuota(null, 4 * 1024 * 1024).level).toBe('warn')
  })
})

describe('account sync status and estimate contracts', () => {
  it('accepts an empty status request', () => {
    expect(AccountSyncIpcSchemaRegistry['account-sync:get-status'].parse({})).toEqual({})
  })

  it('accepts prompt-library items on the estimate channel like execute does', () => {
    const request = {
      promptLibraryItems: [
        {
          id: 'legacy:project-1:prompt-1',
          title: '项目提示词',
          text: '镜头缓慢推进',
          category: '运镜',
          tags: [],
          coverUrl: null,
          coverMimeType: null,
          createdAt: '2026-08-29T00:00:00.000Z',
          updatedAt: '2026-08-30T00:00:00.000Z',
        },
      ],
    }
    expect(AccountSyncIpcSchemaRegistry['account-sync:estimate-payload'].parse(request)).toEqual(
      request,
    )
    expect(() =>
      AccountSyncIpcSchemaRegistry['account-sync:estimate-payload'].parse({ mode: 'preview' }),
    ).toThrow()
  })
})
