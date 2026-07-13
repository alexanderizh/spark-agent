import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { KeystoreRef } from './index'

const mocks = vi.hoisted(() => ({
  credentials: new Map<string, string>(),
  setPasswordError: null as Error | null,
}))

vi.mock('keytar', () => ({
  default: {
    getPassword: vi.fn(async (service: string, account: string) =>
      mocks.credentials.get(`${service}:${account}`) ?? null),
    setPassword: vi.fn(async (service: string, account: string, password: string) => {
      if (mocks.setPasswordError) throw mocks.setPasswordError
      mocks.credentials.set(`${service}:${account}`, password)
    }),
    deletePassword: vi.fn(async (service: string, account: string) =>
      mocks.credentials.delete(`${service}:${account}`)),
  },
}))

describe.runIf(process.platform === 'darwin')('consolidated credential vault', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    mocks.credentials.clear()
    mocks.setPasswordError = null
    ;(await import('./index')).clearSecretCache()
  })

  it('stores multiple refs in one keychain item', async () => {
    const keytar = (await import('keytar')).default
    const keystore = await import('./index')
    await keystore.setSecret('openai-1' as KeystoreRef, 'sk-one')
    await keystore.setSecret('anthropic-1' as KeystoreRef, 'sk-two')

    expect(keytar.setPassword).toHaveBeenLastCalledWith(
      'spark-agent',
      'credential-vault-v1',
      expect.stringContaining('sk-two'),
    )
    expect([...mocks.credentials.keys()]).toEqual(['spark-agent:credential-vault-v1'])
  })

  it('loads the vault only once for concurrent startup preloads', async () => {
    const keytar = (await import('keytar')).default
    const keystore = await import('./index')
    mocks.credentials.set('spark-agent:credential-vault-v1', JSON.stringify({
      version: 1,
      secrets: { 'openai-1': 'sk-one', 'anthropic-1': 'sk-two' },
      legacyChecked: ['openai-1', 'anthropic-1'],
    }))
    await keystore.preloadSecrets(['openai-1', 'anthropic-1'] as KeystoreRef[])
    expect(keytar.getPassword).toHaveBeenCalledTimes(1)
  })

  it('does not write the keychain again when a cached secret is unchanged', async () => {
    const keytar = (await import('keytar')).default
    const keystore = await import('./index')
    mocks.credentials.set('spark-agent:credential-vault-v1', JSON.stringify({
      version: 1,
      secrets: { 'openai-1': 'sk-one' },
      legacyChecked: ['openai-1'],
    }))

    await keystore.preloadSecrets(['openai-1'] as KeystoreRef[])
    await keystore.setSecret('openai-1' as KeystoreRef, 'sk-one')

    expect(keytar.getPassword).toHaveBeenCalledTimes(1)
    expect(keytar.setPassword).not.toHaveBeenCalled()
  })

  it('coalesces concurrent writes of the same secret after the first persistence', async () => {
    const keytar = (await import('keytar')).default
    const keystore = await import('./index')

    await Promise.all([
      keystore.setSecret('openai-1' as KeystoreRef, 'sk-one'),
      keystore.setSecret('openai-1' as KeystoreRef, 'sk-one'),
    ])

    expect(keytar.getPassword).toHaveBeenCalledTimes(1)
    expect(keytar.setPassword).toHaveBeenCalledTimes(1)
  })

  it('migrates a legacy per-ref item into the vault once', async () => {
    const keytar = (await import('keytar')).default
    const keystore = await import('./index')
    const ref = 'openai-legacy' as KeystoreRef
    mocks.credentials.set('spark-agent:openai-legacy', 'sk-legacy')

    await expect(keystore.getSecret(ref)).resolves.toBe('sk-legacy')
    keystore.clearSecretCache()
    await expect(keystore.getSecret(ref)).resolves.toBe('sk-legacy')

    expect(keytar.getPassword).toHaveBeenCalledTimes(3) // vault + legacy, then vault only
    expect(mocks.credentials.get('spark-agent:credential-vault-v1')).toContain('sk-legacy')
  })

  it('does not retry missing legacy refs after the first migration check', async () => {
    const keytar = (await import('keytar')).default
    const keystore = await import('./index')
    const ref = 'missing' as KeystoreRef
    await expect(keystore.getSecret(ref)).resolves.toBeNull()
    keystore.clearSecretCache()
    await expect(keystore.getSecret(ref)).resolves.toBeNull()
    expect(keytar.getPassword).toHaveBeenCalledTimes(3)
  })

  it('keeps the last persisted vault in memory when a write fails', async () => {
    const keystore = await import('./index')
    const ref = 'openai-1' as KeystoreRef
    mocks.credentials.set('spark-agent:credential-vault-v1', JSON.stringify({
      version: 1,
      secrets: { 'openai-1': 'sk-old' },
      legacyChecked: ['openai-1'],
    }))
    await expect(keystore.getSecret(ref)).resolves.toBe('sk-old')

    mocks.setPasswordError = new Error('Keychain access denied')
    await expect(keystore.setSecret(ref, 'sk-not-saved')).rejects.toThrow('access denied')
    await expect(keystore.getSecret(ref)).resolves.toBe('sk-old')
  })

  it('removes a legacy item during an explicit delete', async () => {
    const keytar = (await import('keytar')).default
    const keystore = await import('./index')
    const ref = 'openai-legacy' as KeystoreRef
    mocks.credentials.set('spark-agent:openai-legacy', 'sk-legacy')
    await expect(keystore.getSecret(ref)).resolves.toBe('sk-legacy')

    await expect(keystore.deleteSecret(ref)).resolves.toBe(true)
    expect(keytar.deletePassword).toHaveBeenCalledWith('spark-agent', ref)
    expect(mocks.credentials.has('spark-agent:openai-legacy')).toBe(false)
    await expect(keystore.getSecret(ref)).resolves.toBeNull()
  })
})
