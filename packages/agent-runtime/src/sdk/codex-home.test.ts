import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveCodexHome, withCodexHome } from './codex-home.js'
import type { SDKExecutorConfig } from './types.js'

const THREAD_ID = '019b65e4-9e4f-7000-8000-0123456789ab'
const config: SDKExecutorConfig = {
  apiKey: 'test-key',
  model: 'test-model',
  permissionMode: 'codex-default',
  workspaceRootPath: tmpdir(),
}
let root: string
let host: string
let runtime: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'codex-home-test-'))
  host = join(root, 'host')
  runtime = join(root, 'runtime')
  await mkdir(host)
  vi.stubEnv('CODEX_HOME', host)
  vi.stubEnv('SPARK_CODEX_HOME', runtime)
})

afterEach(async () => {
  vi.unstubAllEnvs()
  await rm(root, { recursive: true, force: true })
})

describe('Spark Codex home isolation', () => {
  it('isolates API runtime state without modifying host environment, config or credentials', async () => {
    await writeFile(join(host, 'auth.json'), 'host-auth-sentinel')
    await writeFile(join(host, 'config.toml'), 'host-config-sentinel')
    const prepared = await withCodexHome(config)
    expect(prepared.customEnv?.CODEX_HOME).toBe(runtime)
    expect(process.env.CODEX_HOME).toBe(host)
    expect(config.customEnv).toBeUndefined()
    expect(await readdir(runtime)).toEqual([])
    expect(await readFile(join(host, 'auth.json'), 'utf8')).toBe('host-auth-sentinel')
    expect(await readFile(join(host, 'config.toml'), 'utf8')).toBe('host-config-sentinel')
  })

  it('uses the Spark-owned default even when a host CODEX_HOME is inherited', () => {
    vi.stubEnv('SPARK_CODEX_HOME', '')
    expect(resolveCodexHome({})).toBe(join(homedir(), '.spark-agent', 'codex-home'))
  })

  it('retains local CLI OAuth/config while isolating local-config calls with an injected API provider', async () => {
    expect(resolveCodexHome({ useLocalConfig: true })).toBe(host)
    expect(
      resolveCodexHome({
        useLocalConfig: true,
        codexCliProvider: { id: 'spark', wireApi: 'responses' },
      }),
    ).toBe(runtime)
  })

  it('honors per-session home ahead of provider home and preserves other environment values', async () => {
    const sessionHome = join(root, 'session')
    const prepared = await withCodexHome({
      ...config,
      customEnv: { CODEX_HOME: sessionHome, KEEP: 'yes' },
      codexCliProvider: {
        id: 'spark',
        wireApi: 'responses',
        env: { CODEX_HOME: join(root, 'provider') },
      },
    })
    expect(prepared.customEnv).toEqual({ CODEX_HOME: sessionHome, KEEP: 'yes' })
    expect(resolveCodexHome({ codexCliProvider: prepared.codexCliProvider })).toBe(
      join(root, 'provider'),
    )
  })

  it('copies only the requested legacy rollout and never overwrites a continued runtime rollout', async () => {
    const folder = join(host, 'sessions', '2026', '11', '09')
    await mkdir(folder, { recursive: true })
    const name = `rollout-2026-11-09T01-00-00-${THREAD_ID}.jsonl`
    const unrelated = 'rollout-unrelated.jsonl'
    await writeFile(join(folder, name), 'legacy-rollout')
    await writeFile(join(folder, unrelated), 'unrelated-rollout')
    const resume = { ...config, continueSession: true, sdkSessionId: THREAD_ID }
    await withCodexHome(resume)
    const target = join(runtime, 'sessions', '2026', '11', '09', name)
    expect(await readFile(target, 'utf8')).toBe('legacy-rollout')
    expect(await readdir(join(runtime, 'sessions', '2026', '11', '09'))).toEqual([name])
    await writeFile(target, 'continued-rollout')
    await withCodexHome(resume)
    expect(await readFile(target, 'utf8')).toBe('continued-rollout')
    expect(await readFile(join(folder, name), 'utf8')).toBe('legacy-rollout')
  })

  it('does not import history for fresh turns, explicit homes or non-native session IDs', async () => {
    for (const overrides of [
      { sdkSessionId: THREAD_ID },
      { sdkSessionId: '../../escape', continueSession: true },
      { sdkSessionId: THREAD_ID, continueSession: true, customEnv: { CODEX_HOME: runtime } },
    ])
      await withCodexHome({ ...config, ...overrides })
    expect(await readdir(runtime)).toEqual([])
  })
})
