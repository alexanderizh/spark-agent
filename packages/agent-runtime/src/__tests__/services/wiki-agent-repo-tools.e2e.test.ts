/**
 * @module wiki-agent-repo-tools.e2e.test
 *
 * Agent repo 编排工具（wiki_repo_scan / wiki_repo_status）端到端行为锁：
 * 真 git 仓库 + 真 SQLite + SessionService 桥（SDK in-process 与 MCP 瘦桥
 * 共用同一 bridgeWikiRepo* 入口，这里锁的就是两条路径的共同语义）。
 *
 * 覆盖不变量：
 *   - 种子扫描后 status 已同步（generatedRev 非空且 == currentRev）；
 *   - 代码推进 → status 漂移可感知 → scan 重建 → status 回到已同步且 rev 前进；
 *   - 非 repo 空间 / 不存在空间 → 结构化错误（不抛异常、不静默成功）；
 *   - 越权防线：scope 外空间 scan / status 双拒绝（防线先于服务层）。
 *
 * HOME 指向临时目录：种子栈与 SessionService 桥栈的 WikiStoreService 才会
 * 解析到同一份 project-orphan 正文文件（repo 空间固定 project/NULL）。
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { SparkDatabase, WikiPageRepository, WorkspaceRepository } from '@spark/storage'
import { SessionService } from '../../services/session.service.js'
import { createWikiServiceStack } from '../../services/wiki/wiki-service-stack.js'

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf-8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'test',
      GIT_COMMITTER_EMAIL: 'test@example.com',
    },
  }).trim()
}

describe('Agent repo 编排工具（wiki_repo_scan / wiki_repo_status）e2e', () => {
  let db: SparkDatabase
  let testDir: string
  let repo: string
  let service: SessionService
  let sessionId: string
  /** 种子扫描建出的 repo 空间（project/NULL，Agent 会话 scope 并入后可见） */
  let repoSpaceId: string
  /** 普通 user 空间（在 scope 内但非 repo，服务层应结构化拒绝） */
  let plainSpaceId: string
  /** 其他 workspace 的 project 空间（scope 防线外） */
  let foreignSpaceId: string
  let originalHome: string | undefined

  beforeEach(async () => {
    testDir = mkdtempSync(path.join(tmpdir(), 'spark-wiki-repo-tools-'))
    originalHome = process.env.HOME
    process.env.HOME = testDir

    // 真 git 仓库脚手架（S4 同款）：README + package.json + src/
    repo = path.join(testDir, 'demo-repo')
    mkdirSync(path.join(repo, 'src'), { recursive: true })
    writeFileSync(path.join(repo, 'README.md'), '# demo\n')
    writeFileSync(path.join(repo, 'package.json'), JSON.stringify({ name: 'demo' }))
    writeFileSync(path.join(repo, 'src', 'index.ts'), 'export const a = 1\n')
    git(repo, ['init', '-q'])
    git(repo, ['add', '-A'])
    git(repo, ['commit', '-q', '-m', 'init'])

    db = new SparkDatabase(path.join(testDir, 'test.db'))
    db.runMigrations(path.join(process.cwd(), '..', 'storage', 'migrations'))

    // 种子：UI 同款栈扫描建 repo 空间（不传 appHomeDir → 与桥栈同用 HOME）
    const seed = createWikiServiceStack({ db })
    const scanned = await seed.repoScanService.scan({ repoPath: repo })
    expect(scanned.ok).toBe(true)
    if (!scanned.ok) throw new Error(`seed scan failed: ${scanned.message}`)
    repoSpaceId = scanned.spaceId!

    const plain = await seed.writeService.createSpace({
      scope: 'user',
      scopeRef: null,
      name: '个人空间',
    })
    expect(plain.ok).toBe(true)
    if (!plain.ok) throw new Error(`plain space create failed: ${plain.message}`)
    plainSpaceId = plain.row.id

    const foreign = await seed.writeService.createSpace({
      scope: 'project',
      scopeRef: 'ws-other',
      name: '别的项目的空间',
    })
    expect(foreign.ok).toBe(true)
    if (!foreign.ok) throw new Error(`foreign space create failed: ${foreign.message}`)
    foreignSpaceId = foreign.row.id

    // 会话绑定 ws-1：scope = user + project/ws-1 + project/NULL（repo 空间可见，
    // ws-other 的空间在防线外）
    new WorkspaceRepository(db).create({
      id: 'ws-1',
      name: '项目A',
      rootPath: path.join(testDir, 'ws1-root'),
    })
    service = new SessionService(db, () => {})
    sessionId = (
      await service.createSession({ providerProfileId: 'provider-test', workspaceId: 'ws-1' })
    ).sessionId
  })

  afterEach(() => {
    try {
      db.close()
    } catch {
      /* db already closed */
    }
    if (originalHome === undefined) delete process.env.HOME
    else process.env.HOME = originalHome
    rmSync(testDir, { recursive: true, force: true })
  })

  it('种子扫描后 status 已同步：rev 非空且 generatedRev == currentRev', async () => {
    const receipt = await service.bridgeWikiRepoStatus({ sessionId, spaceId: repoSpaceId })
    expect(receipt.ok).toBe(true)
    const s = receipt.status
    expect(s).toBeDefined()
    expect(s!.spaceId).toBe(repoSpaceId)
    expect(s!.generatedRev).toMatch(/^[0-9a-f]{7,}$/)
    expect(s!.currentRev).toBe(s!.generatedRev)
    expect(s!.commitsBehind).toBe(0)
    expect(s!.stale).toBe(false)
  })

  it('代码推进 → status 漂移 → scan 重建 → status 回到已同步且 rev 前进', async () => {
    const before = await service.bridgeWikiRepoStatus({ sessionId, spaceId: repoSpaceId })
    const oldRev = before.status!.generatedRev!
    expect(oldRev).toMatch(/^[0-9a-f]{7,}$/)

    writeFileSync(path.join(repo, 'src', 'extra.ts'), 'export const c = 3\n')
    git(repo, ['add', '-A'])
    git(repo, ['commit', '-q', '-m', 'drift'])

    const drifted = await service.bridgeWikiRepoStatus({ sessionId, spaceId: repoSpaceId })
    expect(drifted.status!.commitsBehind).toBe(1)
    expect(drifted.status!.currentRev).not.toBe(oldRev)

    const scan = await service.bridgeWikiRepoScan({ sessionId, spaceId: repoSpaceId })
    expect(scan.ok).toBe(true)
    expect(scan.spaceId).toBe(repoSpaceId)
    expect(scan.repoRev).not.toBeNull()
    expect(scan.repoRev).not.toBe(oldRev)
    // 文件数变了 → 总览/结构页至少一页被更新（重建不是空转）
    expect(scan.pagesUpdated).toBeGreaterThan(0)

    const after = await service.bridgeWikiRepoStatus({ sessionId, spaceId: repoSpaceId })
    expect(after.status!.generatedRev).toBe(scan.repoRev)
    expect(after.status!.generatedRev).not.toBe(oldRev)
    expect(after.status!.commitsBehind).toBe(0)
  })

  it('非 repo 空间：scan 结构化拒绝，status 透出未关联仓库路径', async () => {
    const scan = await service.bridgeWikiRepoScan({ sessionId, spaceId: plainSpaceId })
    expect(scan.ok).toBe(false)
    expect(scan.error).toContain('不是 Repo Wiki')

    const status = await service.bridgeWikiRepoStatus({ sessionId, spaceId: plainSpaceId })
    expect(status.ok).toBe(true)
    expect(status.status?.repoPath).toBeNull()
  })

  it('不存在空间：越权防线先拦（不探测空间存在性，不触达服务层）', async () => {
    const scan = await service.bridgeWikiRepoScan({ sessionId, spaceId: 'wsp_no_such' })
    expect(scan.ok).toBe(false)
    expect(scan.error).toContain('不在本会话可见范围')

    const status = await service.bridgeWikiRepoStatus({ sessionId, spaceId: 'wsp_no_such' })
    expect(status.ok).toBe(false)
    expect(status.error).toContain('不在本会话可见范围')
  })

  it('scope 外空间：scan / status 双拒绝（防线不因工具是查询而放宽）', async () => {
    const scan = await service.bridgeWikiRepoScan({ sessionId, spaceId: foreignSpaceId })
    expect(scan.ok).toBe(false)
    expect(scan.error).toContain('不在本会话可见范围')

    const status = await service.bridgeWikiRepoStatus({ sessionId, spaceId: foreignSpaceId })
    expect(status.ok).toBe(false)
    expect(status.error).toContain('不在本会话可见范围')
  })

  it('folder 存量归一：兜底 manual 复位为生成态，显式接管/忽略标记不被动', async () => {
    const pageRepo = new WikiPageRepository(db)
    const folder = pageRepo.getBySlug(repoSpaceId, 'repo-dir-src')
    expect(folder?.kind).toBe('folder')
    // 根修后种子扫描建的 folder 本就是生成态；这里先验根修，再模拟存量数据
    expect(folder?.source_type).toBe('repo-scan')

    // 模拟存量 bug 产物（老版本 createFolderNode 硬编码落下的兜底 manual）
    pageRepo.update(folder!.id, { source_type: 'manual' })

    // 显式标记对照组：接管与忽略绝不能被归一逻辑碰掉
    const stack = createWikiServiceStack({ db })
    stack.repoScanService.setOwnership(folder!.id, 'manual')
    const manualFolder = pageRepo.getById(folder!.id)
    expect(manualFolder?.source_type).toBe('repo-scan-manual')
    pageRepo.update(folder!.id, { source_type: 'manual' }) // 归一回兜底态再测 ignored
    stack.repoScanService.setOwnership(folder!.id, 'ignored')
    expect(pageRepo.getById(folder!.id)?.source_type).toBe('repo-scan-ignored')

    // 重回兜底 manual 后重建：归一为生成态，且只动这一种值
    pageRepo.update(folder!.id, { source_type: 'manual' })
    const rescan = await service.bridgeWikiRepoScan({ sessionId, spaceId: repoSpaceId })
    expect(rescan.ok).toBe(true)
    expect(pageRepo.getById(folder!.id)?.source_type).toBe('repo-scan')

    // 守卫随所有权标记一起生效：生成态 folder 的删除被拦
    const del = await service.bridgeWikiDelete({ sessionId, pageId: folder!.id })
    expect(del.ok).toBe(false)
    expect(del.error).toContain('wiki_set_ownership')
  })
})
