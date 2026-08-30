import type { GoalSnapshot } from '../../services/event-mapper'
import type { WorkspaceGitFileChange, WorkspaceGitStatusResponse } from '@spark/protocol'

export const GIT_REVIEW_TREE_MIN_WIDTH = 200
export const GIT_REVIEW_TREE_MAX_WIDTH = 360
export const GIT_REVIEW_TREE_DEFAULT_WIDTH = 272
export const GIT_REVIEW_TREE_WIDTH_STORAGE_KEY = 'spark.git-review.tree-width'
export const GIT_REVIEW_TREE_KEYBOARD_STEP = 12

export type GitReviewStageFilter = 'all' | 'staged' | 'unstaged'

export type GitReviewTreeNode = {
  name: string
  path: string
  children: GitReviewTreeNode[]
  change?: WorkspaceGitFileChange
  fileCount: number
  stagedCount: number
  unstagedCount: number
  untrackedCount: number
  additions: number
  deletions: number
}

export type GitDiffViewLine = {
  type: 'hunk' | 'add' | 'del' | 'ctx' | 'meta'
  oldLn?: number | undefined
  newLn?: number | undefined
  text: string
}

export type GitDiffViewSegment =
  | { kind: 'line'; line: GitDiffViewLine }
  | { kind: 'gap'; count: number; lines: GitDiffViewLine[] }

export function formatSignedNumber(value: number): string {
  return value.toLocaleString()
}

export function getGitSourceLabel(status: WorkspaceGitStatusResponse | null): string {
  if (status?.hasRemote !== true || status.remoteName == null) return '暂无来源'
  return `${status.remoteName}/${status.remoteBranch ?? status.currentBranch ?? '-'}`
}

export function buildDefaultCommitMessage(
  status: WorkspaceGitStatusResponse | null,
  paths?: readonly string[],
): string {
  let files = status?.files ?? []
  if (paths != null) {
    const selected = new Set(paths)
    files = files.filter((file) => selected.has(file.path))
  }
  if (files.length === 0) return 'Update workspace changes'
  const first = files[0]?.path ?? 'workspace changes'
  return files.length === 1
    ? `Update ${first}`
    : `Update ${first} and ${files.length - 1} more files`
}

/**
 * 留空提交信息时，构造发给当前会话 agent 的消息。
 * 携带 includeUnstaged / push 两个用户在面板上的选择，由 agent 分析 diff
 * 后生成提交信息并执行提交。paths 存在时约束 agent 只提交指定文件。
 */
export function buildAgentCommitMessage(
  includeUnstaged: boolean,
  push: boolean,
  paths?: readonly string[],
): string {
  const lines: string[] = [
    '请帮我提交当前仓库的更改。',
    '1. 先运行 `git status` 与 `git diff` 分析所有变更，按变更逻辑分组。',
    '2. 生成简洁、可读的提交信息，必要时在 body 补充说明。',
  ]
  if (paths != null && paths.length > 0) {
    lines.push('3. 只提交下面列出的文件（已按我的选择圈定范围），不要 git add 范围外的任何更改：')
    for (const path of paths) lines.push(`   - ${path}`)
    lines.push('   如某文件既有已暂存又有未暂存的改动，请一并提交该文件的全部当前改动。')
  } else if (includeUnstaged) {
    lines.push('3. 暂存全部相关更改（含未暂存的）后再提交，例如 `git add -A` 或按需选择文件。')
  } else {
    lines.push('3. 仅提交当前已暂存的更改，不要对未暂存的内容执行 git add。')
  }
  if (push) {
    lines.push(
      `4. 提交成功后推送到远端（若当前分支没有上游，请用 \`git push -u origin <分支>\` 设置上游后再推送）。`,
    )
  } else {
    lines.push('4. 仅在本地提交，不要执行 git push。')
  }
  lines.push('完成后简要说明这次提交的内容与结果。')
  return lines.join('\n')
}

export function goalStatusLabel(status: GoalSnapshot['status']): string {
  switch (status) {
    case 'active':
      return '进行中'
    case 'paused':
      return '已暂停'
    case 'pending_contract':
      return '待确认契约'
    case 'completed':
      return '已完成'
    case 'failed':
      return '失败'
    case 'cleared':
      return '已清除'
    case 'stopped_by_budget':
      return '预算用尽'
    default:
      return status
  }
}

export function goalPhaseLabel(phase: 'review' | 'act' | 'validate'): string {
  switch (phase) {
    case 'review':
      return '复盘'
    case 'act':
      return '执行'
    case 'validate':
      return '验证'
  }
}

