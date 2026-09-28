/**
 * @module wiki.repository.test
 *
 * S0 验收单测：空间/页面 CRUD + FTS 写入查询闭环 + CJK 分词 + CAS 反例 +
 * 归档槽位释放 + 版本记录。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SparkDatabase } from '../database.js'
import { WikiSpaceRepository } from './wiki-space.repository.js'
import { WikiPageRepository, hashWikiBody } from './wiki-page.repository.js'
import { WikiSearchRepository } from './wiki-search.repository.js'
import { WikiRevisionRepository } from './wiki-revision.repository.js'
import { join } from 'path'
import { mkdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'

describe('Wiki repositories (S0)', () => {
  let db: SparkDatabase
  let spaceRepo: WikiSpaceRepository
  let pageRepo: WikiPageRepository
  let searchRepo: WikiSearchRepository
  let revisionRepo: WikiRevisionRepository
  let testDir: string

  beforeEach(() => {
    testDir = join(
      tmpdir(),
      `spark-wiki-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    )
    mkdirSync(testDir, { recursive: true })
    db = new SparkDatabase(join(testDir, 'test.db'))
    db.runMigrations(join(process.cwd(), 'migrations'))
    spaceRepo = new WikiSpaceRepository(db)
    pageRepo = new WikiPageRepository(db)
    searchRepo = new WikiSearchRepository(db)
    revisionRepo = new WikiRevisionRepository(db)
  })

  afterEach(() => {
    db.close()
    rmSync(testDir, { recursive: true, force: true })
  })

  function makeSpace(overrides: Record<string, unknown> = {}) {
    return spaceRepo.insert({
      id: 'wsp_test0001',
      scope: 'user',
      scope_ref: null,
      space_type: 'manual',
      name: '测试知识库',
      description: '',
      icon: null,
      visibility: 'private',
      repo_path: null,
      repo_rev: null,
      created_by: 'user',
      archived: 0,
      ...overrides,
    })
  }

  function makePage(spaceId: string, overrides: Record<string, unknown> = {}) {
    return pageRepo.insert(
      {
        id: `wp_test${(seq += 1).toString().padStart(4, '0')}`,
        space_id: spaceId,
        parent_id: null,
        kind: 'knowledge',
        title: '未命名页面',
        slug: `page-${seq}`,
        summary: '',
        file_path: join(testDir, `page-${seq}.md`),
        tags_json: '[]',
        status: 'published',
        confidence: 1.0,
        sort_order: 0,
        source_type: 'manual',
        source_session_id: null,
        author_role: 'manual_user',
        hit_count: 0,
        last_hit_at: null,
        valid_from: null,
        invalid_at: null,
        ...overrides,
      } as Parameters<WikiPageRepository['insert']>[0],
      '正文占位',
    )
  }

  let seq = 0

  // ─── 空间 ─────────────────────────────────────────────────────────────

  it('创建空间并按 scope 查询；归档释放唯一名槽位', () => {
    const space = makeSpace()
    expect(space.id).toBe('wsp_test0001')

    const found = spaceRepo.findByName('user', null, 'manual', '测试知识库')
    expect(found?.id).toBe(space.id)

    // 同名活跃空间唯一
    expect(() => makeSpace({ id: 'wsp_test0002' })).toThrow(/UNIQUE/)

    // 归档后同名可再建（部分索引 WHERE archived = 0）
    spaceRepo.archive(space.id)
    expect(spaceRepo.findByName('user', null, 'manual', '测试知识库')).toBeNull()
    expect(() => makeSpace({ id: 'wsp_test0003' })).not.toThrow()
  })

  it('页面计数随空间聚合', () => {
    const space = makeSpace()
    makePage(space.id)
    makePage(space.id)
    const counts = spaceRepo.countActivePagesBySpace([space.id])
    expect(counts.get(space.id)).toBe(2)
  })

  // ─── 页面 + FTS 闭环 ──────────────────────────────────────────────────

  it('FTS 写入/查询闭环：中文关键词可命中（CJK 逐字分词）', () => {
    const space = makeSpace()
    makePage(space.id, {
      title: 'FTS5 contentless 写入注意',
      slug: 'fts5-notes',
      summary: '迁移到 vite 时的注意事项',
    })
    makePage(space.id, {
      title: '无关页面',
      slug: 'other',
      summary: '完全不相关的内容',
    })

    // 中文子串命中（unicode61 原生会把连续中文当整词，靠 segmentCjk 切开）
    const hits1 = searchRepo.searchBm25('写入注意', { spaceIds: [space.id] })
    expect(hits1.map((h) => h.page.slug)).toContain('fts5-notes')

    // 英文词命中
    const hits2 = searchRepo.searchBm25('fts5', { spaceIds: [space.id] })
    expect(hits2.map((h) => h.page.slug)).toContain('fts5-notes')

    // 中英混合查询
    const hits3 = searchRepo.searchBm25('vite 注意', { spaceIds: [space.id] })
    expect(hits3.map((h) => h.page.slug)).toContain('fts5-notes')

    // 无关词不命中
    expect(searchRepo.searchBm25('量子纠缠', { spaceIds: [space.id] })).toHaveLength(0)
  })

  it('正文变更走 FTS 重建；归档页面从检索消失', () => {
    const space = makeSpace()
    const page = makePage(space.id, {
      title: '旧标题',
      slug: 'rebuild',
      summary: '旧摘要',
    })
    pageRepo.update(page.id, { title: '新标题迁移指南' }, '新正文：迁移相关内容')
    expect(searchRepo.searchBm25('迁移指南', { spaceIds: [space.id] }).map((h) => h.page.id)).toContain(
      page.id,
    )

    pageRepo.archive(page.id)
    expect(searchRepo.searchBm25('迁移指南', { spaceIds: [space.id] })).toHaveLength(0)
    // 归档释放 slug 槽位
    expect(pageRepo.getBySlug(space.id, 'rebuild')).toBeNull()
  })

  it('fail-loud：文本字段变更不带 body 抛错（防空串重建 FTS）', () => {
    const space = makeSpace()
    const page = makePage(space.id)
    expect(() => pageRepo.update(page.id, { title: '只改标题' })).toThrow(/未提供 body/)
    // 仅元数据变更无需 body
    expect(() => pageRepo.update(page.id, { sort_order: 5 })).not.toThrow()
  })

  // ─── CAS 版本控制 ─────────────────────────────────────────────────────

  it('CAS：版本失配返回 null 不覆盖；匹配时 version+1', () => {
    const space = makeSpace()
    const page = makePage(space.id)
    expect(page.version).toBe(1)

    // 失配（旧版本号）
    const miss = pageRepo.compareAndSwap(page.id, 999, { summary: '抢写' }, '抢写正文')
    expect(miss).toBeNull()
    expect(pageRepo.getById(page.id)!.version).toBe(1)

    // 匹配
    const hit = pageRepo.compareAndSwap(page.id, 1, { summary: '合法更新' }, '新正文')
    expect(hit?.version).toBe(2)

    // 已归档页面拒绝 CAS
    pageRepo.archive(page.id)
    expect(pageRepo.compareAndSwap(page.id, 2, { summary: 'x' }, 'y')).toBeNull()
  })

  it('content_hash 守卫：写入与更新刷新正文哈希', () => {
    const space = makeSpace()
    const page = makePage(space.id)
    expect(page.content_hash).toBe(hashWikiBody('正文占位'))
    const updated = pageRepo.update(page.id, {}, '全新正文')
    expect(updated.content_hash).toBe(hashWikiBody('全新正文'))
    expect(updated.version).toBe(2)
  })

  // ─── 版本记录 ─────────────────────────────────────────────────────────

  it('revision：按版本倒序，幂等插入', () => {
    const space = makeSpace()
    const page = makePage(space.id)
    revisionRepo.insert({
      page_id: page.id,
      version: 1,
      content_hash: page.content_hash ?? '',
      title: page.title,
      summary: page.summary,
      change_kind: 'create',
    })
    // 同版本重复插入静默跳过
    revisionRepo.insert({
      page_id: page.id,
      version: 1,
      content_hash: page.content_hash ?? '',
      title: page.title,
      summary: page.summary,
      change_kind: 'create',
    })
    pageRepo.update(page.id, { summary: 'v2' }, '正文v2')
    revisionRepo.insert({
      page_id: page.id,
      version: 2,
      content_hash: hashWikiBody('正文v2'),
      title: page.title,
      summary: 'v2',
      change_kind: 'edit',
    })
    const versions = revisionRepo.listByPage(page.id)
    expect(versions.map((v) => v.version)).toEqual([2, 1])
    expect(revisionRepo.getByVersion(page.id, 1)?.change_kind).toBe('create')
  })

  // ─── FTS 回填幂等 ─────────────────────────────────────────────────────

  it('backfillFtsIfNeeded 幂等（二次调用返回 0）', () => {
    const space = makeSpace()
    makePage(space.id, { title: '回填目标页', slug: 'backfill', summary: '回填摘要' })
    // 直接清空 FTS 行模拟"索引缺失"（绕过 repo 直接操作 FTS 表）
    db.raw.prepare('DELETE FROM wiki_fts').run()
    const count1 = searchRepo.backfillFtsIfNeeded()
    expect(count1).toBeGreaterThan(0)
    expect(
      searchRepo.searchBm25('回填目标', { spaceIds: [space.id] }).map((h) => h.page.slug),
    ).toContain('backfill')
    expect(searchRepo.backfillFtsIfNeeded()).toBe(0)
  })
})
