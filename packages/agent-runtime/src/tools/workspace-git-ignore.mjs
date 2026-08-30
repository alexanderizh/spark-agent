/**
 * 平台托管目录的 git 忽略治理（best-effort，绝不影响原写入链路）。
 *
 * 背景：`.spark-agent/tool-results/`、`.spark-agent/sub-app-sources/`、`.spark-artifacts/`
 * 是平台在用户工作区内自动产生的临时产物目录，未忽略时容易被 `git add .` 连带提交。
 * 本模块在首次写入这些目录时，把对应条目追加到仓库本地忽略文件 `.git/info/exclude`：
 * - 不碰用户被 git 跟踪的任何文件（不改 .gitignore、不产生脏状态）；
 * - info/exclude 不随仓库共享，符合「平台临时产物不该进用户仓库」的语义；
 * - `.spark-agent/memory/` 是项目长期记忆，有随仓库共享的价值，刻意不在此处理，
 *   由内置提示词引导 agent 在合适时机询问用户后决定。
 *
 * 幂等与安全：
 * - 进程内按「仓库 + 条目」只尝试一次（成功或失败都缓存），后续调用零 IO；
 * - 写入前做行级去重：exclude / 仓库根 .gitignore 中已存在精确条目或祖先目录条目即跳过；
 * - 兼容 worktree / submodule 的 `.git` 文件形态（linked worktree 写共享 common dir 的 exclude）；
 * - 任何失败（无仓库、权限、磁盘等）静默返回，不影响调用方。
 */
