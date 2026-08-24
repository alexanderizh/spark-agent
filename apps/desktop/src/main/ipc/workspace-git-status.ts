import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type {
  WorkspaceGitFileChange,
  WorkspaceGitFileDiffResponse,
  WorkspaceGitBranch,
  WorkspaceGitStashEntry,
  WorkspaceGitStatusResponse,
  WorkspaceGitCommitEntry,
  WorkspaceGitLogResponse,
} from '@spark/protocol'
import { getUntrackedFilesLineStats } from './git-status-utils.js'

const execFileAsync = promisify(execFile)

type GitFileStats = { additions: number; deletions: number }

type GitComparison = {
  ahead: number
  behind: number
  baseRef: string
  remoteBranch: string | null
  remoteName: string | null
  remoteUrl: string | null
}

/** 标签列表上限：大仓库可能数千个 tag，全量下发会拖垮弹窗渲染。 */
const GIT_TAG_LIST_LIMIT = 200

/**
 * 列出仓库标签（按创建时间倒序，截取最近 LIMIT 个）。
 * creatordate 对附注标签取 taggerdate、对轻量标签取指向 commit 的提交时间，
 * 与 `git tag --sort` 的默认口径一致，适合直接作为展示排序。
 */
async function listWorkspaceTags(rootPath: string): Promise<WorkspaceGitBranch[]> {
  const out = await tryGitRawStdout(rootPath, [
    'for-each-ref',
    `--count=${GIT_TAG_LIST_LIMIT}`,
    '--sort=-creatordate',
    '--format=%(refname)%09%(creatordate:unix)',
    'refs/tags',
  ])
  if (out == null) return []
  return out.split(/\r?\n/).flatMap((line): WorkspaceGitBranch[] => {
    const [refName, timestamp = '0'] = line.split('\t')
    if (!refName?.startsWith('refs/tags/')) return []
    const name = refName.slice('refs/tags/'.length)
    if (name.length === 0) return []
    return [{ name, kind: 'tag', updatedAt: Number(timestamp) * 1000 || 0 }]
  })
}

/**
 * 解析分离头指针下的展示名：优先 HEAD 精确命中的 tag 名（最常见场景：
 * 用户刚检出某个 tag），否则退回短 SHA。
 */
async function resolveDetachedHeadLabel(rootPath: string): Promise<string | null> {
  const exactTag = await tryGitStdout(rootPath, ['describe', '--tags', '--exact-match', 'HEAD'])
  if (exactTag != null && exactTag.length > 0) return exactTag
  const shortSha = await tryGitStdout(rootPath, ['rev-parse', '--short', 'HEAD'])
  return shortSha != null && shortSha.length > 0 ? shortSha : null
}

export async function getWorkspaceBranches(rootPath: string): Promise<{
  currentBranch: string | null
  detachedHead: boolean
  branches: string[]
  branchDetails: WorkspaceGitBranch[]
}> {
  try {
    const [current, refs, tags] = await Promise.all([
      execFileAsync('git', ['branch', '--show-current'], { cwd: rootPath }),
      execFileAsync(
        'git',
        [
          'for-each-ref',
          '--format=%(refname)%09%(committerdate:unix)',
          'refs/heads',
          'refs/remotes',
        ],
        { cwd: rootPath },
      ),
      listWorkspaceTags(rootPath),
    ])
    const branchDetails = refs.stdout
      .split(/\r?\n/)
      .flatMap((line): WorkspaceGitBranch[] => {
        const [refName, timestamp = '0'] = line.split('\t')
        if (refName?.startsWith('refs/heads/')) {
          return [
            {
              name: refName.slice('refs/heads/'.length),
              kind: 'local',
              updatedAt: Number(timestamp) * 1000 || 0,
            },
          ]
        }
        if (refName?.startsWith('refs/remotes/') && !refName.endsWith('/HEAD')) {
          return [
            {
              name: refName.slice('refs/remotes/'.length),
              kind: 'remote',
              updatedAt: Number(timestamp) * 1000 || 0,
            },
          ]
        }
        return []
      })
      .concat(tags)
      .sort((a, b) => b.updatedAt - a.updatedAt || a.name.localeCompare(b.name))
    const branchList = branchDetails
      .filter((branch) => branch.kind === 'local')
      .map((branch) => branch.name)
    const rawCurrent = current.stdout.trim()
    if (rawCurrent.length > 0) {
      return { currentBranch: rawCurrent, detachedHead: false, branches: branchList, branchDetails }
    }
    // 分离头指针：`branch --show-current` 输出为空。旧实现错误回退到 branchList[0]，
    // 会把列表第一个本地分支误当当前分支；这里如实标记 detached 并展示 tag 名/短 SHA。
    const detachedLabel = await resolveDetachedHeadLabel(rootPath)
    return {
      currentBranch: detachedLabel,
      detachedHead: true,
      branches: branchList,
      branchDetails,
    }
  } catch {
    return { currentBranch: null, detachedHead: false, branches: [], branchDetails: [] }
  }
}

