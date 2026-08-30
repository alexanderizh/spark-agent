import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const mocks = vi.hoisted(() => ({
  userDataPath: '',
  encryptionAvailable: true,
  encryptString: vi.fn((value: string) => Buffer.from(`encrypted:${value}`)),
  decryptString: vi.fn((value: Buffer) => value.toString().replace(/^encrypted:/, '')),
}))

vi.mock('electron', () => ({
  app: { getPath: () => mocks.userDataPath },
  safeStorage: {
    isEncryptionAvailable: () => mocks.encryptionAvailable,
    encryptString: mocks.encryptString,
    decryptString: mocks.decryptString,
  },
}))

import { createCredentialVaultPersistence } from './CredentialVaultPersistence.js'

describe.runIf(process.platform === 'darwin')('CredentialVaultPersistence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.encryptionAvailable = true
    mocks.userDataPath = mkdtempSync(join(tmpdir(), 'spark-credential-vault-'))
  })

  afterEach(() => {
    rmSync(mocks.userDataPath, { recursive: true, force: true })
  })

  it('atomically saves and reloads an encrypted vault with user-only permissions', async () => {
    const persistence = createCredentialVaultPersistence()
    expect(persistence).not.toBeNull()

    await persistence?.save('{"version":1}')

    const filePath = join(mocks.userDataPath, 'credential-vault-v1.enc')
    expect(readFileSync(filePath, 'utf8')).toBe('encrypted:{"version":1}')
    expect(statSync(filePath).mode & 0o777).toBe(0o600)
    await expect(persistence?.load()).resolves.toBe('{"version":1}')
  })

  it('returns null when no encrypted vault has been created', async () => {
    await expect(createCredentialVaultPersistence()?.load()).resolves.toBeNull()
  })

  it('disables app persistence when safeStorage encryption is unavailable', () => {
    mocks.encryptionAvailable = false
    expect(createCredentialVaultPersistence()).toBeNull()
  })
})
