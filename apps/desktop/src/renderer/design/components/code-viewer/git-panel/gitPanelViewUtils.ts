/**
 * Git 面板展示层纯函数：待提交变更分组、文件行「简约显示」标签、相对时间格式化。
 * 纯函数无副作用，配套 gitPanelViewUtils.test.ts。
 */

import type { WorkspaceGitFileChange, WorkspaceGitStatusResponse } from '@spark/protocol'
import { splitGitFilePath } from '../../../views/chat/ChatGitUtils'

/** 「已暂存 / 更改」两组待提交变更（porcelain 项） */
export interface GitPanelChangeGroups {
  staged: WorkspaceGitFileChange[]
  unstaged: WorkspaceGitFileChange[]
}

/**
 * 从 status.files 中只取工作区待提交改动：
 * status.files 合并了「相对比对基线的已提交改动」（三态全 false，仅供审查面板），
 * Git 面板的更改板块只关心 index / 工作区状态。
 * staged && unstaged（如 MM）两边都出现：已暂存组代表暂存部分、更改组代表工作区部分。
 */
export function splitPendingGitChanges(files: WorkspaceGitFileChange[]): GitPanelChangeGroups {
  const staged: WorkspaceGitFileChange[] = []
  const unstaged: WorkspaceGitFileChange[] = []
  for (const file of files) {
    if (file.staged) staged.push(file)
    if (file.unstaged || file.untracked) unstaged.push(file)
  }
  return { staged, unstaged }
}

/** 文件行标签：默认只显示文件名；同名文件才带最短父目录消歧。 */
export interface GitPanelFileLabel {
  /** 主显示名（basename） */
  name: string
  /** 消歧用短目录（含尾部 /），无需消歧时为 null */
  shortDir: string | null
}

/**
 * 为一组变更路径生成「简约显示」标签：
 * - basename 唯一 → 只显示文件名；
 * - basename 撞名 → 自动追加最短且足够的父目录段（1 段不够取 2 段，依此类推）。
 */
export function buildGitPanelFileLabels(paths: readonly string[]): Map<string, GitPanelFileLabel> {
  const result = new Map<string, GitPanelFileLabel>()
  const groups = new Map<string, string[]>()
  for (const path of paths) {
    const base = splitGitFilePath(path).base
    const bucket = groups.get(base)
    if (bucket == null) groups.set(base, [path])
    else bucket.push(path)
  }
  for (const [base, groupPaths] of groups) {
    if (groupPaths.length === 1) {
      const path = groupPaths[0]
      if (path != null) result.set(path, { name: base, shortDir: null })
      continue
    }
    // 撞名组：找能让组内标签唯一的最小目录深度
    const dirSegmentsList = groupPaths.map((path) => {
      const { dir } = splitGitFilePath(path)
      return dir === '' ? [] : dir.replace(/\/$/, '').split('/')
    })
    const maxDepth = Math.max(...dirSegmentsList.map((segs) => segs.length))
    let depth = 1
    for (; depth <= maxDepth; depth++) {
      const labels = new Set(
        dirSegmentsList.map((segs) => segs.slice(-depth).join('/') || '\u0000'),
      )
      if (labels.size === groupPaths.length) break
    }
    const effectiveDepth = Math.min(depth, maxDepth)
    groupPaths.forEach((path, index) => {
      const segs = dirSegmentsList[index] ?? []
      const shortDir = segs.slice(-effectiveDepth).join('/')
      result.set(path, {
        name: base,
        shortDir: shortDir === '' ? null : `${shortDir}/`,
      })
    })
  }
  return result
}

/* ---------- 树形视图 ---------- */

/** 树形视图目录节点（可折叠，fileCount 为递归后代文件数） */
export interface GitPanelTreeDir {
  type: 'dir'
  name: string
  /** 相对仓库根的目录路径（折叠状态唯一 key） */
  path: string
  children: GitPanelTreeEntry[]
  fileCount: number
}

/** 树形视图文件叶 */
export interface GitPanelTreeFile {
  type: 'file'
  change: WorkspaceGitFileChange
}

export type GitPanelTreeEntry = GitPanelTreeDir | GitPanelTreeFile

/**
 * 把一组变更文件构建为目录树：目录在前、文件在后，同级各自按名称字典序。
 * 深层目录逐级嵌套（a/b/c.ts → a → b → c.ts），根级文件直接平铺在顶层，
 * 供树形视图渲染。
 */
export function buildGitPanelChangeTree(files: WorkspaceGitFileChange[]): GitPanelTreeEntry[] {
  interface DirBucket {
    name: string
    path: string
    dirs: Map<string, DirBucket>
    files: GitPanelTreeFile[]
  }
  const root: DirBucket = { name: '', path: '', dirs: new Map(), files: [] }
  for (const file of files) {
    const segments = file.path.split('/')
    let bucket = root
    for (let i = 0; i < segments.length - 1; i += 1) {
      const seg = segments[i] ?? ''
      const dirPath = bucket.path === '' ? seg : `${bucket.path}/${seg}`
      let child = bucket.dirs.get(seg)
      if (child == null) {
        child = { name: seg, path: dirPath, dirs: new Map(), files: [] }
        bucket.dirs.set(seg, child)
      }
      bucket = child
    }
    bucket.files.push({ type: 'file', change: file })
  }
  const toDir = (bucket: DirBucket): GitPanelTreeDir => {
    const dirs = [...bucket.dirs.values()].sort((a, b) => a.name.localeCompare(b.name)).map(toDir)
    const leaves = [...bucket.files].sort((a, b) => a.change.path.localeCompare(b.change.path))
    return {
      type: 'dir',
      name: bucket.name,
      path: bucket.path,
      children: [...dirs, ...leaves],
      fileCount: dirs.reduce((count, dir) => count + dir.fileCount, 0) + leaves.length,
    }
  }
  const rootLeaves = [...root.files].sort((a, b) => a.change.path.localeCompare(b.change.path))
  return [
    ...[...root.dirs.values()].sort((a, b) => a.name.localeCompare(b.name)).map(toDir),
    ...rootLeaves,
  ] satisfies GitPanelTreeEntry[]
}