export function splitGitFilePath(path: string): { dir: string; base: string } {
  const normalized = path.replace(/\\/g, '/')
  const idx = normalized.lastIndexOf('/')
  if (idx < 0) return { dir: '', base: path }
  return { dir: normalized.slice(0, idx + 1), base: normalized.slice(idx + 1) }
}

export function getGitReviewFileOpenPath(
  workspaceRootPath: string | null | undefined,
  filePath: string,
): string {
  if (!workspaceRootPath) return filePath
  const separator =
    workspaceRootPath.includes('\\') && !workspaceRootPath.includes('/') ? '\\' : '/'
  return `${workspaceRootPath.replace(/[\\/]+$/, '')}${separator}${filePath.replace(/^[\\/]+/, '')}`
}

export function isGitReviewFileOpenable(change: WorkspaceGitFileChange): boolean {
  return change.status !== 'D' && !change.status.endsWith('D')
}

export function getGitChangeStageLabel(change: WorkspaceGitFileChange): string {
  if (change.untracked) return '未跟踪'
  if (change.staged && change.unstaged) return '已暂存 + 工作区'
  if (change.staged) return '已暂存'
  if (!change.unstaged) return '已提交'
  return '未暂存'
}

export function createGitReviewTreeNode(name: string, path: string): GitReviewTreeNode {
  return {
    name,
    path,
    children: [],
    fileCount: 0,
    stagedCount: 0,
    unstagedCount: 0,
    untrackedCount: 0,
    additions: 0,
    deletions: 0,
  }
}

export function addGitChangeToTreeNodeStats(
  node: GitReviewTreeNode,
  change: WorkspaceGitFileChange,
): void {
  node.fileCount += 1
  node.additions += change.additions
  node.deletions += change.deletions
  if (change.staged) node.stagedCount += 1
  if (change.unstaged || change.untracked) node.unstagedCount += 1
  if (change.untracked) node.untrackedCount += 1
}

export function sortGitReviewTreeNodes(nodes: GitReviewTreeNode[]): GitReviewTreeNode[] {
  return [...nodes]
    .sort((a, b) => {
      const aIsFile = a.change != null
      const bIsFile = b.change != null
      if (aIsFile !== bIsFile) return aIsFile ? 1 : -1
      return a.name.localeCompare(b.name)
    })
    .map((node) => ({ ...node, children: sortGitReviewTreeNodes(node.children) }))
}

export function buildGitReviewTree(changes: WorkspaceGitFileChange[]): GitReviewTreeNode {
  const root = createGitReviewTreeNode('', '')
  for (const change of changes) {
    const parts = change.path.split('/').filter(Boolean)
    if (parts.length === 0) continue
    let node = root
    addGitChangeToTreeNodeStats(node, change)
    for (let index = 0; index < parts.length; index += 1) {
      const name = parts[index] ?? ''
      const nodePath = parts.slice(0, index + 1).join('/')
      const isFile = index === parts.length - 1
      let child = node.children.find((item) => item.path === nodePath)
      if (child == null) {
        child = createGitReviewTreeNode(name, nodePath)
        node.children.push(child)
      }
      addGitChangeToTreeNodeStats(child, change)
      if (isFile) child.change = change
      node = child
    }
  }
  return { ...root, children: sortGitReviewTreeNodes(root.children) }
}

export function buildDefaultExpandedTreeDirs(
  changes: WorkspaceGitFileChange[],
): Record<string, boolean> {
  const expanded: Record<string, boolean> = { '': true }
  const maxDepth = changes.length <= 8 ? Number.POSITIVE_INFINITY : 1
  for (const change of changes) {
    const parts = change.path.split('/').filter(Boolean)
    for (let index = 0; index < parts.length - 1 && index < maxDepth; index += 1) {
      expanded[parts.slice(0, index + 1).join('/')] = true
    }
  }
  return expanded
}

export function matchesGitReviewStageFilter(
  change: WorkspaceGitFileChange,
  filter: GitReviewStageFilter,
): boolean {
  if (filter === 'staged') return change.staged
  if (filter === 'unstaged') return change.unstaged || change.untracked
  return true
}

export function getGitTreeStageClass(change: WorkspaceGitFileChange): string {
  if (change.untracked) return 'untracked'
  if (change.staged && change.unstaged) return 'mixed'
  if (change.staged) return 'staged'
  if (!change.unstaged) return 'committed'
  return 'unstaged'
}

export type GitChangeStatusCode = 'M' | 'A' | 'D' | '?'

