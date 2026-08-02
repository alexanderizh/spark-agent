#!/usr/bin/env node

// 发布 FFmpeg 二进制包到 Spark 制品仓库（minio）。
//
// 复用 publish-depth-model-to-minio.mjs 的 aws4 签名 / 备份 / staging / 校验链路，
// 仅调整入口（读取本地 entry.json）与条目校验（binary + zip，无 contentRoot）。
//
// Usage:
//   node scripts/publish-ffmpeg-to-minio.mjs <entry.json> <archive.zip>
//
// entry.json 是待写入 index.json 的单条 manifest 条目，形如：
//   {
//     "id": "binary.ffmpeg-8.1.2.win32-x64",
//     "type": "binary",
//     "name": "FFmpeg 8.1.2 (Windows x64)",
//     "version": "8.1.2",
//     "platform": "win32",
//     "arch": "x64",
//     "url": "binaries/ffmpeg/ffmpeg-8.1.2-win32-x64.zip",
//     "sha256": "<64 hex>",
//     "size": <bytes>,
//     "archive": { "format": "zip" },
//     "notes": "..."
//   }

import { createHash } from 'node:crypto'
import { createReadStream, readFileSync, statSync } from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import { basename, resolve } from 'node:path'
import aws4 from 'aws4'

const endpoint = process.env.RELEASE_MINIO_ENDPOINT
const bucket = process.env.RELEASE_MINIO_BUCKET
const accessKeyId = process.env.RELEASE_MINIO_ACCESS_KEY
const secretAccessKey = process.env.RELEASE_MINIO_SECRET_KEY
const publicBaseUrl = String(
  process.env.RELEASE_MINIO_PUBLIC_BASE_URL || 'https://minio.yiqibyte.com/spark-desktop',
).replace(/\/$/, '')
const repositoryPrefix = 'artifact-repository/v1'

const entryPath = resolve(process.argv[2] ?? '')
const archivePath = resolve(process.argv[3] ?? '')

if (!process.argv[2] || !process.argv[3]) {
  fail('Usage: node scripts/publish-ffmpeg-to-minio.mjs <entry.json> <archive.zip>')
}
for (const [name, value] of Object.entries({
  RELEASE_MINIO_ENDPOINT: endpoint,
  RELEASE_MINIO_BUCKET: bucket,
  RELEASE_MINIO_ACCESS_KEY: accessKeyId,
  RELEASE_MINIO_SECRET_KEY: secretAccessKey,
})) {
  if (!value) fail(`${name} is required`)
}

const endpointUrl = new URL(endpoint.includes('://') ? endpoint : `https://${endpoint}`)
if (endpointUrl.protocol === 'http:' && process.env.RELEASE_MINIO_ALLOW_INSECURE_HTTP !== '1') {
  fail(
    'HTTP MinIO endpoints require RELEASE_MINIO_ALLOW_INSECURE_HTTP=1; prefer HTTPS whenever possible',
  )
}
if (!['http:', 'https:'].includes(endpointUrl.protocol)) {
  fail(`unsupported MinIO endpoint protocol: ${endpointUrl.protocol}`)
}

const releaseEntry = JSON.parse(readFileSync(entryPath, 'utf8'))
validateReleaseEntry(releaseEntry)

const actualSize = statSync(archivePath).size
const actualSha256 = await sha256File(archivePath)
if (actualSize !== releaseEntry.size || actualSha256 !== releaseEntry.sha256) {
  fail(
    `local artifact does not match entry: size=${actualSize}/${releaseEntry.size}, sha256=${actualSha256}/${releaseEntry.sha256}`,
  )
}
if (basename(releaseEntry.url) !== basename(archivePath)) {
  fail(`archive filename does not match entry.url: ${releaseEntry.url} vs ${archivePath}`)
}

const publicManifestUrl = `${publicBaseUrl}/${repositoryPrefix}/index.json`
const currentManifestResponse = await fetch(
  `${publicManifestUrl}?publish=${encodeURIComponent(Date.now())}`,
  { cache: 'no-store' },
)
if (!currentManifestResponse.ok) {
  fail(`public manifest returned HTTP ${currentManifestResponse.status}`)
}
const currentManifestBytes = Buffer.from(await currentManifestResponse.arrayBuffer())
const currentManifest = JSON.parse(currentManifestBytes.toString('utf8'))
if (currentManifest.schemaVersion !== 1 || !Array.isArray(currentManifest.artifacts)) {
  fail('public manifest has an unsupported or invalid schema')
}
const existing = currentManifest.artifacts.find((candidate) => candidate.id === releaseEntry.id)
if (existing && stableJson(existing) !== stableJson(releaseEntry)) {
  fail(`manifest contains a conflicting artifact: ${releaseEntry.id}`)
}

