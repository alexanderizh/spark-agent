import { afterEach, describe, expect, it } from 'vitest'
import {
  ConnectorAccountRepository,
  ConnectorConnectionRepository,
  PluginRepository,
  createDatabase,
  type SparkDatabase,
} from '@spark/storage'
import type {
  ConnectorRuntimeDescriptor,
  RuntimeConnectRequest,
  RuntimeToolDefinition,
} from '@spark/protocol'
import { RuntimeBroker } from './runtime-broker.js'
import { registerBuiltinRuntimeAdapters } from './builtin-runtimes.js'
import type {
  ConnectorRuntimeAdapter,
  RuntimeConnectContext,
  RuntimeContext,
  RuntimeConnectResult,
} from './runtime-types.js'
import { RuntimeTokenService, type RuntimeSecretStore } from './token-service.js'
import { GitHubRuntimeAdapter } from './adapters/github-runtime.adapter.js'

const databases: SparkDatabase[] = []

afterEach(() => {
  for (const database of databases.splice(0)) database.close()
})

describe('RuntimeBroker', () => {
  it('connects multiple accounts without persisting secrets and selects a default account', async () => {
    const database = setupDatabase()
    const secrets = new Map<string, string>()
    const broker = createBroker(database, secrets)

    const first = await broker.connect('test', requestFor('alpha'))
    const second = await broker.connect('test', requestFor('beta'))

    expect(first.id).not.toBe(second.id)
    expect(broker.listAccounts('test')).toHaveLength(2)
    expect(broker.listRuntimeStatus()[0]).toMatchObject({ accountCount: 2 })
    expect(secrets.size).toBe(2)
    const storedMetadata = database.raw
      .prepare('SELECT config_json, credential_ref FROM connector_accounts')
      .all()
    expect(storedMetadata.every((row) => !JSON.stringify(row).includes('secret-'))).toBe(true)

    broker.setDefault('test', second.id)
    await expect(
      broker.invoke({ runtimeId: 'test', toolName: 'echo', input: { value: 'default' } }),
    ).resolves.toEqual({
      input: { value: 'default' },
      accountId: second.id,
      toolName: 'echo',
    })
  })

  it('blocks secret-like metadata fields before an adapter can persist them', async () => {
    const database = setupDatabase()
    const broker = createBroker(database, new Map())

    await expect(
      broker.connect('test', {
        authMethod: 'pat',
        secrets: { token: 'secret-token' },
        config: { apiBaseUrl: 'https://example.test', accessToken: 'must-not-be-stored' },
      }),
    ).rejects.toMatchObject({ code: 'AUTH_REQUIRED' })
    expect(broker.listAccounts('test')).toEqual([])
  })

  it('rejects undeclared auth methods and capabilities at the connection boundary', async () => {
    const database = setupDatabase()
    const broker = createBroker(database, new Map())

    await expect(
      broker.connect('test', { authMethod: 'oauth2', secrets: { token: 'fixture' } }),
    ).rejects.toMatchObject({ code: 'AUTH_REQUIRED' })
    await expect(
      broker.connect('test', {
        authMethod: 'pat',
        secrets: { token: 'fixture' },
        enabledCapabilities: ['not-declared'],
      }),
    ).rejects.toMatchObject({ code: 'CAPABILITY_DISABLED' })
    expect(broker.listAccounts('test')).toEqual([])
  })

  it('removes legacy transport capabilities when migrating connector accounts', () => {
    const database = setupDatabase()
    new PluginRepository(database).upsert({
      id: 'spark.github',
      version: '1.0.0',
      displayName: 'GitHub',
      description: 'GitHub runtime fixture',
      authorName: 'Spark',
      manifestJson: JSON.stringify({}),
      installPath: 'builtin://spark.github',
      source: 'bundled',
      enabled: true,
      state: 'installed',
      trust: 'bundled',
      integritySha256: 'github-fixture',
    })
    new ConnectorConnectionRepository(database).create({
      id: 'github-legacy',
      provider: 'github',
      name: 'GitHub',
      authMethod: 'pat',
      status: 'connected',
      config: { enabledCapabilities: ['identity', 'mcp_tools'] },
      keystoreRef: 'legacy/github',
      account: { id: 'octocat', login: 'octocat' },
    })
    const broker = new RuntimeBroker({ db: database })
    registerBuiltinRuntimeAdapters(broker)

    const accounts = broker.listAccounts('github')
    expect(accounts).toHaveLength(1)
    const migrated = accounts[0]
    if (migrated == null) throw new Error('GitHub fixture account was not migrated')
    expect(migrated.displayName).toBe('octocat')
    expect(migrated.enabledCapabilities).toContain('identity')
    expect(migrated.enabledCapabilities).not.toContain('mcp_tools')
    new ConnectorAccountRepository(database).update(migrated.id, {
      enabledCapabilities: ['identity', 'mcp_tools'],
    })
    const repaired = broker.listAccounts('github')[0]
    if (repaired == null) throw new Error('GitHub fixture account was not repaired')
    expect(repaired.enabledCapabilities).not.toContain('mcp_tools')
    expect(() =>
      broker.updateAccount('github', migrated.id, {
        enabledCapabilities: repaired.enabledCapabilities,
      }),
    ).not.toThrow()
  })

  it('does not recreate a legacy account after it is disconnected', async () => {
    const database = setupDatabase()
    new PluginRepository(database).upsert({
      id: 'spark.github',
      version: '1.0.0',
      displayName: 'GitHub',
      description: 'GitHub runtime fixture',
      authorName: 'Spark',
      manifestJson: JSON.stringify({}),
      installPath: 'builtin://spark.github',
      source: 'bundled',
      enabled: true,
      state: 'installed',
      trust: 'bundled',
      integritySha256: 'github-fixture',
    })
    new ConnectorConnectionRepository(database).create({
      id: 'github-legacy',
      provider: 'github',
      name: 'GitHub',
      authMethod: 'pat',
      status: 'connected',
      config: { enabledCapabilities: ['identity'] },
      keystoreRef: 'legacy/github',
      account: { id: 'octocat', login: 'octocat' },
    })
    const broker = new RuntimeBroker({
      db: database,
      tokenService: new RuntimeTokenService({
        get: async () => null,
        set: async () => undefined,
        delete: async () => true,
      }),
    })
    broker.register(new GitHubRuntimeAdapter())

    const account = broker.listAccounts('github')[0]
    if (account == null) throw new Error('GitHub legacy account was not migrated')
    await broker.disconnect('github', account.id)

    expect(broker.listAccounts('github')).toEqual([])
    expect(new ConnectorConnectionRepository(database).get('github-legacy')).toBeNull()
  })

  it('enforces capability, scope and one-time confirmation guards and records audit outcomes', async () => {
    const database = setupDatabase()
    const broker = createBroker(database, new Map())
    const account = await broker.connect('test', requestFor('guarded'))

    await expect(
      broker.invoke({ runtimeId: 'test', accountId: account.id, toolName: 'write', input: {} }),
    ).rejects.toMatchObject({ code: 'CAPABILITY_DISABLED' })

    const updated = broker.updateAccount('test', account.id, {
      enabledCapabilities: ['read', 'write'],
    })
    expect(updated.enabledCapabilities).toEqual(['read', 'write'])

    await expect(
      broker.invoke({ runtimeId: 'test', accountId: account.id, toolName: 'write', input: {} }),
    ).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' })

    const confirmation = broker.issueConfirmation('test', account.id, 'write')
    await expect(
      broker.invoke({
        runtimeId: 'test',
        accountId: account.id,
        toolName: 'write',
        input: {},
        confirmationToken: confirmation.token,
      }),
    ).resolves.toMatchObject({ accountId: account.id })

    await expect(
      broker.invoke({
        runtimeId: 'test',
        accountId: account.id,
        toolName: 'write',
        input: {},
        confirmationToken: confirmation.token,
      }),
    ).rejects.toMatchObject({ code: 'CONFIRMATION_REQUIRED' })

    broker.updateAccount('test', account.id, { enabledCapabilities: ['read'] })
    await expect(
      broker.invoke({ runtimeId: 'test', accountId: account.id, toolName: 'read', input: {} }),
    ).rejects.toMatchObject({ code: 'SCOPE_REQUIRED' })

    const audit = database.raw
      .prepare('SELECT outcome, error_code FROM plugin_runtime_audit ORDER BY created_at ASC')
      .all() as Array<{ outcome: string; error_code: string | null }>
    expect(audit.map((row) => row.outcome)).toEqual([
      'denied',
      'denied',
      'success',
      'denied',
      'denied',
    ])
    expect(audit[0]?.error_code).toBe('CAPABILITY_DISABLED')
    expect(audit[1]?.error_code).toBe('CONFIRMATION_REQUIRED')
    expect(audit[4]?.error_code).toBe('SCOPE_REQUIRED')
  })

  it('requires an explicit account when multiple accounts have no default', async () => {
    const database = setupDatabase()
    const broker = createBroker(database, new Map())
    await broker.connect('test', requestFor('one'))
    await broker.connect('test', requestFor('two'))
    database.raw.prepare('DELETE FROM connector_account_defaults').run()

    await expect(
      broker.invoke({ runtimeId: 'test', toolName: 'echo', input: {} }),
    ).rejects.toMatchObject({ code: 'ACCOUNT_SELECTION_REQUIRED' })
  })

  it('keeps disconnect available while the plugin is disabled', async () => {
    const database = setupDatabase()
    let enabled = true
    const secrets = new Map<string, string>()
    const broker = createBroker(database, secrets, () => enabled)
    const account = await broker.connect('test', requestFor('disconnect'))

    enabled = false
    await expect(
      broker.invoke({ runtimeId: 'test', accountId: account.id, toolName: 'echo', input: {} }),
    ).rejects.toMatchObject({ code: 'PLUGIN_DISABLED' })
    await expect(broker.disconnect('test', account.id)).resolves.toBeUndefined()
    expect(broker.listAccounts('test')).toEqual([])
    expect(secrets).toEqual(new Map())
  })
})

