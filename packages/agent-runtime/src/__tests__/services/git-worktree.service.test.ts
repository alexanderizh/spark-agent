import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { GitWorktreeService } from '../../services/git-worktree.service.js'

const execFileAsync = promisify(execFile)

async function initRepo(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'spark-wt-'))
  await execFileAsync('git', ['init', '-b', 'main'], { cwd: dir })
  await execFileAsync('git', ['config', 'user.email', 't@t.dev'], { cwd: dir })
  await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: dir })
  await writeFile(path.join(dir, 'README.md'), '# test\n')
  await execFileAsync('git', ['add', '.'], { cwd: dir })
  await execFileAsync('git', ['commit', '-m', 'init'], { cwd: dir })
  return dir
}

describe('GitWorktreeService.listWorktrees', () => {
  let repo: string
  const svc = new GitWorktreeService()

  beforeEach(async () => { repo = await initRepo() })
  afterEach(async () => { await rm(repo, { recursive: true, force: true }) })

  it('returns the main worktree', async () => {
    const list = await svc.listWorktrees(repo)
    expect(list).toHaveLength(1)
    expect(list[0]?.isMain).toBe(true)
    expect(list[0]?.branch).toBe('main')
    expect(list[0]?.head).toMatch(/^[0-9a-f]{7,}$/)
  })

  it('lists an added worktree', async () => {
    const wtPath = path.join(repo, '.worktrees', 'feat-x')
    await execFileAsync('git', ['worktree', 'add', '-b', 'feat-x', wtPath], { cwd: repo })
    const list = await svc.listWorktrees(repo)
    const added = list.find((w) => w.branch === 'feat-x')
    expect(added).toBeDefined()
    expect(added?.isMain).toBe(false)
  })

  it('throws for a non-git directory', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'spark-nogit-'))
    await expect(svc.listWorktrees(dir)).rejects.toThrow()
    await rm(dir, { recursive: true, force: true })
  })
})

describe('GitWorktreeService merge & base helpers', () => {
  let repo: string
  const svc = new GitWorktreeService()
  beforeEach(async () => { repo = await initRepo() })
  afterEach(async () => { await rm(repo, { recursive: true, force: true }) })

  it('isMerged is false for branch with new commits, true after merge', async () => {
    const wtPath = path.join(repo, '.worktrees', 'feat-y')
    await execFileAsync('git', ['worktree', 'add', '-b', 'feat-y', wtPath], { cwd: repo })
    await writeFile(path.join(wtPath, 'a.txt'), 'a\n')
    await execFileAsync('git', ['add', '.'], { cwd: wtPath })
    await execFileAsync('git', ['commit', '-m', 'feat'], { cwd: wtPath })

    expect(await svc.isMerged(repo, 'feat-y', 'main')).toBe(false)
    await execFileAsync('git', ['merge', 'feat-y'], { cwd: repo })
    expect(await svc.isMerged(repo, 'feat-y', 'main')).toBe(true)
  })

  it('detectBaseBranch falls back to current branch', async () => {
    expect(await svc.detectBaseBranch(repo)).toBe('main')
  })

  it('resolveMainRepoRoot returns repo root from inside a worktree', async () => {
    const wtPath = path.join(repo, '.worktrees', 'feat-z')
    await execFileAsync('git', ['worktree', 'add', '-b', 'feat-z', wtPath], { cwd: repo })
    const resolved = await svc.resolveMainRepoRoot(wtPath)
    const realRepo = await svc.resolveMainRepoRoot(repo)
    expect(resolved).toBe(realRepo)
  })
})

describe('GitWorktreeService listMergedBranches & deleteBranch', () => {
  let repo: string
  const svc = new GitWorktreeService()
  beforeEach(async () => { repo = await initRepo() })
  afterEach(async () => { await rm(repo, { recursive: true, force: true }) })

  it('listMergedBranches includes a branch only after it is merged', async () => {
    const wtPath = path.join(repo, '.worktrees', 'feat-m')
    await execFileAsync('git', ['worktree', 'add', '-b', 'feat-m', wtPath], { cwd: repo })
    await writeFile(path.join(wtPath, 'm.txt'), 'm\n')
    await execFileAsync('git', ['add', '.'], { cwd: wtPath })
    await execFileAsync('git', ['commit', '-m', 'm'], { cwd: wtPath })

    expect(await svc.listMergedBranches(repo, 'main')).not.toContain('feat-m')
    await execFileAsync('git', ['merge', 'feat-m'], { cwd: repo })
    expect(await svc.listMergedBranches(repo, 'main')).toContain('feat-m')
  })

  it('deleteBranch removes a branch after its worktree is removed', async () => {
    const wtPath = path.join(repo, '.worktrees', 'feat-d')
    await execFileAsync('git', ['worktree', 'add', '-b', 'feat-d', wtPath], { cwd: repo })
    await svc.removeWorktree(repo, wtPath, { force: true })
    await svc.deleteBranch(repo, 'feat-d')
    const { stdout } = await execFileAsync('git', ['branch', '--format=%(refname:short)'], { cwd: repo })
    expect(stdout).not.toContain('feat-d')
  })
})
