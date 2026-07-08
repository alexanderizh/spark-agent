import { randomUUID } from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'

import { WorkspaceRepository } from '@spark/storage'
import type { WorkspaceRow, WorktreeMeta } from '@spark/storage'
import type { WorkspaceTreeEntry } from '@spark/protocol'

import { GitWorktreeService } from './git-worktree.service.js'

/**
 * 项目类型检测标识文件列表
 *
 * 按优先级排列：排在前的优先匹配。
 * `files` 支持精确文件名匹配和以 '.' 开头的扩展名匹配。
 */
const PROJECT_KIND_INDICATORS: ReadonlyArray<{
  files: string[]
  kind: string
  /** 二次确认文件（可选，精确文件名） */
  confirmFiles?: string[]
}> = [
  { files: ['package.json'], kind: 'typescript', confirmFiles: ['tsconfig.json', 'tsconfig.jsonc'] },
  { files: ['package.json'], kind: 'javascript' },
  { files: ['Cargo.toml'], kind: 'rust' },
  { files: ['go.mod'], kind: 'go' },
  { files: ['pyproject.toml', 'requirements.txt', 'setup.py', 'Pipfile'], kind: 'python' },
  { files: ['pom.xml', 'build.gradle', 'build.gradle.kts'], kind: 'java' },
  { files: ['.csproj', '.sln'], kind: 'csharp' },
  { files: ['Gemfile'], kind: 'ruby' },
  { files: ['composer.json'], kind: 'php' },
  { files: ['mix.exs'], kind: 'elixir' },
  { files: ['CMakeLists.txt', 'Makefile'], kind: 'cpp' },
]

/**
 * 检测项目类型
 *
 * 检查根目录下的文件标识符，返回最匹配的 projectKind。
 * 优先匹配具体类型，未匹配则返回 'unknown'。
 */
export async function detectProjectKind(rootPath: string): Promise<string> {
  try {
    const dirents = await fs.readdir(rootPath, { withFileTypes: true })
    const fileNames = new Set(dirents.filter((d) => d.isFile() || d.isSymbolicLink()).map((d) => d.name))

    for (const indicator of PROJECT_KIND_INDICATORS) {
      const hasMainFile = indicator.files.some((f) =>
        f.startsWith('.') ? fileNames.has(f) || [...fileNames].some((n) => n.endsWith(f)) : fileNames.has(f),
      )
      if (!hasMainFile) continue

      // 有 confirmFiles 时，需要确认文件也存在才能确认具体类型
      if (indicator.confirmFiles !== undefined) {
        const hasConfirm = indicator.confirmFiles.some((f) => fileNames.has(f))
        if (hasConfirm) return indicator.kind
        continue // 主文件匹配但确认文件不匹配，跳过这个规则
      }

      return indicator.kind
    }

    return 'unknown'
  } catch {
    return 'unknown'
  }
}

export interface UpdateWorkspaceParams {
  name?: string
  projectKind?: string
  pinnedAt?: string | null
  archivedAt?: string | null
}

export interface ListDirectoryTreeParams {
  path?: string
  maxDepth?: number
}

export interface OpenWorkspaceParams {
  create?: boolean
}

export interface RelocateWorkspaceParams {
  rootPath: string
  relocatedFrom?: string[]
}

export interface CreateWorktreeWorkspaceParams {
  baseWorkspaceId: string
  branch: string
  baseBranch?: string
}

const DEFAULT_TREE_DEPTH = 3
const MAX_TREE_DEPTH = 5
const MAX_TREE_ENTRIES = 1000
const DEFAULT_WORKTREE_CONTAINER = '.worktrees'
const CLAUDE_WORKTREE_CONTAINER = '.claude/worktrees'
const LEGACY_SPARK_WORKTREE_CONTAINER = '.spark/worktrees'
const WORKTREE_CONTAINER_PATHS = new Set([
  DEFAULT_WORKTREE_CONTAINER,
  CLAUDE_WORKTREE_CONTAINER,
  LEGACY_SPARK_WORKTREE_CONTAINER,
])
const IGNORED_TREE_NAMES = new Set([
  '.git',
  '.next',
  'coverage',
  'dist',
  'node_modules',
  'out',
])

export class WorkspaceService {
  private currentWorkspace: WorkspaceRow | null = null

  constructor(
    private readonly repo: WorkspaceRepository,
    private readonly git: GitWorktreeService = new GitWorktreeService(),
  ) {}

  async openWorkspace(rootPath: string, name?: string, params: OpenWorkspaceParams = {}): Promise<WorkspaceRow> {
    const resolved = path.resolve(rootPath)
    if (params.create === true) {
      await fs.mkdir(resolved, { recursive: true })
    }
    await assertDirectory(resolved)

    const existing = this.repo.findByRootPath(resolved)
    if (existing !== null) {
      this.currentWorkspace = existing
      return existing
    }

    const detectedKind = await detectProjectKind(resolved)

    const workspace = this.repo.create({
      id: randomUUID(),
      name: name ?? path.basename(resolved),
      rootPath: resolved,
      projectKind: detectedKind,
    })
    this.currentWorkspace = workspace
    return workspace
  }

