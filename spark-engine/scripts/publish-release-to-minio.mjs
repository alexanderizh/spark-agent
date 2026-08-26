#!/usr/bin/env node

// Publishes the directory produced by scripts/prepare-release.mjs to the
// self-hosted MinIO artifact host:
//
//   node scripts/publish-release-to-minio.mjs [release-dir] [--base <url>] [--dry-run]
//
// Configuration comes only from the environment (never flags, never files):
//
//   MINIO_IP         S3 API host, optionally with an https:// prefix
//   MINIO_PORT_API   S3 API port
//   MINIO_ID         access key id
//   MINIO_PWD        secret access key
//   MINIO_BUCKET     bucket name
//   BUCKET_BASE_URL  public https base of the bucket — what installers read
//
// Contract (mirrors prepare-release.mjs):
// - The versioned tarball, its .sha256 sidecar, and the three installers are
//   IMMUTABLE. Remote objects are audited first; an existing object with
//   different bytes aborts the run before anything is uploaded, an identical
//   object is skipped (idempotent republish).
// - latest.json is the only mutable pointer and is published strictly LAST,
//   after every immutable artifact passed authenticated AND public read-back
//   verification. A failed run can never expose a partial release as "latest".
// - --dry-run validates the release directory locally and prints the plan;
//   it never touches the network (MinIO credentials are not required).

import { createHash, createHmac } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import http from 'node:http'
import https from 'node:https'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// Shared, dependency-free release contract: base URL constant, strict SemVer,
// and the latest.json schema — see scripts/release-contract.mjs.
import { DEFAULT_RELEASE_BASE, INSTALLER_NAMES, parseReleaseManifest } from './release-contract.mjs'

// Re-exported for consumers of this module's public surface.
export { DEFAULT_RELEASE_BASE }
const HARD_CAP_BYTES = 512 * 1024 * 1024
const REQUEST_TIMEOUT_MS = 5 * 60 * 1000

export class PublishError extends Error {
  constructor(message, options = {}) {
    super(message)
    this.name = 'PublishError'
    if (options.status !== undefined) this.status = options.status
  }
}

function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

/**
 * Minimal AWS Signature V4 for path-style S3 requests against MinIO
 * (node:crypto only, so spark-engine stays dependency-free).
 */
