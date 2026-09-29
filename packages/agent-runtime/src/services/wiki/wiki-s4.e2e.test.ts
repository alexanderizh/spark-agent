/**
 * Repo Wiki e2e 测试（S4）—— 渲染幂等 + 扫描闭环 + 所有权 + 漂移。
 *
 * 覆盖不变量（方案 §13 S4 出口）：
 *   - 同 rev 两次 rebuild 产出同正文、不推进版本号（可重建 = 幂等）；
 *   - 忽略路径生效（node_modules 不进页面）；
 *   - 生成页默认只读态（source_type='repo-scan'）；
 *   - 人工接管 / 忽略后重建不再覆写（人的改动不被自动内容冲掉）；
 *   - 漂移可感知：repo_rev 落后 HEAD 超过阈值即 stale；
 *   - 截断如实回报（truncated + filesScanned）。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'os'
import { SparkDatabase } from '@spark/storage'
import { createWikiServiceStack, type WikiServiceStack } from './wiki-service-stack.js'
import {
  WIKI_REPO_SOURCE_TYPE,
  WIKI_REPO_SOURCE_TYPE_IGNORED,
  WIKI_REPO_SOURCE_TYPE_MANUAL,
} from './wiki-repo-scan.service.js'
import { scanRepoTree } from './wiki-repo-scan-tree.js'
import { renderRepoPages } from './wiki-repo-scan-render.js'

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

describe('Wiki S4 e2e（Repo Wiki 扫描 / 重建 / 所有权 / 漂移）', () => {
  let db: SparkDatabase
  let root: string
  let repo: string
  let stack: WikiServiceStack

  beforeEach(() => {
    root = join(tmpdir(), `spark-wiki-s4-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    repo = join(root, 'demo-repo')
    mkdirSync(join(repo, 'src'), { recursive: true })
    mkdirSync(join(repo, 'node_modules', 'pkg'), { recursive: true })
    writeFileSync(join(repo, 'README.md'), '# demo\n')
    writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'demo', version: '1.0.0' }))
    writeFileSync(join(repo, 'src', 'index.ts'), 'export const a = 1\n')
    writeFileSync(join(repo, 'src', 'util.ts'), 'export const b = 2\n')
    writeFileSync(join(repo, 'node_modules', 'pkg', 'index.js'), 'module.exports = 1\n')

    git(repo, ['init', '-q'])
    git(repo, ['add', '-A'])
    git(repo, ['commit', '-q', '-m', 'init'])

    const dbDir = join(root, 'db')
    mkdirSync(dbDir, { recursive: true })
    db = new SparkDatabase(join(dbDir, 'test.db'))
    db.runMigrations(join(process.cwd(), '../storage/migrations'))
    stack = createWikiServiceStack({ db, appHomeDir: join(root, 'home'), staleCommits: 2 })
  })

  afterEach(() => {
    db.close()
    rmSync(root, { recursive: true, force: true })
  })

  function spaceId(): string {
    const spaces = stack.spaceRepo.listByScopes([{ scope: 'project', scopeRef: null }], {
      spaceType: 'repo',
    })
    return spaces[0]!.id
  }

  it('渲染是纯函数：同一扫描树两次渲染逐字节一致', () => {
    const tree = scanRepoTree(repo)
    const first = renderRepoPages('demo-repo', 'abc1234', tree)
    const second = renderRepoPages('demo-repo', 'abc1234', tree)
    expect(second.map((p) => p.body)).toEqual(first.map((p) => p.body))
    // 页面规划：总览 / 结构 / 技术栈 + 每个顶层目录一页。
    // node_modules 被默认忽略 → 不产生模块页（这正是忽略规则生效的证据）。
    expect(first.map((p) => p.slug)).toEqual([
      'repo-overview',
      'repo-structure',
      'repo-stack',
      'repo-module-src',
    ])
    expect(first.map((p) => p.slug)).not.toContain('repo-module-node-modules')
  })

  it('扫描生成页面，忽略 node_modules，并记录 repo_rev', async () => {
    const result = await stack.repoScanService.scan({ repoPath: repo })
    expect(result.ok).toBe(true)
    expect(result.pagesCreated).toBeGreaterThan(0)
    expect(result.filesScanned).toBe(4) // README + package.json + 2 个 src 文件
    expect(result.truncated).toBe(false)

    const space = stack.spaceRepo.getById(result.spaceId!)!
    expect(space.space_type).toBe('repo')
    expect(space.repo_rev).toMatch(/^[0-9a-f]{7,}$/)

    // node_modules 不出现在任何页面正文里
    const pages = stack.pageRepo.listBySpace(result.spaceId!)
    const overview = pages.find((p) => p.slug === 'repo-overview')!
    expect(overview.source_type).toBe(WIKI_REPO_SOURCE_TYPE)
    const stackPage = pages.find((p) => p.slug === 'repo-stack')!
    expect(readFileSync(stackPage.file_path, 'utf-8')).not.toContain('node_modules')
  })

  it('重复 scan 不推进版本号（幂等：可重建的核心语义）', async () => {
    const first = await stack.repoScanService.scan({ repoPath: repo })
    const versionsBefore = stack.pageRepo
      .listBySpace(first.spaceId!)
      .map((p) => [p.id, p.version] as const)

    const second = await stack.repoScanService.scan({ repoPath: repo })
    expect(second.ok).toBe(true)
    expect(second.pagesCreated).toBe(0)
    expect(second.pagesUpdated).toBe(0)

    const versionsAfter = stack.pageRepo
      .listBySpace(first.spaceId!)
      .map((p) => [p.id, p.version] as const)
    expect(versionsAfter).toEqual(versionsBefore)
  })

  it('代码变更后 rebuild 更新内容并推进版本', async () => {
    const first = await stack.repoScanService.scan({ repoPath: repo })
    const before = stack.pageRepo.getBySlug(first.spaceId!, 'repo-overview')!
    expect(before.summary).toContain('4 个文件')

    writeFileSync(join(repo, 'src', 'extra.ts'), 'export const c = 3\n')
    git(repo, ['add', '-A'])
    git(repo, ['commit', '-q', '-m', 'add extra'])

    const rebuilt = await stack.repoScanService.rebuild(first.spaceId!)
    expect(rebuilt.ok).toBe(true)
    expect(rebuilt.pagesUpdated).toBeGreaterThan(0)

    const after = stack.pageRepo.getBySlug(first.spaceId!, 'repo-overview')!
    expect(after.version).toBeGreaterThan(before.version)
    expect(after.summary).toContain('5 个文件')
  })

  it('人工接管后 rebuild 不覆写该页（人的改动不被冲掉）', async () => {
    const scanned = await stack.repoScanService.scan({ repoPath: repo })
    const generated = stack.pageRepo.getBySlug(scanned.spaceId!, 'repo-overview')!

    expect(stack.repoScanService.setOwnership(generated.id, 'manual').ok).toBe(true)
    expect(stack.pageRepo.getById(generated.id)!.source_type).toBe(WIKI_REPO_SOURCE_TYPE_MANUAL)
    expect(stack.repoScanService.ownershipOf(generated.id)).toBe('manual')

    // setOwnership 走 repo.update 会推进版本 —— 必须基于最新版本编辑，
    // 否则 CAS 静默拒绝（这正是本断言要防的"编辑看似成功其实没落地"）。
    const afterTakeover = stack.pageRepo.getById(generated.id)!
    const edited = await stack.writeService.commitPage({
      pageId: generated.id,
      expectedVersion: afterTakeover.version,
      title: afterTakeover.title,
      summary: '我手写的摘要',
      body: '我手写的正文',
      authorRole: 'manual_user',
    })
    expect(edited.ok).toBe(true)

    writeFileSync(join(repo, 'src', 'another.ts'), 'export const d = 4\n')
    git(repo, ['add', '-A'])
    git(repo, ['commit', '-q', '-m', 'more'])

    const rebuilt = await stack.repoScanService.rebuild(scanned.spaceId!)
    expect(rebuilt.pagesSkipped).toBeGreaterThanOrEqual(1)

    const after = stack.pageRepo.getById(generated.id)!
    expect(after.summary).toBe('我手写的摘要')
    expect(readFileSync(after.file_path, 'utf-8')).toBe('我手写的正文')
    // 所有权标记未被普通编辑派生值冲掉（source_type 保留语义）
    expect(after.source_type).toBe(WIKI_REPO_SOURCE_TYPE_MANUAL)
  })

  it('忽略的页面同样不被 rebuild 覆写', async () => {
    const scanned = await stack.repoScanService.scan({ repoPath: repo })
    const page = stack.pageRepo.getBySlug(scanned.spaceId!, 'repo-module-src')!
    stack.repoScanService.setOwnership(page.id, 'ignored')
    expect(stack.repoScanService.ownershipOf(page.id)).toBe('ignored')

    const rebuilt = await stack.repoScanService.rebuild(scanned.spaceId!)
    expect(rebuilt.ok).toBe(true)
    expect(stack.pageRepo.getById(page.id)!.source_type).toBe(WIKI_REPO_SOURCE_TYPE_IGNORED)
  })

  it('非 repo 空间的页面不接受所有权切换', async () => {
    const created = await stack.writeService.createSpace({
      scope: 'user',
      scopeRef: null,
      name: '我的知识库',
    })
    expect(created.ok).toBe(true)
    if (!created.ok) throw new Error(created.message)
    const written = await stack.writeService.commitPage({
      spaceId: created.row.id,
      title: '普通页',
      body: '正文',
      authorRole: 'manual_user',
    })
    expect(written.ok).toBe(true)
    if (!written.ok) throw new Error(written.message)
    const result = stack.repoScanService.setOwnership(written.row.id, 'manual')
    expect(result.ok).toBe(false)
    expect(result.message).toContain('不属于 Repo Wiki')
  })

  it('漂移：落后提交数超过阈值即 stale', async () => {
    const scanned = await stack.repoScanService.scan({ repoPath: repo })
    const before = await stack.repoScanService.status(scanned.spaceId!)
    expect(before).not.toBeNull()
    expect(before!.generatedRev).toBe(scanned.repoRev)
    expect(before!.currentRev).toBe(scanned.repoRev)
    expect(before!.commitsBehind).toBe(0)
    expect(before!.stale).toBe(false)
    expect(before!.threshold).toBe(2)

    // 推进 3 个提交（阈值 2）→ 应判为漂移
    for (let i = 0; i < 3; i += 1) {
      writeFileSync(join(repo, `extra-${i}.ts`), `export const v${i} = ${i}\n`)
      git(repo, ['add', '-A'])
      git(repo, ['commit', '-q', '-m', `c${i}`])
    }
    const after = await stack.repoScanService.status(scanned.spaceId!)
    expect(after!.commitsBehind).toBe(3)
    expect(after!.stale).toBe(true)
  })

  it('扫描不存在的路径返回结构化失败（不抛异常）', async () => {
    const result = await stack.repoScanService.scan({ repoPath: join(root, 'nope') })
    expect(result.ok).toBe(false)
    expect(result.message).toContain('不存在')
    expect(result.pagesCreated).toBe(0)
  })

  it('rebuild 非 repo 空间被拒绝', async () => {
    const created = await stack.writeService.createSpace({
      scope: 'user',
      scopeRef: null,
      name: '我的知识库',
    })
    expect(created.ok).toBe(true)
    if (!created.ok) throw new Error(created.message)
    const result = await stack.repoScanService.rebuild(created.row.id)
    expect(result.ok).toBe(false)
    expect(result.message).toContain('不是 Repo Wiki')
  })

  it('maxFiles 上限如实回报截断', async () => {
    for (let i = 0; i < 6; i += 1) {
      writeFileSync(join(repo, `bulk-${i}.ts`), 'x\n')
    }
    const result = await stack.repoScanService.scan({ repoPath: repo, maxFiles: 5 })
    expect(result.ok).toBe(true)
    expect(result.truncated).toBe(true)
    expect(result.filesScanned).toBe(5)
  })

  it('重复 scan 复用同一空间（不因多次扫描堆积空间）', async () => {
    await stack.repoScanService.scan({ repoPath: repo })
    await stack.repoScanService.scan({ repoPath: repo })
    const spaces = stack.spaceRepo.listByScopes([{ scope: 'project', scopeRef: null }], {
      spaceType: 'repo',
    })
    expect(spaces).toHaveLength(1)
    expect(spaceId()).toBe(spaces[0]!.id)
  })

  it('扫描生成的空间能被"全部视图"的 scope 集合发现（不变成孤儿空间）', async () => {
    // 桌面 wiki:space:list 在无 scope 入参时用的就是这组 scope；少任何一条，
    // 扫完的空间就只会躺在库里、界面永远列不出来。
    const scanned = await stack.repoScanService.scan({ repoPath: repo })
    const visible = stack.spaceRepo.listByScopes(
      [
        { scope: 'user', scopeRef: null },
        { scope: 'project', scopeRef: null },
      ],
      { spaceType: 'repo' },
    )
    expect(visible.map((s) => s.id)).toContain(scanned.spaceId)
  })
})
