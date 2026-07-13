import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  configureCredentialVaultPersistence: vi.fn(),
  preloadSecrets: vi.fn(),
  bootstrap: vi.fn(async () => ({ isAuthenticated: true, baseUrl: 'https://spark.example' })),
  warn: vi.fn(),
}))

vi.mock('../../ipc/typed-ipc.js', () => ({
  typedIpcHandle: (channel: string, handler: (...args: unknown[]) => unknown) => {
    mocks.handlers.set(channel, handler)
  },
}))
vi.mock('./AuthService', () => ({
  getAuthService: () => ({
    getCurrentUserId: () => 'spark-user-1',
    bootstrap: mocks.bootstrap,
  }),
}))
vi.mock('../../db.js', () => ({ getDatabase: () => ({}) }))
vi.mock('@spark/storage', () => ({
  ProviderProfileRepository: class { listAll() { return [{ keystore_ref: 'provider-ref' }] } },
  ConnectorConnectionRepository: class { listAll() { return [{ keystore_ref: 'connector-ref' }] } },
  SettingsRepository: class {},
}))
vi.mock('@spark/shared/keystore', () => ({
  configureCredentialVaultPersistence: mocks.configureCredentialVaultPersistence,
  preloadSecrets: mocks.preloadSecrets,
}))
vi.mock('../CredentialVaultPersistence.js', () => ({
  createCredentialVaultPersistence: () => ({ load: vi.fn(), save: vi.fn() }),
}))
vi.mock('@spark/shared', () => ({
  SparkError: class extends Error {},
  createLogger: () => ({ warn: mocks.warn }),
}))
vi.mock('electron', () => ({
  app: { isPackaged: false },
  dialog: { showMessageBox: vi.fn() },
}))

import { registerAuthIpc } from './registerAuthIpc.js'

describe('auth bootstrap credential preload', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.handlers.clear()
  })

  it('continues login when the user denies credential access', async () => {
    mocks.preloadSecrets.mockRejectedValueOnce(new Error('User denied Keychain access'))
    registerAuthIpc()
    const bootstrapHandler = mocks.handlers.get('auth:bootstrap')

    await expect(bootstrapHandler?.()).resolves.toMatchObject({ isAuthenticated: true })
    expect(mocks.configureCredentialVaultPersistence).toHaveBeenCalledOnce()
    expect(mocks.preloadSecrets).toHaveBeenCalledWith(['provider-ref', 'connector-ref'])
    expect(mocks.bootstrap).toHaveBeenCalledOnce()
    expect(mocks.warn).toHaveBeenCalledWith(expect.stringContaining('User denied'))
  })
})
