#!/usr/bin/env node
/**
 * Desktop CI: 把当前 matrix 的安装包元数据注册到 edu-server。
 *
 * 上游流程（workflow 中已完成）：
 *   1. electron-builder --publish always         → 推 GitHub Release（保留）
 *   2. aws s3 cp apps/desktop/dist/ s3://...     → 上传到 MinIO 公网桶
 *   3. node apps/desktop/scripts/register-release.mjs  ← 本脚本
 *
 * 本脚本职责：
 *   - 扫 dist/，找出当前 matrix (PLATFORM, ARCH) 对应的安装包 + 可选 blockmap
 *   - 计算 sha512（base64）
 *   - POST /api/v1/ci/desktop/releases/register（带 X-Release-Token）
 *
 * 必填环境变量：
 *   VERSION              语义化版本（如 1.4.2）
 *   PLATFORM             mac | win | linux （electron-builder os 值）
 *   ARCH                 arm64 | x64 | universal
 *   RELEASE_API_BASE     edu-server 公网地址（例 https://spark.yiqibyte.com）
 *   RELEASE_CI_TOKEN     CI 鉴权 token（X-Release-Token header）
 *
 * 可选：
 *   CHANNEL              默认 stable
 *   DIST_DIR             默认 apps/desktop/dist
 *   RELEASE_OBJECT_PREFIX  MinIO 对象 key 前缀，默认 "{channel}/{version}"
 *   RELEASE_AUTO_PUBLISH  默认 true；false 时仅落草稿，待 admin 手动发布
 *
 * 失败行为：默认 retry 3 次后 exit 1（让 CI 标红）。
 */
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

const tag = '[register-release]'

function required(name) {
  const v = process.env[name]
  if (!v) {
    console.error(`${tag} missing required env: ${name}`)
    process.exit(1)
  }
  return v
}

const VERSION = required('VERSION')
const PLATFORM = required('PLATFORM').toLowerCase()
const ARCH = required('ARCH').toLowerCase()
const API_BASE = required('RELEASE_API_BASE').replace(/\/$/, '')
const CI_TOKEN = required('RELEASE_CI_TOKEN')
const CHANNEL = (process.env.CHANNEL || 'stable').toLowerCase()
const DIST_DIR = process.env.DIST_DIR || 'apps/desktop/dist'
const OBJECT_PREFIX = (
  process.env.RELEASE_OBJECT_PREFIX || `${CHANNEL}/${VERSION}`
).replace(/^\/+|\/+$/g, '')
const AUTO_PUBLISH = (process.env.RELEASE_AUTO_PUBLISH || 'true').toLowerCase() !== 'false'

const INSTALLER_EXTS = ['.dmg', '.exe', '.AppImage', '.zip', '.deb', '.rpm']

async function listDistFiles() {
  const entries = await readdir(DIST_DIR, { withFileTypes: true })
  return entries.filter(e => e.isFile()).map(e => e.name)
}

/**
 * 匹配当前 matrix 的安装包。artifactName 模板：
 *   ${productName}-${version}-${os}-${arch}.${ext}
 * 例：`Spark Agent-1.4.2-mac-arm64.dmg`
 *
 * 用 "-{platform}-{arch}." 作为子串识别，避免硬编码 productName，
 * 同时兼容 productName 改名场景。
 */
function pickInstallersFor(platform, arch, names) {
  const tagSubstr = `-${platform}-${arch}.`.toLowerCase()
  const out = []
  for (const name of names) {
    const lower = name.toLowerCase()
    if (!lower.includes(tagSubstr)) continue
    if (!INSTALLER_EXTS.some(ext => lower.endsWith(ext.toLowerCase()))) continue
    const blockmap = `${name}.blockmap`
    out.push({
      fileName: name,
      blockmap: names.includes(blockmap) ? blockmap : null,
    })
  }
  return out
}

async function sha512Base64(absPath) {
  return await new Promise((resolve, reject) => {
    const hash = createHash('sha512')
    const stream = createReadStream(absPath)
    stream.on('error', reject)
    stream.on('data', chunk => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('base64')))
  })
}

async function buildFileEntry({ fileName, blockmap }) {
  const absPath = join(DIST_DIR, fileName)
  const [hash, fileStat] = await Promise.all([
    sha512Base64(absPath),
    stat(absPath),
  ])
  return {
    platform: PLATFORM,
    arch: ARCH,
    fileName,
    fileSize: fileStat.size,
    sha512: hash,
    objectKey: `${OBJECT_PREFIX}/${fileName}`,
    blockmapKey: blockmap ? `${OBJECT_PREFIX}/${blockmap}` : null,
  }
}

async function postRegister(body) {
  const url = `${API_BASE}/api/v1/ci/desktop/releases/register`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Release-Token': CI_TOKEN,
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${text.slice(0, 500)}`)
  }
  let json
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error(`non-JSON response: ${text.slice(0, 500)}`)
  }
  if (typeof json.code !== 'number' || json.code !== 0) {
    throw new Error(`api code=${json.code} message=${json.message}`)
  }
  return json
}

async function withRetry(fn, attempts = 3) {
  let lastErr
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn()
    } catch (e) {
      lastErr = e
      const wait = i * 2000
      console.warn(`${tag} attempt ${i}/${attempts} failed: ${e instanceof Error ? e.message : e}`)
      if (i < attempts) await new Promise(r => setTimeout(r, wait))
    }
  }
  throw lastErr
}

async function main() {
  console.log(
    `${tag} version=${VERSION} channel=${CHANNEL} platform=${PLATFORM} arch=${ARCH} prefix=${OBJECT_PREFIX} autoPublish=${AUTO_PUBLISH}`,
  )

  const names = await listDistFiles()
  const matches = pickInstallersFor(PLATFORM, ARCH, names)
  if (matches.length === 0) {
    console.error(
      `${tag} 没在 ${DIST_DIR} 找到匹配 -${PLATFORM}-${ARCH} 的安装包。dist 内容：\n  ${names.join('\n  ')}`,
    )
    process.exit(1)
  }
  console.log(`${tag} matched installers: ${matches.map(m => m.fileName).join(', ')}`)

  const files = []
  for (const m of matches) {
    const entry = await buildFileEntry(m)
    console.log(
      `${tag}   - ${entry.fileName} size=${entry.fileSize} sha512=${entry.sha512.slice(0, 16)}…`,
    )
    files.push(entry)
  }

  const body = {
    version: VERSION,
    channel: CHANNEL,
    files,
    autoPublish: AUTO_PUBLISH,
  }

  const result = await withRetry(() => postRegister(body), 3)
  console.log(`${tag} registered ok: ${JSON.stringify(result.data)}`)
}

main().catch(err => {
  console.error(`${tag} fatal:`, err instanceof Error ? err.stack : err)
  process.exit(1)
})
