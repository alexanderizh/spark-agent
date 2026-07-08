import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { promisify } from 'node:util'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { GitWorktreeService } from '../../services/git-worktree.service.js'
import { WorkspaceService, detectProjectKind } from '../../services/workspace.service.js'
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
    worktree_meta_json: null,
    pinned_at: null,
    archived_at: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  }
}

function makeRepo() {
  const rows = new Map<string, WorkspaceRow>()

  return {
    rows,
    create: vi.fn((params: { id: string; name: string; rootPath: string; projectKind?: string; worktreeMeta?: unknown }) => {
      const row = makeWorkspace({
        id: params.id,
        name: params.name,
        root_path: params.rootPath,
        spark_config_path: `${params.rootPath}/.spark`,
        agent_runtime_path: `${params.rootPath}/.agent_spark`,
        project_kind: params.projectKind ?? 'unknown',
        worktree_meta_json: params.worktreeMeta ? JSON.stringify(params.worktreeMeta) : null,
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
    countAll: vi.fn(() => rows.size),
    delete: vi.fn((id: string) => rows.delete(id)),
    update: vi.fn((id: string, params: { name?: string; projectKind?: string }) => {
      const row = rows.get(id)
      if (row === undefined) return
      if (params.name !== undefined) row.name = params.name
      if (params.projectKind !== undefined) row.project_kind = params.projectKind
    }),
    relocate: vi.fn((id: string, params: { rootPath: string; relocatedFrom?: string[] }) => {
      const row = rows.get(id)
      if (row === undefined) return
      row.root_path = params.rootPath
      row.spark_config_path = `${params.rootPath}/.spark`
      row.agent_runtime_path = `${params.rootPath}/.agent_spark`
      row.relocated_from_json = JSON.stringify(params.relocatedFrom ?? [])
    }),
    getWorktreeMeta: vi.fn((id: string) => {
      const row = rows.get(id)
      return row?.worktree_meta_json ? JSON.parse(row.worktree_meta_json) : null
    }),
    findWorktreesByBaseRepo: vi.fn(() => [] as WorkspaceRow[]),
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
    repo.rows.set('other', makeWorkspace({ id: 'other', root_path: path.join(tempDir, 'other') }))

    service.updateWorkspace('other', { name: 'Other' })

    expect(service.getCurrent()).toBe(workspace)
    expect(service.getCurrent()?.name).not.toBe('Other')
  })

  it('relocateWorkspace moves the workspace root and records the previous path', async () => {
    const workspace = await service.openWorkspace(tempDir)
    const relocatedRoot = path.join(tempDir, 'persistent-no-project')

    const relocated = await service.relocateWorkspace(workspace.id, { rootPath: relocatedRoot })

    expect(repo.relocate).toHaveBeenCalledWith(
      workspace.id,
      expect.objectContaining({
        rootPath: relocatedRoot,
        relocatedFrom: [tempDir],
      }),
    )
    expect(relocated.root_path).toBe(relocatedRoot)
    expect(relocated.spark_config_path).toBe(`${relocatedRoot}/.spark`)
    expect(service.getCurrent()?.root_path).toBe(relocatedRoot)
  })

  it('listWorkspaces delegates to repository listAll', () => {
    const listed = [makeWorkspace({ id: 'ws-1' }), makeWorkspace({ id: 'ws-2' })]
    repo.listAll.mockReturnValue(listed)

    const result = service.listWorkspaces(10, 5)

    expect(repo.listAll).toHaveBeenCalledWith(10, 5, {})
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

  it('hides known worktree containers from the workspace directory tree', async () => {
    const workspace = await service.openWorkspace(tempDir)
    await mkdir(path.join(tempDir, '.worktrees', 'feat-a'), { recursive: true })
    await mkdir(path.join(tempDir, '.claude', 'worktrees', 'feat-b'), { recursive: true })
    await mkdir(path.join(tempDir, '.spark', 'worktrees', 'legacy'), { recursive: true })
    await writeFile(path.join(tempDir, '.worktrees', 'feat-a', 'generated.ts'), 'export {}')
    await writeFile(path.join(tempDir, '.claude', 'worktrees', 'feat-b', 'generated.ts'), 'export {}')
    await writeFile(path.join(tempDir, '.spark', 'worktrees', 'legacy', 'generated.ts'), 'export {}')

    const entries = await service.listDirectoryTree(workspace.id, { maxDepth: 3 })
    const paths = entries.map((entry) => entry.path)

    expect(paths.some((entryPath) => entryPath.startsWith('.worktrees'))).toBe(false)
    expect(paths.some((entryPath) => entryPath.startsWith('.claude/worktrees'))).toBe(false)
    expect(paths.some((entryPath) => entryPath.startsWith('.spark/worktrees'))).toBe(false)
  })

  it('rejects directory traversal when listing a tree', async () => {
    const workspace = await service.openWorkspace(tempDir)

    await expect(service.listDirectoryTree(workspace.id, { path: '..' })).rejects.toThrow(
      'Directory path is outside workspace',
    )
  })

  it('openWorkspace auto-detects project kind', async () => {
    await writeFile(path.join(tempDir, 'go.mod'), 'module example')
    const workspace = await service.openWorkspace(tempDir, 'GoProject')
    expect(workspace.project_kind).toBe('go')
  })
})

describe('detectProjectKind', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), 'spark-detect-'))
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  it('detects typescript when package.json + tsconfig.json exist', async () => {
    await writeFile(path.join(tempDir, 'package.json'), '{}')
    await writeFile(path.join(tempDir, 'tsconfig.json'), '{}')
    await expect(detectProjectKind(tempDir)).resolves.toBe('typescript')
  })

  it('detects javascript when only package.json exists', async () => {
    await writeFile(path.join(tempDir, 'package.json'), '{}')
    await expect(detectProjectKind(tempDir)).resolves.toBe('javascript')
  })

  it('detects rust when Cargo.toml exists', async () => {
    await writeFile(path.join(tempDir, 'Cargo.toml'), '[package]')
    await expect(detectProjectKind(tempDir)).resolves.toBe('rust')
  })

  it('detects go when go.mod exists', async () => {
    await writeFile(path.join(tempDir, 'go.mod'), 'module example')
    await expect(detectProjectKind(tempDir)).resolves.toBe('go')
  })

  it('detects python when pyproject.toml exists', async () => {
    await writeFile(path.join(tempDir, 'pyproject.toml'), '[project]')
    await expect(detectProjectKind(tempDir)).resolves.toBe('python')
  })

  it('detects python when requirements.txt exists', async () => {
    await writeFile(path.join(tempDir, 'requirements.txt'), 'flask')
    await expect(detectProjectKind(tempDir)).resolves.toBe('python')
  })

  it('detects python when setup.py exists', async () => {
    await writeFile(path.join(tempDir, 'setup.py'), 'from setuptools import setup')
    await expect(detectProjectKind(tempDir)).resolves.toBe('python')
  })

  it('detects java when pom.xml exists', async () => {
    await writeFile(path.join(tempDir, 'pom.xml'), '<project></project>')
    await expect(detectProjectKind(tempDir)).resolves.toBe('java')
  })

  it('detects java when build.gradle exists', async () => {
    await writeFile(path.join(tempDir, 'build.gradle'), 'plugins {}')
    await expect(detectProjectKind(tempDir)).resolves.toBe('java')
  })

  it('detects java when build.gradle.kts exists', async () => {
    await writeFile(path.join(tempDir, 'build.gradle.kts'), 'plugins {}')
    await expect(detectProjectKind(tempDir)).resolves.toBe('java')
  })

  it('detects csharp when .csproj file exists', async () => {
    await writeFile(path.join(tempDir, 'App.csproj'), '<Project></Project>')
    await expect(detectProjectKind(tempDir)).resolves.toBe('csharp')
  })

  it('detects csharp when .sln file exists', async () => {
    await writeFile(path.join(tempDir, 'App.sln'), '')
    await expect(detectProjectKind(tempDir)).resolves.toBe('csharp')
  })

  it('detects ruby when Gemfile exists', async () => {
    await writeFile(path.join(tempDir, 'Gemfile'), "source 'https://rubygems.org'")
    await expect(detectProjectKind(tempDir)).resolves.toBe('ruby')
  })

  it('detects php when composer.json exists', async () => {
    await writeFile(path.join(tempDir, 'composer.json'), '{}')
    await expect(detectProjectKind(tempDir)).resolves.toBe('php')
  })

  it('detects elixir when mix.exs exists', async () => {
    await writeFile(path.join(tempDir, 'mix.exs'), 'defmodule do end')
    await expect(detectProjectKind(tempDir)).resolves.toBe('elixir')
  })

  it('detects cpp when CMakeLists.txt exists', async () => {
    await writeFile(path.join(tempDir, 'CMakeLists.txt'), 'cmake_minimum_required(VERSION 3.0)')
    await expect(detectProjectKind(tempDir)).resolves.toBe('cpp')
  })

  it('detects cpp when Makefile exists', async () => {
    await writeFile(path.join(tempDir, 'Makefile'), 'all:')
    await expect(detectProjectKind(tempDir)).resolves.toBe('cpp')
  })

  it('returns unknown when no indicator files exist', async () => {
    await expect(detectProjectKind(tempDir)).resolves.toBe('unknown')
  })

  it('returns unknown for non-existent directory', async () => {
    await expect(detectProjectKind('/non/existent/path')).resolves.toBe('unknown')
  })

  it('prioritizes typescript over javascript when both indicators match', async () => {
    await writeFile(path.join(tempDir, 'package.json'), '{}')
    await writeFile(path.join(tempDir, 'tsconfig.json'), '{}')
    // First rule: package.json + tsconfig.json → 'typescript'
    await expect(detectProjectKind(tempDir)).resolves.toBe('typescript')
  })
})