export function signRequest(request, credentials, clock = new Date()) {
  const amzDate = clock
    .toISOString()
    .replace(/[-:]/gu, '')
    .replace(/\.\d{3}/gu, '')
  const dateStamp = amzDate.slice(0, 8)
  // Path-style S3: /<bucket>/<key…>. Empty segments collapse, which also lets
  // the AWS published SigV4 vectors (virtual-host style) exercise this signer.
  const segments = [credentials.bucket, ...(request.key ?? '').split('/')].filter(Boolean)
  const encodedUri = `/${segments.map(encodeSegment).join('/')}`
  const payloadHash = request.payloadHash ?? sha256Hex(Buffer.alloc(0))

  const headers = {
    host: request.endpointUrl.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    ...(request.headers ?? {}),
  }
  // Every key above is authored lowercase in this script, so plain sort gives
  // the SigV4 canonical form directly.
  const sortedNames = Object.keys(headers).sort()
  const canonicalHeaders = sortedNames
    .map((name) => `${name}:${String(headers[name]).trim()}\n`)
    .join('')
  const signedHeaders = sortedNames.join(';')
  const canonicalRequest = [
    request.method.toUpperCase(),
    encodedUri,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n')

  const scope = `${dateStamp}/${credentials.region}/s3/aws4_request`
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    sha256Hex(Buffer.from(canonicalRequest, 'utf8')),
  ].join('\n')
  const hmac = (keyBytes, value) => createHmac('sha256', keyBytes).update(value, 'utf8').digest()
  const kSigning = hmac(
    hmac(hmac(hmac(`AWS4${credentials.secretAccessKey}`, dateStamp), credentials.region), 's3'),
    'aws4_request',
  )
  const signature = createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex')

  return {
    method: request.method.toUpperCase(),
    host: request.endpointUrl.host,
    path: encodedUri,
    headers: {
      ...headers,
      Authorization:
        `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, ` +
        `SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  }
}

/** RFC 3986 segment encoding; MinIO/Node accept this conservative subset. */
function encodeSegment(segment) {
  return encodeURIComponent(segment)
}

export function sendSigned(endpointUrl, signedRequest, writeBody = (request) => request.end()) {
  const transport = endpointUrl.protocol === 'https:' ? https : http
  return new Promise((resolveRequest, rejectRequest) => {
    const request = transport.request(
      {
        // host must stay port-free here or node resolves it as a hostname.
        hostname: endpointUrl.hostname,
        port: Number(endpointUrl.port) || (endpointUrl.protocol === 'https:' ? 443 : 80),
        method: signedRequest.method,
        path: signedRequest.path,
        headers: signedRequest.headers,
      },
      (response) => {
        const chunks = []
        response.on('data', (chunk) => chunks.push(chunk))
        response.on('end', () => {
          const status = response.statusCode ?? 0
          const body = Buffer.concat(chunks)
          if (status >= 200 && status < 300) {
            resolveRequest({ status, headers: response.headers, body })
            return
          }
          rejectRequest(
            new PublishError(
              `${signedRequest.method} ${signedRequest.path} returned HTTP ${status}: ${body.toString('utf8').slice(0, 300)}`,
              { status },
            ),
          )
        })
      },
    )
    request.on('error', rejectRequest)
    request.setTimeout(REQUEST_TIMEOUT_MS, () =>
      request.destroy(
        new PublishError(`MinIO request timed out: ${signedRequest.method} ${signedRequest.path}`),
      ),
    )
    writeBody(request)
  })
}

/**
 * Reads MINIO_IP / MINIO_PORT_API / MINIO_ID / MINIO_PWD / MINIO_BUCKET /
 * BUCKET_BASE_URL. All six are required; missing ones are reported together.
 */
export function resolvePublishConfig(env = process.env) {
  const required = [
    'MINIO_IP',
    'MINIO_PORT_API',
    'MINIO_ID',
    'MINIO_PWD',
    'MINIO_BUCKET',
    'BUCKET_BASE_URL',
  ]
  const missing = required.filter((name) => !env[name])
  if (missing.length > 0) {
    throw new PublishError(`missing required environment variables: ${missing.join(', ')}`)
  }
  const rawHost = env.MINIO_IP.replace(/^https?:\/\//iu, '')
  const scheme = /^https:\/\//iu.test(env.MINIO_IP) ? 'https:' : 'http:'
  let endpointUrl
  try {
    endpointUrl = new URL(`${scheme}//${rawHost}:${env.MINIO_PORT_API}`)
  } catch {
    throw new PublishError(
      `MINIO_IP/MINIO_PORT_API do not form a valid endpoint: ${env.MINIO_IP}:${env.MINIO_PORT_API}`,
    )
  }
  let publicBaseUrl
  try {
    publicBaseUrl = new URL(env.BUCKET_BASE_URL)
  } catch {
    throw new PublishError(`BUCKET_BASE_URL is not a valid URL: ${env.BUCKET_BASE_URL}`)
  }
  if (publicBaseUrl.protocol !== 'https:' && !isLoopbackHost(publicBaseUrl.hostname)) {
    throw new PublishError(
      `BUCKET_BASE_URL must be https (clients download releases over it), got: ${publicBaseUrl.href}`,
    )
  }
  return {
    endpointUrl,
    region: env.MINIO_REGION || 'us-east-1',
    accessKeyId: env.MINIO_ID,
    secretAccessKey: env.MINIO_PWD,
    bucket: env.MINIO_BUCKET,
    publicBaseUrl,
  }
}

function isLoopbackHost(hostname) {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]' ||
    hostname === '::1'
  )
}

/**
 * The remote release base defaults to BUCKET_BASE_URL + /spark-cli/v1 (matching
 * DEFAULT_RELEASE_BASE when BUCKET_BASE_URL points at the spark-desktop bucket);
 * any other layout requires --base. Object keys are the base path under the
 * bucket, so a mismatched combination fails here instead of uploading elsewhere.
 */
export function resolveRemoteBase({ config, baseOverride }) {
  const candidate = baseOverride ?? `${stripTrailingSlash(config.publicBaseUrl)}/spark-cli/v1`
  const url = new URL(candidate)
  if (url.protocol !== 'https:' && !isLoopbackHost(url.hostname)) {
    throw new PublishError(`release base must be https (only loopback http), got: ${candidate}`)
  }
  const publicPath = config.publicBaseUrl.pathname.replace(/\/+$/u, '')
  if (!url.pathname.startsWith(`${publicPath}/`) && url.pathname !== publicPath) {
    throw new PublishError(
      `--base ${candidate} must live under BUCKET_BASE_URL ${stripTrailingSlash(config.publicBaseUrl)}`,
    )
  }
  // Object keys live inside the bucket, so the public-URL path segment that
  // denotes the bucket itself must not be repeated in the signed key path.
  const relative = publicPath === '' ? url.pathname : url.pathname.slice(publicPath.length)
  const keyPrefix = relative.split('/').filter(Boolean).map(decodeURIComponent).join('/')
  return { url, keyPrefix }
}