function emptyGitStatus(): WorkspaceGitStatusResponse {
  return {
    isGitRepo: false,
    currentBranch: null,
    detachedHead: false,
    branches: [],
    branchDetails: [],
    ahead: 0,
    behind: 0,
    additions: 0,
    deletions: 0,
    changedFiles: 0,
    stagedFiles: 0,
    unstagedFiles: 0,
    untrackedFiles: 0,
    hasRemote: false,
    remoteName: null,
    remoteBranch: null,
    pullRequestUrl: null,
    stashEntries: [],
    files: [],
  }
}

export function getGitExecErrorMessage(err: unknown, fallback: string): string {
  if (err != null && typeof err === 'object') {
    const maybe = err as { stderr?: unknown; stdout?: unknown; message?: unknown }
    const stderr = typeof maybe.stderr === 'string' ? maybe.stderr.trim() : ''
    if (stderr.length > 0) return stderr
    const stdout = typeof maybe.stdout === 'string' ? maybe.stdout.trim() : ''
    if (stdout.length > 0) return stdout
    if (typeof maybe.message === 'string' && maybe.message.length > 0) return maybe.message
  }
  return fallback
}

function parseGitPorcelainPath(rawPath: string): string {
  const renamedPath = rawPath.includes(' -> ') ? rawPath.split(' -> ').pop() : rawPath
  return (renamedPath ?? rawPath).replace(/^"|"$/g, '')
}

function parseGitNumstat(stdout: string): Map<string, GitFileStats> {
  const result = new Map<string, GitFileStats>()
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue
    const [addsRaw, delsRaw, ...pathParts] = line.split('\t')
    const filePath = parseGitPorcelainPath(pathParts.join('\t'))
    if (!filePath) continue
    result.set(filePath, {
      additions: addsRaw === '-' ? 0 : Number(addsRaw) || 0,
      deletions: delsRaw === '-' ? 0 : Number(delsRaw) || 0,
    })
  }
  return result
}

function mergeGitStats(primary: Map<string, GitFileStats>, fallback: Map<string, GitFileStats>) {
  const result = new Map(primary)
  for (const [filePath, stats] of fallback) {
    if (!result.has(filePath)) result.set(filePath, stats)
  }
  return result
}

function parseGitPorcelainChanges(
  stdout: string,
  statsByPath: Map<string, GitFileStats>,
): WorkspaceGitFileChange[] {
  return stdout
    .split(/\r?\n/)
    .map((line): WorkspaceGitFileChange | null => {
      if (line.length < 3) return null
      const x = line[0] ?? ' '
      const y = line[1] ?? ' '
      const filePath = parseGitPorcelainPath(line.slice(3))
      if (!filePath) return null
      const untracked = x === '?' && y === '?'
      const staged = !untracked && x !== ' '
      const unstaged = !untracked && y !== ' '
      const stats = statsByPath.get(filePath) ?? { additions: 0, deletions: 0 }
      return {
        path: filePath,
        status: `${x}${y}`.trim() || '??',
        staged,
        unstaged,
        untracked,
        additions: stats.additions,
        deletions: stats.deletions,
      }
    })
    .filter((item): item is WorkspaceGitFileChange => item != null)
}

function parseGitNameStatusChanges(
  stdout: string,
  statsByPath: Map<string, GitFileStats>,
): WorkspaceGitFileChange[] {
  const tokens = stdout.split('\0')
  const changes: WorkspaceGitFileChange[] = []
  let cursor = 0
  while (cursor < tokens.length) {
    const rawStatus = tokens[cursor++]?.trim() ?? ''
    if (!rawStatus) continue
    const status = rawStatus[0] ?? 'M'
    const firstPath = tokens[cursor++] ?? ''
    const filePath = status === 'R' || status === 'C' ? (tokens[cursor++] ?? '') : firstPath
    if (!filePath) continue
    const stats = statsByPath.get(filePath) ?? { additions: 0, deletions: 0 }
    changes.push({
      path: filePath,
      status,
      staged: false,
      unstaged: false,
      untracked: false,
      additions: stats.additions,
      deletions: stats.deletions,
    })
  }
  return changes
}