  getCurrent(): WorkspaceRow | null {
    return this.currentWorkspace
  }

  closeWorkspace(): void {
    this.currentWorkspace = null
  }

  listWorkspaces(limit = 50, offset = 0, params: { includeArchived?: boolean } = {}): WorkspaceRow[] {
    return this.repo.listAll(limit, offset, params)
  }

  countWorkspaces(params: { includeArchived?: boolean } = {}): number {
    return this.repo.countAll(params)
  }

  async listDirectoryTree(
    workspaceId: string,
    params: ListDirectoryTreeParams = {},
  ): Promise<WorkspaceTreeEntry[]> {
    const workspace = this.repo.findByIdOrFail(workspaceId)
    const rootPath = path.resolve(workspace.root_path)
    const startRelativePath = normalizeRelativePath(params.path ?? '')
    const startPath = resolveInsideRoot(rootPath, startRelativePath)
    await assertDirectory(startPath)

    const maxDepth = clampDepth(params.maxDepth ?? DEFAULT_TREE_DEPTH)
    const entries: WorkspaceTreeEntry[] = []

    const walk = async (dirPath: string, relativePrefix: string, depth: number): Promise<void> => {
      if (entries.length >= MAX_TREE_ENTRIES) return

      const children = await readVisibleChildren(dirPath)
      for (const child of children) {
        if (entries.length >= MAX_TREE_ENTRIES) return

        const childPath = path.join(dirPath, child.name)
        const childRelativePath = toPosixPath(path.join(relativePrefix, child.name))
        // 跳过隔离 worktree 容器：它们存放整份工作树副本，
        // 不应污染主项目的文件树。
        if (WORKTREE_CONTAINER_PATHS.has(childRelativePath)) continue
        const isDirectory = child.isDirectory()
        const childEntries = isDirectory ? await readVisibleChildren(childPath) : []
        const extension = !isDirectory && !child.isSymbolicLink() ? path.extname(child.name).slice(1).toLowerCase() : ''
        const entry: WorkspaceTreeEntry = {
          name: child.name,
          path: childRelativePath,
          type: child.isSymbolicLink() ? 'symlink' : isDirectory ? 'directory' : 'file',
          depth,
        }

        if (extension !== '') entry.extension = extension
        if (isDirectory) entry.childrenCount = childEntries.length

        entries.push(entry)

        if (isDirectory && depth < maxDepth) {
          await walk(childPath, childRelativePath, depth + 1)
        }
      }
    }

    await walk(startPath, startRelativePath, 0)
    return entries
  }

  deleteWorkspace(id: string): boolean {
    if (this.currentWorkspace?.id === id) {
      this.currentWorkspace = null
    }
    return this.repo.delete(id)
  }

  updateWorkspace(id: string, params: UpdateWorkspaceParams): WorkspaceRow {
    this.repo.update(id, params)
    const updated = this.repo.findByIdOrFail(id)

    if (this.currentWorkspace?.id !== id) {
      return updated
    }

    this.currentWorkspace = updated
    return updated
  }

  async relocateWorkspace(id: string, params: RelocateWorkspaceParams): Promise<WorkspaceRow> {
    const resolved = path.resolve(params.rootPath)
    await fs.mkdir(resolved, { recursive: true })
    await assertDirectory(resolved)

    const current = this.repo.findByIdOrFail(id)
    const previousRoot = path.resolve(current.root_path)
    if (previousRoot === resolved) {
      if (this.currentWorkspace?.id === id) this.currentWorkspace = current
      return current
    }

    const relocatedFrom = Array.from(new Set([
      ...('relocated_from_json' in current
        ? parseRelocatedFrom(current.relocated_from_json)
        : []),
      previousRoot,
      ...(params.relocatedFrom ?? []),
    ]))
    this.repo.relocate(id, { rootPath: resolved, relocatedFrom })
    const updated = this.repo.findByIdOrFail(id)

    if (this.currentWorkspace?.id === id) {
      this.currentWorkspace = updated
    }
    return updated
  }

  async createWorktreeWorkspace(params: CreateWorktreeWorkspaceParams): Promise<WorkspaceRow> {
    const base = this.repo.findByIdOrFail(params.baseWorkspaceId)
    const mainRepoRoot = await this.git.resolveMainRepoRoot(base.root_path)
    const baseBranch = params.baseBranch ?? (await this.git.detectBaseBranch(mainRepoRoot))

    // 确保分支名与目标目录唯一：已存在则追加 -2 / -3 …（如生成的语义名重复）
    const worktreeContainer = await resolveWorktreeContainer(mainRepoRoot)
    const branch = await this.resolveUniqueBranch(mainRepoRoot, params.branch, worktreeContainer)
    const slug = slugifyBranch(branch)
    const targetPath = path.join(mainRepoRoot, worktreeContainer, slug)

    await ensureGitignoreEntry(mainRepoRoot, `${worktreeContainer}/`)
    await this.git.addWorktree(mainRepoRoot, { branch, targetPath, baseBranch })

    const meta: WorktreeMeta = { baseRepoRoot: mainRepoRoot, branch, baseBranch, baseWorkspaceId: base.id }
    const workspace = this.repo.create({
      id: randomUUID(),
      name: `${base.name} · ${branch}`,
      rootPath: targetPath,
      projectKind: base.project_kind,
      worktreeMeta: meta,
    })
    // 不把 worktree 设为「当前 workspace」：它只是会话的后台 cwd，
    // 当前项目应保持 base，避免 get-current 返回 worktree 污染 UI 项目选择。
    return workspace
  }

