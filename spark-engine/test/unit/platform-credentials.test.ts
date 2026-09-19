import { chmod, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { PlatformCredentialError, PlatformCredentialStore } from '../../src/platform/credentials.js'

const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function sparkHome(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), 'spark-platform-credentials-'))
  roots.push(root)
  return root
}

const SESSION = { token: 'access-token', refreshToken: 'refresh-token', userId: '42' }

describe('PlatformCredentialStore', () => {
  it('round-trips a session with 0600 permissions and no temp file left behind', async () => {
    const home = await sparkHome()
    const store = new PlatformCredentialStore({ sparkHome: home })
    expect(store.path).toBe(resolve(home, 'credentials.json'))
    expect(await store.load()).toBeNull()

    await store.save({ serverUrl: 'https://spark.example.com/', session: SESSION })

    const loaded = await store.load()
    expect(loaded?.version).toBe(1)
    expect(loaded?.serverUrl).toBe('https://spark.example.com/')
    expect(loaded?.session).toEqual(SESSION)
    const stats = await stat(store.path)
    if (process.platform !== 'win32') {
      // Windows reports a fixed mode mask; access control there is ACL-based.
      expect(stats.mode & 0o777).toBe(0o600)
    }
    expect(await readdir(home)).toEqual(['credentials.json'])
  })

  it('keeps the account profile and returns null-free optional handling', async () => {
    const home = await sparkHome()
    const store = new PlatformCredentialStore({ sparkHome: home })
    await store.save({
      serverUrl: 'https://spark.example.com/',
      session: SESSION,
      account: { id: 7, account: 'cli@example.com', nickname: 'CLI User', role: 'user' },
    })

    const loaded = await store.load()
    expect(loaded?.account).toEqual({
      id: 7,
      account: 'cli@example.com',
      nickname: 'CLI User',
      role: 'user',
    })
  })

  it('reports unreadable credentials instead of pretending to be signed out', async () => {
    const home = await sparkHome()
    const store = new PlatformCredentialStore({ sparkHome: home })

    await writeFile(store.path, '{ not json', 'utf8')
    await expect(store.load()).rejects.toBeInstanceOf(PlatformCredentialError)

    await writeFile(
      store.path,
      JSON.stringify({ version: 2, serverUrl: 'https://a.example.com/' }),
      'utf8',
    )
    await expect(store.load()).rejects.toThrow(/run `spark login` again/u)
  })

  it('tightens group/world readable files back to 0600', async () => {
    const home = await sparkHome()
    const store = new PlatformCredentialStore({ sparkHome: home })
    await store.save({ serverUrl: 'https://spark.example.com/', session: SESSION })
    await chmod(store.path, 0o644)

    await store.load()

    const stats = await stat(store.path)
    if (process.platform !== 'win32') {
      expect(stats.mode & 0o777).toBe(0o600)
    }
  })

  it('clears the stored session and reports whether anything was removed', async () => {
    const home = await sparkHome()
    const store = new PlatformCredentialStore({ sparkHome: home })
    expect(await store.clear()).toBe(false)

    await store.save({ serverUrl: 'https://spark.example.com/', session: SESSION })
    expect(await store.clear()).toBe(true)
    expect(await store.load()).toBeNull()
  })
})