const execFileAsyncT = promisify(execFile)

describe('WorkspaceService worktree', () => {
  it('createWorktreeWorkspace adds a worktree under .worktrees by default and registers a workspace', async () => {
    const repoDir = await mkdtemp(path.join(tmpdir(), 'spark-wssvc-'))
    await execFileAsyncT('git', ['init', '-b', 'main'], { cwd: repoDir })
    await execFileAsyncT('git', ['config', 'user.email', 't@t.dev'], { cwd: repoDir })
    await execFileAsyncT('git', ['config', 'user.name', 'T'], { cwd: repoDir })
    await writeFile(path.join(repoDir, 'README.md'), '# x\n')
    await execFileAsyncT('git', ['add', '.'], { cwd: repoDir })
    await execFileAsyncT('git', ['commit', '-m', 'init'], { cwd: repoDir })

    const repo = makeRepo()
    const base = repo.create({ id: 'base', name: 'base', rootPath: repoDir, projectKind: 'unknown' })
    const svc = new WorkspaceService(repo as never, new GitWorktreeService())

    const wt = await svc.createWorktreeWorkspace({ baseWorkspaceId: base.id, branch: 'spark/feat-1' })
    expect(wt.root_path).toContain(path.join('.worktrees'))
    expect(wt.root_path).not.toContain(path.join('.spark', 'worktrees'))
    expect(repo.create).toHaveBeenCalledTimes(2)

    await rm(repoDir, { recursive: true, force: true })
  })

  it('createWorktreeWorkspace reuses .claude/worktrees when that container already exists', async () => {
    const repoDir = await mkdtemp(path.join(tmpdir(), 'spark-wssvc-'))
    await execFileAsyncT('git', ['init', '-b', 'main'], { cwd: repoDir })
    await execFileAsyncT('git', ['config', 'user.email', 't@t.dev'], { cwd: repoDir })
    await execFileAsyncT('git', ['config', 'user.name', 'T'], { cwd: repoDir })
    await writeFile(path.join(repoDir, 'README.md'), '# x\n')
    await execFileAsyncT('git', ['add', '.'], { cwd: repoDir })
    await execFileAsyncT('git', ['commit', '-m', 'init'], { cwd: repoDir })
    await mkdir(path.join(repoDir, '.claude', 'worktrees'), { recursive: true })

    const repo = makeRepo()
    const base = repo.create({ id: 'base', name: 'base', rootPath: repoDir, projectKind: 'unknown' })
    const svc = new WorkspaceService(repo as never, new GitWorktreeService())

    const wt = await svc.createWorktreeWorkspace({ baseWorkspaceId: base.id, branch: 'spark/feat-claude' })
    expect(wt.root_path).toContain(path.join('.claude', 'worktrees'))
    expect(wt.root_path).not.toContain(path.join('.spark', 'worktrees'))

    await rm(repoDir, { recursive: true, force: true })
  })
})
