import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AgentRepository, ProviderProfileRepository, SparkDatabase } from '@spark/storage'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { registerToolPackageBuiltInCapabilities } from './tool-package-built-in-capabilities.js'
import { ToolHostCapabilityBroker } from './tool-host-capability-broker.js'

const migrationsDir = fileURLToPath(new URL('../../../../storage/migrations/', import.meta.url))

describe('Tool Package built-in capabilities', () => {
  let root: string
  let db: SparkDatabase
  let broker: ToolHostCapabilityBroker
  let unregister: () => void

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'spark-tool-capabilities-'))
    db = new SparkDatabase(join(root, 'test.db'))
    db.runMigrations(migrationsDir)
    new ProviderProfileRepository(db).create({
      id: 'provider-safe-listing',
      providerType: 'openai',
      name: 'Safe listing provider',
      config: {
        defaultModel: 'model-safe-listing',
        modelIds: ['model-safe-listing'],
        apiEndpoint: 'https://credential-bearing-endpoint.invalid/v1',
      },
      keystoreRef: 'secret-keystore-reference',
      isDefault: true,
    })
    new AgentRepository(db).create({
      id: 'agent-safe-listing',
      name: 'Safe listing agent',
      description: 'Public description',
      prompt: 'PRIVATE_AGENT_PROMPT',
      metadata: { privateNote: 'PRIVATE_AGENT_METADATA' },
    })
    broker = new ToolHostCapabilityBroker()
    unregister = registerToolPackageBuiltInCapabilities(broker, {
      db,
      uploadFile: vi.fn(async () => ({ uploaded: true })),
      presentFiles: vi.fn(async () => ({ presented: true })),
    })
  })

  afterEach(async () => {
    unregister()
    db.close()
    await rm(root, { recursive: true, force: true })
  })

  const context = {
    packageId: 'acme.capability-test',
    packageVersion: '1.0.0',
    toolName: 'inspect_platform',
    invocationId: 'invocation-1',
  }

  async function invoke(capability: string, input: unknown = {}) {
    const allowed = new Set([capability])
    return broker.invoke({
      capability,
      declaredCapabilities: allowed,
      grantedCapabilities: allowed,
      context,
      input,
    })
  }

  it('registers the initial versioned capability surface', () => {
    expect(broker.protocolVersion).toBe(1)
    expect(broker.list()).toEqual([
      'agents.get',
      'agents.invoke',
      'agents.list',
      'files.present',
      'files.upload',
      'models.get',
      'models.invoke',
      'models.list',
    ])
  })

  it('returns model and Agent listings without credentials, prompts or metadata', async () => {
    const models = await invoke('models.list')
    const agents = await invoke('agents.list')
    expect(models).toEqual({
      models: [
        {
          providerId: 'provider-safe-listing',
          providerName: 'Safe listing provider',
          providerType: 'openai',
          model: 'model-safe-listing',
          default: true,
        },
      ],
    })
    expect(agents).toEqual({
      agents: expect.arrayContaining([
        expect.objectContaining({
          id: 'agent-safe-listing',
          name: 'Safe listing agent',
          description: 'Public description',
        }),
      ]),
    })
    const serialized = JSON.stringify({ models, agents })
    expect(serialized).not.toContain('secret-keystore-reference')
    expect(serialized).not.toContain('credential-bearing-endpoint')
    expect(serialized).not.toContain('PRIVATE_AGENT_PROMPT')
    expect(serialized).not.toContain('PRIVATE_AGENT_METADATA')
  })

  it('rejects ungranted capabilities and validates file callback input before invocation', async () => {
    await expect(
      broker.invoke({
        capability: 'models.list',
        declaredCapabilities: new Set(['models.list']),
        grantedCapabilities: new Set(),
        context,
        input: {},
      }),
    ).rejects.toMatchObject({ code: 'CAPABILITY_NOT_AUTHORIZED' })

    await expect(invoke('files.upload', { path: 42 })).rejects.toMatchObject({
      code: 'CAPABILITY_FAILED',
    })
  })
})
