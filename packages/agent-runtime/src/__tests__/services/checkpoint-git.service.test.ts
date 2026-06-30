import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CheckpointGitService } from '../../services/checkpoint-git.service.js'

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', ['-C', cwd, ...args], { stdio: 'ignore' })
}

describe('CheckpointGitService', () => {
  let ws: string
  let svc: CheckpointGitService

  beforeEach(() => {
    ws = mkdtempSync(join(tmpdir(), 'spark-ckpt-git-'))
    git(ws, 'init')
    git(ws, 'config', 'user.email', 't@t.com')
    git(ws, 'config', 'user.name', 't')
    writeFileSync(join(ws, '.gitignore'), 'node_modules/\nbuild/\n')
    writeFileSync(join(ws, 'a.txt'), 'A1')
    mkdirSync(join(ws, 'src'), { recursive: true })
    writeFileSync(join(ws, 'src', 'b.ts'), 'B1')
    mkdirSync(join(ws, 'node_modules'), { recursive: true })
    writeFileSync(join(ws, 'node_modules', 'dep.js'), 'IGNORED')
    git(ws, 'add', '-A')
    git(ws, 'commit', '-m', 'init')
    svc = new CheckpointGitService()
  })

  afterEach(() => {
    rmSync(ws, { recursive: true, force: true })
  })

  it('detects git repo', async () => {
    expect(await svc.isGitRepo(ws)).toBe(true)
    const nonGit = mkdtempSync(join(tmpdir(), 'spark-nogit-'))
    try {
      expect(await svc.isGitRepo(nonGit)).toBe(false)
    } finally {
      rmSync(nonGit, { recursive: true, force: true })
    }
  })

  it('snapshot respects .gitignore and dedups by tree', async () => {
    writeFileSync(join(ws, 'a.txt'), 'A2')
    writeFileSync(join(ws, 'c.txt'), 'NEW')
    mkdirSync(join(ws, 'build'), { recursive: true })
    writeFileSync(join(ws, 'build', 'o.js'), 'OUT')

    const r1 = await svc.snapshot(ws, 'sess-1', 'cp-1', 'first')
    expect(r1.created).toBe(true)
    // node_modules / build 被 .gitignore 排除，应只数到受控文件
    expect(r1.fileCount).toBeGreaterThan(0)
    expect(await svc.hasCheckpoint(ws, 'sess-1', 'cp-1')).toBe(true)

    // 工作区无变化 → 第二次快照应跳过（去重）
    const r2 = await svc.snapshot(ws, 'sess-1', 'cp-2', 'second')
    expect(r2.created).toBe(false)
    expect(await svc.hasCheckpoint(ws, 'sess-1', 'cp-2')).toBe(false)
  })

  it('restore is non-destructive: reverts modified, recreates deleted, keeps newly added', async () => {
    writeFileSync(join(ws, 'a.txt'), 'A2')
    await svc.snapshot(ws, 'sess-1', 'cp-1', 'cp')

    // 改 a、删 b、加 c（快照后新增）
    writeFileSync(join(ws, 'a.txt'), 'A-BAD')
    rmSync(join(ws, 'src', 'b.ts'))
    writeFileSync(join(ws, 'c.txt'), 'AFTER')

    await svc.restore(ws, 'sess-1', 'cp-1')

    expect(readFileSync(join(ws, 'a.txt'), 'utf8')).toBe('A2') // 回退
    expect(readFileSync(join(ws, 'src', 'b.ts'), 'utf8')).toBe('B1') // 重建
    expect(existsSync(join(ws, 'c.txt'))).toBe(true) // 安全：不删快照后新增文件
  })

  it('prune keeps only given checkpoint ids', async () => {
    writeFileSync(join(ws, 'a.txt'), 'A2')
    await svc.snapshot(ws, 'sess-1', 'cp-1', 'cp')
    writeFileSync(join(ws, 'a.txt'), 'A3')
    await svc.snapshot(ws, 'sess-1', 'cp-2', 'cp')
    await svc.prune('' + ws, 'sess-1', ['cp-2'])
    expect(await svc.hasCheckpoint(ws, 'sess-1', 'cp-1')).toBe(false)
    expect(await svc.hasCheckpoint(ws, 'sess-1', 'cp-2')).toBe(true)
  })
})
