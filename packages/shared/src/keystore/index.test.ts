import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { KeystoreRef } from './index'

const mocks = vi.hoisted(() => ({
  credentials: new Map<string, string>(),
}))

vi.mock('keytar', () => ({
  default: {
    getPassword: vi.fn(async (service: string, account: string) => {
      return mocks.credentials.get(`${service}:${account}`) ?? null
    }),
    setPassword: vi.fn(async (service: string, account: string, password: string) => {
      mocks.credentials.set(`${service}:${account}`, password)
    }),
    deletePassword: vi.fn(async (service: string, account: string) => {
      return mocks.credentials.delete(`${service}:${account}`)
    }),
  },
}))

describe('keystore cache', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    mocks.credentials.clear()
    const keystore = await import('./index')
    keystore.clearSecretCache()
  })

  it('caches secrets after the first keychain read', async () => {
    const keytar = (await import('keytar')).default
    const keystore = await import('./index')
    const ref = 'openai-profile-1' as KeystoreRef
    mocks.credentials.set('spark-agent:openai-profile-1', 'sk-first')

    await expect(keystore.getSecret(ref)).resolves.toBe('sk-first')
    await expect(keystore.getSecret(ref)).resolves.toBe('sk-first')

    expect(keytar.getPassword).toHaveBeenCalledTimes(1)
  })

  it('deduplicates concurrent reads for the same secret', async () => {
    const keytar = (await import('keytar')).default
    const keystore = await import('./index')
    const ref = 'openai-profile-2' as KeystoreRef
    mocks.credentials.set('spark-agent:openai-profile-2', 'sk-concurrent')

    const [first, second] = await Promise.all([keystore.getSecret(ref), keystore.getSecret(ref)])

    expect(first).toBe('sk-concurrent')
    expect(second).toBe('sk-concurrent')
    expect(keytar.getPassword).toHaveBeenCalledTimes(1)
  })

  it('updates the cache when a secret is saved', async () => {
    const keytar = (await import('keytar')).default
    const keystore = await import('./index')
    const ref = 'anthropic-profile-1' as KeystoreRef

    await keystore.setSecret(ref, 'sk-new')
    await expect(keystore.getSecret(ref)).resolves.toBe('sk-new')

    expect(keytar.setPassword).toHaveBeenCalledWith('spark-agent', ref, 'sk-new')
    expect(keytar.getPassword).not.toHaveBeenCalled()
  })

  it('clears the cached value after deleting a secret', async () => {
    const keytar = (await import('keytar')).default
    const keystore = await import('./index')
    const ref = 'deepseek-profile-1' as KeystoreRef

    await keystore.setSecret(ref, 'sk-delete-me')
    await keystore.deleteSecret(ref)
    await expect(keystore.getSecret(ref)).resolves.toBeNull()

    expect(keytar.getPassword).toHaveBeenCalledTimes(1)
  })
})