function setupDatabase(): SparkDatabase {
  const database = createDatabase(':memory:')
  databases.push(database)
  new PluginRepository(database).upsert({
    id: 'spark.test',
    version: '1.0.0',
    displayName: 'Test runtime',
    description: 'Test runtime',
    authorName: 'Spark QA',
    manifestJson: JSON.stringify({}),
    installPath: 'builtin://spark.test',
    source: 'bundled',
    enabled: true,
    state: 'installed',
    trust: 'bundled',
    integritySha256: 'test',
  })
  return database
}

function createBroker(
  database: SparkDatabase,
  values: Map<string, string>,
  isEnabled: (pluginId: string, runtimeId: string) => boolean = () => true,
): RuntimeBroker {
  const store: RuntimeSecretStore = {
    get: async (ref) => values.get(ref) ?? null,
    set: async (ref, value) => {
      values.set(ref, value)
    },
    delete: async (ref) => values.delete(ref),
  }
  const broker = new RuntimeBroker({
    db: database,
    isPluginEnabled: isEnabled,
    tokenService: new RuntimeTokenService(store),
  })
  broker.register(new TestRuntimeAdapter())
  return broker
}

function requestFor(name: string): RuntimeConnectRequest {
  return {
    authMethod: 'pat',
    secrets: { token: `secret-${name}` },
    config: { name },
    enabledCapabilities: ['read'],
  }
}

