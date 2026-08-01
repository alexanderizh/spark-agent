#!/usr/bin/env node

import { createHash } from 'node:crypto'

const manifestUrl =
  process.argv.find((arg) => arg.startsWith('http')) ??
  'https://minio.yiqibyte.com/spark-desktop/artifact-repository/v1/index.json'
const verifySkills = process.argv.includes('--verify-skills')
const verifyAll = process.argv.includes('--verify-all')

const response = await fetch(manifestUrl, { headers: { Accept: 'application/json' } })
if (!response.ok) throw new Error(`manifest returned HTTP ${response.status}: ${manifestUrl}`)
const manifest = await response.json()
const artifacts = Array.isArray(manifest.artifacts) ? manifest.artifacts : []
const baseUrl = String(manifest.baseUrl ?? new URL('.', manifestUrl)).replace(/\/$/, '')
const errors = []
const ids = new Set()

if (manifest.schemaVersion !== 1)
  errors.push(`unsupported schemaVersion: ${manifest.schemaVersion}`)
if (artifacts.length === 0) errors.push('manifest contains no artifacts')

for (const artifact of artifacts) {
  if (typeof artifact.id !== 'string' || artifact.id.length === 0) {
    errors.push('artifact is missing id')
  } else if (ids.has(artifact.id)) {
    errors.push(`duplicate artifact id: ${artifact.id}`)
  } else {
    ids.add(artifact.id)
  }
  if (typeof artifact.url !== 'string' || artifact.url.length === 0) {
    errors.push(`${artifact.id}: missing url`)
  } else if (!isSafeRelativeObjectPath(artifact.url)) {
    errors.push(`${artifact.id}: unsafe artifact url ${artifact.url}`)
  }
  if (!/^[0-9a-f]{64}$/.test(artifact.sha256 ?? '')) {
    errors.push(`${artifact.id}: invalid sha256`)
  }
  if (!Number.isSafeInteger(artifact.size) || artifact.size <= 0) {
    errors.push(`${artifact.id}: invalid size`)
  }
}

for (let offset = 0; offset < artifacts.length; offset += 8) {
  const batch = artifacts.slice(offset, offset + 8)
  const results = await Promise.all(
    batch.map(async (artifact) => {
      const url = `${baseUrl}/${artifact.url}`
      try {
        const objectResponse = await fetch(url, { method: 'HEAD' })
        const contentLength = Number(objectResponse.headers.get('content-length') ?? 0)
        if (!objectResponse.ok) return `${artifact.id}: HTTP ${objectResponse.status}`
        if (contentLength > 0 && contentLength !== artifact.size) {
          return `${artifact.id}: size ${contentLength}, expected ${artifact.size}`
        }
        return null
      } catch (error) {
        return `${artifact.id}: ${String(error)}`
      }
    }),
  )
  errors.push(...results.filter(Boolean))
}

if (verifySkills || verifyAll) {
  const downloadableArtifacts = verifyAll
    ? artifacts
    : artifacts.filter((item) => item.type === 'skill')
  for (const artifact of downloadableArtifacts) {
    const objectResponse = await fetch(`${baseUrl}/${artifact.url}`)
    if (!objectResponse.ok) {
      errors.push(`${artifact.id}: download returned HTTP ${objectResponse.status}`)
      continue
    }
    const downloaded = await hashResponse(objectResponse)
    if (downloaded.size !== artifact.size) {
      errors.push(`${artifact.id}: downloaded size ${downloaded.size}, expected ${artifact.size}`)
    }
    if (downloaded.sha256 !== artifact.sha256) {
      errors.push(
        `${artifact.id}: downloaded SHA256 ${downloaded.sha256}, expected ${artifact.sha256}`,
      )
    }
  }
}

if (errors.length > 0) {
  console.error(`Artifact repository audit failed (${errors.length} issues):`)
  for (const error of errors) console.error(`- ${error}`)
  process.exit(1)
}

const byType = Object.fromEntries(
  Object.entries(
    artifacts.reduce((counts, artifact) => {
      counts[artifact.type] = (counts[artifact.type] ?? 0) + 1
      return counts
    }, {}),
  ).sort(([left], [right]) => left.localeCompare(right)),
)
console.log(
  JSON.stringify(
    {
      manifestUrl,
      updatedAt: manifest.updatedAt,
      artifacts: artifacts.length,
      byType,
      verifiedSkillArchives: verifySkills
        ? artifacts.filter((artifact) => artifact.type === 'skill').length
        : 0,
      fullyVerifiedArtifacts: verifyAll ? artifacts.length : 0,
    },
    null,
    2,
  ),
)

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
