import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDatabase } from '@spark/storage'
import { PluginManager, PluginPermissionError } from './plugin-manager.service.js'

const roots: string[] = []

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function createPluginRoot() {
  const root = await mkdtemp(join(tmpdir(), 'spark-plugin-manager-test-'))
  roots.push(root)
  await mkdir(join(root, 'skills', 'demo'), { recursive: true })
  await writeFile(join(root, 'skills', 'demo', 'SKILL.md'), '# Demo\n', 'utf8')
  await writeFile(
    join(root, 'plugin.json'),
    JSON.stringify({
      schemaVersion: 1,
      id: 'acme.manager',
      version: '1.0.0',
      displayName: 'Manager',
      description: 'Manager test plugin',
      author: { name: 'Acme' },
      permissions: { required: ['network'], optional: [] },
      activation: 'manual',
      contributions: {
        skills: [{ id: 'demo', path: 'skills/demo' }],
        mcpServers: [
          { id: 'demo', name: 'Demo MCP', config: { command: 'node', args: ['server.js'] } },
        ],
        connectors: [],
      },
    }),
    'utf8',
  )
  return root
}

describe('PluginManager', () => {
  it('keeps unapproved plugins blocked and activates owned resources after consent', async () => {
    const database = createDatabase(':memory:')
    const packageRoot = await createPluginRoot()
    const pluginRoot = await mkdtemp(join(tmpdir(), 'spark-plugin-installed-'))
    roots.push(pluginRoot)
    const manager = new PluginManager({ db: database, pluginRoot })
    await manager.initialize()

    const blocked = await manager.installLocal(packageRoot, [], false)
    expect(blocked.enabled).toBe(false)
    await expect(manager.setEnabled(blocked.id, true)).rejects.toBeInstanceOf(PluginPermissionError)

    const granted = await manager.setPermission(blocked.id, 'network', 'granted')
    expect(granted.enabled).toBe(false)
    const active = await manager.setEnabled(blocked.id, true)
    expect(active.enabled).toBe(true)
    expect(active.contributionCounts).toEqual({ skills: 1, mcpServers: 1, connectors: 0 })

    const inactive = await manager.setEnabled(blocked.id, false)
    expect(inactive.enabled).toBe(false)
    expect(manager.list(false).filter((item) => item.id === blocked.id)).toHaveLength(0)
    expect(await manager.uninstall(blocked.id)).toBe(true)
    database.close()
  })

  it('only marks marketplace packages verified with a trusted Ed25519 signature', async () => {
    const database = createDatabase(':memory:')
    const pluginRoot = await mkdtemp(join(tmpdir(), 'spark-plugin-market-test-'))
    roots.push(pluginRoot)
    const manager = new PluginManager({ db: database, pluginRoot })
    await manager.initialize()
    expect(manager.listMarketplaces().find((item) => item.id === 'spark-official')).toMatchObject({
      enabled: false,
      configured: false,
    })
    const { publicKey, privateKey } = generateKeyPairSync('ed25519')
    const publicKeyDer = publicKey.export({ format: 'der', type: 'spki' })
    const fingerprint = createHash('sha256').update(publicKeyDer).digest('hex')
    const packageSha256 = 'a'.repeat(64)
    const signature = sign(
      null,
      Buffer.from(`acme.signed\n1.0.0\n${packageSha256}`),
      privateKey,
    ).toString('base64')
    manager.repository.updateRegistry('spark-official', {
      enabled: true,
      trustedKeyFingerprintsJson: JSON.stringify([fingerprint]),
    })
    expect(manager.listMarketplaces().find((item) => item.id === 'spark-official')).toMatchObject({
      configured: true,
    })
    database.raw
      .prepare(
        `INSERT INTO plugin_registries
          (id, name, description, api_base_url, enabled, trusted_key_fingerprints_json, config_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run('mirror', 'Mirror', 'Mirror registry', 'https://mirror.example.test/v1', 1, '[]', '{}')
    const marketplacePayload = JSON.stringify({
      plugins: [
        {
          id: 'acme.signed',
          version: '1.0.0',
          displayName: 'Signed',
          description: 'Signed plugin',
          author: 'Acme',
          packageUrl: 'https://plugins.example.test/acme.signed.tar',
          packageSha256,
          requiredPermissions: [],
          signature,
          signingKey: publicKeyDer.toString('base64'),
        },
      ],
      total: 1,
    })
    vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
      Promise.resolve(
        new Response(marketplacePayload, {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ),
    )

    const result = await manager.searchMarketplace({ query: '' })
    expect(result.plugins).toHaveLength(1)
    expect(result.total).toBe(1)
    expect(result.plugins[0]?.marketplaceId).toBe('spark-official')
    expect(result.plugins[0]?.trust).toBe('verified')
    database.close()
  })

  it('seeds GitHub as a bundled capability package and gates its runtime lifecycle', async () => {
    const database = createDatabase(':memory:')
    const pluginRoot = await mkdtemp(join(tmpdir(), 'spark-plugin-builtin-test-'))
    roots.push(pluginRoot)
    const manager = new PluginManager({ db: database, pluginRoot })
    await manager.initialize()

    const github = manager.list(true).find((item) => item.id === 'spark.github')
    expect(github).toMatchObject({
      id: 'spark.github',
      source: 'bundled',
      trust: 'bundled',
      enabled: true,
      runtimeId: 'github',
      contributionCounts: { connectors: 1 },
    })
    expect(manager.isRuntimeEnabled('github')).toBe(true)
    expect(manager.repository.listResources('spark.github')).toEqual(
      expect.arrayContaining([expect.objectContaining({ resource_type: 'connector', enabled: 1 })]),
    )

    await manager.setEnabled('spark.github', false)
    expect(manager.isRuntimeEnabled('github')).toBe(false)
    expect(
      manager.repository.listResources('spark.github').every((resource) => resource.enabled === 0),
    ).toBe(true)
    await expect(manager.uninstall('spark.github')).rejects.toThrow('内置能力包不能移除')
    database.close()
  })
})
