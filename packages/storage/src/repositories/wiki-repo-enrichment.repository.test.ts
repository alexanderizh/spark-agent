/**
 * @module wiki-repo-enrichment.repository.test
 *
 * 导读缓存仓储的契约测试（migration 119 / 方案B §5.2）：
 *   - 主键 (space_id, slug, repo_rev)：upsert 幂等覆盖、跨 rev 共存；
 *   - deleteStaleRevs 只回收旧 rev（缓存体积上限 = 单空间单 rev 页面数）；
 *   - CHECK(status IN ('ready','failed')) 挡住非法状态写入。
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { SparkDatabase } from '../database.js'
import { WikiRepoEnrichmentRepository } from './wiki-repo-enrichment.repository.js'

describe('WikiRepoEnrichmentRepository', () => {
  let db: SparkDatabase
  let repo: WikiRepoEnrichmentRepository
  let testDir: string

  beforeEach(() => {
    testDir = join(
      tmpdir(),
      `spark-wiki-enrich-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    )
    mkdirSync(testDir, { recursive: true })
    db = new SparkDatabase(join(testDir, 'test.db'))
    db.runMigrations(join(process.cwd(), 'migrations'))
    repo = new WikiRepoEnrichmentRepository(db)
  })

  afterEach(() => {
    db.close()
    rmSync(testDir, { recursive: true, force: true })
  })

  it('upsert / get 往返：字段完整落库', () => {
    const saved = repo.upsert({
      spaceId: 'sp-1',
      slug: 'repo-module-src',
      repoRev: 'abc1234',
      section: '## 模块职责\n...',
      status: 'ready',
      model: 'test-model',
      provider: 'openai',
      now: 1000,
    })
    expect(saved).toMatchObject({
      space_id: 'sp-1',
      slug: 'repo-module-src',
      repo_rev: 'abc1234',
      section: '## 模块职责\n...',
      status: 'ready',
      error: null,
      model: 'test-model',
      provider: 'openai',
      created_at: 1000,
      updated_at: 1000,
    })
    expect(repo.get('sp-1', 'repo-module-src', 'abc1234')?.section).toBe('## 模块职责\n...')
    expect(repo.get('sp-1', 'repo-module-src', 'other')).toBeNull()
  })

  it('upsert 幂等：同键二次写覆盖内容与 updated_at，created_at 保持首次值', () => {
    repo.upsert({
      spaceId: 'sp-1',
      slug: 'repo-module-src',
      repoRev: 'abc1234',
      section: 'v1',
      status: 'ready',
      now: 1000,
    })
    const second = repo.upsert({
      spaceId: 'sp-1',
      slug: 'repo-module-src',
      repoRev: 'abc1234',
      section: '',
      status: 'failed',
      error: 'model_failed',
      now: 2000,
    })
    expect(second.section).toBe('')
    expect(second.status).toBe('failed')
    expect(second.error).toBe('model_failed')
    // 重试 failed / 手动重跑共用同一覆盖语义，但不是新行
    expect(second.created_at).toBe(1000)
    expect(second.updated_at).toBe(2000)
  })

  it('跨 rev 共存：rev 前进即新键空间，旧 rev 行不丢（读取侧按 rev 过滤）', () => {
    repo.upsert({
      spaceId: 'sp-1',
      slug: 'repo-module-src',
      repoRev: 'rev-1',
      section: 'old',
      status: 'ready',
    })
    repo.upsert({
      spaceId: 'sp-1',
      slug: 'repo-module-src',
      repoRev: 'rev-2',
      section: 'new',
      status: 'ready',
    })
    expect(repo.getBySpace('sp-1', 'rev-1')).toHaveLength(1)
    expect(repo.getBySpace('sp-1', 'rev-2')).toHaveLength(1)
    expect(repo.get('sp-1', 'repo-module-src', 'rev-1')?.section).toBe('old')
    expect(repo.get('sp-1', 'repo-module-src', 'rev-2')?.section).toBe('new')
    // 不同空间同键互不影响
    repo.upsert({
      spaceId: 'sp-2',
      slug: 'repo-module-src',
      repoRev: 'rev-1',
      section: 'other space',
      status: 'ready',
    })
    expect(repo.getBySpace('sp-2', 'rev-1')).toHaveLength(1)
    expect(repo.getBySpace('sp-1', 'rev-1')).toHaveLength(1)
  })

  it('deleteStaleRevs 只回收旧 rev 行，保留当前 rev', () => {
    repo.upsert({
      spaceId: 'sp-1',
      slug: 'repo-module-src',
      repoRev: 'rev-1',
      section: 'a',
      status: 'ready',
    })
    repo.upsert({
      spaceId: 'sp-1',
      slug: 'repo-module-lib',
      repoRev: 'rev-1',
      section: 'b',
      status: 'failed',
      error: 'model_failed',
    })
    repo.upsert({
      spaceId: 'sp-1',
      slug: 'repo-module-src',
      repoRev: 'rev-2',
      section: 'c',
      status: 'ready',
    })
    const removed = repo.deleteStaleRevs('sp-1', 'rev-2')
    expect(removed).toBe(2)
    expect(repo.getBySpace('sp-1', 'rev-1')).toHaveLength(0)
    const keep = repo.getBySpace('sp-1', 'rev-2')
    expect(keep).toHaveLength(1)
    expect(keep[0]!.slug).toBe('repo-module-src')
    // 无旧 rev 时幂等（二次回收 0 行）
    expect(repo.deleteStaleRevs('sp-1', 'rev-2')).toBe(0)
  })

  it('CHECK 约束：非法 status 直接被 SQLite 拒绝（fail-loud）', () => {
    expect(() =>
      db.raw
        .prepare(
          `INSERT INTO wiki_repo_enrichment
             (space_id, slug, repo_rev, section, status, created_at, updated_at)
           VALUES ('sp-1', 's', 'r', '', 'pending', 0, 0)`,
        )
        .run(),
    ).toThrow(/CHECK|constraint/i)
  })

  it('getStatusBySpace 跨 rev 返回全部行；deleteBySpace 清空该空间', () => {
    repo.upsert({
      spaceId: 'sp-1',
      slug: 'a',
      repoRev: 'rev-1',
      section: '',
      status: 'ready',
      now: 1000,
    })
    repo.upsert({
      spaceId: 'sp-1',
      slug: 'b',
      repoRev: 'rev-2',
      section: '',
      status: 'ready',
      now: 2000,
    })
    expect(repo.getStatusBySpace('sp-1')).toHaveLength(2)
    // ORDER BY updated_at DESC
    expect(repo.getStatusBySpace('sp-1')[0]!.slug).toBe('b')
    expect(repo.deleteBySpace('sp-1')).toBe(2)
    expect(repo.getStatusBySpace('sp-1')).toHaveLength(0)
  })
})
