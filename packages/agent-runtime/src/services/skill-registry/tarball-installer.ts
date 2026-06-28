/**
 * @module skill-registry/tarball-installer
 *
 * Tarball 整库安装器 —— 突破 GitHub Contents API「60 文件 / 单文件 ≤1MB」的硬限制，
 * 用于安装 ppt-master 这类大体量技能（上万文件、近百 MB）。
 *
 * 流程：
 *   1. 下载 https://codeload.github.com/<repo>/tar.gz/refs/heads/<ref>（或 tags/<ref>）到临时文件
 *   2. 解压到临时目录
 *   3. 定位目标子目录（tarball 解包后会多一层 `<repo>-<ref>/` 前缀，再拼上 source.path）
 *   4. 校验该目录含 SKILL.md
 *   5. 整目录复制到 <userSkillsDir>/<slug>/，清掉旧的
 *   6. 删除临时文件 / 目录
 *
 * 解包优先用系统 `tar`（快、稳、无依赖）；不可用时回落到纯 JS 的 tar-stream 解包。
 */

import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import {
  chmodSync,
  copyFileSync,
  createWriteStream,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { gunzipSync, inflateRawSync } from 'node:zlib'

export interface TarballInstallParams {
  /** 形如 "hugohe3/ppt-master" */
  repo: string
  /** 分支 / 标签 / commit，缺省取默认分支 */
  ref?: string
  /** 仓库内技能目录（相对仓库根），缺省为根 */
  path?: string
  /** 落盘后的目录名 */
  destDirName: string
  /** 目标用户技能根目录 */
  userSkillsDir: string
  /** 可选：GITHUB_TOKEN / GH_TOKEN 注入，提升速率限制 */
  token?: string
  /** 进度回调（已下载字节数 / 总字节数，总字节数未知时为 0） */
  onProgress?: (downloaded: number, total: number) => void
}

export interface TarballInstallResult {
  /** 技能最终落盘目录 */
  destPath: string
  /** SKILL.md 原文 */
  skillMd: string
  /** 本次解压出的文件数（统计用） */
  fileCount: number
}

/**
 * 从 GitHub 下载 tarball、解压、把指定子目录复制到 userSkillsDir。
 * 成功返回最终技能目录与 SKILL.md 内容。
 */
export async function installFromGithubTarball(
  params: TarballInstallParams,
): Promise<TarballInstallResult> {
  const { repo, ref, path, destDirName, userSkillsDir, token, onProgress } = params
  const normalizedRepo = repo.replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').trim()
  if (!/^[\w.-]+\/[\w.-]+$/.test(normalizedRepo)) {
    throw new Error(`Invalid repo "${repo}"; expected "owner/name"`)
  }

  const effectiveRef = ref?.trim() || (await resolveDefaultBranch(normalizedRepo, token))
  const directUrl = buildTarballUrl(normalizedRepo, effectiveRef)
  // 候选源：直连 codeload.github.com 在国内常失败，依次回退国内镜像（前缀代理）。
  const downloadCandidates = [directUrl, ...GITHUB_TARBALL_MIRRORS.map((m) => `${m}/${directUrl}`)]

  // ── 1. 下载到临时文件 ────────────────────────────────────────────────
  const workId = randomUUID()
  const tmpDir = join(tmpdir(), `spark-skill-${workId}`)
  mkdirSync(tmpDir, { recursive: true })
  const tarballPath = join(tmpDir, 'skill.tar.gz')
  const extractDir = join(tmpDir, 'extracted')

  try {
    await downloadFromCandidates(downloadCandidates, tarballPath, token, onProgress)

    // ── 2. 解压 ──────────────────────────────────────────────────────
    mkdirSync(extractDir, { recursive: true })
    let extracted = false
    try {
      extracted = await extractWithSystemTar(tarballPath, extractDir)
    } catch {
      extracted = false
    }
    if (!extracted) {
      await extractWithPureJs(tarballPath, extractDir)
    }

    // ── 3. 定位技能根目录 ────────────────────────────────────────────
    // tarball 解包后顶层形如 "<repo>-<ref>"，再拼 source.path。
    const topLevel = findSingleTopLevelDir(extractDir)
    if (!topLevel) {
      throw new Error('Tarball extracted to an unexpected layout (no top-level directory)')
    }
    const basePath = (path ?? '').replace(/^\/+|\/+$/g, '')
    const skillRoot = basePath ? join(topLevel, basePath) : topLevel

    const skillMdPath = join(skillRoot, 'SKILL.md')
    if (!existsSync(skillMdPath)) {
      throw new Error(
        `No SKILL.md found under ${normalizedRepo}${basePath ? '/' + basePath : ''}@${effectiveRef}`,
      )
    }

    // 统计文件数（递归）
    const fileCount = countFiles(skillRoot)

    // ── 4. 复制到 userSkillsDir ──────────────────────────────────────
    const dest = join(userSkillsDir, destDirName)
    if (existsSync(dest)) {
      rmSync(dest, { recursive: true, force: true })
    }
    copyDirSync(skillRoot, dest)

    // 用内联的读文件工具，避免在此处 import 整个 fs.readFileSync（保持与文件顶部 import 一致）
    const skillMd = readFileSync(skillMdPath, 'utf8')

    return { destPath: dest, skillMd, fileCount }
  } finally {
    // 清理临时目录
    rmSync(tmpDir, { recursive: true, force: true })
  }
}

/**
 * 从一个 zip 归档 URL 下载、解压、把技能目录复制到 userSkillsDir。
 * 用于 SkillHub 等以 zip 整包分发的源：下载 zip → 系统 `tar -xf` 解压（仅 bsdtar 支持，
 * Windows 10+ / macOS 自带）→ 定位含 SKILL.md 的目录 → 落盘。
 * Linux 默认 GNU tar 不支持 zip，所以系统 tar 失败时会回落到纯 JS 解压；都失败时再抛错，
 * 由调用方决定是否回落到其它安装策略。
 */
export interface ZipInstallParams {
  /** zip 下载 URL（如 SkillHub `/api/v1/download?slug=`，302 → COS 加速） */
  url: string
  /** 落盘后的目录名（slug） */
  destDirName: string
  /** 目标用户技能根目录 */
  userSkillsDir: string
  /** 进度回调（已下载字节数 / 总字节数，总字节数未知时为 0） */
  onProgress?: (downloaded: number, total: number) => void
}

export async function installFromZip(params: ZipInstallParams): Promise<TarballInstallResult> {
  const { url, destDirName, userSkillsDir, onProgress } = params
  const workId = randomUUID()
  const tmpDir = join(tmpdir(), `spark-skill-zip-${workId}`)
  mkdirSync(tmpDir, { recursive: true })
  const zipPath = join(tmpDir, 'skill.zip')
  const extractDir = join(tmpDir, 'extracted')

  try {
    await downloadFile(url, zipPath, undefined, onProgress)

    mkdirSync(extractDir, { recursive: true })
    let extracted = false
    try {
      // -xf（不带 z）：bsdtar 按 magic 自动识别 zip；Windows/macOS 自带。Linux 多数发行版
      // 默认 GNU tar 不支持 zip，会直接失败，落到纯 JS 兜底。
      extracted = await extractWithSystemTar(zipPath, extractDir, ['-xf'])
    } catch {
      extracted = false
    }
    if (!extracted) {
      // Linux 等不带 bsdtar 的环境兜底；只支持 Store(0) 与 Deflate(8) 两种主流方法，
      // 加密/分卷不在覆盖范围（SkillHub 打包不会用到）。
      try {
        extractZipWithPureJs(zipPath, extractDir)
        extracted = true
      } catch {
        extracted = false
      }
    }
    if (!extracted) {
      throw new Error('Failed to extract zip archive (system tar unavailable and pure-JS fallback failed).')
    }

    const skillRoot = resolveSkillRoot(extractDir)
    const skillMdPath = join(skillRoot, 'SKILL.md')
    if (!existsSync(skillMdPath)) {
      throw new Error('No SKILL.md found in the downloaded zip archive.')
    }
    const fileCount = countFiles(skillRoot)

    const dest = join(userSkillsDir, destDirName)
    if (existsSync(dest)) {
      rmSync(dest, { recursive: true, force: true })
    }
    copyDirSync(skillRoot, dest)

    const skillMd = readFileSync(skillMdPath, 'utf8')
    return { destPath: dest, skillMd, fileCount }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }
}

/** 定位 zip 解压后含 SKILL.md 的技能根：优先解压根本身，其次唯一顶层目录。 */
function resolveSkillRoot(extractDir: string): string {
  if (existsSync(join(extractDir, 'SKILL.md'))) return extractDir
  const top = findSingleTopLevelDir(extractDir)
  return top ?? extractDir
}

// ─── URL & metadata ────────────────────────────────────────────────────

/**
 * GitHub tarball 国内镜像前缀（前缀代理：`{mirror}/{原始 codeload URL}`）。
 * codeload.github.com 直连在国内常超时 / 被墙，按顺序回退这些镜像。
 * 留空数组等价于仅直连。维护时优先放稳定性高的。
 */
const GITHUB_TARBALL_MIRRORS = [
  'https://gh-proxy.com',
  'https://ghproxy.net',
]

function buildTarballUrl(repo: string, ref: string): string {
  // ref 可能是分支名（含 /，如 feature/x）、标签或 commit。
  // codeload 的 refs/heads/<ref> 要求分支名中的 / 保持字面量，不能用 encodeURIComponent
  // 把它编码成 %2F（否则 404）。这里对每一段分别 encode，保留分隔符 /。
  const encodedRef = ref
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/')
  return `https://codeload.github.com/${repo}/tar.gz/refs/heads/${encodedRef}`
}

async function resolveDefaultBranch(repo: string, token?: string): Promise<string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'Spark-Agent',
  }
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(`https://api.github.com/repos/${repo}`, {
    headers,
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) throw new Error(`Failed to resolve default branch for ${repo}: ${res.status}`)
  const data = (await res.json()) as { default_branch?: string }
  return data.default_branch || 'main'
}

