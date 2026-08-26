import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { loadConfiguredModel } from '../../src/config/model-config.js'

const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('model configuration', () => {
  it('merges global, project, environment, and CLI layers in precedence order', async () => {
    const root = await createRoot()
    const globalPath = join(root, 'home', 'config.toml')
    const projectPath = join(root, 'project', '.spark', 'config.toml')
    await writeFile(
      globalPath,
      '[agent]\nmodel = "primary"\nfailover = ["backup"]\nmax_retries = 1\n\n[providers.local]\nprotocol = "openai-responses"\nbase_url = "https://global.example/v1"\napi_key_env = "TEST_KEY"\n\n[models.primary]\nprovider = "local"\nmodel = "global-model"\n\n[models.backup]\nprovider = "local"\nmodel = "backup-model"\n',
    )
    await writeFile(
      projectPath,
      '[providers.local]\nbase_url = "https://project.example/v1"\n\n[models.primary]\nmodel = "project-model"\n',
    )
    const runtime = await loadConfiguredModel({
      cwd: join(root, 'project'),
      globalConfigPath: globalPath,
      projectConfigPath: projectPath,
      env: { TEST_KEY: 'secret', SPARK_FAILOVER_MODELS: 'backup' },
      model: 'primary',
    })
    expect(runtime.modelId).toBe('primary')
    expect(runtime.route).toEqual(['primary', 'backup'])
    expect(JSON.stringify(runtime.configSnapshot)).not.toContain('secret')
    expect(runtime.configSnapshot).toMatchObject({
      providers: { local: { base_url: 'https://project.example/v1' } },
      models: { primary: { model: 'project-model', provider: 'local' } },
    })
  })

  it('fails closed with an actionable message when a credential is missing', async () => {
    const root = await createRoot()
    const projectPath = join(root, 'project', '.spark', 'config.toml')
    await writeFile(
      projectPath,
      '[agent]\nmodel = "main"\n\n[providers.anthropic]\nprotocol = "anthropic-messages"\n\n[models.main]\nprovider = "anthropic"\nmodel = "claude-test"\n',
    )
    await expect(
      loadConfiguredModel({
        cwd: join(root, 'project'),
        globalConfigPath: join(root, 'missing.toml'),
        projectConfigPath: projectPath,
        env: {},
      }),
    ).rejects.toThrow(/ANTHROPIC_API_KEY/u)
  })

  it('rejects unknown top-level fields before they can enter the config snapshot', async () => {
    const root = await createRoot()
    const projectPath = join(root, 'project', '.spark', 'config.toml')
    await writeFile(
      projectPath,
      '[agent]\nmodel = "main"\n\n[providers.local]\nprotocol = "openai-responses"\napi_key_env = "TEST_KEY"\n\n[models.main]\nprovider = "local"\nmodel = "gpt-test"\n\n[credentials]\nsecret = "must-not-persist"\n',
    )

    await expect(
      loadConfiguredModel({
        cwd: join(root, 'project'),
        globalConfigPath: join(root, 'missing.toml'),
        projectConfigPath: projectPath,
        env: { TEST_KEY: 'runtime-secret' },
      }),
    ).rejects.toThrow(/Unrecognized key.*credentials/u)
  })

  it('discovers the SparkWork default route without copying its provider credential', async () => {
    const root = await createRoot()
    const descriptorPath = join(root, 'bridge.json')
    await writeFile(
      descriptorPath,
      JSON.stringify({
        schemaVersion: 1,
        host: 'sparkwork',
        instanceId: 'instance-1234567890',
        endpoint: 'http://127.0.0.1:39876',
        token: 'bridge-token-that-is-long-enough-to-be-private',
        pid: 1234,
        startedAt: '2026-08-26T12:00:00.000Z',
      }),
      { mode: 0o600 },
    )
    if (process.platform !== 'win32') await chmod(descriptorPath, 0o600)
    const runtime = await loadConfiguredModel({
      cwd: join(root, 'project'),
      globalConfigPath: join(root, 'missing.toml'),
      projectConfigPath: join(root, 'project', '.spark', 'config.toml'),
      sparkWorkBridgePath: descriptorPath,
      env: {},
      fetch: async (input) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
        expect(url).toBe('http://127.0.0.1:39876/v1/catalog')
        return new Response(
          JSON.stringify({
            schemaVersion: 1,
            host: 'sparkwork',
            revision: 'a'.repeat(64),
            generatedAt: '2026-08-26T12:00:00.000Z',
            defaultRoute: 'sparkwork:provider-1:gpt-test',
            routes: [
              {
                routeId: 'sparkwork:provider-1:gpt-test',
                providerId: 'provider-1',
                providerName: 'Provider One',
                protocol: 'openai-responses',
                model: 'gpt-test',
              },
            ],
          }),
        )
      },
    })

    expect(runtime.modelId).toBe('sparkwork:provider-1:gpt-test')
    expect(runtime.route).toEqual(['sparkwork:provider-1:gpt-test'])
    expect(JSON.stringify(runtime.configSnapshot)).not.toContain('bridge-token')
    expect(runtime.configSnapshot).toMatchObject({
      sparkwork: {
        catalogRevision: 'a'.repeat(64),
        selectedRoute: 'sparkwork:provider-1:gpt-test',
      },
    })
  })

  it('keeps an explicit project model above the SparkWork default', async () => {
    const root = await createRoot()
    const projectPath = join(root, 'project', '.spark', 'config.toml')
    const descriptorPath = join(root, 'bridge.json')
    await writeFile(
      projectPath,
      '[agent]\nmodel = "local"\n\n[providers.local]\nprotocol = "openai-responses"\napi_key_env = "LOCAL_KEY"\n\n[models.local]\nprovider = "local"\nmodel = "local-model"\n',
    )
    await writeFile(
      descriptorPath,
      JSON.stringify({
        schemaVersion: 1,
        host: 'sparkwork',
        instanceId: 'instance-1234567890',
        endpoint: 'http://127.0.0.1:39876',
        token: 'bridge-token-that-is-long-enough-to-be-private',
        pid: 1234,
        startedAt: '2026-08-26T12:00:00.000Z',
      }),
      { mode: 0o600 },
    )
    if (process.platform !== 'win32') await chmod(descriptorPath, 0o600)
    const runtime = await loadConfiguredModel({
      cwd: join(root, 'project'),
      globalConfigPath: join(root, 'missing.toml'),
      projectConfigPath: projectPath,
      sparkWorkBridgePath: descriptorPath,
      env: { LOCAL_KEY: 'local-secret' },
      fetch: async () =>
        new Response(
          JSON.stringify({
            schemaVersion: 1,
            host: 'sparkwork',
            revision: 'b'.repeat(64),
            generatedAt: '2026-08-26T12:00:00.000Z',
            defaultRoute: 'sparkwork:provider-1:host-model',
            routes: [
              {
                routeId: 'sparkwork:provider-1:host-model',
                providerId: 'provider-1',
                providerName: 'Provider One',
                protocol: 'openai-responses',
                model: 'host-model',
              },
            ],
          }),
        ),
    })

    expect(runtime.modelId).toBe('local')
  })
})

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'spark-config-'))
  roots.push(root)
  await mkdir(join(root, 'home'), { recursive: true })
  await mkdir(join(root, 'project', '.spark'), { recursive: true })
  return root
}
