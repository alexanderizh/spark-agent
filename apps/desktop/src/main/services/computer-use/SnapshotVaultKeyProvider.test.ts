import { beforeEach, describe, expect, it, vi } from 'vitest'

const keystoreMocks = vi.hoisted(() => ({
  getSecret: vi.fn<() => Promise<string | null>>(),
  setSecret: vi.fn<(ref: string, value: string) => Promise<void>>(),
}))

vi.mock('@spark/shared/keystore', () => keystoreMocks)

import { SnapshotVaultKeyProvider } from './SnapshotVaultKeyProvider.js'

describe('SnapshotVaultKeyProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    keystoreMocks.getSecret.mockResolvedValue(null)
    keystoreMocks.setSecret.mockResolvedValue()
  })

  it('generates and persists one installation-scoped 256-bit key', async () => {
    const firstProvider = new SnapshotVaultKeyProvider()
    const secondProvider = new SnapshotVaultKeyProvider()

    const [first, second, third] = await Promise.all([
      firstProvider.getKey(),
      firstProvider.getKey(),
      secondProvider.getKey(),
    ])

    expect(first).toHaveLength(32)
    expect(second).toEqual(first)
    expect(third).toEqual(first)
    expect(keystoreMocks.getSecret).toHaveBeenCalledTimes(1)
    expect(keystoreMocks.setSecret).toHaveBeenCalledTimes(1)
    const persisted = keystoreMocks.setSecret.mock.calls[0]?.[1]
    expect(persisted).toBeTypeOf('string')
    expect(Buffer.from(persisted ?? '', 'base64')).toHaveLength(32)
  })

  it('loads a valid existing key without rewriting it', async () => {
    const encoded = Buffer.alloc(32, 7).toString('base64')
    keystoreMocks.getSecret.mockResolvedValue(encoded)
    const provider = new SnapshotVaultKeyProvider()

    await expect(provider.getKey()).resolves.toEqual(Buffer.alloc(32, 7))
    expect(keystoreMocks.setSecret).not.toHaveBeenCalled()
  })

  it('fails closed when the persisted key is malformed', async () => {
    keystoreMocks.getSecret.mockResolvedValue(Buffer.alloc(16).toString('base64'))
    const provider = new SnapshotVaultKeyProvider()

    await expect(provider.getKey()).rejects.toThrow('Invalid Snapshot Vault installation key')
    expect(keystoreMocks.setSecret).not.toHaveBeenCalled()
  })
})
