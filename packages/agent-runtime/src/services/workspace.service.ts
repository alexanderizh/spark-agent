import { randomUUID } from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'

import { WorkspaceRepository } from '@spark/storage'
import type { WorkspaceRow } from '@spark/storage'

export interface UpdateWorkspaceParams {
  name?: string
  projectKind?: string
}

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