function mergeReviewChanges(
  baselineChanges: WorkspaceGitFileChange[],
  pendingChanges: WorkspaceGitFileChange[],
): WorkspaceGitFileChange[] {
  const byPath = new Map(baselineChanges.map((change) => [change.path, change]))
  for (const pending of pendingChanges) {
    byPath.set(pending.path, pending)
  }
  return [...byPath.values()]
}

function parseGitStashList(stdout: string): WorkspaceGitStashEntry[] {
  return stdout
    .split('\x1e')
    .map((record, index): WorkspaceGitStashEntry | null => {
      const trimmed = record.trim()
      if (!trimmed) return null
      const [selectorRaw, hashRaw, dateRaw, ...messageParts] = trimmed.split('\x1f')
      const selector = selectorRaw?.trim() ?? ''
      if (!selector) return null
      return {
        index,
        selector,
        hash: hashRaw?.trim() ?? '',
        date: dateRaw?.trim() || null,
        message: messageParts.join('\x1f').trim(),
      }
    })
    .filter((item): item is WorkspaceGitStashEntry => item != null)
}

export async function tryGitStdout(rootPath: string, args: string[]): Promise<string | null> {
  try {
    const result = await execFileAsync('git', args, { cwd: rootPath })
    return result.stdout.trim()
  } catch {
    return null
  }
}

async function tryGitRawStdout(rootPath: string, args: string[]): Promise<string | null> {
  try {
    const result = await execFileAsync('git', args, { cwd: rootPath })
    return result.stdout.replace(/\r?\n$/, '')
  } catch {
    return null
  }
}

async function tryGitDiffStdout(rootPath: string, args: string[]): Promise<string | null> {
  try {
    const result = await execFileAsync('git', args, { cwd: rootPath })
    return result.stdout.trim()
  } catch (err) {
    const gitError = err as { code?: number | string; stdout?: unknown }
    if (
      Number(gitError.code) === 1 &&
      typeof gitError.stdout === 'string' &&
      gitError.stdout.length > 0
    ) {
      return gitError.stdout.trim()
    }
    return null
  }
}

async function findRemoteComparisonRef(
  rootPath: string,
  remoteName: string,
): Promise<string | null> {
  const remoteHead = await tryGitStdout(rootPath, [
    'symbolic-ref',
    '--quiet',
    '--short',
    `refs/remotes/${remoteName}/HEAD`,
  ])
  if (remoteHead) return remoteHead

  for (const branch of ['main', 'master']) {
    const candidate = `${remoteName}/${branch}`
    if ((await tryGitStdout(rootPath, ['rev-parse', '--verify', '--quiet', candidate])) != null) {
      return candidate
    }
  }
  return null
}

async function resolveGitComparison(rootPath: string): Promise<GitComparison> {
  const upstream = await tryGitStdout(rootPath, [
    'rev-parse',
    '--abbrev-ref',
    '--symbolic-full-name',
    '@{u}',
  ])
  const firstRemote = await tryGitStdout(rootPath, ['remote'])
  const remoteNames = (firstRemote ?? '').split(/\r?\n/).filter(Boolean)
  const upstreamRemoteCandidate = upstream?.split('/')[0]
  const remoteNameFromUpstream =
    upstreamRemoteCandidate != null && remoteNames.includes(upstreamRemoteCandidate)
      ? upstreamRemoteCandidate
      : null
  const remoteName = remoteNameFromUpstream ?? remoteNames[0] ?? null
  const comparisonRef =
    upstream ?? (remoteName == null ? null : await findRemoteComparisonRef(rootPath, remoteName))
  const baseRef =
    (comparisonRef == null
      ? null
      : await tryGitStdout(rootPath, ['merge-base', 'HEAD', comparisonRef])) ?? 'HEAD'
  const remoteBranch =
    comparisonRef != null && remoteName != null && comparisonRef.startsWith(`${remoteName}/`)
      ? comparisonRef.slice(remoteName.length + 1)
      : null
  const remoteUrl =
    remoteName == null ? null : await tryGitStdout(rootPath, ['remote', 'get-url', remoteName])

  let ahead = 0
  let behind = 0
  if (comparisonRef != null) {
    const counts = await tryGitStdout(rootPath, [
      'rev-list',
      '--left-right',
      '--count',
      `HEAD...${comparisonRef}`,
    ])
    const [aheadRaw, behindRaw] = (counts ?? '').split(/\s+/)
    ahead = Number(aheadRaw) || 0
    behind = Number(behindRaw) || 0
  }

  return { ahead, behind, baseRef, remoteBranch, remoteName, remoteUrl }
}

