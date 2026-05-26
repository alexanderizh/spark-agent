import { randomUUID } from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'

import { WorkspaceRepository } from '@spark/storage'
import type { WorkspaceRow } from '@spark/storage'
import type { WorkspaceTreeEntry } from '@spark/protocol'

export interface UpdateWorkspaceParams {
  name?: string
  projectKind?: string
}

export interface ListDirectoryTreeParams {
  path?: string
  maxDepth?: number
}

const DEFAULT_TREE_DEPTH = 3
const MAX_TREE_DEPTH = 5
const MAX_TREE_ENTRIES = 1000
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

  constructor(private readonly repo: WorkspaceRepository) {}

  async openWorkspace(rootPath: string, name?: string): Promise<WorkspaceRow> {
    const resolved = path.resolve(rootPath)
    await assertDirectory(resolved)

    const existing = this.repo.findByRootPath(resolved)
    if (existing !== null) {
      this.currentWorkspace = existing
      return existing
    }

    const workspace = this.repo.create({
      id: randomUUID(),
      name: name ?? path.basename(resolved),
      rootPath: resolved,
      projectKind: 'unknown',
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

  listWorkspaces(limit = 50, offset = 0): WorkspaceRow[] {
    return this.repo.listAll(limit, offset)
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

  updateWorkspace(id: string, params: UpdateWorkspaceParams): void {
    this.repo.update(id, params)

    if (this.currentWorkspace?.id !== id) {
      return
    }

    if (params.name !== undefined) {
      this.currentWorkspace.name = params.name
    }

    if (params.projectKind !== undefined) {
      this.currentWorkspace.project_kind = params.projectKind
    }

    this.currentWorkspace.updated_at = new Date().toISOString()
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
