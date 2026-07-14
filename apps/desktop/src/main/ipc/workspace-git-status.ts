import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type {
  WorkspaceGitFileChange,
  WorkspaceGitFileDiffResponse,
  WorkspaceGitStashEntry,
  WorkspaceGitStatusResponse,
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

export async function getWorkspaceBranches(
  rootPath: string,
): Promise<{ currentBranch: string | null; branches: string[] }> {
  try {
    const [current, branches] = await Promise.all([
      execFileAsync('git', ['branch', '--show-current'], { cwd: rootPath }),
      execFileAsync('git', ['branch', '--format=%(refname:short)'], { cwd: rootPath }),
    ])
    const branchList = branches.stdout
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean)
    const currentBranch = current.stdout.trim() || branchList[0] || null
    return { currentBranch, branches: branchList }
  } catch {
    return { currentBranch: null, branches: [] }
  }
}

function emptyGitStatus(): WorkspaceGitStatusResponse {
  return {
    isGitRepo: false,
    currentBranch: null,
    branches: [],
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
  let diff: string
  if (untracked) {
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
    branches: branches.branches,
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