  /** 分支或目标目录已存在时追加数字后缀，返回可用的唯一分支名 */
  private async resolveUniqueBranch(mainRepoRoot: string, desired: string, worktreeContainer: string): Promise<string> {
    const exists = async (candidate: string): Promise<boolean> => {
      if (await this.git.branchExists(mainRepoRoot, candidate)) return true
      const dir = path.join(mainRepoRoot, worktreeContainer, slugifyBranch(candidate))
      try {
        await fs.stat(dir)
        return true
      } catch {
        return false
      }
    }
    let candidate = desired
    let n = 2
    while (await exists(candidate)) {
      candidate = `${desired}-${n}`
      n += 1
    }
    return candidate
  }

  async removeWorktreeWorkspace(workspaceId: string, opts: { force?: boolean } = {}): Promise<void> {
    const meta = this.repo.getWorktreeMeta(workspaceId)
    if (meta == null) throw new Error('Workspace is not a worktree')
    const ws = this.repo.findByIdOrFail(workspaceId)
    await this.git.removeWorktree(meta.baseRepoRoot, ws.root_path, {
      ...(opts.force !== undefined && { force: opts.force }),
    })
    // worktree 移除后分支不再被检出，删除它（确认框已告知用户「及其分支」）。
    // 容错：分支删除失败不应阻断 workspace 记录的清理。
    try {
      await this.git.deleteBranch(meta.baseRepoRoot, meta.branch)
    } catch {
      /* 分支可能已被手动删除或不存在 */
    }
    if (this.currentWorkspace?.id === workspaceId) this.currentWorkspace = null
    this.repo.delete(workspaceId)
  }
}

function clampDepth(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_TREE_DEPTH
  return Math.max(0, Math.min(MAX_TREE_DEPTH, Math.floor(value)))
}

function normalizeRelativePath(relativePath: string): string {
  if (path.isAbsolute(relativePath)) {
    throw new Error('Directory path must be relative to workspace root')
  }

  const normalized = path.normalize(relativePath).replace(/\\/g, '/')
  return normalized === '.' ? '' : normalized
}

function resolveInsideRoot(rootPath: string, relativePath: string): string {
  const resolved = path.resolve(rootPath, relativePath)
  const rel = path.relative(rootPath, resolved)

  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('Directory path is outside workspace')
  }

  return resolved
}

async function readVisibleChildren(dirPath: string): Promise<import('node:fs').Dirent[]> {
  try {
    const children = await fs.readdir(dirPath, { withFileTypes: true })
    return children
      .filter((child) => !IGNORED_TREE_NAMES.has(child.name))
      .sort((a, b) => {
        if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1
        return a.name.localeCompare(b.name)
      })
  } catch (error) {
    if (isNodeError(error) && error.code === 'EACCES') return []
    throw error
  }
}

function toPosixPath(value: string): string {
  return value.replace(/\\/g, '/')
}

function parseRelocatedFrom(value: string | null): string[] {
  if (value == null || value.trim() === '') return []
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

async function assertDirectory(rootPath: string): Promise<void> {
  try {
    const stat = await fs.stat(rootPath)
    if (!stat.isDirectory()) {
      throw new Error(`Path is not a directory: ${rootPath}`)
    }
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') {
      throw new Error(`Directory does not exist: ${rootPath}`, { cause: error })
    }
    throw error
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}

function slugifyBranch(branch: string): string {
  return branch.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'worktree'
}

async function ensureGitignoreEntry(repoRoot: string, entry: string): Promise<void> {
  const gitignorePath = path.join(repoRoot, '.gitignore')
  let content = ''
  try {
    content = await fs.readFile(gitignorePath, 'utf8')
  } catch { /* no .gitignore yet */ }
  const lines = content.split(/\r?\n/).map((l) => l.trim())
  if (lines.includes(entry.trim())) return
  const prefix = content === '' || content.endsWith('\n') ? '' : '\n'
  await fs.writeFile(gitignorePath, `${content}${prefix}${entry}\n`, 'utf8')
}

async function resolveWorktreeContainer(repoRoot: string): Promise<string> {
  if (await pathExists(path.join(repoRoot, DEFAULT_WORKTREE_CONTAINER))) {
    return DEFAULT_WORKTREE_CONTAINER
  }
  if (await pathExists(path.join(repoRoot, CLAUDE_WORKTREE_CONTAINER))) {
    return CLAUDE_WORKTREE_CONTAINER
  }
  return DEFAULT_WORKTREE_CONTAINER
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.stat(targetPath)
    return true
  } catch {
    return false
  }
}