/**
 * Loads and strictly re-validates the prepared release directory before any
 * network contact. Schema rules mirror parseReleaseManifest in src/cli/release.ts.
 */
export async function discoverReleaseArtifacts(releaseDir) {
  let manifestRaw
  try {
    manifestRaw = await readFile(join(releaseDir, 'latest.json'), 'utf8')
  } catch {
    throw new PublishError(
      `${releaseDir} does not contain latest.json — run scripts/prepare-release.mjs first`,
    )
  }
  const manifest = parseLocalManifest(manifestRaw)

  const filenames = [manifest.tarball, `${manifest.tarball}.sha256`, ...INSTALLER_NAMES]
  const artifacts = []
  for (const filename of filenames) {
    let bytes
    try {
      bytes = await readFile(join(releaseDir, filename))
    } catch {
      throw new PublishError(`release directory is incomplete: ${filename} is missing`)
    }
    if (bytes.length === 0) throw new PublishError(`release artifact ${filename} is empty`)
    if (bytes.length > HARD_CAP_BYTES)
      throw new PublishError(
        `release artifact ${filename} exceeds the ${HARD_CAP_BYTES} byte limit`,
      )
    artifacts.push({ filename, bytes, sha256: sha256Hex(bytes) })
  }

  const [tarball, sidecar] = artifacts
  if (tarball.sha256 !== manifest.sha256) {
    throw new PublishError(
      `tarball sha256 mismatch: latest.json says ${manifest.sha256}, local bytes hash ${tarball.sha256}`,
    )
  }
  const sidecarText = sidecar.bytes.toString('utf8')
  const match = /^([0-9a-f]{64}) {2}(.+)\n?$/u.exec(sidecarText)
  if (!match || match[1] !== manifest.sha256 || match[2] !== manifest.tarball) {
    throw new PublishError(
      `${sidecar.filename} must contain "${manifest.sha256}  ${manifest.tarball}", got: ${JSON.stringify(sidecarText.slice(0, 120))}`,
    )
  }
  return { manifest, artifacts }
}

function parseLocalManifest(raw) {
  try {
    return parseReleaseManifest(raw)
  } catch (error) {
    throw new PublishError(error instanceof Error ? error.message : String(error))
  }
}

async function headObject(config, key) {
  const signed = signRequest({ method: 'HEAD', endpointUrl: config.endpointUrl, key }, config)
  try {
    const response = await sendSigned(config.endpointUrl, signed)
    return {
      size: Number(response.headers['content-length'] ?? 0),
      sha256: String(response.headers['x-amz-meta-sha256'] ?? ''),
    }
  } catch (error) {
    if (error instanceof PublishError && error.status === 404) return undefined
    throw error
  }
}

/**
 * Two-phase publish: audit every immutable object, abort on conflict BEFORE
 * writing anything, upload what is missing, verify by authenticated and public
 * read-back, then replace latest.json last.
 */
