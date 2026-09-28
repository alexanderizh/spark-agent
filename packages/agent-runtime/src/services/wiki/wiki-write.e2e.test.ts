/**
 * @module wiki-write.e2e.test
 *
 * S0 出口验收：创建空间 → 写入一页 → FTS 检索命中 → 分页读取（含预算裁剪、
 * CAS 反例、守卫校验、indexReady 回执）。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SparkDatabase, hashWikiBody } from '@spark/storage'
import {
  WikiSpaceRepository,
  WikiPageRepository,
  WikiSearchRepository,
  WikiRevisionRepository,
} from '@spark/storage'
import { WikiStoreService } from './wiki-store.service.js'
import { WikiWriteService } from './wiki-write.service.js'
import { WikiSearchService } from './wiki-search.service.js'
import { WikiPageService } from './wiki-page.service.js'
import { WikiSpaceService } from './wiki-space.service.js'
import { DEFAULT_WIKI_BUDGET } from './wiki-context-budget.js'
import { join } from 'path'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'

describe('Wiki S0 e2e（创建→写入→检索→读取）', () => {
  let db: SparkDatabase
  let spaceRepo: WikiSpaceRepository
  let pageRepo: WikiPageRepository
  let searchRepo: WikiSearchRepository
  let revisionRepo: WikiRevisionRepository
  let store: WikiStoreService
  let writeService: WikiWriteService
  let searchService: WikiSearchService
  let pageService: WikiPageService
  let spaceService: WikiSpaceService
  let testDir: string

  beforeEach(() => {
    testDir = join(tmpdir(), `spark-wiki-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(testDir, { recursive: true })
    db = new SparkDatabase(join(testDir, 'test.db'))
    db.runMigrations(join(process.cwd(), '../storage/migrations'))
    spaceRepo = new WikiSpaceRepository(db)
    pageRepo = new WikiPageRepository(db)
    searchRepo = new WikiSearchRepository(db)
    revisionRepo = new WikiRevisionRepository(db)
    store = new WikiStoreService(testDir, undefined)
    writeService = new WikiWriteService(spaceRepo, pageRepo, revisionRepo, searchRepo, store)
    searchService = new WikiSearchService(searchRepo, DEFAULT_WIKI_BUDGET)
    pageService = new WikiPageService(pageRepo, revisionRepo, store, DEFAULT_WIKI_BUDGET)
    spaceService = new WikiSpaceService(spaceRepo)
  })

  afterEach(() => {
    db.close()
    rmSync(testDir, { recursive: true, force: true })
  })

  it('完整闭环：空间 → 页面 → 检索只回摘要 → 读取正文 → indexReady', async () => {
    // 1. 创建空间
    const spaceResult = await writeService.createSpace({
      scope: 'user',
      name: '工程经验库',
    })
    expect(spaceResult.ok).toBe(true)
    if (!spaceResult.ok) return
    const spaceId = spaceResult.row.id

    // 2. 写入一页（中文正文 + 摘要 + 标签）
    const writeResult = await writeService.commitPage({
      spaceId,
      title: 'FTS5 contentless 写入注意',
      summary: '迁移到 vite 后 FTS 分词的注意事项与修复方案',
      body: '# FTS5 contentless\n\n迁移到 vite 之后，contentless 表的部分更新需要先删后插。'.repeat(
        20,
      ),
      tags: ['sqlite', 'fts'],
      kind: 'experience',
      authorRole: 'manual_user',
    })
    expect(writeResult.ok).toBe(true)
    if (!writeResult.ok) return
    expect(writeResult.created).toBe(true)
    expect(writeResult.indexReady).toBe(true) // FTS 同事务维护 → 就绪
    expect(writeResult.row.version).toBe(1)
    const pageId = writeResult.row.id

    // 3. Agent 检索：只回 id+摘要，绝不带正文
    const search = searchService.searchForAgent({
      sessionId: 'e2e-session',
      query: 'contentless 注意',
      spaceIds: [spaceId],
    })
    expect('gateExceeded' in search && search.gateExceeded).toBe(false)
    if (!('gateExceeded' in search)) {
      expect(search.items).toHaveLength(1)
      const item = search.items[0]!
      expect(item.id).toBe(pageId)
      expect(item.summary).toContain('迁移到 vite')
      // 正文绝不出现（服务端裁剪铁律）
      expect(JSON.stringify(search)).not.toContain('先删后插')
    }

    // 4. Agent 读取正文（守卫通过 + bumpHit）
    const read = await pageService.readForAgent({ sessionId: 'e2e-session', pageId })
    expect(read.ok).toBe(true)
    if (read.ok) {
      expect(read.page.body).toContain('先删后插')
      expect(read.page.version).toBe(1)
      expect(read.page.truncated).toBe(false)
    }
    expect(pageRepo.getById(pageId)!.hit_count).toBe(1)

    // 5. 空间列表（Agent L1 视图）
    const spaces = spaceService.listSpacesForAgent([{ scope: 'user', scopeRef: null }])
    expect(spaces.items[0]!.pageCount).toBe(1)
  })

  it('CAS 更新：版本推进 + 旧正文快照落 revision + 失配拒绝', async () => {
    const space = await writeService.createSpace({ scope: 'user', name: 'CAS 库' })
    expect(space.ok).toBe(true)
    if (!space.ok) return
    const created = await writeService.commitPage({
      spaceId: space.row.id,
      title: '版本化页面',
      body: '第一版正文',
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return

    // head 不入版本表：v1 是当前版本，创建时不得写历史行
    // （若写入会与「v1 被替代时」的记录撞 UNIQUE(page_id, version) 而被吞掉）
    expect(pageService.history(created.row.id)).toEqual([])

    // 正常 CAS 更新
    const updated = await writeService.commitPage({
      pageId: created.row.id,
      expectedVersion: 1,
      body: '第二版正文',
    })
    expect(updated.ok).toBe(true)
    if (updated.ok) {
      expect(updated.row.version).toBe(2)
      expect(updated.row.content_hash).toBe(hashWikiBody('第二版正文'))
    }

    // 版本历史不变量：当前版本（head）不入表，只有被替代的 v1 进表，
    // 且 v1 的正文快照必须真实可读（快照路径失效 = 版本历史不可还原）。
    const versions = pageService.history(created.row.id)
    expect(versions.map((v) => v.version)).toEqual([1])
    const rev1 = revisionRepo.getByVersion(created.row.id, 1)
    expect(rev1).not.toBeNull()
    expect(rev1!.content_hash).toBe(hashWikiBody('第一版正文'))
    expect(rev1!.body_snapshot_path).not.toBeNull()
    expect(readFileSync(rev1!.body_snapshot_path!, 'utf-8')).toBe('第一版正文')

    // 旧版本号重放 → 拒绝
    const stale = await writeService.commitPage({
      pageId: created.row.id,
      expectedVersion: 1,
      body: '抢写',
    })
    expect(stale.ok).toBe(false)
    if (!stale.ok) {
      expect(stale.reason).toBe('version_conflict')
      expect(stale.currentVersion).toBe(2)
    }

    // 文件侧新正文生效
    const read = await pageService.readForAgent({ sessionId: 'cas', pageId: created.row.id })
    expect(read.ok && read.page.body === '第二版正文').toBe(true)
  })

  it('守卫：正文文件与 DB 指纹失配（孤儿文件）拒绝采信', async () => {
    const space = await writeService.createSpace({ scope: 'user', name: '守卫库' })
    expect(space.ok).toBe(true)
    if (!space.ok) return
    const created = await writeService.commitPage({
      spaceId: space.row.id,
      title: '守卫页',
      body: '权威正文',
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return

    // 模拟 CAS 失败留下的孤儿新文件（直接篡改磁盘文件）
    writeFileSync(created.row.file_path, '孤儿新正文', 'utf-8')

    const read = await pageService.readForAgent({ sessionId: 'guard', pageId: created.row.id })
    expect(read.ok).toBe(false)
    if (!read.ok) expect(read.error).toBe('guard_mismatch')
  })

  it('超预算正文分页 + 续读（S0 出口：单页默认 3000、可翻页）', async () => {
    const space = await writeService.createSpace({ scope: 'user', name: '长文库' })
    expect(space.ok).toBe(true)
    if (!space.ok) return
    const longBody = Array.from(
      { length: 1500 },
      (_, i) => `第${i}段：这是一段较长的中文知识正文。`,
    ).join('\n')
    const created = await writeService.commitPage({
      spaceId: space.row.id,
      title: '长文页',
      body: longBody,
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return

    const page1 = await pageService.readForAgent({ sessionId: 'long', pageId: created.row.id })
    expect(page1.ok).toBe(true)
    if (page1.ok) {
      expect(page1.page.truncated).toBe(true)
      expect(page1.page.nextOffset).toBeGreaterThan(0)
      expect(page1.page.tokens).toBeLessThanOrEqual(DEFAULT_WIKI_BUDGET.readMaxTokens)

      const page2 = await pageService.readForAgent({
        sessionId: 'long',
        pageId: created.row.id,
        offset: page1.page.nextOffset!,
      })
      expect(page2.ok).toBe(true)
      if (page2.ok) {
        expect(page1.page.body + page2.page.body).toBe(
          longBody.slice(0, (page1.page.body + page2.page.body).length),
        )
      }
    }
  })

  it('CAS 失配不破坏权威正文：文件回滚 + 守卫放行 + 历史不污染', async () => {
    const space = await writeService.createSpace({ scope: 'user', name: '回滚库' })
    expect(space.ok).toBe(true)
    if (!space.ok) return
    const created = await writeService.commitPage({
      spaceId: space.row.id,
      title: '权威页',
      body: '权威 v1',
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    const pageId = created.row.id
    const committed = await writeService.commitPage({
      pageId,
      expectedVersion: 1,
      body: '权威 v2',
    })
    expect(committed.ok).toBe(true)

    // 晚到写者：版本号已过期，正文为「抢写」——先文件后 CAS，文件已被原子替换
    const stale = await writeService.commitPage({ pageId, expectedVersion: 1, body: '抢写内容' })
    expect(stale.ok).toBe(false)
    if (!stale.ok) expect(stale.reason).toBe('version_conflict')

    // 文件侧必须是胜者正文（回滚真实发生），而不是被拒绝的那一版
    const row = pageRepo.getById(pageId)!
    expect(readFileSync(row.file_path, 'utf-8')).toBe('权威 v2')
    expect(row.version).toBe(2)
    expect(row.content_hash).toBe(hashWikiBody('权威 v2'))

    // 读取守卫放行 —— 本用例防的就是「失败写者把页面写成不可读」这一回归
    const read = await pageService.readForAgent({ sessionId: 'rollback', pageId })
    expect(read.ok).toBe(true)
    if (read.ok) expect(read.page.body).toBe('权威 v2')

    // 失败写者不推进版本、不留下历史行、不像成功路径那样写新快照
    expect(pageService.history(pageId).map((v) => v.version)).toEqual([1])
  })

  it('并发同名创建：唯一索引兜底收敛为 slug_conflict（不抛异常）', async () => {
    const space = await writeService.createSpace({ scope: 'user', name: '竞争库' })
    expect(space.ok).toBe(true)
    if (!space.ok) return

    // 预检查（同步）与 insert 之间隔着一次 await 落盘 → 两个并发创建都能过
    // 预检查，靠 uniq_wiki_page_slug 兜底；契约要求收敛为结构化结果而非抛出。
    const [a, b] = await Promise.all([
      writeService.commitPage({ spaceId: space.row.id, title: '同名页', body: 'A 正文' }),
      writeService.commitPage({ spaceId: space.row.id, title: '同名页', body: 'B 正文' }),
    ])
    const oks = [a, b].filter((r) => r.ok)
    const failures = [a, b].filter((r) => !r.ok)
    expect(oks).toHaveLength(1)
    expect(failures).toHaveLength(1)
    if (!failures[0]!.ok) expect(failures[0]!.reason).toBe('slug_conflict')
    // 落败者不得留下 DB 行，也不得覆盖胜者正文
    expect(pageRepo.listBySpace(space.row.id)).toHaveLength(1)
    const winner = pageRepo.listBySpace(space.row.id)[0]!
    expect(['A 正文', 'B 正文']).toContain(readFileSync(winner.file_path, 'utf-8'))
  })

  it('slug 冲突与空间名冲突拒绝（不静默覆盖）', async () => {
    const space1 = await writeService.createSpace({ scope: 'user', name: '唯一库' })
    expect(space1.ok).toBe(true)
    // 同名空间
    const dup = await writeService.createSpace({ scope: 'user', name: '唯一库' })
    expect(dup.ok).toBe(false)
    if (!dup.ok) expect(dup.reason).toBe('name_conflict')

    if (space1.ok) {
      await writeService.commitPage({ spaceId: space1.row.id, title: 'Same Title', body: 'A' })
      const conflict = await writeService.commitPage({
        spaceId: space1.row.id,
        title: 'Same Title',
        body: 'B',
      })
      expect(conflict.ok).toBe(false)
      if (!conflict.ok) expect(conflict.reason).toBe('slug_conflict')
    }
  })
})
