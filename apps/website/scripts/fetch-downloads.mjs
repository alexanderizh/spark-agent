#!/usr/bin/env node
/**
 * 构建期：从 edu-server 拉一份最新版本快照，写入
 * `src/content/downloads.generated.json`，供首屏 SSR/SSG 渲染使用。
 *
 * 失败策略：
 *   - 接口不通 / 返回错误 / 网络超时：保留磁盘上已有快照，不阻断构建。
 *   - 接口可用但当前 channel 一条 release 都没有：覆盖为 releases=[]，
 *     运行时仍会回退到 fallbackHref（/releases 历史版本页）。
 *
 * 环境变量（任选其一）：
 *   RELEASES_API_BASE        构建机能访问到的 edu-server 地址（带 https://）
 *   VITE_RELEASES_API_BASE   兜底；与运行时同一个变量，方便复用
 *
 * 可选：
 *   RELEASES_CHANNEL         默认 stable
 *   RELEASES_FETCH_TIMEOUT_MS  默认 10000
 *
 * 调用：
 *   node scripts/fetch-downloads.mjs
 *   pnpm prebuild
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_PATH = resolve(__dirname, '..', 'src', 'content', 'downloads.generated.json')

const API_BASE = (
  process.env.RELEASES_API_BASE ||
  process.env.VITE_RELEASES_API_BASE ||
  ''
).replace(/\/$/, '')

const CHANNEL = process.env.RELEASES_CHANNEL || 'stable'
const TIMEOUT_MS = Number(process.env.RELEASES_FETCH_TIMEOUT_MS || 10_000)

const tag = '[fetch-downloads]'

async function main() {
  if (!API_BASE) {
    console.warn(
      `${tag} 未配置 RELEASES_API_BASE / VITE_RELEASES_API_BASE，跳过构建期拉取（运行时会用磁盘快照）。`,
    )
    await ensureSnapshotExists()
    return
  }

  const url = `${API_BASE}/api/v1/desktop/releases/latest?channel=${encodeURIComponent(CHANNEL)}`
  console.log(`${tag} fetching ${url}`)

  try {
    const json = await fetchWithTimeout(url, TIMEOUT_MS)
    if (typeof json !== 'object' || json === null || typeof json.code !== 'number') {
      throw new Error(`unexpected payload: ${JSON.stringify(json).slice(0, 200)}`)
    }
    if (json.code !== 0) {
      throw new Error(`api code=${json.code} message=${json.message}`)
    }
    const data = json.data
    const releases = Array.isArray(data) ? data : data ? [data] : []
    const snapshot = {
      generatedAt: new Date().toISOString(),
      channel: CHANNEL,
      releases,
    }
    await writeSnapshot(snapshot)
    console.log(
      `${tag} ok — wrote ${releases.length} release(s) for channel="${CHANNEL}" → ${OUT_PATH}`,
    )
  } catch (e) {
    console.warn(
      `${tag} 拉取失败，保留磁盘已有快照不阻断构建：${(e instanceof Error ? e.message : String(e))}`,
    )
    await ensureSnapshotExists()
  }
}

async function fetchWithTimeout(url, timeoutMs) {
  if (typeof fetch !== 'function') {
    throw new Error('全局 fetch 不可用，构建脚本需要 Node 18+')
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })
    if (!res.ok) {
      throw new Error(`http ${res.status}`)
    }
    return await res.json()
  } finally {
    clearTimeout(timer)
  }
}

async function writeSnapshot(snapshot) {
  await mkdir(dirname(OUT_PATH), { recursive: true })
  await writeFile(OUT_PATH, JSON.stringify(snapshot, null, 2) + '\n', 'utf-8')
}

/**
 * 兜底：保证 OUT_PATH 至少是一个合法 JSON，否则 TS 编译会因 module import 失败。
 * 已存在则不覆盖（保留上次成功结果）。
 */
async function ensureSnapshotExists() {
  try {
    const content = await readFile(OUT_PATH, 'utf-8')
    JSON.parse(content)
    return
  } catch {
    /* fall through */
  }
  const empty = {
    generatedAt: null,
    channel: CHANNEL,
    releases: [],
  }
  await writeSnapshot(empty)
  console.log(`${tag} 写入空快照占位：${OUT_PATH}`)
}

main().catch((e) => {
  console.error(`${tag} fatal:`, e)
  process.exit(0) // 故意不抛错：避免一次 API 抖动阻断官网发布
})
