import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  configureLocalProvider,
  createConfiguredRuntime,
  loadConfiguredModel,
} from '../../src/config/model-config.js'

const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('configureLocalProvider', () => {
  it('writes a credential-free provider entry that the loader can immediately use', async () => {
    const home = await tempHome()
    const result = await configureLocalProvider({
      sparkHome: home,
      alias: 'main',
      protocol: 'openai-responses',
      baseUrl: 'https://models.example/v1',
      apiKeyEnv: 'MY_KEY',
      modelId: 'gpt-test',
    })

    expect(result.modelEntryId).toBe('main')
    const content = await readFile(join(home, 'config.toml'), 'utf8')
    expect(content).toContain('api_key_env = "MY_KEY"')
    expect(content).not.toMatch(/(sk-|Bearer )/u)
    if (process.platform !== 'win32') {
      expect((await stat(join(home, 'config.toml'))).mode & 0o077).toBe(0)
    }

    const runtime = await loadConfiguredModel({
      cwd: home,
      globalConfigPath: join(home, 'config.toml'),
      projectConfigPath: join(home, 'project', '.spark', 'config.toml'),
      env: { MY_KEY: 'secret-value', SPARK_HOME: home },
      model: 'main',
    })
    expect(runtime.modelId).toBe('main')
    expect(JSON.stringify(runtime.configSnapshot)).not.toContain('secret-value')
  })

  it('merges into an existing config without dropping other entries', async () => {
    const home = await tempHome()
    const configPath = join(home, 'config.toml')
    await writeFile(
      configPath,
      '[agent]\nmodel = "existing"\nfailover = []\n\n[providers.existing]\nprotocol = "anthropic-messages"\napi_key_env = "OTHER_KEY"\n\n[models.existing]\nprovider = "existing"\nmodel = "claude-x"\n',
      'utf8',
    )

    await configureLocalProvider({
      sparkHome: home,
      alias: 'extra',
      protocol: 'openai-responses',
      apiKeyEnv: 'EXTRA_KEY',
      modelId: 'gpt-extra',
    })

    const runtime = await createConfiguredRuntime({
      cwd: home,
      globalConfigPath: configPath,
      projectConfigPath: join(home, 'project', '.spark', 'config.toml'),
      env: { EXTRA_KEY: 'x', SPARK_HOME: home },
      model: 'extra',
    })
    expect(runtime.route).toEqual(['extra'])
    expect(JSON.stringify(runtime.configSnapshot)).toContain('"existing"')
  })

  it('overwrites the same alias and refuses invalid input without touching the file', async () => {
    const home = await tempHome()
    await configureLocalProvider({
      sparkHome: home,
      alias: 'main',
      protocol: 'openai-responses',
      apiKeyEnv: 'MY_KEY',
      modelId: 'gpt-old',
    })
    await configureLocalProvider({
      sparkHome: home,
      alias: 'main',
      protocol: 'openai-responses',
      apiKeyEnv: 'MY_KEY',
      modelId: 'gpt-new',
    })
    const content = await readFile(join(home, 'config.toml'), 'utf8')
    expect(content).toContain('gpt-new')
    expect(content).not.toContain('gpt-old')

    await expect(
      configureLocalProvider({
        sparkHome: home,
        alias: 'Bad Alias',
        protocol: 'openai-responses',
        apiKeyEnv: 'MY_KEY',
        modelId: 'gpt',
      }),
    ).rejects.toThrow(/alias/u)
    await expect(
      configureLocalProvider({
        sparkHome: home,
        alias: 'ok',
        protocol: 'openai-responses',
        apiKeyEnv: 'not-an-env-name',
        modelId: 'gpt',
      }),
    ).rejects.toThrow(/environment variable/u)
    await expect(
      configureLocalProvider({
        sparkHome: home,
        alias: 'ok',
        protocol: 'openai-responses',
        baseUrl: 'ftp://nope',
        apiKeyEnv: 'MY_KEY',
        modelId: 'gpt',
      }),
    ).rejects.toThrow(/base_url/u)
    expect((await readFile(join(home, 'config.toml'), 'utf8')).includes('gpt-new')).toBe(true)
  })

  it('builds a runtime for an explicit SparkWork route id through the live catalog', async () => {
    const home = await tempHome()
    const bridgeDir = join(home, 'hosts', 'sparkwork')
    await mkdir(bridgeDir, { recursive: true })
    const descriptorPath = join(bridgeDir, 'bridge-live-aaaa.json')
    await writeFile(
      descriptorPath,
      JSON.stringify({
        schemaVersion: 1,
        host: 'sparkwork',
        instanceId: 'instance-live-aaaaaaaaa',
        endpoint: 'http://127.0.0.1:39931',
        token: 'bridge-token-that-is-long-enough-to-be-private',
        pid: process.pid,
        startedAt: '2026-08-26T12:00:00.000Z',
      }),
      { mode: 0o600 },
    )
    if (process.platform !== 'win32') await chmod(descriptorPath, 0o600)
    const runtime = await createConfiguredRuntime({
      cwd: home,
      globalConfigPath: join(home, 'missing.toml'),
      projectConfigPath: join(home, 'project', '.spark', 'config.toml'),
      env: { SPARK_HOME: home },
      model: 'sparkwork:provider-9:gpt-live',
      fetch: async () =>
        new Response(
          JSON.stringify({
            schemaVersion: 1,
            host: 'sparkwork',
            revision: 'd'.repeat(64),
            generatedAt: '2026-08-26T12:00:00.000Z',
            routes: [
              {
                routeId: 'sparkwork:provider-9:gpt-live',
                providerId: 'provider-9',
                providerName: 'Provider Nine',
                protocol: 'openai-responses',
                model: 'gpt-live',
              },
            ],
          }),
        ),
    })
    expect(runtime.modelId).toBe('sparkwork:provider-9:gpt-live')
    expect(runtime.configSnapshot).toMatchObject({
      sparkwork: { selectedRoute: 'sparkwork:provider-9:gpt-live' },
    })
  })
})

async function tempHome(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'spark-config-write-'))
  roots.push(root)
  await mkdir(join(root, 'project', '.spark'), { recursive: true })
  return root
}
