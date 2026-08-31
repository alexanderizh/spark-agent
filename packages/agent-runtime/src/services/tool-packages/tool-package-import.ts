import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { isAbsolute, join, sep } from 'node:path'
import { unzip, type UnzipFileInfo } from 'fflate'
import { terminateProcessTree, waitForExit } from './tool-package-project-runner.js'

const MANIFEST_NAME = 'spark-tool.json'

/** 压缩包本体上限：解压需要整包进入内存，超过该尺寸请改用本地目录安装。 */
const MAX_ARCHIVE_BYTES = 256 * 1024 * 1024
/** 与 inspector 的包体检查对齐：条目数与解压总量双重限额。 */
const MAX_IMPORT_ENTRIES = 50_000
const MAX_IMPORT_UNCOMPRESSED_BYTES = 2 * 1024 * 1024 * 1024
const DEFAULT_CLONE_TIMEOUT_MS = 5 * 60 * 1000
const MAX_CLONE_TIMEOUT_MS = 15 * 60 * 1000
const MAX_STDERR_TAIL_BYTES = 4 * 1024

export interface ToolPackageImportLimits {
  maxArchiveBytes?: number
  maxEntries?: number
  maxUncompressedBytes?: number
}

export interface MaterializedImport {
  /** 指向含 spark-tool.json 的包根目录（可能是解压根或其唯一包裹子目录）。 */
  root: string
  cleanup: () => Promise<void>
}

/* -------------------------------------------------------------------------
 * 压缩包导入
 * ---------------------------------------------------------------------- */

/**
 * 将 zip 压缩包解压到 extractRoot 下的独立目录并定位包根。
 *
 * 安全边界：
 * - 拒绝 zip-slip（绝对路径 / 反斜杠 / `..` 段）条目；
 * - 跳过 `.git/`、`__MACOSX/`、`.DS_Store`；
 * - 压缩包本体、条目数、解压总量三重限额（防 zip 炸弹）；
 * - 永不物化符号链接（fflate 不暴露条目属性，我们只写普通文件），
 *   因此压缩包无法引入 inspector 拒绝的 symlink 攻击面。
 */
export async function extractToolPackageArchive(params: {
  archivePath: string
  extractRoot: string
  limits?: ToolPackageImportLimits
}): Promise<MaterializedImport> {
  const limits = {
    maxArchiveBytes: params.limits?.maxArchiveBytes ?? MAX_ARCHIVE_BYTES,
    maxEntries: params.limits?.maxEntries ?? MAX_IMPORT_ENTRIES,
    maxUncompressedBytes: params.limits?.maxUncompressedBytes ?? MAX_IMPORT_UNCOMPRESSED_BYTES,
  }
  const archivePath = params.archivePath
  const archiveInfo = await stat(archivePath).catch(() => null)
  if (archiveInfo == null || !archiveInfo.isFile()) {
    throw new Error(`Tool package archive not found: ${archivePath}`)
  }
  if (archiveInfo.size > limits.maxArchiveBytes) {
    throw new Error(
      `Tool package archive exceeds the ${Math.floor(limits.maxArchiveBytes / 1024 / 1024)} MB limit; install from the unpacked directory instead`,
    )
  }

  const extractDir = join(params.extractRoot, `archive-${randomUUID()}`)
  await mkdir(extractDir, { recursive: true })

  try {
    const buffer = await readFile(archivePath)
    const entries = await decompressArchive(buffer, limits)
    for (const [name, data] of Object.entries(entries)) {
      const destination = join(extractDir, name)
      await mkdir(extractDirName(destination), { recursive: true })
      await writeFile(destination, data)
    }
    const root = await resolvePackageRoot(extractDir)
    return {
      root,
      cleanup: () => rm(extractDir, { recursive: true, force: true }),
    }
  } catch (error) {
    await rm(extractDir, { recursive: true, force: true })
    throw error
  }
}

function decompressArchive(
  buffer: Buffer,
  limits: Required<ToolPackageImportLimits>,
): Promise<Record<string, Uint8Array>> {
  return new Promise((resolveEntries, rejectEntries) => {
    let entryCount = 0
    let totalBytes = 0
    let rejected: string | null = null
    unzip(
      new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength),
      {
        filter: (info: UnzipFileInfo) => {
          if (rejected != null) return false
          if (isSkippedArchiveEntry(info.name)) return false
          const violation = findUnsafeArchiveEntry(info.name)
          if (violation != null) {
            rejected = violation
            return false
          }
          entryCount += 1
          totalBytes += info.size
          if (entryCount > limits.maxEntries) {
            rejected = `Tool package archive exceeds the ${limits.maxEntries} entry limit`
            return false
          }
          if (totalBytes > limits.maxUncompressedBytes) {
            rejected = 'Tool package archive exceeds the uncompressed size limit'
            return false
          }
          return true
        },
      },
      (error, unzipped) => {
        if (rejected != null) {
          rejectEntries(new Error(rejected))
          return
        }
        if (error != null) {
          rejectEntries(
            new Error(`Tool package archive could not be read as a zip file: ${error.message}`, {
              cause: error,
            }),
          )
          return
        }
        if (unzipped == null || Object.keys(unzipped).length === 0) {
          rejectEntries(new Error('Tool package archive contains no usable entries'))
          return
        }
        resolveEntries(unzipped as Record<string, Uint8Array>)
      },
    )
  })
}

