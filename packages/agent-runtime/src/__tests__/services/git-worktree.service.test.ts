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
    const wtPath = path.join(repo, '.spark', 'worktrees', 'feat-x')
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
