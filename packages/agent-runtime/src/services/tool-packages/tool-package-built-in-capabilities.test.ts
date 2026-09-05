import { createServer } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
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
    db.raw
      .prepare(
        `INSERT INTO tool_packages(
          id, display_name, description, source, trust, state, enabled_version, created_at, updated_at
        ) VALUES (?, ?, ?, 'managed-project', 'trusted-local', 'installed-disabled', NULL, ?, ?)`,
      )
      .run(
        'acme.capability-test',
        'Capability test',
        'Capability test package',
        new Date().toISOString(),
        new Date().toISOString(),
      )
    broker = new ToolHostCapabilityBroker()
    unregister = registerToolPackageBuiltInCapabilities(broker, {
      db,
      uploadFile: vi.fn(async () => ({ uploaded: true })),
      presentFiles: vi.fn(async () => ({ presented: true })),
      trashFile: vi.fn(async (_context, input) => ({ trashed: input.path })),
      readClipboardText: vi.fn(() => 'clipboard value'),
      writeClipboardText: vi.fn((_context, input) => ({ characters: input.text.length })),
      showNotification: vi.fn(async () => ({ shown: true })),
      openExternal: vi.fn(async (_context, input) => ({ opened: input.url })),
      openDialog: vi.fn(async () => ({ canceled: false, filePaths: ['/tmp/example.txt'] })),
      saveDialog: vi.fn(async () => ({ canceled: false, filePath: '/tmp/example.txt' })),
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
      'artifacts.present',
      'browser.open',
      'clipboard.read',
      'clipboard.write',
      'dialogs.open',
      'dialogs.save',
      'files.copy',
      'files.list',
      'files.move',
      'files.present',
      'files.read',
      'files.stat',
      'files.trash',
      'files.upload',
      'files.write',
      'http.fetch',
      'models.get',
      'models.invoke',
      'models.list',
      'notifications.show',
      'process.exec',
      'storage.kv.delete',
      'storage.kv.get',
      'storage.kv.list',
      'storage.kv.set',
    ])
    expect(broker.describe().find((item) => item.name === 'http.fetch')).toMatchObject({
      risk: 'high-write',
      supportsCancellation: true,
    })
    expect(
      broker
        .describe()
        .every(
          (item) =>
            item.description != null &&
            item.inputSchema != null &&
            item.outputSchema != null &&
            item.risk != null,
        ),
    ).toBe(true)
  })

  it('routes desktop integrations through validated optional host callbacks', async () => {
    await expect(invoke('clipboard.read')).resolves.toEqual({ text: 'clipboard value' })
    await expect(invoke('clipboard.write', { text: 'copy me' })).resolves.toEqual({ characters: 7 })
    await expect(invoke('browser.open', { url: 'spark-agent://settings/tools' })).resolves.toEqual({
      opened: 'spark-agent://settings/tools',
    })
    await expect(invoke('dialogs.open', { mode: 'directory' })).resolves.toMatchObject({
      canceled: false,
    })
    await expect(invoke('notifications.show', { title: '' })).rejects.toMatchObject({
      code: 'CAPABILITY_FAILED',
    })
    await expect(invoke('files.trash', { path: '/tmp/example.txt' })).rejects.toMatchObject({
      code: 'CAPABILITY_NOT_AUTHORIZED',
    })
    const authorize = vi.fn(async () => true)
    broker.setInvocationAuthorizer(authorize)
    await expect(invoke('files.trash', { path: '/tmp/example.txt' })).resolves.toEqual({
      trashed: '/tmp/example.txt',
    })
    expect(authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        definition: expect.objectContaining({
          name: 'files.trash',
          requiresCallConfirmation: true,
        }),
      }),
    )
  })

  it('keeps KV state package-isolated and reads and writes explicit file paths', async () => {
    await expect(
      invoke('storage.kv.set', { key: 'counter', value: { count: 1 } }),
    ).resolves.toMatchObject({
      entry: { key: 'counter', value: { count: 1 } },
    })
    await expect(invoke('storage.kv.get', { key: 'counter' })).resolves.toMatchObject({
      entry: { key: 'counter', value: { count: 1 } },
    })

    const filePath = join(root, 'nested', 'result.txt')
    await invoke('files.write', {
      path: filePath,
      content: 'tool output',
      createParents: true,
    })
    expect(await readFile(filePath, 'utf8')).toBe('tool output')
    await expect(invoke('files.read', { path: filePath })).resolves.toMatchObject({
      path: filePath,
      content: 'tool output',
    })
  })

  it('allows private HTTP endpoints and stops reading responses at the configured limit', async () => {
    const server = createServer((_request, response) => {
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ ok: true }))
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const address = server.address()
      if (address == null || typeof address === 'string')
        throw new Error('HTTP test server unavailable')
      await expect(
        invoke('http.fetch', {
          url: `http://127.0.0.1:${address.port}/health`,
          responseType: 'json',
        }),
      ).resolves.toMatchObject({ status: 200, content: { ok: true } })
      await expect(
        invoke('http.fetch', {
          url: `http://127.0.0.1:${address.port}/health`,
          maxResponseBytes: 4,
        }),
      ).rejects.toMatchObject({ code: 'CAPABILITY_FAILED' })
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error == null ? resolve() : reject(error))),
      )
    }
  })

  it('runs confirmed process.exec commands and reports non-zero exits as data', async () => {
    const authorize = vi.fn(async () => true)
    broker.setInvocationAuthorizer(authorize)
    const run = await invoke('process.exec', {
      command: [
        process.execPath,
        '-e',
        'console.log(process.env.SPARK_EXEC_TEST_VAR ?? "missing"); console.error("warn-line")',
      ],
      env: { SPARK_EXEC_TEST_VAR: 'injected' },
      timeoutMs: 30_000,
    })
    expect(run).toMatchObject({
      status: 'completed',
      exitCode: 0,
      stdout: expect.stringContaining('injected'),
      stderr: expect.stringContaining('warn-line'),
    })
    expect(authorize).toHaveBeenCalledWith(
      expect.objectContaining({
        definition: expect.objectContaining({
          name: 'process.exec',
          risk: 'destructive',
          requiresCallConfirmation: true,
        }),
      }),
    )

    await expect(
      invoke('process.exec', {
        command: [process.execPath, '-e', 'process.exit(3)'],
        timeoutMs: 30_000,
      }),
    ).resolves.toMatchObject({ status: 'completed', exitCode: 3 })

    await expect(invoke('process.exec', { command: [] })).rejects.toMatchObject({
      code: 'CAPABILITY_FAILED',
    })
    await expect(
      invoke('process.exec', { command: ['definitely-missing-binary-xyz'] }),
    ).rejects.toMatchObject({ code: 'CAPABILITY_FAILED' })
  })

  it('kills the process tree on process.exec timeout and cancellation', async () => {
    broker.setInvocationAuthorizer(async () => true)
    await expect(
      invoke('process.exec', {
        command: [process.execPath, '-e', 'setInterval(() => {}, 50)'],
        timeoutMs: 1_500,
      }),
    ).resolves.toMatchObject({ status: 'timeout', exitCode: null })

    const controller = new AbortController()
    const pending = broker.invoke({
      capability: 'process.exec',
      declaredCapabilities: new Set(['process.exec']),
      grantedCapabilities: new Set(['process.exec']),
      context: { ...context, signal: controller.signal },
      input: {
        command: [process.execPath, '-e', 'setInterval(() => {}, 50)'],
        timeoutMs: 30_000,
      },
    })
    await new Promise((resolve) => setTimeout(resolve, 300))
    controller.abort()
    await expect(pending).resolves.toMatchObject({ status: 'cancelled' })
  })

  it('forwards models.invoke responseFormat and parses structured JSON output', async () => {
    const seenBodies: unknown[] = []
    const server = createServer((request, response) => {
      let raw = ''
      request.on('data', (chunk: Buffer) => {
        raw += chunk.toString('utf8')
      })
      request.on('end', () => {
        seenBodies.push(JSON.parse(raw) as unknown)
        response.setHeader('content-type', 'application/json')
        response.end(
          JSON.stringify({
            choices: [{ message: { content: '{"answer": 42}' } }],
          }),
        )
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const address = server.address()
      if (address == null || typeof address === 'string')
        throw new Error('HTTP test server unavailable')
      const providers = new ProviderProfileRepository(db)
      providers.create({
        id: 'provider-json-model',
        providerType: 'openai',
        name: 'Structured output provider',
        config: {
          defaultModel: 'model-json',
          modelIds: ['model-json'],
          apiEndpoint: `http://127.0.0.1:${address.port}/v1`,
        },
        keystoreRef: 'structured-output-test-ref',
      })

      const result = await invoke('models.invoke', {
        providerId: 'provider-json-model',
        model: 'model-json',
        prompt: 'answer as json',
        responseFormat: { type: 'json' },
      })
      expect(result).toMatchObject({
        model: 'model-json',
        text: '{"answer": 42}',
        json: { value: { answer: 42 } },
      })
      expect(seenBodies.at(-1)).toMatchObject({
        response_format: { type: 'json_object' },
      })

      await invoke('models.invoke', {
        providerId: 'provider-json-model',
        model: 'model-json',
        prompt: 'answer as json',
        responseFormat: { type: 'json', schema: { type: 'object' } },
      })
      expect(seenBodies.at(-1)).toMatchObject({
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'result', schema: { type: 'object' } },
        },
      })
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error == null ? resolve() : reject(error))),
      )
    }
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
