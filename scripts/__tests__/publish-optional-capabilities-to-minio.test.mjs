import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'
import { publishOptionalCapabilities } from '../publish-optional-capabilities-to-minio.mjs'

const cleanups = []

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()))
})

test('rejects a local archive whose size or SHA differs before remote mutation', async () => {
  const fixture = await createFixture()
  fixture.entry.sha256 = '0'.repeat(64)
  await writeFile(fixture.manifestPath, JSON.stringify(fixture.entry))

  await assert.rejects(
    publishOptionalCapabilities({
      artifacts: [fixture],
      config: invalidButCompleteConfig(),
    }),
    /本地制品与发布清单不一致/,
  )
})

test('rejects an existing artifact ID with conflicting immutable metadata', async () => {
  const fixture = await createFixture()
  const repository = await createRepository({
    artifacts: [{ ...fixture.entry, sha256: 'f'.repeat(64) }],
  })

  await assert.rejects(
    publishOptionalCapabilities({
      artifacts: [fixture],
      config: repository.config,
    }),
    /正式清单包含冲突制品/,
  )
  assert.equal(
    repository.events.some((event) => event.method === 'PUT'),
    false,
  )
})

test('backs up, uploads, publicly hashes, stages and audits before replacing index', async () => {
  const fixture = await createFixture()
  const repository = await createRepository({ artifacts: [] })

  const result = await publishOptionalCapabilities({
    artifacts: [fixture],
    config: repository.config,
    now: () => new Date('2026-08-02T05:00:00.000Z'),
  })

  assert.deepEqual(result.artifacts, [
    {
      id: fixture.entry.id,
      size: fixture.entry.size,
      sha256: fixture.entry.sha256,
      url: fixture.entry.url,
    },
  ])
  const mutations = repository.events
    .filter((event) => event.method === 'PUT')
    .map((event) => event.key)
  assert.match(mutations[0], /^artifact-repository\/v1\/backups\/index-/)
  assert.equal(mutations[1], `artifact-repository/v1/${fixture.entry.url}`)
  assert.match(mutations[2], /^artifact-repository\/v1\/staging\/index-optional-/)
  assert.equal(mutations[3], 'artifact-repository/v1/index.json')

  const publicArtifactGets = repository.events.filter(
    (event) =>
      event.method === 'GET' && event.key === `artifact-repository/v1/${fixture.entry.url}`,
  )
  assert.equal(publicArtifactGets.length, 2)
  const stagingPut = repository.events.findIndex(
    (event) => event.method === 'PUT' && event.key.includes('/staging/'),
  )
  const formalPut = repository.events.findIndex(
    (event) => event.method === 'PUT' && event.key.endsWith('/index.json'),
  )
  const stagingAudit = repository.events.findIndex(
    (event) => event.method === 'GET' && event.key.includes('/staging/'),
  )
  assert.ok(stagingPut < stagingAudit && stagingAudit < formalPut)
})

async function createFixture() {
  const directory = await mkdtemp(join(os.tmpdir(), 'optional-publisher-'))
  cleanups.push(() => rm(directory, { recursive: true, force: true }))
  const archivePath = join(directory, 'office-viewer-2.2.3-1.tar.gz')
  const bytes = Buffer.from('deterministic optional office archive')
  await writeFile(archivePath, bytes)
  const entry = {
    id: 'archive.optional-office-viewer-2.2.3-1',
    type: 'archive',
    name: 'Offline Office Viewer 2.2.3-1',
    version: '2.2.3-1',
    platform: 'any',
    arch: 'any',
    url: 'dependencies/office-viewer/office-viewer-2.2.3-1.tar.gz',
    sha256: createHash('sha256').update(bytes).digest('hex'),
    size: bytes.length,
    archive: { format: 'tar.gz', contentRoot: '.' },
  }
  const manifestPath = join(directory, 'manifest.json')
  await writeFile(manifestPath, JSON.stringify(entry))
  return { manifestPath, archivePath, entry }
}

async function createRepository(initialManifest) {
  const objects = new Map()
  const metadata = new Map()
  const events = []
  const server = http.createServer(async (request, response) => {
    const path = new URL(request.url, 'http://localhost').pathname
    const isSigned = path.startsWith('/bucket/')
    const prefix = isSigned ? '/bucket/' : '/public/'
    const key = decodePath(path.slice(prefix.length))
    events.push({ method: request.method, key })
    if (request.method === 'PUT' && isSigned) {
      const body = Buffer.concat(await Array.fromAsync(request))
      objects.set(key, body)
      metadata.set(key, String(request.headers['x-amz-meta-sha256'] ?? ''))
      response.writeHead(200).end()
      return
    }
    const body = objects.get(key)
    if (!body) {
      response.writeHead(404).end()
      return
    }
    response.setHeader('content-length', String(body.length))
    if (metadata.has(key)) response.setHeader('x-amz-meta-sha256', metadata.get(key))
    response.writeHead(200)
    response.end(request.method === 'HEAD' ? undefined : body)
  })
  await new Promise((resolveServer) => server.listen(0, '127.0.0.1', resolveServer))
  cleanups.push(() => new Promise((resolveServer) => server.close(resolveServer)))
  const port = server.address().port
  const publicBaseUrl = `http://127.0.0.1:${port}/public`
  const manifest = {
    schemaVersion: 1,
    updatedAt: '2026-08-01',
    baseUrl: `${publicBaseUrl}/artifact-repository/v1`,
    ...initialManifest,
  }
  objects.set('artifact-repository/v1/index.json', Buffer.from(JSON.stringify(manifest)))
  return {
    events,
    config: {
      endpoint: `http://127.0.0.1:${port}`,
      bucket: 'bucket',
      accessKeyId: 'test-access-key',
      secretAccessKey: 'test-secret-key',
      publicBaseUrl,
      allowInsecureHttp: true,
    },
  }
}

function invalidButCompleteConfig() {
  return {
    endpoint: 'http://127.0.0.1:9',
    bucket: 'bucket',
    accessKeyId: 'test',
    secretAccessKey: 'test',
    publicBaseUrl: 'http://127.0.0.1:9/public',
    allowInsecureHttp: true,
  }
}

function decodePath(path) {
  return path
    .split('/')
    .map((segment) => decodeURIComponent(segment))
    .join('/')
}