// ─── Download ──────────────────────────────────────────────────────────

async function downloadFile(
  url: string,
  dest: string,
  token: string | undefined,
  onProgress?: (downloaded: number, total: number) => void,
): Promise<void> {
  const headers: Record<string, string> = { 'User-Agent': 'Spark-Agent' }
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(120000) })
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`)
  if (!res.body) throw new Error('Download failed: empty response body')

  const total = Number(res.headers.get('content-length') ?? 0)
  const source = Readable.fromWeb(res.body as unknown as Parameters<typeof Readable.fromWeb>[0])
  const fileStream = createWriteStream(dest)
  let downloaded = 0
  let lastReported = 0

  // 用 Transform 在数据流过时统计字节数，再交给文件写入流。
  // 这样进度统计与 pipeline 的背压/销毁管理互不干扰，且 onProgress 抛错不会破坏下载。
  const counter = new Transform({
    transform(chunk, _enc, cb) {
      downloaded += chunk.length
      // 节流：每 256KB 或完成时才回调一次，避免大文件（96MB）上每 chunk 都跨 IPC 推送
      if (onProgress && (downloaded - lastReported >= 256 * 1024 || downloaded === total)) {
        lastReported = downloaded
        try {
          onProgress(downloaded, total)
        } catch {
          // 进度回调失败不应中断下载
        }
      }
      cb(null, chunk)
    },
  })

  try {
    await pipeline(source, counter, fileStream)
  } catch (err) {
    // 下载失败时清理半成品文件，避免后续把它当成完整 tarball 解压
    try {
      rmSync(dest, { force: true })
    } catch {
      // 忽略清理失败
    }
    throw err
  }
}

// ─── Extraction ────────────────────────────────────────────────────────

/**
 * 按顺序尝试候选 URL 列表下载，首个成功即返回；全部失败抛出最后一个错误。
 * 每个候选失败都会清理半成品文件，确保下一个候选从干净状态开始。
 *
 * 安全约束：调用方约定 `urls[0]` 为「直连原始 URL」（如 codeload.github.com），
 * 其余为「镜像前缀代理」（如 https://gh-proxy.com/<原始 URL>）。Authorization
 * 仅附加到直连请求——镜像是公开代理，不需要 GitHub 鉴权，把 Bearer token 发给
 * 镜像方会直接泄露凭据给第三方。
 */
async function downloadFromCandidates(
  urls: string[],
  dest: string,
  token: string | undefined,
  onProgress?: (downloaded: number, total: number) => void,
): Promise<void> {
  let lastErr: unknown
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i]!
    // 直连走 token；镜像不带任何鉴权头，避免凭据泄露到镜像方
    const authToken = i === 0 ? token : undefined
    try {
      await downloadFile(url, dest, authToken, onProgress)
      return
    } catch (err) {
      lastErr = err
      try {
        rmSync(dest, { force: true })
      } catch {
        // ignore cleanup failure
      }
      const label = i === 0 ? 'direct (codeload.github.com)' : `mirror ${url}`
      console.warn(
        `[tarball-installer] download via ${label} failed: ${
          err instanceof Error ? err.message : err
        }${i < urls.length - 1 ? '; trying next source…' : ''}`,
      )
    }
  }
  throw new Error(
    `All download sources failed. Last error: ${
      lastErr instanceof Error ? lastErr.message : lastErr
    }`,
  )
}

/** 用系统 tar 解压。成功返回 true；tar 不存在或失败返回 false。flags 默认 -xzf（tar.gz），zip 传 -xf。 */
function extractWithSystemTar(
  archivePath: string,
  destDir: string,
  flags: string[] = ['-xzf'],
): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn('tar', [...flags, archivePath, '-C', destDir], { stdio: 'ignore' })
    child.on('error', () => resolve(false))
    child.on('close', (code) => resolve(code === 0))
  })
}

/**
 * 纯 JS 解包回落方案：读取整个 tar.gz 到内存，gunzip，再按 POSIX tar 512 字节块解析。
 * 适合作为系统 tar 不可用时的兜底；大文件会占用较多内存，但 macOS/Linux/Windows 均自带 tar，极少走到这里。
 */
async function extractWithPureJs(tarballPath: string, destDir: string): Promise<void> {
  const gz = readFileSync(tarballPath)
  const tar = gunzipSync(gz)
  extractTarBuffer(tar, destDir)
}

/**
 * 纯 JS zip 解压兜底：当系统 tar 不支持 zip（典型：Linux 默认 GNU tar）时使用。
 * 只支持 Store (method 0) 与 Deflate (method 8) 两种压缩方式，覆盖 SkillHub 全部产物。
 * 对加密 / 分卷 / Zip64 之外的扩展不做处理（保留抛错，由调用方再降级）。
 */
function extractZipWithPureJs(zipPath: string, destDir: string): void {
  const buf = readFileSync(zipPath)
  if (buf.length < 22) throw new Error('zip file too small')

  // 从尾部向前扫描 EOCD 记录（最多 65557 字节 = 22 + 0xFFFF comment）
  const eocdSig = 0x06054b50
  let eocdOffset = -1
  const scanEnd = Math.min(buf.length, 65557)
  for (let i = buf.length - 22; i >= buf.length - scanEnd; i--) {
    if (i < 0) break
    if (buf.readUInt32LE(i) === eocdSig) {
      eocdOffset = i
      break
    }
  }
  if (eocdOffset < 0) throw new Error('zip: End of Central Directory record not found')

  const totalRecords = buf.readUInt16LE(eocdOffset + 10)
  const cdOffset = buf.readUInt32LE(eocdOffset + 16)
  if (cdOffset + totalRecords * 46 > buf.length) {
    throw new Error('zip: central directory offset out of range')
  }

  const cdSig = 0x02014b50
  const localSig = 0x04034b50

  let p = cdOffset
  for (let i = 0; i < totalRecords; i++) {
    if (buf.readUInt32LE(p) !== cdSig) throw new Error(`zip: bad central directory entry at ${p}`)
    const method = buf.readUInt16LE(p + 10)
    const compSize = buf.readUInt32LE(p + 20)
    const uncompSize = buf.readUInt32LE(p + 24)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const localOffset = buf.readUInt32LE(p + 42)
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen)
    p += 46 + nameLen + extraLen + commentLen

    // 跳过目录条目
    if (name.endsWith('/')) continue
    // 跳过加密/未知压缩
    if (method !== 0 && method !== 8) {
      throw new Error(`zip: unsupported compression method ${method} for ${name}`)
    }

    // 解析本地文件头
    if (buf.readUInt32LE(localOffset) !== localSig) {
      throw new Error(`zip: bad local file header at ${localOffset} for ${name}`)
    }
    const localNameLen = buf.readUInt16LE(localOffset + 26)
    const localExtraLen = buf.readUInt16LE(localOffset + 28)
    const dataStart = localOffset + 30 + localNameLen + localExtraLen

    // zip-slip 防护：解析后路径必须在 destDir 内
    const targetPath = safeJoinWithin(resolve(destDir), name)
    if (!targetPath) continue

    const compressed = buf.subarray(dataStart, dataStart + compSize)
    let data: Buffer
    if (method === 0) {
      data = compressed
    } else {
      // method 8: raw deflate (no zlib header)，与 zlib.inflateRaw 对应
      data = inflateRawSync(compressed, { maxOutputLength: Math.max(uncompSize, 1) })
    }
    mkdirSync(join(targetPath, '..'), { recursive: true })
    writeFileSync(targetPath, data)
  }
}

/** 解析 POSIX ustar/old-gnu tar 缓冲区并落盘。 */
function extractTarBuffer(buf: Buffer, destDir: string): void {
  const destRoot = resolve(destDir)
  let offset = 0
  while (offset + 512 <= buf.length) {
    const header = buf.subarray(offset, offset + 512)
    // 全零块 = 结束
    if (header.every((b) => b === 0)) break

    const name = readTarString(header, 0, 100)
    if (!name) {
      offset += 512
      continue
    }
    const size = parseTarOctal(header.subarray(124, 136))
    const typeflag = String.fromCharCode(header[156] ?? 0)

    offset += 512
    const fileEnd = offset + size
    const alignedEnd = fileEnd + (512 - (size % 512)) % 512

    // 只处理普通文件（'0' / '\0'）和目录（'5'）
    if (typeflag === '5') {
      const target = safeJoinWithin(destRoot, name)
      if (target) mkdirSync(target, { recursive: true })
    } else if (typeflag === '0' || typeflag === '\0' || typeflag === '') {
      const targetPath = safeJoinWithin(destRoot, name)
      if (!targetPath) {
        // 命中路径穿越（zip-slip），跳过该条目而非写入 destDir 之外
        offset = alignedEnd
        continue
      }
      mkdirSync(join(targetPath, '..'), { recursive: true })
      if (size > 0) {
        writeFileSync(targetPath, buf.subarray(offset, fileEnd))
      }
    }
    // 其它类型（软链/硬链/pax 扩展头等）跳过，足以覆盖技能目录的常规文件

    offset = alignedEnd
  }
}

/**
 * 安全地把 tar 内的相对路径拼到解包根目录下，防止 zip-slip（路径穿越）：
 * 仅当解析后的绝对路径仍位于 destRoot 之内时返回它，否则返回 null。
 */
function safeJoinWithin(destRoot: string, relName: string): string | null {
  const target = resolve(destRoot, relName)
  if (target === destRoot || target.startsWith(destRoot + sep)) return target
  return null
}

function readTarString(buf: Buffer, start: number, end: number): string {
  return buf.subarray(start, end).toString('utf8').replace(/\0+$/, '').trim()
}

function parseTarOctal(buf: Buffer): number {
  const str = buf.toString('utf8').replace(/\0.*$/, '').trim()
  if (!str) return 0
  return parseInt(str, 8) || 0
}

// ─── Filesystem helpers ────────────────────────────────────────────────

/** 找到解包目录下唯一的顶层子目录（tarball 标准结构：<repo>-<ref>/）；不唯一返回 null。 */
function findSingleTopLevelDir(extractDir: string): string | null {
  let entries: string[]
  try {
    entries = readdirSync(extractDir)
  } catch {
    return null
  }
  const dirs = entries.filter((e) => {
    try {
      return statSync(join(extractDir, e)).isDirectory()
    } catch {
      return false
    }
  })
  if (dirs.length === 1) {
    const dir = dirs[0]
    if (dir) return join(extractDir, dir)
  }
  return null
}

function countFiles(root: string): number {
  let count = 0
  const walk = (dir: string): void => {
    let entries: import('node:fs').Dirent[]
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.name === '.DS_Store') continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else count += 1
    }
  }
  walk(root)
  return count
}

/** 递归复制目录（保留权限与符号链接）。 */
function copyDirSync(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true })
  const entries = readdirSync(src, { withFileTypes: true })
  for (const entry of entries) {
    const srcPath = join(src, entry.name)
    const destPath = join(dest, entry.name)
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath)
    } else if (entry.isSymbolicLink()) {
      // 软链接原样重建（技能里可能有相对符号链接）
      try {
        symlinkSync(readlinkSync(srcPath), destPath)
      } catch {
        // 链接失败则跳过
      }
    } else {
      copyFileSync(srcPath, destPath)
      try {
        // 用 lstat 避免对符号链接解引用（此处已是常规文件，但保持一致更稳妥）
        const st = lstatSync(srcPath)
        chmodSync(destPath, st.mode & 0o777)
      } catch {
        // 权限设置失败忽略
      }
    }
  }
}

/**
 * 根据 repo + path 生成稳定的安装来源指纹（用于 DB 记录 id 去重）。
 */
export function tarballSourceFingerprint(repo: string, path?: string): string {
  const key = `${repo}/${path ?? ''}`
  return createHash('sha1').update(key).digest('hex').slice(0, 12)
}