function buildGitHubCompareUrl(remoteUrl: string | null, branch: string | null): string | null {
  if (remoteUrl == null || branch == null) return null
  const sshMatch = remoteUrl.match(/^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/)
  const httpsMatch = remoteUrl.match(/^https:\/\/github\.com\/([^/]+)\/(.+?)(?:\.git)?$/)
  const match = sshMatch ?? httpsMatch
  if (match == null) return null
  const owner = match[1]
  const repo = match[2]
  if (owner == null || repo == null) return null
  const encodedBranch = branch.split('/').map(encodeURIComponent).join('/')
  return `https://github.com/${owner}/${repo}/compare/${encodedBranch}?expand=1`
}

export async function getWorkspaceGitFileDiff(
  rootPath: string,
  filePath: string,
  untracked: boolean,
): Promise<WorkspaceGitFileDiffResponse> {
  // 以 git 自身跟踪状态为准：未跟踪文件 `git diff` 永远返回空，必须走 `--no-index`。
  // 前端透传的 untracked 可能缺失（变更卡片未带 changeType），此处用 ls-files 兜底。
  // 已 staged 的新文件仍在 index 中，ls-files 命中 → 走 tracked 分支，由 `git diff HEAD` 以 new file 呈现。
  const tracked =
    (await tryGitStdout(rootPath, ['ls-files', '--error-unmatch', '--', filePath])) != null
  const effectiveUntracked = untracked || !tracked

  let diff: string
  if (effectiveUntracked) {
    diff =
      (await tryGitDiffStdout(rootPath, ['diff', '--no-index', '--', '/dev/null', filePath])) ?? ''
  } else {
    const comparison = await resolveGitComparison(rootPath)
    diff = (await tryGitStdout(rootPath, ['diff', comparison.baseRef, '--', filePath])) ?? ''
    if (!diff.trim()) diff = (await tryGitStdout(rootPath, ['diff', 'HEAD', '--', filePath])) ?? ''
    if (!diff.trim()) {
      diff = (await tryGitStdout(rootPath, ['diff', '--cached', '--', filePath])) ?? ''
    }
  }
  return { diff, isBinary: diff.includes('Binary files') }
}

export async function getWorkspaceGitStatus(rootPath: string): Promise<WorkspaceGitStatusResponse> {
  const isRepo = (await tryGitStdout(rootPath, ['rev-parse', '--is-inside-work-tree'])) === 'true'
  if (!isRepo) return emptyGitStatus()

  const [branches, comparison] = await Promise.all([
    getWorkspaceBranches(rootPath),
    resolveGitComparison(rootPath),
  ])
  const [porcelain, comparisonNumstat, headNumstat, nameStatus, stashList] = await Promise.all([
    tryGitRawStdout(rootPath, ['status', '--porcelain=v1', '--untracked-files=all']),
    tryGitStdout(rootPath, ['diff', '--numstat', comparison.baseRef, '--']),
    tryGitStdout(rootPath, ['diff', '--numstat', 'HEAD', '--']),
    tryGitRawStdout(rootPath, ['diff', '--name-status', '-z', comparison.baseRef, '--']),
    tryGitStdout(rootPath, [
      'stash',
      'list',
      '--date=iso-strict',
      '--format=%gd%x1f%h%x1f%ci%x1f%gs%x1e',
    ]),
  ])
  const comparisonStats = parseGitNumstat(comparisonNumstat ?? '')
  const pendingStats = mergeGitStats(comparisonStats, parseGitNumstat(headNumstat ?? ''))
  const parsedPendingFiles = parseGitPorcelainChanges(porcelain ?? '', pendingStats)
  const untrackedStats = await getUntrackedFilesLineStats(
    rootPath,
    parsedPendingFiles.filter((item) => item.untracked).map((item) => item.path),
  )
  const pendingFiles = parsedPendingFiles.map((item) => {
    if (!item.untracked) return item
    const stats = untrackedStats.get(item.path)
    return stats == null ? item : { ...item, ...stats }
  })
  const baselineFiles = parseGitNameStatusChanges(nameStatus ?? '', comparisonStats)
  // `files` drives review and therefore spans committed + pending changes.
  // The pending-only counters below intentionally keep commit-dialog semantics.
  const files = mergeReviewChanges(baselineFiles, pendingFiles)

  return {
    isGitRepo: true,
    currentBranch: branches.currentBranch,
    detachedHead: branches.detachedHead,
    branches: branches.branches,
    branchDetails: branches.branchDetails,
    ahead: comparison.ahead,
    behind: comparison.behind,
    additions: files.reduce((sum, item) => sum + item.additions, 0),
    deletions: files.reduce((sum, item) => sum + item.deletions, 0),
    changedFiles: pendingFiles.length,
    stagedFiles: pendingFiles.filter((item) => item.staged).length,
    unstagedFiles: pendingFiles.filter((item) => item.unstaged || item.untracked).length,
    untrackedFiles: pendingFiles.filter((item) => item.untracked).length,
    hasRemote: comparison.remoteName != null,
    remoteName: comparison.remoteName,
    remoteBranch: comparison.remoteBranch,
    pullRequestUrl: buildGitHubCompareUrl(comparison.remoteUrl, branches.currentBranch),
    stashEntries: parseGitStashList(stashList ?? ''),
    files,
  }
}