/**
 * 提交范围树的短状态徽章。status 字段来自 porcelain XY 码 trim 后的值
 * （如 'M'、'MM'、'??'），需结合 staged/unstaged/untracked 布尔值判定，
 * 避免 staged-only 与 unstaged-only 都显示 'M' 时无法区分增删意图。
 */
export function getGitChangeStatusCode(change: WorkspaceGitFileChange): GitChangeStatusCode {
  if (change.untracked) return '?'
  if (change.status.includes('D')) return 'D'
  if (change.status.includes('A')) return 'A'
  return 'M'
}

export function getGitChangeStatusBadgeClass(code: GitChangeStatusCode): string {
  switch (code) {
    case 'A':
    case '?':
      return 'add'
    case 'D':
      return 'del'
    default:
      return 'mod'
  }
}

export type GitSelectionSummary = {
  count: number
  additions: number
  deletions: number
}

export function summarizeGitSelection(
  files: readonly WorkspaceGitFileChange[],
  selected: ReadonlySet<string>,
): GitSelectionSummary {
  let additions = 0
  let deletions = 0
  let count = 0
  for (const file of files) {
    if (!selected.has(file.path)) continue
    count += 1
    additions += file.additions
    deletions += file.deletions
  }
  return { count, additions, deletions }
}

/** 收集节点下所有文件路径（含节点自身是文件的情况），用于文件夹整组勾选。 */
export function collectGitTreeNodeFilePaths(node: GitReviewTreeNode): string[] {
  const paths: string[] = []
  if (node.change != null) paths.push(node.change.path)
  for (const child of node.children) {
    for (const path of collectGitTreeNodeFilePaths(child)) paths.push(path)
  }
  return paths
}

/** 收集树内全部目录节点 path（含根节点空串），用于树面板一键展开全部。 */
export function collectGitReviewTreeDirPaths(node: GitReviewTreeNode): string[] {
  const paths: string[] = []
  if (node.change == null) paths.push(node.path)
  for (const child of node.children) {
    for (const path of collectGitReviewTreeDirPaths(child)) paths.push(path)
  }
  return paths
}

export function formatGitStashDate(date: string | null): string {
  if (!date) return ''
  const timestamp = Date.parse(date)
  if (!Number.isFinite(timestamp)) return date
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(timestamp)
}

export function parseGitDiffViewSegments(diff: string, collapseAfter = 4): GitDiffViewSegment[] {
  const rawLines: GitDiffViewLine[] = []
  let oldLn = 0
  let newLn = 0

  for (const line of diff.split(/\r?\n/)) {
    if (
      line.startsWith('diff --git') ||
      line.startsWith('index ') ||
      line.startsWith('new file mode')
    ) {
      rawLines.push({ type: 'meta', text: line })
      continue
    }
    if (line.startsWith('---') || line.startsWith('+++')) {
      rawLines.push({ type: 'meta', text: line })
      continue
    }
    if (line.startsWith('@@')) {
      const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
      oldLn = match ? Number(match[1]) || 0 : 0
      newLn = match ? Number(match[2]) || 0 : 0
      rawLines.push({ type: 'hunk', text: line })
      continue
    }
    if (line.startsWith('+')) {
      rawLines.push({
        type: 'add',
        oldLn: undefined,
        newLn: newLn || undefined,
        text: line.slice(1),
      })
      if (newLn > 0) newLn += 1
      continue
    }
    if (line.startsWith('-')) {
      rawLines.push({
        type: 'del',
        oldLn: oldLn || undefined,
        newLn: undefined,
        text: line.slice(1),
      })
      if (oldLn > 0) oldLn += 1
      continue
    }
    if (line.startsWith(' ') || line === '') {
      rawLines.push({
        type: 'ctx',
        oldLn: oldLn || undefined,
        newLn: newLn || undefined,
        text: line.startsWith(' ') ? line.slice(1) : line,
      })
      if (oldLn > 0) oldLn += 1
      if (newLn > 0) newLn += 1
      continue
    }
    rawLines.push({ type: 'meta', text: line })
  }

  const segments: GitDiffViewSegment[] = []
  let ctxBuffer: GitDiffViewLine[] = []

  const flushCtx = () => {
    if (ctxBuffer.length === 0) return
    if (ctxBuffer.length > collapseAfter) {
      segments.push({ kind: 'gap', count: ctxBuffer.length, lines: ctxBuffer })
    } else {
      for (const line of ctxBuffer) segments.push({ kind: 'line', line })
    }
    ctxBuffer = []
  }

  for (const line of rawLines) {
    if (line.type === 'ctx') {
      ctxBuffer.push(line)
      continue
    }
    flushCtx()
    segments.push({ kind: 'line', line })
  }
  flushCtx()
  return segments
}
