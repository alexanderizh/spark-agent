#!/usr/bin/env node
/**
 * Desktop CI: 把当前 matrix 的安装包元数据与更新说明注册到官网版本中心。
 *
 * 上游流程（workflow 中已完成）：
 *   1. electron-builder --publish always         → 推 GitHub Release
 *   2. aws s3 cp apps/desktop/dist/ s3://...     → 上传到 MinIO 公网桶
 *   3. node apps/desktop/scripts/register-release.mjs  ← 本脚本
 *
 * `CHANGELOG.md` 是更新说明唯一来源。正式版本缺少精确版本条目时，本脚本会失败，
 * 防止官网优先更新路径发布无说明的版本。
 */
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

import { readReleaseNotes } from '../../../scripts/release-notes.mjs'

const tag = '[register-release]'
const INSTALLER_EXTS = ['.dmg', '.exe', '.AppImage', '.zip', '.deb', '.rpm']

function required(env, name) {
  const value = env[name]
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`missing required env: ${name}`)
  }
  return value
}

export function readRegistrationConfig(env = process.env) {
  const version = required(env, 'VERSION')
  const channel = (env.CHANNEL || 'stable').toLowerCase()
  return {
    version,
    platform: required(env, 'PLATFORM').toLowerCase(),
    arch: required(env, 'ARCH').toLowerCase(),
    apiBase: required(env, 'RELEASE_API_BASE').replace(/\/$/, ''),
    ciToken: required(env, 'RELEASE_CI_TOKEN'),
    channel,
    distDir: env.DIST_DIR || 'apps/desktop/dist',
    objectPrefix: (env.RELEASE_OBJECT_PREFIX || `${channel}/${version}`).replace(/^\/+|\/+$/g, ''),
    autoPublish: (env.RELEASE_AUTO_PUBLISH || 'true').toLowerCase() !== 'false',
  }
}

export function pickInstallersFor(platform, arch, names) {
  const tagSubstring = `-${platform}-${arch}.`.toLowerCase()
  return names.flatMap((fileName) => {
    const lower = fileName.toLowerCase()
    if (!lower.includes(tagSubstring) || !INSTALLER_EXTS.some((extension) => lower.endsWith(extension))) {
      return []
    }
    const blockmap = `${fileName}.blockmap`
    return [{ fileName, blockmap: names.includes(blockmap) ? blockmap : null }]
  })
}

async function sha512Base64(path) {
  return await new Promise((resolve, reject) => {
    const hash = createHash('sha512')
    const stream = createReadStream(path)
    stream.on('error', reject)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('base64')))
  })
}

async function buildFileEntry(config, installer) {
  const path = join(config.distDir, installer.fileName)
  const [sha512, fileStat] = await Promise.all([sha512Base64(path), stat(path)])
  return {
    platform: config.platform,
    arch: config.arch,
    fileName: installer.fileName,
    fileSize: fileStat.size,
    sha512,
    objectKey: `${config.objectPrefix}/${installer.fileName}`,
    blockmapKey: installer.blockmap == null ? null : `${config.objectPrefix}/${installer.blockmap}`,
  }
}

export async function buildRegistrationPayload(config, changelogPath) {
  const names = await readdir(config.distDir)
  const installers = pickInstallersFor(config.platform, config.arch, names)
  if (installers.length === 0) {
    throw new Error(
      `没在 ${config.distDir} 找到匹配 -${config.platform}-${config.arch} 的安装包。dist 内容：\n  ${names.join('\n  ')}`,
    )
  }
  const [files, releaseNotes] = await Promise.all([
    Promise.all(installers.map((installer) => buildFileEntry(config, installer))),
    readReleaseNotes({ version: config.version, changelogPath }),
  ])
  return {
    version: config.version,
    channel: config.channel,
    files,
    releaseNotes,
    autoPublish: config.autoPublish,
  }
}

async function postRegister(config, body) {
  const response = await fetch(`${config.apiBase}/api/v1/ci/desktop/releases/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Release-Token': config.ciToken,
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}: ${text.slice(0, 500)}`)
  let json
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error(`non-JSON response: ${text.slice(0, 500)}`)
  }
  if (json.code !== 0) throw new Error(`api code=${json.code} message=${json.message}`)
  return json
}

async function withRetry(fn, attempts = 3) {
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      console.warn(`${tag} attempt ${attempt}/${attempts} failed: ${error instanceof Error ? error.message : error}`)
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, attempt * 2_000))
    }
  }
  throw lastError
}

export async function registerRelease(env = process.env, changelogPath) {
  const config = readRegistrationConfig(env)
  console.log(
    `${tag} version=${config.version} channel=${config.channel} platform=${config.platform} arch=${config.arch} prefix=${config.objectPrefix} autoPublish=${config.autoPublish}`,
  )
  const body = await buildRegistrationPayload(config, changelogPath)
  console.log(`${tag} matched installers: ${body.files.map((file) => file.fileName).join(', ')}`)
  const result = await withRetry(() => postRegister(config, body))
  console.log(`${tag} registered ok: ${JSON.stringify(result.data)}`)
  return result
}

if (process.argv[1]?.endsWith('register-release.mjs')) {
  registerRelease().catch((error) => {
    console.error(`${tag} fatal:`, error instanceof Error ? error.stack : error)
    process.exitCode = 1
  })
}