export async function pushWorkspaceBranch(rootPath: string): Promise<void> {
  const currentBranch = (await tryGitStdout(rootPath, ['branch', '--show-current'])) ?? ''
  if (!currentBranch) throw new Error('当前不是可推送的本地分支')
  const upstream = await tryGitStdout(rootPath, [
    'rev-parse',
    '--abbrev-ref',
    '--symbolic-full-name',
    '@{u}',
  ])
  if (upstream != null) {
    await execFileAsync('git', ['push'], { cwd: rootPath })
    return
  }
  await execFileAsync('git', ['push', '-u', 'origin', currentBranch], { cwd: rootPath })
}

/**
 * 拉取当前分支的远端更新。行为与用户在终端手动执行 `git pull` 完全一致：
 * 不附加 --ff-only 等约束，尊重本地 pull.rebase / pull.ff 等配置，
 * 由 git 默认策略决定 fast-forward、merge 还是 rebase。
 */
export async function pullWorkspaceBranch(rootPath: string): Promise<void> {
  const upstream = await tryGitStdout(rootPath, [
    'rev-parse',
    '--abbrev-ref',
    '--symbolic-full-name',
    '@{u}',
  ])
  if (upstream == null) throw new Error('当前分支没有设置上游分支，无法拉取')
  await execFileAsync('git', ['pull'], { cwd: rootPath })
}

/* ────────────────────────────────────────────────────────────
 * 以下为代码面板 Git 管理面板的轻量命令（log / stage / unstage / stash / discard）。
 * 全部复用上面的 tryGitStdout / getGitExecErrorMessage / getWorkspaceGitStatus，
 * 不引入任何新依赖；错误原样抛出，由 IPC 层包装为 GIT_OPERATION_FAILED。
 * ──────────────────────────────────────────────────────────── */

const GIT_LOG_DEFAULT_LIMIT = 100
const GIT_LOG_MAX_LIMIT = 500

function clampGitLogLimit(limit: number | undefined): number {
  if (limit == null || !Number.isFinite(limit)) return GIT_LOG_DEFAULT_LIMIT
  return Math.min(GIT_LOG_MAX_LIMIT, Math.max(1, Math.round(limit)))
}

/**
 * 提交历史：`git log` 最近 N 条 + `rev-list @{u}..HEAD` 标记未推送。
 * 没有上游分支时（本地新仓库 / 未推送过的分支）不标记 unpushed，
 * 与 VSCode 源代码管理面板的展示口径一致。
 */