const backupName = `index-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
const backupKey = `${repositoryPrefix}/backups/${backupName}`
await putBuffer(backupKey, currentManifestBytes, 'application/json')
console.log(`[minio] backed up current manifest to ${backupKey}`)

const objectKey = `${repositoryPrefix}/${releaseEntry.url}`
const existingRemote = await headObject(objectKey).catch(() => null)
if (existingRemote?.size === releaseEntry.size && existingRemote.sha256 === releaseEntry.sha256) {
  console.log(`[minio] already verified ${objectKey}`)
} else {
  console.log(`[minio] uploading ${basename(archivePath)} (${releaseEntry.size} bytes)`)
  await putFile(objectKey, archivePath, releaseEntry.sha256)
  const remote = await headObject(objectKey)
  if (remote.size !== releaseEntry.size || remote.sha256 !== releaseEntry.sha256) {
    fail(`remote metadata mismatch for ${objectKey}: size=${remote.size}, sha256=${remote.sha256}`)
  }
  console.log(`[minio] verified ${objectKey}`)
}

const mergedManifest = {
  ...currentManifest,
  updatedAt: new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' }),
  artifacts: [
    ...currentManifest.artifacts.filter((candidate) => candidate.id !== releaseEntry.id),
    releaseEntry,
  ],
}
const mergedManifestBytes = Buffer.from(`${JSON.stringify(mergedManifest, null, 2)}\n`)
const stagingKey = `${repositoryPrefix}/staging/index-ffmpeg-${releaseEntry.version}-${Date.now()}.json`
await putBuffer(stagingKey, mergedManifestBytes, 'application/json')
console.log(`[minio] uploaded staging manifest ${stagingKey}`)
await putBuffer(`${repositoryPrefix}/index.json`, mergedManifestBytes, 'application/json')
console.log(`[minio] published ${repositoryPrefix}/index.json`)

const publishedResponse = await fetch(
  `${publicManifestUrl}?verify=${encodeURIComponent(Date.now())}`,
  { cache: 'no-store' },
)
if (!publishedResponse.ok) {
  fail(`published manifest returned HTTP ${publishedResponse.status}`)
}
const publishedManifest = await publishedResponse.json()
const published = publishedManifest.artifacts?.find(
  (candidate) => candidate.id === releaseEntry.id,
)
if (!published || stableJson(published) !== stableJson(releaseEntry)) {
  fail(`published manifest entry does not match ${releaseEntry.id}`)
}
const publicArtifactResponse = await fetch(
  `${publicBaseUrl}/${repositoryPrefix}/${releaseEntry.url}?verify=${encodeURIComponent(Date.now())}`,
  { cache: 'no-store' },
)
if (!publicArtifactResponse.ok) {
  fail(`published artifact returned HTTP ${publicArtifactResponse.status}`)
}
const publicArtifact = await hashResponse(publicArtifactResponse)
if (publicArtifact.size !== releaseEntry.size || publicArtifact.sha256 !== releaseEntry.sha256) {
  fail(
    `public artifact mismatch: size=${publicArtifact.size}, sha256=${publicArtifact.sha256}`,
  )
}

console.log(
  JSON.stringify(
    {
      backupKey,
      stagingKey,
      artifactId: releaseEntry.id,
      objectKey,
      size: publicArtifact.size,
      sha256: publicArtifact.sha256,
      updatedAt: publishedManifest.updatedAt,
    },
    null,
    2,
  ),
)

function signedRequestOptions(method, key, headers = {}) {
  const path = `/${encodeURIComponent(bucket)}/${key
    .split('/')
    .map(encodeURIComponent)
    .join('/')}`
  const options = {
    host: endpointUrl.hostname,
    port: endpointUrl.port || (endpointUrl.protocol === 'https:' ? 443 : 80),
    path,
    method,
    service: 's3',
    region: process.env.RELEASE_MINIO_REGION || 'us-east-1',
    headers: { Host: endpointUrl.host, ...headers },
  }
  aws4.sign(options, { accessKeyId, secretAccessKey })
  return options
}

function requestModule() {
  return endpointUrl.protocol === 'https:' ? https : http
}

async function putBuffer(key, bytes, contentType) {
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const options = signedRequestOptions('PUT', key, {
    'Content-Length': String(bytes.length),
    'Content-Type': contentType,
    'X-Amz-Content-Sha256': sha256,
    'X-Amz-Meta-Sha256': sha256,
  })
  await sendRequest(options, (request) => request.end(bytes))
}

async function putFile(key, path, sha256) {
  const size = statSync(path).size
  const options = signedRequestOptions('PUT', key, {
    'Content-Length': String(size),
    'Content-Type': 'application/zip',
    'X-Amz-Content-Sha256': sha256,
    'X-Amz-Meta-Sha256': sha256,
  })
  await sendRequest(options, (request) => createReadStream(path).pipe(request))
}

async function headObject(key) {
  const options = signedRequestOptions('HEAD', key, {
    'X-Amz-Content-Sha256': createHash('sha256').update('').digest('hex'),
  })
  const response = await sendRequest(options, (request) => request.end())
  return {
    size: Number(response.headers['content-length'] || 0),
    sha256: String(response.headers['x-amz-meta-sha256'] || ''),
  }
}

function sendRequest(options, writeBody) {
  return new Promise((resolveRequest, rejectRequest) => {
    const request = requestModule().request(options, (response) => {
      const chunks = []
      response.on('data', (chunk) => chunks.push(chunk))
      response.on('end', () => {
        if (response.statusCode >= 200 && response.statusCode < 300) {
          resolveRequest({ headers: response.headers, body: Buffer.concat(chunks) })
          return
        }
        rejectRequest(
          new Error(
            `${options.method} ${options.path} returned HTTP ${response.statusCode}: ${Buffer.concat(chunks).toString('utf8').slice(0, 500)}`,
          ),
        )
      })
    })
    request.on('error', rejectRequest)
    request.setTimeout(30 * 60 * 1000, () => request.destroy(new Error('request timed out')))
    writeBody(request)
  })
}

function sha256File(path) {
  return new Promise((resolveHash, rejectHash) => {
    const hash = createHash('sha256')
    const stream = createReadStream(path)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', rejectHash)
    stream.on('end', () => resolveHash(hash.digest('hex')))
  })
}

async function hashResponse(response) {
  if (!response.body) throw new Error('response body is unavailable')
  const hash = createHash('sha256')
  let size = 0
  for await (const chunk of response.body) {
    size += chunk.byteLength
    hash.update(chunk)
  }
  return { size, sha256: hash.digest('hex') }
}

function validateReleaseEntry(entry) {
  if (
    entry == null ||
    typeof entry !== 'object' ||
    typeof entry.id !== 'string' ||
    !/^binary\.ffmpeg-\d+\.\d+\.\d+\.(win32|darwin|linux)-(x64|arm64)$/.test(entry.id) ||
    entry.type !== 'binary' ||
    typeof entry.version !== 'string' ||
    !/^\d+\.\d+\.\d+$/.test(entry.version) ||
    !['win32', 'darwin', 'linux'].includes(entry.platform) ||
    !['x64', 'arm64'].includes(entry.arch) ||
    typeof entry.name !== 'string' ||
    !isSafeRelativeObjectPath(entry.url) ||
    !/^[0-9a-f]{64}$/.test(entry.sha256 ?? '') ||
    !Number.isSafeInteger(entry.size) ||
    entry.size <= 0 ||
    entry.archive?.format !== 'zip'
  ) {
    fail(`invalid ffmpeg release entry: ${entryPath}\n${JSON.stringify(entry, null, 2)}`)
  }
}

function isSafeRelativeObjectPath(value) {
  if (typeof value !== 'string' || value.startsWith('/') || value.includes('\\')) return false
  let decoded
  try {
    decoded = decodeURIComponent(value)
  } catch {
    return false
  }
  if (decoded.includes('?') || decoded.includes('#')) return false
  const segments = decoded.split('/')
  return (
    segments.length > 1 &&
    segments.every((segment) => segment && segment !== '.' && segment !== '..')
  )
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function fail(message) {
  console.error(message)
  process.exit(1)
}