import { appendFileSync, lstatSync, mkdirSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'

const EXCLUDE_MARKER = '# Spark Work platform artifacts (auto-added local ignore):'

/** `目录段` 合法性：与 workspace-content-store 的 SAFE_SEGMENT 保持一致口径。 */
const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/

/** 进程内已处理（成功或失败）的 `${excludePath}\0${entry}`，避免热路径重复 IO 与重复失败。 */
const attempted = new Set()

/**
 * 确保 `workspaceRoot/<segments...>` 目录在所属 git 仓库中被忽略（写 .git/info/exclude）。
 * 仅适用于平台自动产生的临时产物目录；不适用于用户数据目录（如 .spark-agent/memory）。
 */
export function ensureWorkspaceManagedDirIgnored(workspaceRoot, directorySegments) {
  try {
    if (typeof workspaceRoot !== 'string' || workspaceRoot.trim().length === 0) return
    if (!Array.isArray(directorySegments) || directorySegments.length === 0) return
    for (const segment of directorySegments) {
      if (
        typeof segment !== 'string' ||
        !SAFE_SEGMENT.test(segment) ||
        segment === '.' ||
        segment === '..'
      ) {
        return
      }
    }

    let realRoot
    try {
      realRoot = realpathSync(workspaceRoot)
    } catch {
      return
    }

    const repo = resolveGitRepo(realRoot)
    if (repo == null) return

    const prefix = toPosixRelative(repo.repoRoot, realRoot)
    const entry = `${prefix}${directorySegments.join('/')}/`
    const cacheKey = `${repo.excludePath}\0${entry}`
    if (attempted.has(cacheKey)) return

    const existingLines = readIgnoreCandidateLines(repo)
    if (isEntryAlreadyIgnored(entry, prefix, directorySegments, existingLines)) {
      attempted.add(cacheKey)
      return
    }

    mkdirSync(dirname(repo.excludePath), { recursive: true })
    const current = readFileOrNull(repo.excludePath) ?? ''
    const suffix = current.length > 0 && !current.endsWith('\n') ? '\n' : ''
    const markerBlock = current.includes(EXCLUDE_MARKER) ? '' : `${EXCLUDE_MARKER}\n`
    appendFileSync(repo.excludePath, `${suffix}${markerBlock}${entry}\n`)
    attempted.add(cacheKey)
  } catch {
    // best-effort：忽略治理失败不阻断产物写入。
  }
}

/**
 * 从 `startDir` 向上定位 git 仓库。
 * 返回 exclude 文件绝对路径与「条目前缀基准根」（找到 .git 的那一层工作树根）。
 * 兼容三种形态：
 * - `.git` 目录：普通仓库，exclude = <gitDir>/info/exclude；
 * - `.git` 文件且 gitdir 下有 commondir（linked worktree）：写共享 common dir 的 exclude；
 * - `.git` 文件无 commondir（submodule）：写模块自身 gitdir 的 exclude。
 */
function resolveGitRepo(startDir) {
  let current = startDir
  for (;;) {
    const dotGit = join(current, '.git')
    let item
    try {
      item = lstatSync(dotGit)
    } catch {
      // 本级没有 .git，继续向上。
    }
    if (item != null) {
      if (item.isSymbolicLink()) return null
      if (item.isDirectory()) {
        return { repoRoot: current, excludePath: join(dotGit, 'info', 'exclude') }
      }
      if (item.isFile()) {
        const gitDir = resolveDotGitFileDir(dotGit, current)
        if (gitDir == null) return null
        const excludePath = join(resolveExcludeBaseDir(gitDir), 'info', 'exclude')
        return { repoRoot: current, excludePath }
      }
      return null
    }
    const parent = dirname(current)
    if (parent === current) return null
    current = parent
  }
}

/** 解析 `.git` 文件（`gitdir: <path>`），相对路径按 git 标准相对该文件所在目录。 */
function resolveDotGitFileDir(dotGitPath, dotGitDir) {
  const content = readFileOrNull(dotGitPath)
  if (content == null) return null
  const match = /^gitdir:\s*(.+)$/m.exec(content)
  if (match == null) return null
  const raw = match[1].trim()
  if (raw.length === 0) return null
  return isAbsolute(raw) ? raw : join(dotGitDir, raw)
}

/**
 * linked worktree 的 gitdir 下有 `commondir` 指向主仓库 .git；info/exclude 属于
 * 共享路径，写 common dir 才能对 worktree 生效。submodule 的模块 gitdir 无 commondir，
 * 直接写自身。commondir 内容相对 gitdir 解析。
 */
function resolveExcludeBaseDir(gitDir) {
  const commonRaw = readFileOrNull(join(gitDir, 'commondir'))
  if (commonRaw == null) return gitDir
  const common = commonRaw.trim()
  if (common.length === 0) return gitDir
  return isAbsolute(common) ? common : join(gitDir, common)
}

/** 汇总「可能已经写了忽略」的文件行：exclude 本体 + 仓库根 .gitignore。 */
function readIgnoreCandidateLines(repo) {
  const lines = new Set()
  for (const file of [repo.excludePath, join(repo.repoRoot, '.gitignore')]) {
    const content = readFileOrNull(file)
    if (content == null) continue
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (trimmed.length > 0 && !trimmed.startsWith('#')) lines.add(trimmed)
    }
  }
  return lines
}

/**
 * 判断目标条目是否已被覆盖：精确匹配，或存在任一「祖先目录条目」（带前缀/无前缀两种
 * 常见写法）。不做完整 gitignore 语义解析——识别不了的写法最多导致多写一条冗余本地
 * 条目，无功能影响。
 */
function isEntryAlreadyIgnored(entry, prefix, segments, existingLines) {
  if (existingLines.has(entry)) return true
  const candidates = new Set([entry])
  // 无前缀写法（`.spark-agent/tool-results/`）在任意层级生效，同样视为已忽略。
  candidates.add(`${segments.join('/')}/`)
  for (let i = 1; i <= segments.length; i += 1) {
    candidates.add(`${prefix}${segments.slice(0, i).join('/')}/`)
    candidates.add(`${segments.slice(0, i).join('/')}/`)
  }
  for (const candidate of candidates) {
    if (existingLines.has(candidate)) return true
  }
  return false
}

function readFileOrNull(filePath) {
  try {
    return readFileSync(filePath, 'utf8')
  } catch {
    return null
  }
}

/** repo 根到目标的相对路径（posix 分隔），作为 gitignore 条目前缀；同根时为空串。 */
function toPosixRelative(from, to) {
  const rel = relative(from, to)
  if (rel.length === 0) return ''
  return `${rel.split(sep).join('/')}/`
}