export async function getWorkspaceGitLog(
  rootPath: string,
  limit?: number,
): Promise<WorkspaceGitLogResponse> {
  const bounded = clampGitLogLimit(limit)
  const [logOut, upstream, unpushedOut] = await Promise.all([
    tryGitRawStdout(rootPath, [
      'log',
      '-n',
      String(bounded),
      '--date=iso-strict',
      '--format=%H%x1f%h%x1f%an%x1f%aI%x1f%s%x1e',
    ]),
    tryGitStdout(rootPath, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']),
    tryGitStdout(rootPath, ['rev-list', '@{u}..HEAD']),
  ])
  const unpushedHashes = new Set((unpushedOut ?? '').split(/\r?\n/).filter(Boolean))
  const commits = (logOut ?? '')
    .split('\x1e')
    .map((record): WorkspaceGitCommitEntry | null => {
      const trimmed = record.trim()
      if (!trimmed) return null
      const [hash, shortHash, authorName, date, ...subjectParts] = trimmed.split('\x1f')
      if (hash == null || shortHash == null) return null
      return {
        hash,
        shortHash,
        authorName: authorName ?? '',
        date: date ?? '',
        subject: subjectParts.join('\x1f'),
        // upstream == null 时 rev-list 也为空，unpushed 自然全为 false
        unpushed: upstream != null && unpushedHashes.has(hash),
      }
    })
    .filter((item): item is WorkspaceGitCommitEntry => item != null)
  return { commits }
}

function normalizePathList(paths: string[] | undefined): string[] | null {
  if (paths == null) return null
  const normalized = paths.map((p) => p.trim()).filter(Boolean)
  return normalized.length > 0 ? normalized : null
}

/** 暂存指定路径（-A 覆盖新增/删除）；paths 为 null 时暂存全部。 */
export async function stageWorkspacePaths(
  rootPath: string,
  paths: string[] | undefined,
): Promise<WorkspaceGitStatusResponse> {
  const list = normalizePathList(paths)
  const args = list == null ? ['add', '-A'] : ['add', '-A', '--', ...list]
  await execFileAsync('git', args, { cwd: rootPath })
  return getWorkspaceGitStatus(rootPath)
}

/** 取消暂存指定路径（reset 回 HEAD 版本，工作区改动保留）；paths 为 null 时全部取消。 */
export async function unstageWorkspacePaths(
  rootPath: string,
  paths: string[] | undefined,
): Promise<WorkspaceGitStatusResponse> {
  const list = normalizePathList(paths)
  const args = list == null ? ['reset', '-q'] : ['reset', '-q', 'HEAD', '--', ...list]
  await execFileAsync('git', args, { cwd: rootPath })
  return getWorkspaceGitStatus(rootPath)
}

/** 贮藏当前改动。工作区无改动时 git 原样成功返回，不视为错误。 */
export async function stashWorkspaceChanges(
  rootPath: string,
  message: string | undefined,
  includeUntracked: boolean,
): Promise<WorkspaceGitStatusResponse> {
  const args = ['stash', 'push']
  if (includeUntracked) args.push('-u')
  const text = message?.trim()
  if (text) args.push('-m', text)
  await execFileAsync('git', args, { cwd: rootPath })
  return getWorkspaceGitStatus(rootPath)
}

/** 恢复并弹出 stash（pop）。selector 形如 stash@{0}。 */
export async function popWorkspaceStash(
  rootPath: string,
  selector: string,
): Promise<WorkspaceGitStatusResponse> {
  await execFileAsync('git', ['stash', 'pop', selector], { cwd: rootPath })
  return getWorkspaceGitStatus(rootPath)
}

/** 丢弃一条 stash（drop）。 */
export async function dropWorkspaceStash(
  rootPath: string,
  selector: string,
): Promise<WorkspaceGitStatusResponse> {
  await execFileAsync('git', ['stash', 'drop', selector], { cwd: rootPath })
  return getWorkspaceGitStatus(rootPath)
}

/**
 * 丢弃指定路径的工作区改动（破坏性，由调用方 UI 做二次确认）。
 * - 已跟踪文件（含已暂存的修改/删除）：`git checkout HEAD --`，index 与工作区一并回到 HEAD；
 * - 未跟踪文件：`git clean -f --` 直接移除。
 */
export async function discardWorkspacePaths(
  rootPath: string,
  paths: string[],
): Promise<WorkspaceGitStatusResponse> {
  const list = normalizePathList(paths)
  if (list == null) throw new Error('未选择任何要丢弃的文件')
  const trackedOut = await tryGitRawStdout(rootPath, ['ls-files', '-z', '--', ...list])
  const tracked = new Set((trackedOut ?? '').split('\0').filter(Boolean))
  const trackedPaths = list.filter((p) => tracked.has(p))
  const untrackedPaths = list.filter((p) => !tracked.has(p))
  if (trackedPaths.length > 0) {
    await execFileAsync('git', ['checkout', 'HEAD', '--', ...trackedPaths], { cwd: rootPath })
  }
  if (untrackedPaths.length > 0) {
    await execFileAsync('git', ['clean', '-f', '--', ...untrackedPaths], { cwd: rootPath })
  }
  return getWorkspaceGitStatus(rootPath)
}
