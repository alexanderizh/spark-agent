import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as keystore from '@spark/shared/keystore'
import { PlatformCredentialStore } from './PlatformCredentialStore.js'

vi.mock('@spark/shared/keystore', () => ({
  makeKeystoreRef: (_provider: string, id: string) => `newapi:${id}`,
  getSecret: vi.fn(),
  setSecret: vi.fn(),
  deleteSecret: vi.fn(),
}))

describe('PlatformCredentialStore', () => {
  beforeEach(() => vi.clearAllMocks())

  it('isolates credentials by Spark user id', async () => {
    const first = new PlatformCredentialStore('user-1')
    const second = new PlatformCredentialStore('user-2')
    await first.setApiKey('sk-first')
    await second.setApiKey('sk-second')
    expect(keystore.setSecret).toHaveBeenNthCalledWith(1, 'newapi:spark-user-user-1-api-key', 'sk-first')
    expect(keystore.setSecret).toHaveBeenNthCalledWith(2, 'newapi:spark-user-user-2-api-key', 'sk-second')
  })

  it('persists and parses a pending browser payment', async () => {
    const store = new PlatformCredentialStore('user-1')
    await store.setPendingPayment({ planId: 8, createdAt: 12345 })
    expect(keystore.setSecret).toHaveBeenCalledWith(
      'newapi:spark-user-user-1-pending-payment',
      JSON.stringify({ planId: 8, createdAt: 12345 }),
    )
    vi.mocked(keystore.getSecret).mockResolvedValue(JSON.stringify({ planId: 8, createdAt: 12345 }))
    await expect(store.getPendingPayment()).resolves.toEqual({ planId: 8, createdAt: 12345 })
  })

  it('clears every platform credential including payment recovery state', async () => {
    await new PlatformCredentialStore('user-1').clearAll()
    expect(keystore.deleteSecret).toHaveBeenCalledTimes(5)
    expect(keystore.deleteSecret).toHaveBeenCalledWith('newapi:spark-user-user-1-pending-payment')
  })
})
