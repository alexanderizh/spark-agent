#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import http from 'node:http'
import https from 'node:https'
import { basename, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import aws4 from 'aws4'

const REPOSITORY_PREFIX = 'artifact-repository/v1'

export async function publishOptionalCapabilities({ artifacts, config, now = () => new Date() }) {
  const settings = validateConfig(config)
  const releases = await Promise.all(artifacts.map(loadRelease))
  if (releases.length === 0) throw new Error('至少需要一个可选能力制品')
  const ids = new Set()
  for (const release of releases) {
    validateReleaseEntry(release.entry)
    if (ids.has(release.entry.id)) throw new Error(`发布参数包含重复 ID: ${release.entry.id}`)
    ids.add(release.entry.id)
    await verifyLocalArchive(release)
  }

  const publicIndexUrl = `${settings.publicBaseUrl}/${REPOSITORY_PREFIX}/index.json`
  const currentBytes = await fetchBytes(cacheBust(publicIndexUrl, 'publish'))
  const current = parseRepositoryManifest(currentBytes)
  for (const { entry } of releases) {
    const existing = current.artifacts.find((candidate) => candidate.id === entry.id)
    if (existing && stableJson(existing) !== stableJson(entry)) {
      throw new Error(`正式清单包含冲突制品: ${entry.id}`)
    }
  }

  const timestamp = now().toISOString().replace(/[:.]/g, '-')
  const backupKey = `${REPOSITORY_PREFIX}/backups/index-${timestamp}.json`
  await putBuffer(settings, backupKey, currentBytes, 'application/json')

  const uploaded = []
  for (const release of releases) {
    const objectKey = `${REPOSITORY_PREFIX}/${release.entry.url}`
    const remote = await headObject(settings, objectKey).catch(() => null)
    if (remote?.size !== release.entry.size || remote.sha256 !== release.entry.sha256) {
      await putFile(settings, objectKey, release.archivePath, release.entry.sha256)
    }
    const verifiedHead = await headObject(settings, objectKey)
    if (verifiedHead.size !== release.entry.size || verifiedHead.sha256 !== release.entry.sha256) {
      throw new Error(`MinIO 对象元数据校验失败: ${release.entry.id}`)
    }
    await verifyPublicArtifact(settings.publicBaseUrl, release.entry)
    uploaded.push(objectKey)
  }

  const merged = {
    ...current,
    updatedAt: now().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' }),
    artifacts: [
      ...current.artifacts.filter((candidate) => !ids.has(candidate.id)),
      ...releases.map(({ entry }) => entry),
    ],
  }
  const mergedBytes = Buffer.from(`${JSON.stringify(merged, null, 2)}\n`)
  const stagingKey = `${REPOSITORY_PREFIX}/staging/index-optional-${Date.now()}.json`
  await putBuffer(settings, stagingKey, mergedBytes, 'application/json')
  await auditRepository(
    cacheBust(`${settings.publicBaseUrl}/${stagingKey}`, 'audit'),
    releases.map(({ entry }) => entry.id),
  )

  await putBuffer(settings, `${REPOSITORY_PREFIX}/index.json`, mergedBytes, 'application/json')
  const publishedBytes = await fetchBytes(cacheBust(publicIndexUrl, 'verify'))
  const published = parseRepositoryManifest(publishedBytes)
  if (stableJson(published) !== stableJson(merged)) {
    throw new Error('公网正式清单与待发布清单不一致')
  }
  for (const { entry } of releases) await verifyPublicArtifact(settings.publicBaseUrl, entry)

  return {
    backupKey,
    stagingKey,
    uploaded,
    updatedAt: published.updatedAt,
    artifacts: releases.map(({ entry }) => ({
      id: entry.id,
      size: entry.size,
      sha256: entry.sha256,
      url: entry.url,
    })),
  }
}

async function loadRelease({ manifestPath, archivePath }) {
  const resolvedManifest = resolve(manifestPath)
  const entry = JSON.parse(await readFile(resolvedManifest, 'utf8'))
  return { entry, archivePath: resolve(archivePath) }
}

async function verifyLocalArchive({ entry, archivePath }) {
  const archiveStat = await stat(archivePath)
  const sha256 = await sha256File(archivePath)
  if (archiveStat.size !== entry.size || sha256 !== entry.sha256) {
    throw new Error(`本地制品与发布清单不一致: ${archivePath}`)
  }
  if (basename(entry.url) !== basename(archivePath)) {
    throw new Error(`制品文件名与清单 URL 不一致: ${entry.id}`)
  }
}

function validateReleaseEntry(entry) {
  const optionalOffice =
    entry?.id?.startsWith('archive.optional-office-viewer-') && entry.type === 'archive'
  const optionalDepth = entry?.id?.startsWith('runtime.optional-depth-') && entry.type === 'runtime'
  if (
    (!optionalOffice && !optionalDepth) ||
    typeof entry.version !== 'string' ||
    !['any', 'darwin', 'win32', 'linux'].includes(entry.platform) ||
    !['any', 'arm64', 'x64'].includes(entry.arch) ||
    !isSafeRelativeObjectPath(entry.url) ||
    !/^[0-9a-f]{64}$/.test(entry.sha256 ?? '') ||
    !Number.isSafeInteger(entry.size) ||
    entry.size <= 0 ||
    entry.archive?.format !== 'tar.gz' ||
    entry.archive?.contentRoot !== '.'
  ) {
    throw new Error(`无效的可选能力发布条目: ${JSON.stringify(entry)}`)
  }
}

function validateConfig(config) {
  for (const key of ['endpoint', 'bucket', 'accessKeyId', 'secretAccessKey', 'publicBaseUrl']) {
    if (!config?.[key]) throw new Error(`缺少 MinIO 发布配置: ${key}`)
  }
  const endpointUrl = new URL(
    config.endpoint.includes('://') ? config.endpoint : `https://${config.endpoint}`,
  )
  if (!['http:', 'https:'].includes(endpointUrl.protocol)) {
    throw new Error(`不支持的 MinIO 协议: ${endpointUrl.protocol}`)
  }
  if (endpointUrl.protocol === 'http:' && !config.allowInsecureHttp) {
    throw new Error('HTTP MinIO endpoint 必须显式启用 allowInsecureHttp')
  }
  return {
    ...config,
    endpointUrl,
    publicBaseUrl: String(config.publicBaseUrl).replace(/\/$/, ''),
    region: config.region || 'us-east-1',
  }
}

async function auditRepository(manifestUrl, releaseIds) {
  const manifest = parseRepositoryManifest(await fetchBytes(manifestUrl))
  const baseUrl = String(manifest.baseUrl ?? new URL('.', manifestUrl)).replace(/\/$/, '')
  const ids = new Set()
  for (const artifact of manifest.artifacts) {
    validateRepositoryEntry(artifact)
    if (ids.has(artifact.id)) throw new Error(`staging 清单存在重复 ID: ${artifact.id}`)
    ids.add(artifact.id)
    const response = await fetch(`${baseUrl}/${artifact.url}`, { method: 'HEAD' })
    if (!response.ok) throw new Error(`staging 审计失败: ${artifact.id} HTTP ${response.status}`)
    const size = Number(response.headers.get('content-length') ?? 0)
    if (size > 0 && size !== artifact.size) {
      throw new Error(`staging 审计失败: ${artifact.id} size=${size}`)
    }
  }
  for (const id of releaseIds) {
    if (!ids.has(id)) throw new Error(`staging 清单缺少本次制品: ${id}`)
  }
}

function parseRepositoryManifest(bytes) {
  let manifest
  try {
    manifest = JSON.parse(bytes.toString('utf8'))
  } catch (error) {
    throw new Error(
      `制品仓库清单不是有效 JSON: ${error instanceof Error ? error.message : error}`,
      { cause: error },
    )
  }
  if (manifest?.schemaVersion !== 1 || !Array.isArray(manifest.artifacts)) {
    throw new Error('制品仓库清单 schema 无效')
  }
  return manifest
}

function validateRepositoryEntry(entry) {
  if (
    !entry ||
    typeof entry.id !== 'string' ||
    !isSafeRelativeObjectPath(entry.url) ||
    !/^[0-9a-f]{64}$/.test(entry.sha256 ?? '') ||
    !Number.isSafeInteger(entry.size) ||
    entry.size <= 0
  ) {
    throw new Error(`staging 清单含无效制品: ${entry?.id ?? 'unknown'}`)
  }
}

async function verifyPublicArtifact(publicBaseUrl, entry) {
  const downloaded = await fetchBytes(
    cacheBust(`${publicBaseUrl}/${REPOSITORY_PREFIX}/${entry.url}`, 'sha'),
  )
  const sha256 = createHash('sha256').update(downloaded).digest('hex')
  if (downloaded.length !== entry.size || sha256 !== entry.sha256) {
    throw new Error(`公网制品校验失败: ${entry.id}`)
  }
}

function signedOptions(settings, method, objectKey, headers = {}) {
  const path = `/${encodeURIComponent(settings.bucket)}/${objectKey
    .split('/')
    .map(encodeURIComponent)
    .join('/')}`
  const options = {
    host: settings.endpointUrl.hostname,
    port: settings.endpointUrl.port || (settings.endpointUrl.protocol === 'https:' ? 443 : 80),
    path,
    method,
    service: 's3',
    region: settings.region,
    headers: { Host: settings.endpointUrl.host, ...headers },
  }
  aws4.sign(options, {
    accessKeyId: settings.accessKeyId,
    secretAccessKey: settings.secretAccessKey,
  })
  return options
}

async function putBuffer(settings, key, bytes, contentType) {
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  await sendSigned(
    settings,
    signedOptions(settings, 'PUT', key, {
      'Content-Length': String(bytes.length),
      'Content-Type': contentType,
      'X-Amz-Content-Sha256': sha256,
      'X-Amz-Meta-Sha256': sha256,
    }),
    (request) => request.end(bytes),
  )
}

async function putFile(settings, key, filePath, sha256) {
  const size = (await stat(filePath)).size
  await sendSigned(
    settings,
    signedOptions(settings, 'PUT', key, {
      'Content-Length': String(size),
      'Content-Type': 'application/gzip',
      'X-Amz-Content-Sha256': sha256,
      'X-Amz-Meta-Sha256': sha256,
    }),
    (request) => createReadStream(filePath).pipe(request),
  )
}

async function headObject(settings, key) {
  const response = await sendSigned(
    settings,
    signedOptions(settings, 'HEAD', key, {
      'X-Amz-Content-Sha256': createHash('sha256').update('').digest('hex'),
    }),
    (request) => request.end(),
  )
  return {
    size: Number(response.headers['content-length'] ?? 0),
    sha256: String(response.headers['x-amz-meta-sha256'] ?? ''),
  }
}

function sendSigned(settings, options, writeBody) {
  const transport = settings.endpointUrl.protocol === 'https:' ? https : http
  return new Promise((resolveRequest, rejectRequest) => {
    const request = transport.request(options, (response) => {
      const chunks = []
      response.on('data', (chunk) => chunks.push(chunk))
      response.on('end', () => {
        if ((response.statusCode ?? 500) >= 200 && (response.statusCode ?? 500) < 300) {
          resolveRequest({ headers: response.headers, body: Buffer.concat(chunks) })
          return
        }
        rejectRequest(
          new Error(`${options.method} ${options.path} 返回 HTTP ${response.statusCode}`),
        )
      })
    })
    request.on('error', rejectRequest)
    request.setTimeout(30 * 60 * 1000, () => request.destroy(new Error('MinIO 请求超时')))
    writeBody(request)
  })
}

async function fetchBytes(url) {
  const response = await fetch(url, { cache: 'no-store' })
  if (!response.ok)
    throw new Error(`公网读取失败: HTTP ${response.status} ${new URL(url).pathname}`)
  return Buffer.from(await response.arrayBuffer())
}

function sha256File(filePath) {
  return new Promise((resolveHash, rejectHash) => {
    const hash = createHash('sha256')
    const stream = createReadStream(filePath)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', rejectHash)
    stream.on('end', () => resolveHash(hash.digest('hex')))
  })
}

function isSafeRelativeObjectPath(value) {
  if (typeof value !== 'string' || value.startsWith('/') || value.includes('\\')) return false
  let decoded
  try {
    decoded = decodeURIComponent(value)
  } catch {
    return false
  }
  const segments = decoded.split('/')
  return (
    !decoded.includes('?') &&
    !decoded.includes('#') &&
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

function cacheBust(url, label) {
  const parsed = new URL(url)
  parsed.searchParams.set(label, String(Date.now()))
  return parsed.href
}

async function main() {
  const args = process.argv.slice(2)
  if (args.length === 0 || args.length % 2 !== 0) {
    throw new Error('Usage: publish-optional-capabilities-to-minio.mjs <manifest> <archive> [...]')
  }
  const artifacts = []
  for (let index = 0; index < args.length; index += 2) {
    artifacts.push({ manifestPath: args[index], archivePath: args[index + 1] })
  }
  const result = await publishOptionalCapabilities({
    artifacts,
    config: {
      endpoint: process.env.RELEASE_MINIO_ENDPOINT,
      bucket: process.env.RELEASE_MINIO_BUCKET,
      accessKeyId: process.env.RELEASE_MINIO_ACCESS_KEY,
      secretAccessKey: process.env.RELEASE_MINIO_SECRET_KEY,
      publicBaseUrl:
        process.env.RELEASE_MINIO_PUBLIC_BASE_URL || 'https://minio.yiqibyte.com/spark-desktop',
      region: process.env.RELEASE_MINIO_REGION,
      allowInsecureHttp: process.env.RELEASE_MINIO_ALLOW_INSECURE_HTTP === '1',
    },
  })
  console.log(JSON.stringify(result, null, 2))
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main()
}