/** 提交记录 / stash 的相对时间；nowMs 供测试注入。 */
export function formatGitRelativeTime(iso: string | null | undefined, nowMs?: number): string {
  if (!iso) return ''
  const timestamp = Date.parse(iso)
  if (!Number.isFinite(timestamp)) return iso
  const now = nowMs ?? Date.now()
  const diffMs = Math.max(0, now - timestamp)
  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days} 天前`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months} 个月前`
  return `${Math.floor(months / 12)} 年前`
}

/** 提交详情浮层的绝对时间：本地时区 YYYY-MM-DD HH:mm（解析失败回退原文）。 */
export function formatGitCommitAbsoluteTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const timestamp = Date.parse(iso)
  if (!Number.isFinite(timestamp)) return iso
  const d = new Date(timestamp)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * 提交信息副本（右键菜单「复制提交信息」）：标题 + 正文，正文缺失时只给标题。
 * 与 git log 的完整提交信息一致（正文与标题之间空一行）。
 */
export function formatGitCommitMessageText(commit: {
  subject: string
  body?: string | undefined
}): string {
  const body = commit.body?.trim()
  return body != null && body.length > 0 ? `${commit.subject}\n\n${body}` : commit.subject
}

/* ---------- 提交详情浮层定位 ---------- */

/** 提交详情浮层的 fixed 坐标与实际放置方向。 */
export interface GitCommitPopoverPosition {
  left: number
  top: number
  /** 'right' = 锚点行右侧（常态），'left' = 右侧空间不足时翻到左侧 */
  side: 'right' | 'left'
}

/** 浮层与锚点的间距 / 距视口边缘的最小留白（px）。 */
export const GIT_POPOVER_GAP = 8
export const GIT_POPOVER_EDGE = 8

/**
 * 提交详情浮层定位（纯函数，坐标均为视口系）：
 * 优先放在锚点行右侧（Git 面板在左侧栏，右侧是编辑区，不遮挡列表）；
 * 右侧放不下时翻到左侧；两侧都放不下时取空间更大的一侧并由 clamp 收进视口。
 * 垂直方向与锚点行顶对齐，超出视口时上下 clamp。
 */
export function computeGitCommitPopoverPosition(
  anchor: { left: number; right: number; top: number },
  popover: { width: number; height: number },
  viewport: { width: number; height: number },
): GitCommitPopoverPosition {
  const rightLeft = anchor.right + GIT_POPOVER_GAP
  const leftLeft = anchor.left - GIT_POPOVER_GAP - popover.width
  const fitsRight = rightLeft + popover.width <= viewport.width - GIT_POPOVER_EDGE
  const fitsLeft = leftLeft >= GIT_POPOVER_EDGE
  // 两侧都放不下：比较锚点左右剩余空间，取更宽的一侧再 clamp
  const side: 'right' | 'left' = fitsRight
    ? 'right'
    : fitsLeft
      ? 'left'
      : viewport.width - anchor.right >= anchor.left
        ? 'right'
        : 'left'
  const rawLeft = side === 'right' ? rightLeft : leftLeft
  const maxLeft = Math.max(GIT_POPOVER_EDGE, viewport.width - GIT_POPOVER_EDGE - popover.width)
  const maxTop = Math.max(GIT_POPOVER_EDGE, viewport.height - GIT_POPOVER_EDGE - popover.height)
  return {
    left: Math.min(Math.max(rawLeft, GIT_POPOVER_EDGE), maxLeft),
    top: Math.min(Math.max(anchor.top, GIT_POPOVER_EDGE), maxTop),
    side,
  }
}

/** useGitCommitLog 的刷新 key：status 中影响提交历史的字段的轻量指纹。 */
export function buildGitPanelLogRefreshKey(
  status: WorkspaceGitStatusResponse | null,
  tick: number,
): string {
  if (status == null) return `${tick}|null`
  return [
    tick,
    status.currentBranch ?? '',
    status.files.length,
    status.stashEntries.length,
    status.ahead,
    status.behind,
    status.stagedFiles,
    status.changedFiles,
  ].join('|')
}

/**
 * 相对仓库路径 → 绝对路径（「复制路径」用，与文件树 joinAbs / ChatView resolveAbsCodePath
 * 同语义：root 未知或为空时原样返回相对路径；Windows root 用反斜杠拼接）。
 */
export function joinGitWorkspacePath(
  rootAbsPath: string | null | undefined,
  relPath: string,
): string {
  if (rootAbsPath == null || rootAbsPath.length === 0) return relPath
  const sep = rootAbsPath.includes('\\') ? '\\' : '/'
  const normalized = relPath.replace(/^\.\//, '').replace(/^[\\/]+/, '')
  return `${rootAbsPath.replace(/[\\/]+$/, '')}${sep}${normalized.split('/').join(sep)}`
}