export async function publishRelease(input) {
  const {
    config,
    remoteBase,
    artifacts,
    manifest,
    dryRun = false,
    log = (text) => process.stdout.write(text),
  } = input
  const target = stripTrailingSlash(remoteBase.url)
  const keyOf = (filename) => `${remoteBase.keyPrefix}/${filename}`
  const immutables = artifacts

  if (dryRun) {
    log(
      [
        '[dry-run] release directory is valid:',
        ...artifacts.map(
          ({ filename, bytes, sha256 }) =>
            `  ${filename} (${bytes.length} bytes, sha256 ${sha256})`,
        ),
        `[dry-run] would publish spark-agent ${manifest.version} under ${target}/ (bucket ${config?.bucket ?? '<MINIO_BUCKET>'})`,
        '[dry-run] audit → upload missing only → verify read-back → latest.json last',
        '[dry-run] no changes were made',
        '',
      ].join('\n'),
    )
    return { skipped: [], uploaded: [] }
  }

  const planned = []
  for (const artifact of immutables) {
    const existing = await headObject(config, keyOf(artifact.filename))
    if (existing === undefined) {
      planned.push({ artifact, action: 'put' })
      continue
    }
    if (existing.size === artifact.bytes.length && existing.sha256 === artifact.sha256) {
      planned.push({ artifact, action: 'skip' })
      continue
    }
    throw new PublishError(
      `${artifact.filename} already exists on ${target} with different content (${existing.sha256 || 'no checksum metadata'}, ${existing.size} bytes). ` +
        'Versioned artifacts are immutable: bump package.json version instead of republishing.',
    )
  }

  for (const item of planned.filter((entry) => entry.action === 'put')) {
    const { artifact } = item
    await sendSigned(
      config.endpointUrl,
      signRequest(
        {
          method: 'PUT',
          endpointUrl: config.endpointUrl,
          key: keyOf(artifact.filename),
          headers: {
            'Content-Length': String(artifact.bytes.length),
            'X-Amz-Meta-Sha256': artifact.sha256,
          },
          payloadHash: artifact.sha256,
        },
        config,
      ),
      (request) => request.end(artifact.bytes),
    )
  }

  for (const { artifact } of planned) {
    const got = await sendSigned(
      config.endpointUrl,
      signRequest(
        { method: 'GET', endpointUrl: config.endpointUrl, key: keyOf(artifact.filename) },
        config,
      ),
    )
    if (got.body.length !== artifact.bytes.length || sha256Hex(got.body) !== artifact.sha256) {
      throw new PublishError(`authenticated read-back mismatch for ${artifact.filename}`)
    }
  }
  for (const { artifact } of planned) {
    const fetched = await fetchPublic(cacheBust(`${target}/${artifact.filename}`))
    if (!fetched.equals(artifact.bytes)) {
      throw new PublishError(
        `public read-back mismatch for ${artifact.filename} — clients would receive corrupt bytes`,
      )
    }
  }

  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  await sendSigned(
    config.endpointUrl,
    signRequest(
      {
        method: 'PUT',
        endpointUrl: config.endpointUrl,
        key: keyOf('latest.json'),
        headers: {
          'Content-Length': String(manifestBytes.length),
          'Cache-Control': 'max-age=0, no-cache',
        },
        payloadHash: sha256Hex(manifestBytes),
      },
      config,
    ),
    (request) => request.end(manifestBytes),
  )
  const published = JSON.parse(
    (await fetchPublic(cacheBust(`${target}/latest.json`))).toString('utf8'),
  )
  if (
    published.version !== manifest.version ||
    published.sha256 !== manifest.sha256 ||
    published.tarball !== manifest.tarball
  ) {
    throw new PublishError('published latest.json does not match the prepared manifest')
  }

  const skipped = planned
    .filter((item) => item.action === 'skip')
    .map((item) => item.artifact.filename)
  const uploaded = planned
    .filter((item) => item.action === 'put')
    .map((item) => item.artifact.filename)
  log(
    [
      `Published spark-agent ${manifest.version} to ${target}:`,
      ...(skipped.length > 0 ? [`  kept (immutable, identical): ${skipped.join(', ')}`] : []),
      ...(uploaded.length > 0 ? [`  uploaded: ${uploaded.join(', ')}`] : []),
      '  latest.json published last after verified read-back',
      '',
    ].join('\n'),
  )
  return { skipped, uploaded, remoteBase: target, version: manifest.version }
}

function stripTrailingSlash(url) {
  return url.href.replace(/\/+$/u, '')
}

function cacheBust(url) {
  return `${url}${url.includes('?') ? '&' : '?'}cb=${Date.now().toString(36)}`
}

async function fetchPublic(url) {
  const response = await fetch(url, { cache: 'no-store' })
  if (!response.ok) {
    throw new PublishError(
      `public read failed: HTTP ${response.status} for ${new URL(url).pathname}`,
    )
  }
  return Buffer.from(await response.arrayBuffer())
}

async function main(argv) {
  let positional = []
  let dryRun = false
  let baseOverride
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--dry-run') dryRun = true
    else if (arg === '--base') baseOverride = argv[++index]
    else if (!arg.startsWith('--')) positional.push(arg)
    else throw new PublishError(`unknown flag: ${arg}`)
  }
  if (positional.length > 1)
    throw new PublishError(
      'usage: publish-release-to-minio.mjs [release-dir] [--base <url>] [--dry-run]',
    )
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const releaseDir = resolve(positional[0] ?? join(packageRoot, 'release'))

  const discovered = await discoverReleaseArtifacts(releaseDir)
  // A dry-run is a pure local check: without credentials it targets the
  // built-in release base (or an explicit --base) purely for plan display and
  // touches neither network nor bucket. Real publishing always requires a
  // complete credential environment.
  let config
  let remoteBase
  if (dryRun && !process.env.MINIO_BUCKET) {
    const url = new URL(baseOverride ?? DEFAULT_RELEASE_BASE)
    remoteBase = {
      url,
      keyPrefix: url.pathname.split('/').filter(Boolean).map(decodeURIComponent).join('/'),
    }
  } else {
    config = resolvePublishConfig(process.env)
    remoteBase = resolveRemoteBase({ config, baseOverride })
  }
  await publishRelease({ config, remoteBase, ...discovered, dryRun })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(
      `publish-release-to-minio: ${error instanceof Error ? error.message : String(error)}\n`,
    )
    process.exitCode = 1
  })
}