class TestRuntimeAdapter implements ConnectorRuntimeAdapter {
  readonly descriptor: ConnectorRuntimeDescriptor = {
    id: 'test',
    pluginId: 'spark.test',
    provider: 'test',
    displayName: 'Test runtime',
    description: 'Runtime broker contract fixture',
    icon: 'generic',
    toolNamespace: 'test',
    accountMode: 'multiple',
    execution: { type: 'builtin', adapter: 'test' },
    authMethods: ['pat'],
    capabilities: [
      {
        id: 'read',
        label: 'Read',
        description: 'Read fixture data',
        requiredScopes: ['fixture.read'],
        enabledByDefault: true,
      },
      {
        id: 'write',
        label: 'Write',
        description: 'Write fixture data',
        enabledByDefault: false,
      },
    ],
  }

  async connect(
    ctx: RuntimeConnectContext,
    request: RuntimeConnectRequest,
  ): Promise<RuntimeConnectResult> {
    const name = typeof request.config?.name === 'string' ? request.config.name : 'unknown'
    return {
      externalAccountId: name,
      displayName: name,
      grantedScopes: name === 'guarded' ? [] : ['fixture.read'],
      config: { name },
      credential: { accessToken: ctx.getSecret('token') ?? 'fixture-token' },
    }
  }

  async healthCheck(_ctx: RuntimeContext) {
    return { status: 'healthy' as const, checkedAt: new Date().toISOString() }
  }

  async listTools(_ctx: RuntimeContext): Promise<RuntimeToolDefinition[]> {
    return [
      fixtureTool('echo', ['read'], 'read'),
      fixtureTool('read', ['read'], 'read'),
      fixtureTool('write', ['write'], 'high-write'),
    ]
  }

  async invokeTool(ctx: RuntimeContext, toolName: string, input: unknown): Promise<unknown> {
    return { input, accountId: ctx.account.id, toolName }
  }
}

function fixtureTool(
  name: string,
  requiredCapabilities: string[],
  risk: RuntimeToolDefinition['risk'],
): RuntimeToolDefinition {
  return {
    name,
    title: name,
    description: name,
    inputSchema: { type: 'object' },
    requiredCapabilities,
    risk,
    effect: risk === 'read' ? 'read' : 'update',
    idempotency: risk === 'read' ? 'safe' : 'keyed',
  }
}
