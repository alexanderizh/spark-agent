import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as keystore from '@spark/shared/keystore'
import {
  resolveProviderApiKey,
  setManagedCredentialRecoveryHandler,
} from '../../services/provider-credential-resolver.js'

vi.mock('@spark/shared/keystore', () => ({
  getSecret: vi.fn(),
  setSecret: vi.fn(),
}))

const managedProvider = {
  id: 'platform-newapi',
  keystore_ref: 'provider:platform-newapi',
  config_json: JSON.stringify({
    managed: true,
    managedType: 'newapi',
    managedOwnerUserId: 'spark-user-1',
  }),
}

describe('resolveProviderApiKey', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => setManagedCredentialRecoveryHandler(null))

  it('keeps third-party providers on the original keystore path', async () => {
    vi.mocked(keystore.getSecret).mockResolvedValue('third-party-key')
    const recover = vi.fn()
    setManagedCredentialRecoveryHandler(recover)

    await expect(resolveProviderApiKey({
      ...managedProvider,
      config_json: JSON.stringify({ apiEndpoint: 'https://third-party.example' }),
    })).resolves.toBe('third-party-key')
    expect(recover).not.toHaveBeenCalled()
  })

  it('recovers a missing managed credential and persists it', async () => {
    vi.mocked(keystore.getSecret).mockResolvedValue(null)
    const recover = vi.fn().mockResolvedValue('recovered-key')
    setManagedCredentialRecoveryHandler(recover)

    await expect(resolveProviderApiKey(managedProvider)).resolves.toBe('recovered-key')
    expect(recover).toHaveBeenCalledWith(expect.objectContaining({
      ownerUserId: 'spark-user-1',
      currentSecret: null,
    }))
    expect(keystore.setSecret).toHaveBeenCalledWith('provider:platform-newapi', 'recovered-key')
  })

  it('validates an existing managed credential without rewriting it', async () => {
    vi.mocked(keystore.getSecret).mockResolvedValue('existing-key')
    setManagedCredentialRecoveryHandler(vi.fn().mockResolvedValue('existing-key'))

    await expect(resolveProviderApiKey(managedProvider)).resolves.toBe('existing-key')
    expect(keystore.setSecret).not.toHaveBeenCalled()
  })

  it('propagates a managed recovery failure', async () => {
    vi.mocked(keystore.getSecret).mockResolvedValue(null)
    setManagedCredentialRecoveryHandler(vi.fn().mockRejectedValue(new Error('session conflict')))
    await expect(resolveProviderApiKey(managedProvider)).rejects.toThrow('session conflict')
  })
})
