import { createServer, type Server } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  ConnectorConnectionRepository,
  SparkDatabase,
  SubAppPackageService,
  SubAppPlatformRepository,
  SubAppRepository,
} from '@spark/storage'
import { SubAppNetworkGateway } from '../SubAppNetworkGateway.js'

describe('SubAppNetworkGateway', () => {
  let root = ''
  let db: SparkDatabase | undefined
  let server: Server | undefined
  let origin = ''

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'spark-sub-app-network-'))
    db = new SparkDatabase(join(root, 'test.db'))
    db.runMigrations(
      fileURLToPath(new URL('../../../../../../packages/storage/migrations', import.meta.url)),
    )
    server = createServer((request, response) => {
      response.setHeader('content-type', 'application/json')
      response.end(
        JSON.stringify({ path: request.url, authorization: request.headers.authorization ?? null }),
      )
    })
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (address == null || typeof address === 'string') throw new Error('missing server address')
    origin = `http://127.0.0.1:${address.port}`
  })

  afterEach(async () => {
    if (server != null) await new Promise<void>((resolve) => server!.close(() => resolve()))
    db?.close()
    rmSync(root, { recursive: true, force: true })
  })

  it('allows an explicitly declared and granted private-network connection', async () => {
    const app = await createNetworkApp(db!, origin, true)
    const gateway = new SubAppNetworkGateway(db!)
    await expect(
      gateway.request({ appId: app, slot: 'api', path: '/items' }),
    ).resolves.toMatchObject({
      ok: true,
      body: { path: '/items', authorization: null },
    })
  })

  it('blocks a private target unless both manifest and binding grant it', async () => {
    const app = await createNetworkApp(db!, origin, false)
    const gateway = new SubAppNetworkGateway(db!)
    await expect(gateway.request({ appId: app, slot: 'api', path: '/items' })).rejects.toThrow(
      '私网地址',
    )
  })
})

async function createNetworkApp(db: SparkDatabase, origin: string, allowPrivateNetwork: boolean) {
  const packages = new SubAppPackageService(db)
  const created = await packages.scaffold({ name: 'Network' })
  const manifestFile = await packages.readFile(created.appId, 'spark-app.json')
  const manifest = JSON.parse(manifestFile.content) as Record<string, unknown>
  manifest.permissions = {
    sparkCapabilities: ['data', 'network'],
    osEffects: ['network'],
    connections: ['api'],
  }
  manifest.connections = {
    api: {
      kind: 'http-api',
      displayName: 'Test API',
      allowedOrigins: [origin],
      allowPrivateNetwork,
    },
  }
  const updated = await packages.writeFile({
    appId: created.appId,
    expectedDraftRevision: created.draftRevision,
    filePath: 'spark-app.json',
    content: JSON.stringify(manifest),
  })
  await packages.publish(created.appId, updated.revision)
  new SubAppRepository(db).setEnabled(created.appId, true)
  const connectionId = '22222222-2222-4222-8222-222222222222'
  new ConnectorConnectionRepository(db).create({
    id: connectionId,
    provider: 'generic-http',
    name: 'Test API',
    authMethod: 'none',
    status: 'connected',
    config: { baseUrl: origin },
  })
  new SubAppPlatformRepository(db).upsertBinding({
    appId: created.appId,
    slot: 'api',
    bindingKind: 'api-connection',
    bindingId: connectionId,
    grantedOrigins: [origin],
    allowPrivateNetwork,
  })
  return created.appId
}
