import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { WorkspaceService } from '../../services/workspace.service.js'
import type { WorkspaceRow } from '@spark/storage'

function makeWorkspace(overrides: Partial<WorkspaceRow> = {}): WorkspaceRow {
  const now = '2024-01-01T00:00:00.000Z'
  return {
    id: 'ws-1',
    name: 'workspace',
    root_path: '/tmp/workspace',
    spark_config_path: '/tmp/workspace/.spark',
    agent_runtime_path: '/tmp/workspace/.agent_spark',
    project_kind: 'unknown',
    relocated_from_json: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  }
}

function makeRepo() {
  const rows = new Map<string, WorkspaceRow>()

  return {
    rows,
    create: vi.fn((params: { id: string; name: string; rootPath: string; projectKind?: string }) => {
      const row = makeWorkspace({
        id: params.id,
        name: params.name,
        root_path: params.rootPath,
        spark_config_path: `${params.rootPath}/.spark`,
        agent_runtime_path: `${params.rootPath}/.agent_spark`,
        project_kind: params.projectKind ?? 'unknown',
      })
      rows.set(row.id, row)
      return row
    }),
    findByRootPath: vi.fn((rootPath: string) => {
      return [...rows.values()].find((row) => row.root_path === rootPath) ?? null
    }),
    findByIdOrFail: vi.fn((id: string) => {
      const row = rows.get(id)
      if (row === undefined) throw new Error(`Workspace not found: ${id}`)
      return row
    }),
    listAll: vi.fn((limit = 50, offset = 0) => [...rows.values()].slice(offset, offset + limit)),
    delete: vi.fn((id: string) => rows.delete(id)),
    update: vi.fn((id: string, params: { name?: string; projectKind?: string }) => {
      const row = rows.get(id)
      if (row === undefined) return
      if (params.name !== undefined) row.name = params.name
      if (params.projectKind !== undefined) row.project_kind = params.projectKind
    }),
  }
}

describe('WorkspaceService', () => {
  let tempDir: string
  let repo: ReturnType<typeof makeRepo>
  let service: WorkspaceService

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'spark-workspace-'))
    repo = makeRepo()
    service = new WorkspaceService(repo as never)
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('throws when root path does not exist', async () => {
    const missingPath = path.join(tempDir, 'missing')

    await expect(service.openWorkspace(missingPath)).rejects.toThrow(
      `Directory does not exist: ${missingPath}`,
    )
  })

  it('throws when root path is not a directory', async () => {
    const filePath = path.join(tempDir, 'file.txt')
    await writeFile(filePath, 'hello')

    await expect(service.openWorkspace(filePath)).rejects.toThrow(
      `Path is not a directory: ${filePath}`,
    )
  })

  it('creates a workspace for a new root path and sets current', async () => {
    const workspace = await service.openWorkspace(tempDir, 'Custom Workspace')

    expect(repo.findByRootPath).toHaveBeenCalledWith(tempDir)
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Custom Workspace',
        rootPath: tempDir,
        projectKind: 'unknown',
      }),
    )
    expect(workspace.name).toBe('Custom Workspace')
    expect(service.getCurrent()).toBe(workspace)
  })

  it('reuses an existing workspace for the same root path', async () => {
    const existing = makeWorkspace({ id: 'existing', root_path: tempDir })
    repo.rows.set(existing.id, existing)

    const workspace = await service.openWorkspace(tempDir)

    expect(workspace).toBe(existing)
    expect(repo.create).not.toHaveBeenCalled()
    expect(service.getCurrent()).toBe(existing)
  })

  it('returns null when no workspace is current', () => {
    expect(service.getCurrent()).toBeNull()
  })

  it('closeWorkspace clears current workspace', async () => {
    await service.openWorkspace(tempDir)

    service.closeWorkspace()

    expect(service.getCurrent()).toBeNull()
  })

  it('deleteWorkspace clears current when deleting current workspace', async () => {
    const workspace = await service.openWorkspace(tempDir)

    const deleted = service.deleteWorkspace(workspace.id)

    expect(deleted).toBe(true)
    expect(repo.delete).toHaveBeenCalledWith(workspace.id)
    expect(service.getCurrent()).toBeNull()
  })

  it('deleteWorkspace keeps current when deleting another workspace', async () => {
    const workspace = await service.openWorkspace(tempDir)
    repo.rows.set('other', makeWorkspace({ id: 'other', root_path: path.join(tempDir, 'other') }))

    service.deleteWorkspace('other')

    expect(service.getCurrent()).toBe(workspace)
  })

  it('updateWorkspace syncs current workspace state', async () => {
    const workspace = await service.openWorkspace(tempDir)

    service.updateWorkspace(workspace.id, { name: 'Renamed', projectKind: 'node' })

    expect(repo.update).toHaveBeenCalledWith(workspace.id, { name: 'Renamed', projectKind: 'node' })
    expect(service.getCurrent()).toMatchObject({
      name: 'Renamed',
      project_kind: 'node',
    })
  })

  it('updateWorkspace does not mutate current for another workspace', async () => {
    const workspace = await service.openWorkspace(tempDir)

    service.updateWorkspace('other', { name: 'Other' })

    expect(service.getCurrent()).toBe(workspace)
    expect(service.getCurrent()?.name).not.toBe('Other')
  })

  it('listWorkspaces delegates to repository listAll', () => {
    const listed = [makeWorkspace({ id: 'ws-1' }), makeWorkspace({ id: 'ws-2' })]
    repo.listAll.mockReturnValue(listed)

    const result = service.listWorkspaces(10, 5)

    expect(repo.listAll).toHaveBeenCalledWith(10, 5)
    expect(result).toBe(listed)
  })

  it('lists a bounded workspace directory tree', async () => {
    const workspace = await service.openWorkspace(tempDir)
    await mkdir(path.join(tempDir, 'src', 'nested'), { recursive: true })
    await mkdir(path.join(tempDir, 'node_modules'), { recursive: true })
    await writeFile(path.join(tempDir, 'package.json'), '{}')
    await writeFile(path.join(tempDir, 'src', 'index.ts'), 'export {}')
    await writeFile(path.join(tempDir, 'src', 'nested', 'deep.ts'), 'export {}')
    await writeFile(path.join(tempDir, 'node_modules', 'ignored.js'), '')

    const entries = await service.listDirectoryTree(workspace.id, { maxDepth: 1 })

    expect(entries.map((entry) => entry.path)).toEqual([
      'src',
      'src/nested',
      'src/index.ts',
      'package.json',
    ])
    expect(entries.find((entry) => entry.path === 'src/index.ts')).toMatchObject({
      type: 'file',
      extension: 'ts',
      depth: 1,
    })
    expect(entries.some((entry) => entry.path.startsWith('node_modules'))).toBe(false)
  })

  it('rejects directory traversal when listing a tree', async () => {
    const workspace = await service.openWorkspace(tempDir)

    await expect(service.listDirectoryTree(workspace.id, { path: '..' })).rejects.toThrow(
      'Directory path is outside workspace',
    )
  })
})
