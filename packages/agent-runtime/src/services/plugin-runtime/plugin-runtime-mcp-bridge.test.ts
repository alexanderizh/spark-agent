import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { PluginRepository, createDatabase, type SparkDatabase } from '@spark/storage'
import { PluginRuntimeMcpBridge } from './plugin-runtime-mcp-bridge.js'
import { RuntimeBroker } from './runtime-broker.js'
import { RuntimeTokenService } from './token-service.js'
import { registerBuiltinRuntimeAdapters } from './builtin-runtimes.js'

let database: SparkDatabase | undefined
let root: string | undefined
let bridge: PluginRuntimeMcpBridge | undefined

afterEach(async () => {
  await bridge?.dispose()
  database?.close()
  if (root != null) await rm(root, { recursive: true, force: true })
  bridge = undefined
  database = undefined
  root = undefined
})

describe('PluginRuntimeMcpBridge', () => {
  it('exposes a connected Obsidian runtime through the same MCP contract used by Agent consumers', async () => {
    root = await mkdtemp(join(tmpdir(), 'spark-plugin-mcp-'))
    await writeFile(join(root, 'brief.md'), '# Runtime\nMCP bridge works', 'utf8')
    database = createDatabase(':memory:')
    new PluginRepository(database).upsert({
      id: 'spark.obsidian',
      version: '1.0.0',
      displayName: 'Obsidian Vault',
      description: 'test',
      authorName: 'Spark',
      manifestJson: '{}',
      installPath: 'builtin://spark.obsidian',
      source: 'bundled',
      enabled: true,
      state: 'installed',
      trust: 'bundled',
      integritySha256: 'test',
    })
    const broker = new RuntimeBroker({
      db: database,
      tokenService: new RuntimeTokenService({
        get: async () => null,
        set: async () => undefined,
        delete: async () => true,
      }),
    })
    registerBuiltinRuntimeAdapters(broker)
    await broker.connect('obsidian', { authMethod: 'none', config: { vaultPath: root } })
    bridge = new PluginRuntimeMcpBridge(broker)
    const handle = await bridge.serve()
    expect(handle).not.toBeNull()
    if (handle == null) return
    const url = handle.config.url
    if (url == null) throw new Error('MCP bridge did not return a URL')
    const headers = handle.config.headers ?? {}

    const unauthorised = await fetch(url, { method: 'GET' })
    expect(unauthorised.status).toBe(401)

    const transport = new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers },
    })
    const client = new Client({ name: 'plugin-runtime-test', version: '1.0.0' })
    await client.connect(transport as unknown as Transport)
    const tools = await client.listTools()
    expect(tools.tools.map((tool) => tool.name)).toContain('obsidian_search_notes')
    const result = await client.callTool({
      name: 'obsidian_search_notes',
      arguments: { query: 'MCP bridge' },
    })
    expect(JSON.stringify(result)).toContain('brief.md')
    await client.close()

    await handle.close()
    const revoked = await fetch(url, {
      method: 'GET',
      headers,
    })
    expect(revoked.status).toBe(401)
  })
})