function findUnsafeArchiveEntry(name: string): string | null {
  if (name.length === 0) return 'Tool package archive contains an empty entry name'
  if (name.startsWith('/') || /^[A-Za-z]:/.test(name)) {
    return `Tool package archive contains an absolute entry path: ${name}`
  }
  if (name.includes('\\')) {
    return `Tool package archive contains a backslash entry path: ${name}`
  }
  if (name.split('/').includes('..')) {
    return `Tool package archive contains a path traversal entry: ${name}`
  }
  return null
}

function isSkippedArchiveEntry(name: string): boolean {
  const first = name.split('/')[0]
  return (
    first === '.git' || first === '__MACOSX' || name === '.DS_Store' || name.endsWith('/.DS_Store')
  )
}

function extractDirName(destination: string): string {
  const index = destination.lastIndexOf(sep)
  return index <= 0 ? sep : destination.slice(0, index)
}

/** 根目录无 manifest 时，识别唯一一层包裹目录（常见 zip 打包形态）。 */
async function resolvePackageRoot(extractDir: string): Promise<string> {
  if (await isFile(join(extractDir, MANIFEST_NAME))) return extractDir
  const entries = await readdir(extractDir, { withFileTypes: true })
  const directories = entries.filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
  if (directories.length === 1) {
    const candidate = join(extractDir, directories[0]!.name)
    if (await isFile(join(candidate, MANIFEST_NAME))) return candidate
  }
  throw new Error(
    `Tool package archive root does not contain ${MANIFEST_NAME}; if the archive nests the package in one directory it is detected automatically, otherwise unpack it and install from the directory`,
  )
}

async function isFile(path: string): Promise<boolean> {
  const info = await lstat(path).catch(() => null)
  return info != null && info.isFile() && !info.isSymbolicLink()
}

/* -------------------------------------------------------------------------
 * Git 仓库导入
 * ---------------------------------------------------------------------- */

export interface ResolvedGitSource {
  /** 传给 git clone 的最终地址（GitHub 简写已展开）。 */
  url: string
  /** true 表示输入是 owner/repo 简写，已展开为 GitHub https 地址。 */
  expandedShorthand: boolean
  /** true 表示按本地仓库路径克隆（离线 / 内网 / 测试场景）。 */
  localPath: boolean
}

/**
 * 规范化用户输入的 Git 来源。支持：
 * - `owner/repo` GitHub 简写 → `https://github.com/owner/repo.git`
 * - https / http / ssh / scp 形式（git@host:path）完整地址
 * - 本地仓库路径（绝对路径，或 ./ ../ 开头的相对路径，目录内须有 .git）
 */
export function resolveGitImportSource(raw: string): ResolvedGitSource {
  const input = raw.trim()
  if (input.length === 0) throw new Error('Git repository URL is empty')
  if (input.length > 2000) throw new Error('Git repository URL exceeds the length limit')
  if (input.startsWith('-')) throw new Error('Git repository URL must not start with "-"')
  if (/[\s]/.test(input)) throw new Error('Git repository URL must not contain whitespace')

  if (/^https:\/\/|^http:\/\/|^ssh:\/\/|^git:\/\//.test(input)) {
    return { url: input, expandedShorthand: false, localPath: false }
  }
  if (/^git@[A-Za-z0-9._-]+:/.test(input)) {
    return { url: input, expandedShorthand: false, localPath: false }
  }
  if (
    isAbsolute(input) ||
    input.startsWith('./') ||
    input.startsWith('../') ||
    /^[A-Za-z]:[\\/]/.test(input)
  ) {
    return { url: input, expandedShorthand: false, localPath: true }
  }
  if (/^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9_.-]+$/.test(input)) {
    return {
      url: `https://github.com/${input}.git`,
      expandedShorthand: true,
      localPath: false,
    }
  }
  throw new Error(
    'Unsupported git source; use a full URL (https://…), an scp-style address (git@host:path), owner/repo GitHub shorthand, or a local repository path',
  )
}

export function validateGitRef(ref: string): string {
  const value = ref.trim()
  if (value.length === 0) throw new Error('Git ref is empty')
  if (value.length > 200) throw new Error('Git ref exceeds the length limit')
  if (value.startsWith('-') || value.startsWith('/')) {
    throw new Error('Git ref must not start with "-" or "/"')
  }
  if (!/^[A-Za-z0-9._/-]+$/.test(value) || value.includes('..')) {
    throw new Error(`Unsupported git ref (use a branch or tag name): ${ref}`)
  }
  return value
}

export function validateGitSubdirectory(subdirectory: string): string {
  const value = subdirectory.trim()
  if (
    value.length === 0 ||
    value.startsWith('/') ||
    value.includes('\\') ||
    value.split('/').includes('..')
  ) {
    throw new Error(`Unsafe tool package subdirectory: ${subdirectory}`)
  }
  return value
}

