import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as keystore from '@spark/shared/keystore'
import { PlatformCredentialStore } from './PlatformCredentialStore.js'

vi.mock('../../db.js', () => ({ getDatabase: vi.fn(() => ({})) }))

vi.mock('@spark/shared/keystore', () => ({
  makeKeystoreRef: (_provider: string, id: string) => `newapi:${id}`,
  getSecret: vi.fn(), setSecret: vi.fn(), deleteSecret: vi.fn(),
}))

function fakeSettings() {
  const values = new Map<string, unknown>()
  return {
    get: (category: string, key: string) => values.get(`${category}:${key}`) ?? null,
    set: (category: string, key: string, value: unknown) => values.set(`${category}:${key}`, value),
    delete: (category: string, key: string) => values.delete(`${category}:${key}`),
    deleteByCategory: (category: string) => {
      let count = 0
      for (const key of values.keys()) if (key.startsWith(`${category}:`)) { values.delete(key); count++ }
      return count
    },
  }
}

describe('PlatformCredentialStore', () => {
  beforeEach(() => vi.clearAllMocks())

  it('keeps sensitive credentials in the keystore', async () => {
    const settings = fakeSettings()
    const first = new PlatformCredentialStore('user-1', settings as never)
    await first.setApiKey('sk-first')
    await first.setAccessToken('token')
    expect(keystore.setSecret).toHaveBeenCalledTimes(2)
  })

  it('stores non-sensitive platform state in local settings', async () => {
    const settings = fakeSettings()
    const store = new PlatformCredentialStore('user-1', settings as never)
    await store.setNewApiUserId(42)
    await store.setBaseUrl('https://newapi.example')
    await store.setPendingPayment({ planId: 8, createdAt: 12345 })

    await expect(store.getNewApiUserId()).resolves.toBe(42)
    await expect(store.getBaseUrl()).resolves.toBe('https://newapi.example')
    await expect(store.getPendingPayment()).resolves.toEqual({ planId: 8, createdAt: 12345 })
    expect(keystore.setSecret).not.toHaveBeenCalled()
  })

  it('clears sensitive vault values and local platform state', async () => {
    const settings = fakeSettings()
    const store = new PlatformCredentialStore('user-1', settings as never)
    await store.setPendingPayment({ planId: 8, createdAt: 12345 })
    await store.clearAll()
    expect(keystore.deleteSecret).toHaveBeenCalledTimes(2)
    await expect(store.getPendingPayment()).resolves.toBeNull()
  })
})
