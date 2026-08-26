import { createHash } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  discoverReleaseArtifacts,
  PublishError,
  publishRelease,
  resolvePublishConfig,
  resolveRemoteBase,
  signRequest,
} from '../../scripts/publish-release-to-minio.mjs'
import {
  parseRemoteManifest,
  resolveVerifyBase,
  run as runVerify,
} from '../../scripts/verify-release.mjs'

const roots: string[] = []
const closers: (() => Promise<void>)[] = []

afterEach(async () => {
  for (const close of closers.splice(0)) await close()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

function sha256Hex(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

describe('SigV4 signer', () => {
  // Published example from the AWS SigV4 documentation (GET Object with a
  // range header); guards the canonical request, string-to-sign, and key
  // derivation against regressions.
  it('reproduces the AWS documented GET-object signature', () => {
    const signed = signRequest(
      {
        method: 'GET',
        endpointUrl: new URL('https://examplebucket.s3.amazonaws.com'),
        key: 'test.txt',
        headers: { range: 'bytes=0-9' },
      },
      {
        accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
        secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
        region: 'us-east-1',
        bucket: '',
      },
      new Date('2013-05-24T00:00:00.000Z'),
    )
    expect(signed.path).toBe('/test.txt')
    expect(signed.headers.Authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, ' +
        'SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, ' +
        'Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
    )
  })

  it('uses path-style addressing for bucketed keys', () => {
    const signed = signRequest(
      { method: 'HEAD', endpointUrl: new URL('http://127.0.0.1:9000'), key: 'spark-cli/v1/x.tgz' },
      { accessKeyId: 'a', secretAccessKey: 'b', region: 'us-east-1', bucket: 'spark-desktop' },
      new Date('2026-08-26T00:00:00.000Z'),
    )
    expect(signed.path).toBe('/spark-desktop/spark-cli/v1/x.tgz')
  })
})

describe('resolvePublishConfig', () => {
  const fullEnv = {
    MINIO_IP: '10.0.0.8',
    MINIO_PORT_API: '9000',
    MINIO_ID: 'id-value',
    MINIO_PWD: 'pwd-value',
    MINIO_BUCKET: 'spark-desktop',
    BUCKET_BASE_URL: 'https://minio.yiqibyte.com/spark-desktop',
  } as NodeJS.ProcessEnv

  it('reports every missing variable together and never leaks values', () => {
    expect(() => resolvePublishConfig({ MINIO_ID: 'x' })).toThrow(
      /MINIO_IP, MINIO_PORT_API, MINIO_PWD, MINIO_BUCKET, BUCKET_BASE_URL/u,
    )
    try {
      resolvePublishConfig({ MINIO_ID: 'x' })
    } catch (error) {
      expect((error as Error).message).not.toContain('x')
    }
  })

  it('builds the S3 endpoint from host+port with an optional https prefix', () => {
    const plain = resolvePublishConfig(fullEnv)
    expect(plain.endpointUrl.href).toBe('http://10.0.0.8:9000/')
    expect(plain.bucket).toBe('spark-desktop')
    const tls = resolvePublishConfig({
      ...fullEnv,
      MINIO_IP: 'https://minio.internal.example',
    })
    expect(tls.endpointUrl.protocol).toBe('https:')
  })

  it('rejects a non-https public base outside loopback', () => {
    expect(() =>
      resolvePublishConfig({
        ...fullEnv,
        BUCKET_BASE_URL: 'http://minio.yiqibyte.com/spark-desktop',
      }),
    ).toThrow(/must be https/u)
  })
})

describe('resolveRemoteBase', () => {
  const config = { publicBaseUrl: new URL('https://minio.yiqibyte.com/spark-desktop') }

  it('defaults to spark-cli/v1 under the bucket base and strips the bucket path from keys', () => {
    const resolved = resolveRemoteBase({ config, baseOverride: undefined })
    expect(resolved.url.href).toBe('https://minio.yiqibyte.com/spark-desktop/spark-cli/v1')
    expect(resolved.keyPrefix).toBe('spark-cli/v1')
  })

  it('keeps an explicit --base within the bucket and honors its suffix', () => {
    expect(
      resolveRemoteBase({
        config,
        baseOverride: 'https://minio.yiqibyte.com/spark-desktop/channel/rc',
      }).keyPrefix,
    ).toBe('channel/rc')
    expect(() =>
      resolveRemoteBase({ config, baseOverride: 'https://minio.yiqibyte.com/elsewhere' }),
    ).toThrow(/must live under/u)
  })
})

describe('discoverReleaseArtifacts', () => {
  it('validates manifest, tarball hash, sidecar pairing, and installers', async () => {
    const fixture = await releaseFixture()
    const discovered = await discoverReleaseArtifacts(fixture.releaseDir)
    expect(discovered.manifest.version).toBe('0.2.0')
    expect(discovered.artifacts.map(({ filename }) => filename)).toEqual([
      'spark-agent-0.2.0.tgz',
      'spark-agent-0.2.0.tgz.sha256',
      'install.sh',
      'install.ps1',
      'install.cmd',
    ])
    expect(discovered.artifacts[0]?.sha256).toBe(fixture.tarballSha256)
  })

  it('fails closed on a missing installer or a disagreeing sidecar', async () => {
    const fixture = await releaseFixture()
    await rm(join(fixture.releaseDir, 'install.ps1'))
    await expect(discoverReleaseArtifacts(fixture.releaseDir)).rejects.toThrow(
      /install\.ps1 is missing/u,
    )

    const second = await releaseFixture()
    await writeFile(
      join(second.releaseDir, 'spark-agent-0.2.0.tgz.sha256'),
      `${'a'.repeat(64)}  spark-agent-0.2.0.tgz\n`,
      'utf8',
    )
    await expect(discoverReleaseArtifacts(second.releaseDir)).rejects.toThrow(PublishError)
  })

  it('rejects manifests with foreign package names', async () => {
    const fixture = await releaseFixture()
    await writeFile(
      join(fixture.releaseDir, 'latest.json'),
      JSON.stringify({
        name: '@other/pkg',
        version: '0.2.0',
        sha256: fixture.tarballSha256,
        tarball: 'spark-agent-0.2.0.tgz',
      }),
      'utf8',
    )
    await expect(discoverReleaseArtifacts(fixture.releaseDir)).rejects.toThrow(/name must be/u)
  })
})

describe('publishRelease against a MinIO-shaped server', () => {
  it('uploads immutables, verifies read-back, then publishes latest.json last', async () => {
    const store = new Map<string, Buffer>()
    const writes: string[] = []
    const { baseUrl, close } = await serveS3(store, writes)
    const fixture = await releaseFixture()
    const discovered = await discoverReleaseArtifacts(fixture.releaseDir)
    const remoteBase = {
      url: new URL(`${baseUrl}/spark-desktop/spark-cli/v1`),
      keyPrefix: 'spark-cli/v1',
    }

    const result = await publishRelease({ config: fakeConfig(baseUrl), remoteBase, ...discovered })
    expect(result.uploaded).toContain('spark-agent-0.2.0.tgz')

    const expectedKeys = [
      'spark-desktop/spark-cli/v1/install.cmd',
      'spark-desktop/spark-cli/v1/install.ps1',
      'spark-desktop/spark-cli/v1/install.sh',
      'spark-desktop/spark-cli/v1/latest.json',
      'spark-desktop/spark-cli/v1/spark-agent-0.2.0.tgz',
      'spark-desktop/spark-cli/v1/spark-agent-0.2.0.tgz.sha256',
    ]
    expect([...store.keys()].sort()).toEqual(expectedKeys)

    // The mutable pointer must be written after every immutable artifact.
    const pointerIndex = writes.indexOf('spark-desktop/spark-cli/v1/latest.json')
    expect(pointerIndex).toBeGreaterThanOrEqual(0)
    expect(pointerIndex).toBe(writes.length - 1)

    // Republishing identical bytes rewrites only the mutable latest.json.
    const writesBefore = writes.length
    const again = await publishRelease({ config: fakeConfig(baseUrl), remoteBase, ...discovered })
    expect(again.uploaded).toEqual([])
    expect(again.skipped).toHaveLength(5)
    expect(writes.length).toBe(writesBefore + 1)
    expect(writes[writes.length - 1]!).toBe('spark-desktop/spark-cli/v1/latest.json')

    await close()
  })

  it('aborts before any write when an immutable artifact conflicts remotely', async () => {
    const store = new Map<string, Buffer>()
    const writes: string[] = []
    const { baseUrl, close } = await serveS3(store, writes)
    const fixture = await releaseFixture()
    const discovered = await discoverReleaseArtifacts(fixture.releaseDir)
    store.set(
      'spark-desktop/spark-cli/v1/spark-agent-0.2.0.tgz.sha256',
      Buffer.from('attacker-controlled', 'utf8'),
    )

    await expect(
      publishRelease({
        config: fakeConfig(baseUrl),
        remoteBase: {
          url: new URL(`${baseUrl}/spark-desktop/spark-cli/v1`),
          keyPrefix: 'spark-cli/v1',
        },
        ...discovered,
      }),
    ).rejects.toThrow(/immutable|already exists/u)
    expect(writes).toEqual([])
    expect([...store.keys()]).toHaveLength(1)
    await close()
  })

  it('dry-run validates locally, touches no network, and needs no credentials', async () => {
    const fixture = await releaseFixture()
    const discovered = await discoverReleaseArtifacts(fixture.releaseDir)
    const lines: string[] = []
    const result = await publishRelease({
      config: undefined,
      remoteBase: {
        url: new URL('https://minio.yiqibyte.com/spark-desktop/spark-cli/v1'),
        keyPrefix: 'spark-cli/v1',
      },
      ...discovered,
      dryRun: true,
      log: (text) => lines.push(text),
    })
    expect(result.uploaded).toEqual([])
    const output = lines.join('\n')
    expect(output).toContain('[dry-run] no changes were made')
    expect(output).toContain('audit → upload missing only → verify read-back → latest.json last')
    expect(output).toContain(`sha256 ${fixture.tarballSha256}`)
  })
})

describe('verify-release helpers', () => {
  it('parses strict manifests and resolves the base precedence chain', () => {
    const manifest = parseRemoteManifest(
      JSON.stringify({
        name: '@spark/agent',
        version: '1.0.0-rc.1',
        sha256: 'c'.repeat(64),
        tarball: 'spark-agent-1.0.0-rc.1.tgz',
      }),
    )
    expect(manifest.version).toBe('1.0.0-rc.1')
    expect(() => parseRemoteManifest('{"name":"@spark/agent"}')).toThrow(/version must be/u)
    // Strict SemVer parity with the TS runtime: zero-padded cores are refused.
    expect(() =>
      parseRemoteManifest(
        JSON.stringify({
          name: '@spark/agent',
          version: '01.2.3',
          sha256: 'c'.repeat(64),
          tarball: 'spark-agent-01.2.3.tgz',
        }),
      ),
    ).toThrow(/strict SemVer/u)
    // publishedAt is validated too (the duplicated pre-contract copy skipped it).
    expect(() =>
      parseRemoteManifest(
        JSON.stringify({
          name: '@spark/agent',
          version: '1.2.3',
          sha256: 'c'.repeat(64),
          tarball: 'spark-agent-1.2.3.tgz',
          publishedAt: 'yesterday',
        }),
      ),
    ).toThrow(/ISO 8601/u)

    expect(resolveVerifyBase({ env: {} })).toMatch(/^https:\/\/minio\.yiqibyte\.com\//u)
    expect(resolveVerifyBase({ env: { SPARK_RELEASE_BASE: 'https://flag.example/base/' } })).toBe(
      'https://flag.example/base',
    )
    expect(
      resolveVerifyBase({
        env: {
          SPARK_INSTALL_BASE: 'https://env2.example/b',
          SPARK_RELEASE_BASE: 'https://env1.example/b',
        },
      }),
    ).toBe('https://env1.example/b')
    expect(
      resolveVerifyBase({ env: { BUCKET_BASE_URL: 'https://minio.yiqibyte.com/spark-desktop' } }),
    ).toBe('https://minio.yiqibyte.com/spark-desktop/spark-cli/v1')
  })

  it('runs end to end against a local static server, failing on tampered bytes', async () => {
    const fixture = await releaseFixture()
    // Keys are stored path-style WITHOUT the leading slash, matching how the
    // raw server routes requests.
    const files = new Map<string, Buffer>()
    files.set('latest.json', await readFile(join(fixture.releaseDir, 'latest.json')))
    files.set('spark-agent-0.2.0.tgz', Buffer.from('tampered', 'utf8'))
    files.set(
      'spark-agent-0.2.0.tgz.sha256',
      Buffer.from(`${fixture.tarballSha256}  spark-agent-0.2.0.tgz\n`, 'utf8'),
    )
    for (const name of ['install.sh', 'install.ps1', 'install.cmd']) {
      files.set(name, Buffer.from(`# ${name}\n`, 'utf8'))
    }
    const { baseUrl, close } = await serveFiles(files)
    closers.push(close)

    const lines: string[] = []
    const collect = (text: string) => lines.push(text)

    // Tampered tarball content versus manifest sha256 fails with exit code 1.
    expect(await runVerify(['--base', baseUrl], collect)).toBe(1)
    expect(lines.join('\n')).toContain('✗ tarball sha256')
    expect(lines.join('\n')).toContain('FAILED:')
    expect(lines.join('\n')).not.toContain('OK:')

    // The same server with true bytes passes, including local cross-checks.
    lines.length = 0
    files.set('spark-agent-0.2.0.tgz', Buffer.from('tarball-bytes', 'utf8'))
    expect(await runVerify([fixture.releaseDir, '--base', baseUrl], collect)).toBe(0)
    expect(lines.join('\n')).toContain(`OK:`)
    expect(lines.join('\n')).toContain('local copy identical: install.sh')
  }, 30_000)
})

function fakeConfig(baseUrl: string) {
  return {
    endpointUrl: new URL(baseUrl),
    region: 'us-east-1',
    accessKeyId: 'test-id',
    secretAccessKey: 'test-secret',
    bucket: 'spark-desktop',
    publicBaseUrl: new URL(baseUrl),
  }
}

/** Minimal stand-in for MinIO: stores by path, echoes x-amz-meta-sha256. */
async function serveS3(
  store: Map<string, Buffer>,
  writes: string[],
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  return serveRaw(store, writes)
}

async function serveFiles(
  files: Map<string, Buffer>,
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  return serveRaw(files, [])
}

async function serveRaw(
  store: Map<string, Buffer>,
  writes: string[],
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const server: Server = createServer((request, response) => {
    void (async () => {
      const path = decodeURIComponent((request.url ?? '').replace(/\?.*$/u, '')).replace(/^\//u, '')
      if (!path) {
        response.writeHead(400).end()
        return
      }
      if (request.method === 'PUT') {
        const chunks: Uint8Array[] = []
        for await (const chunk of request as AsyncIterable<string | Uint8Array>) {
          chunks.push(
            typeof chunk === 'string' ? new TextEncoder().encode(chunk) : Uint8Array.from(chunk),
          )
        }
        const body = Buffer.concat(chunks)
        store.set(path, body)
        writes.push(path)
        response.writeHead(200).end()
        return
      }
      const body = store.get(path)
      if (body === undefined) {
        response.writeHead(404).end()
        return
      }
      if (request.method === 'HEAD') {
        response
          .writeHead(200, {
            'content-length': String(body.length),
            'x-amz-meta-sha256': sha256Hex(body),
          })
          .end()
        return
      }
      response.writeHead(200, { 'content-length': String(body.length) }).end(body)
    })().catch(() => {
      response.writeHead(500).end()
    })
  })
  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('test server failed to bind')
  const close = () =>
    new Promise<void>((resolveClose) => {
      server.close(() => {
        resolveClose()
      })
    })
  return { baseUrl: `http://127.0.0.1:${address.port}`, close }
}

interface ReleaseFixtureResult {
  readonly releaseDir: string
  readonly tarballSha256: string
}

async function releaseFixture(): Promise<ReleaseFixtureResult> {
  const root = await mkdtemp(join(tmpdir(), 'spark-release-pub-'))
  roots.push(root)
  const releaseDir = join(root, 'release')
  await mkdir(releaseDir, { recursive: true })
  const bytes = Buffer.from('tarball-bytes', 'utf8')
  const sha = sha256Hex(bytes)
  await writeFile(join(releaseDir, 'spark-agent-0.2.0.tgz'), bytes)
  await writeFile(
    join(releaseDir, 'spark-agent-0.2.0.tgz.sha256'),
    `${sha}  spark-agent-0.2.0.tgz\n`,
  )
  await writeFile(
    join(releaseDir, 'latest.json'),
    `${JSON.stringify(
      {
        name: '@spark/agent',
        version: '0.2.0',
        sha256: sha,
        tarball: 'spark-agent-0.2.0.tgz',
        publishedAt: '2026-08-26T12:00:00.000Z',
      },
      null,
      2,
    )}\n`,
  )
  for (const name of ['install.sh', 'install.ps1', 'install.cmd']) {
    await writeFile(join(releaseDir, name), `# ${name}\n`)
  }
  return { releaseDir, tarballSha256: sha }
}