export interface GitCloneResult {
  /** 克隆产物目录（含 .git，inspector 会自动忽略 .git 条目）。 */
  clonePath: string
  resolvedUrl: string
  ref: string | null
  stderrTail: string
  durationMs: number
}

/** 浅克隆（--depth 1 + --branch ref）到 targetDir；超时杀整棵进程树。 */
export async function cloneGitRepository(params: {
  source: ResolvedGitSource
  ref?: string
  targetDir: string
  timeoutMs?: number
}): Promise<GitCloneResult> {
  await assertGitAvailable()
  const ref = params.ref == null ? null : validateGitRef(params.ref)
  if (params.source.localPath) {
    const info = await stat(params.source.url).catch(() => null)
    const gitDir = info?.isDirectory() === true ? join(params.source.url, '.git') : null
    const gitInfo = gitDir == null ? null : await stat(gitDir).catch(() => null)
    if (info == null || !info.isDirectory() || gitInfo == null) {
      throw new Error(
        `Local git repository not found (expected a directory containing .git): ${params.source.url}`,
      )
    }
  }

  const timeoutMs = Math.min(params.timeoutMs ?? DEFAULT_CLONE_TIMEOUT_MS, MAX_CLONE_TIMEOUT_MS)
  const startedAt = Date.now()
  const args = [
    'clone',
    '--depth',
    '1',
    '--no-hardlinks',
    ...(ref == null ? [] : ['--branch', ref]),
    '--',
    params.source.url,
    params.targetDir,
  ]
  const child = spawn('git', args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
    env: buildCloneEnvironment(),
  })

  let stderrTail = ''
  let stderrBytes = 0
  child.stderr?.on('data', (chunk: Buffer) => {
    stderrBytes += chunk.length
    if (stderrTail.length < MAX_STDERR_TAIL_BYTES) stderrTail += chunk.toString('utf8')
  })

  const exitedBeforeTimeout = await new Promise<boolean>((resolveExited) => {
    let settled = false
    const finish = (exited: boolean): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.off('exit', onExit)
      child.off('error', onError)
      resolveExited(exited)
    }
    const onExit = (): void => finish(true)
    const onError = (): void => finish(true)
    const timer = setTimeout(() => finish(false), timeoutMs)
    child.once('exit', onExit)
    child.once('error', onError)
  })

  if (!exitedBeforeTimeout) {
    terminateProcessTree(child)
    await waitForExit(child, 15_000)
    throw new Error(
      `git clone timed out after ${Math.round(timeoutMs / 1000)}s: ${params.source.url}`,
    )
  }
  if (child.exitCode !== 0 || child.exitCode == null) {
    const detail = stderrTail.trim().split('\n').slice(-4).join('\n')
    const hint =
      ref != null && /not found|ambiguous argument|unknown revision/i.test(stderrTail)
        ? `; check that the branch or tag "${ref}" exists`
        : ''
    throw new Error(
      `git clone failed (exit ${child.exitCode ?? 'unknown'}) for ${params.source.url}${hint}${detail.length > 0 ? `:\n${detail}` : ''}`,
    )
  }

  return {
    clonePath: params.targetDir,
    resolvedUrl: params.source.url,
    ref,
    stderrTail,
    durationMs: Date.now() - startedAt,
  }
}

async function assertGitAvailable(): Promise<void> {
  const available = await new Promise<boolean>((resolveAvailable) => {
    const probe = spawn('git', ['--version'], { stdio: 'ignore' })
    const timer = setTimeout(() => {
      terminateProcessTree(probe)
      resolveAvailable(false)
    }, 10_000)
    probe.once('exit', (code) => {
      clearTimeout(timer)
      resolveAvailable(code === 0)
    })
    probe.once('error', () => {
      clearTimeout(timer)
      resolveAvailable(false)
    })
  })
  if (!available) {
    throw new Error(
      'git is not available on this machine; install Git from https://git-scm.com/downloads (or via your package manager) before importing tool packages from Git',
    )
  }
}

function buildCloneEnvironment(): NodeJS.ProcessEnv {
  const inheritedNames = [
    'PATH',
    'Path',
    'PATHEXT',
    'HOME',
    'USERPROFILE',
    'SystemRoot',
    'WINDIR',
    'TEMP',
    'TMP',
    'TMPDIR',
    'LANG',
    'LC_ALL',
    'SSH_AUTH_SOCK',
    'http_proxy',
    'https_proxy',
    'all_proxy',
    'no_proxy',
    'HTTP_PROXY',
    'HTTPS_PROXY',
    'ALL_PROXY',
    'NO_PROXY',
  ]
  const inherited = Object.fromEntries(
    inheritedNames.flatMap((name) =>
      process.env[name] == null ? [] : ([[name, process.env[name]]] as Array<[string, string]>),
    ),
  )
  return {
    ...inherited,
    // 私有仓库缺凭据时快速失败，而不是挂在终端凭据提示上。
    GIT_TERMINAL_PROMPT: '0',
  }
}
