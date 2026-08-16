/**
 * SessionWorktreeStateService 单元测试：
 *  - enter/exit 的 metadata 持久化与变更通知语义（changed 标志）
 *  - git 真实性校验（拒绝主仓库路径、接受 linked worktree、解析其分支）
 *  - readSessionRuntimeWorktree 解析容错
 *
 * 依赖真实 git 与临时目录（与 git-worktree.service.test.ts 同策略）。
 */
import { execFile } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SparkDatabase } from '@spark/storage'
import {
  SessionWorktreeStateService,
  readSessionRuntimeWorktree,
} from '../../services/session-worktree-state.js'

const execFileAsync = promisify(execFile)

describe('SessionWorktreeStateService', () => {
  let testDir: string
  let db: SparkDatabase
  let service: SessionWorktreeStateService

  beforeEach(() => {
    testDir = mkdtempSync(path.join(tmpdir(), 'spark-session-worktree-'))
    db = new SparkDatabase(path.join(testDir, 'test.db'))
    db.runMigrations(path.join(process.cwd(), '..', 'storage', 'migrations'))
    service = new SessionWorktreeStateService(db)
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  async function git(cwd: string, args: string[]): Promise<void> {
    await execFileAsync('git', args, { cwd })
  }

  /** 建一个带初始提交的主仓库 + 分支为 feat-x 的 linked worktree，返回 worktree 绝对路径 */
  async function createRepoWithWorktree(
    branch: string,
  ): Promise<{ repo: string; worktree: string }> {
    const repo = path.join(testDir, 'repo')
    const worktree = path.join(testDir, 'wt')
    mkdirSync(repo)
    await git(repo, ['init', '-b', 'main'])
    await git(repo, ['config', 'user.email', 't@t.dev'])
    await git(repo, ['config', 'user.name', 'Test'])
    await git(repo, ['commit', '--allow-empty', '-m', 'init'])
    await git(repo, ['worktree', 'add', '-b', branch, worktree])
    return { repo, worktree }
  }

  it('persists enter state with the branch resolved from git and reports changed', async () => {
    const { worktree } = await createRepoWithWorktree('feat-x')
    const sessionId = 'sess-wt-1'
    db.prepare(
      `INSERT INTO sessions (id, kind, title, project_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      sessionId,
      'chat',
      'T',
      'proj',
      'idle',
      new Date().toISOString(),
      new Date().toISOString(),
    )

    const r = await service.apply(sessionId, { action: 'enter', path: worktree })
    expect(r.ok).toBe(true)
    expect(r.changed).toBe(true)
    expect(r.worktree).toMatchObject({ path: worktree, branch: 'feat-x' })

    // 持久化可回读
    expect(service.get(sessionId)).toMatchObject({ path: worktree, branch: 'feat-x' })

    // 相同 path + branch 的重复 enter 是 no-op
    const again = await service.apply(sessionId, { action: 'enter', path: worktree })
    expect(again.changed).toBe(false)
  })

  it('clears state on exit and treats exit-without-state as no-op', async () => {
    const { worktree } = await createRepoWithWorktree('feat-y')
    const sessionId = 'sess-wt-2'
    db.prepare(
      `INSERT INTO sessions (id, kind, title, project_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      sessionId,
      'chat',
      'T',
      'proj',
      'idle',
      new Date().toISOString(),
      new Date().toISOString(),
    )

    const noOp = await service.apply(sessionId, { action: 'exit' })
    expect(noOp).toEqual({ ok: true, worktree: null, changed: false })

    await service.apply(sessionId, { action: 'enter', path: worktree })
    const exited = await service.apply(sessionId, { action: 'exit' })
    expect(exited).toEqual({ ok: true, worktree: null, changed: true })
    expect(service.get(sessionId)).toBeNull()
  })

  it('rejects the main checkout path and missing paths', async () => {
    const { repo } = await createRepoWithWorktree('feat-z')
    const sessionId = 'sess-wt-3'
    db.prepare(
      `INSERT INTO sessions (id, kind, title, project_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      sessionId,
      'chat',
      'T',
      'proj',
      'idle',
      new Date().toISOString(),
      new Date().toISOString(),
    )

    const main = await service.apply(sessionId, { action: 'enter', path: repo })
    expect(main.ok).toBe(false)
    expect(main.changed).toBe(false)
    expect(main.error).toContain('not a git worktree')

    const missing = await service.apply(sessionId, {
      action: 'enter',
      path: path.join(testDir, 'does-not-exist'),
    })
    expect(missing.ok).toBe(false)
    expect(missing.error).toContain('does not exist')

    // 校验失败不落任何状态
    expect(service.get(sessionId)).toBeNull()
  })

  it('falls back to the agent-provided branch only for detached worktrees', async () => {
    const { worktree } = await createRepoWithWorktree('feat-detach')
    // 把 worktree 切成 detached HEAD，模拟无法从 git 解析分支的场景
    await git(worktree, ['checkout', '--detach'])
    const sessionId = 'sess-wt-4'
    db.prepare(
      `INSERT INTO sessions (id, kind, title, project_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      sessionId,
      'chat',
      'T',
      'proj',
      'idle',
      new Date().toISOString(),
      new Date().toISOString(),
    )

    const r = await service.apply(sessionId, { action: 'enter', path: worktree, branch: 'manual' })
    expect(r.ok).toBe(true)
    expect(r.worktree).toMatchObject({ branch: 'manual' })
  })
})

describe('readSessionRuntimeWorktree', () => {
  it('parses a valid payload', () => {
    expect(
      readSessionRuntimeWorktree(
        JSON.stringify({
          runtimeWorktree: { path: '/x/wt', branch: 'b', updatedAt: '2026-08-16T00:00:00Z' },
        }),
      ),
    ).toEqual({ path: '/x/wt', branch: 'b', updatedAt: '2026-08-16T00:00:00Z' })
  })

  it('returns null for missing / malformed payloads', () => {
    expect(readSessionRuntimeWorktree(null)).toBeNull()
    expect(readSessionRuntimeWorktree('')).toBeNull()
    expect(readSessionRuntimeWorktree('not json')).toBeNull()
    expect(readSessionRuntimeWorktree('{}')).toBeNull()
    expect(
      readSessionRuntimeWorktree(JSON.stringify({ runtimeWorktree: { branch: 'b' } })),
    ).toBeNull()
    expect(
      readSessionRuntimeWorktree(JSON.stringify({ runtimeWorktree: { path: '', branch: 'b' } })),
    ).toBeNull()
  })
})
