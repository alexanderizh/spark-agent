import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthSession } from '@spark/protocol'
import * as keytar from 'keytar'

const mocks = vi.hoisted(() => {
  const credentials = new Map<string, string>()
  return {
    credentials,
    userDataDir: '',
    keytarUnavailable: false,
    keytarHangs: false,
    safeStorageAvailable: true,
  }
})

vi.mock('keytar', () => ({
  getPassword: vi.fn(async (service: string, key: string) => {
    if (mocks.keytarHangs) return await new Promise<string | null>(() => {})
    if (mocks.keytarUnavailable) throw new Error('keytar unavailable')
    return mocks.credentials.get(`${service}:${key}`) ?? null
  }),
  setPassword: vi.fn(async (service: string, key: string, value: string) => {
    if (mocks.keytarHangs) return await new Promise<void>(() => {})
    if (mocks.keytarUnavailable) throw new Error('keytar unavailable')
    mocks.credentials.set(`${service}:${key}`, value)
  }),
  deletePassword: vi.fn(async (service: string, key: string) => {
    if (mocks.keytarHangs) return await new Promise<boolean>(() => {})
    if (mocks.keytarUnavailable) throw new Error('keytar unavailable')
    return mocks.credentials.delete(`${service}:${key}`)
  }),
}))

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => mocks.userDataDir),
  },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => mocks.safeStorageAvailable),
    encryptString: vi.fn((value: string) => Buffer.from(`encrypted:${value}`, 'utf8')),
    decryptString: vi.fn((value: Buffer) => {
      const text = value.toString('utf8')
      if (!text.startsWith('encrypted:')) throw new Error('invalid encrypted payload')
      return text.slice('encrypted:'.length)
    }),
  },
}))

const session: AuthSession = {
  token: 'access-token',
  refreshToken: 'refresh-token',
  userId: 'user-1',
}

describe('TokenStore persistent fallback', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'spark-token-store-'))
    mocks.userDataDir = tempDir
    mocks.credentials.clear()
    mocks.keytarUnavailable = false
    mocks.keytarHangs = false
    mocks.safeStorageAvailable = true
    vi.resetModules()
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('restores the session from encrypted backup when keytar has no credentials', async () => {
    const { TokenStore } = await import('./TokenStore')
    const firstStore = new TokenStore('SparkAgent.CloudAuth')

    await firstStore.save(session)
    mocks.credentials.clear()

    const secondStore = new TokenStore('SparkAgent.CloudAuth')
    const loaded = await secondStore.load()

    expect(loaded).toEqual(session)
    expect(secondStore.isAuthenticated()).toBe(true)
    expect(secondStore.isPersistent()).toBe(true)
  })

  it('prefers encrypted backup without reading keychain on startup', async () => {
    const { TokenStore } = await import('./TokenStore')
    const firstStore = new TokenStore('SparkAgent.CloudAuth')
    await firstStore.save(session)
    vi.clearAllMocks()

    const secondStore = new TokenStore('SparkAgent.CloudAuth')
    const loaded = await secondStore.load()

    expect(loaded).toEqual(session)
    expect(keytar.getPassword).not.toHaveBeenCalled()
  })

  it('persists across restarts when keytar is unavailable', async () => {
    const { TokenStore } = await import('./TokenStore')
    mocks.keytarUnavailable = true

    const firstStore = new TokenStore('SparkAgent.CloudAuth')
    await firstStore.load()
    await firstStore.save(session)

    const secondStore = new TokenStore('SparkAgent.CloudAuth')
    const loaded = await secondStore.load()

    expect(loaded).toEqual(session)
    expect(secondStore.isAuthenticated()).toBe(true)
    expect(secondStore.isPersistent()).toBe(true)
  })

  it('falls back instead of blocking startup when keytar reads time out', async () => {
    const { TokenStore } = await import('./TokenStore')
    mocks.safeStorageAvailable = false
    mocks.keytarHangs = true

    const store = new TokenStore('SparkAgent.CloudAuth', { keytarOperationTimeoutMs: 20 })
    await expect(store.load()).resolves.toEqual({})

    expect(store.isPersistent()).toBe(false)
    expect(store.getLastError()).toContain('keytar load timed out after 20ms')
  })

  it('keeps the encrypted backup instead of blocking save when keytar writes time out', async () => {
    const { TokenStore } = await import('./TokenStore')
    mocks.keytarHangs = true

    const store = new TokenStore('SparkAgent.CloudAuth', { keytarOperationTimeoutMs: 20 })
    await expect(store.save(session)).resolves.toBeUndefined()

    expect(store.get()).toEqual(session)
    expect(store.isPersistent()).toBe(true)
    expect(store.getLastError()).toContain('keytar save timed out after 20ms')
  })

  it('clears local state instead of blocking logout when keytar deletes time out', async () => {
    const { TokenStore } = await import('./TokenStore')
    const store = new TokenStore('SparkAgent.CloudAuth', { keytarOperationTimeoutMs: 20 })
    await store.save(session)
    mocks.keytarHangs = true

    await expect(store.clear()).resolves.toBeUndefined()

    expect(store.get()).toEqual({})
    expect(store.isPersistent()).toBe(false)
    expect(store.getLastError()).toContain('keytar clear timed out after 20ms')
  })
})
