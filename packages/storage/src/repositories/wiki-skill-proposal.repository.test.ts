/**
 * WikiSkillProposalRepository 测试 — 技能提议状态机。
 *
 * 覆盖不变量（方案 §4 设计原则 1 / §13 S3 出口）：
 *   - 同名新提议把旧 pending 置 superseded，不堆积重复草案；
 *   - 拒绝史保留且可查（"上次为何被拒"是下一轮提议的输入）；
 *   - 接受是一次性状态迁移并回填 skill_id；
 *   - 接受后技能落地失败可条件回滚；已注册技能的行不受回滚影响；
 *   - 草稿 / 溯源 JSON 损坏时不采信（返回 null / 空数组）。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SparkDatabase } from '../database.js'
import {
  WikiSkillProposalRepository,
  generateWikiSkillProposalId,
  normalizeSkillName,
  type WikiSkillProposalDraft,
} from './wiki-skill-proposal.repository.js'
import { WikiPageRepository } from './wiki-page.repository.js'
import { join } from 'path'
import { mkdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'

const draft: WikiSkillProposalDraft = {
  skillMd: '---\nname: demo\ndescription: 演示技能\n---\n\n# Demo\n',
  description: '演示技能',
  triggers: ['demo', '示例'],
}

describe('WikiSkillProposalRepository', () => {
  let db: SparkDatabase
  let repo: WikiSkillProposalRepository
  let pageRepo: WikiPageRepository
  let testDir: string

  beforeEach(() => {
    testDir = join(tmpdir(), `spark-wiki-sklp-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(testDir, { recursive: true })
    db = new SparkDatabase(join(testDir, 'test.db'))
    db.runMigrations(join(process.cwd(), 'migrations'))
    repo = new WikiSkillProposalRepository(db)
    pageRepo = new WikiPageRepository(db)
    pageRepo.insert(
      {
        id: 'wp_src0001',
        space_id: 'wsp_space01',
        parent_id: null,
        kind: 'pattern',
        title: '源知识页',
        slug: 'source-page',
        summary: '用于溯源的源页',
        file_path: '/tmp/wiki-test/wp_src0001.md',
        tags_json: '[]',
        status: 'published',
        confidence: 1,
        sort_order: 0,
        source_type: null,
        source_session_id: null,
        author_role: 'user',
        hit_count: 0,
        last_hit_at: null,
        valid_from: null,
        invalid_at: null,
        // body 是 insert 的第二个参数（只用于 FTS 索引与 content_hash 守卫）
      },
      '源页正文',
    )
  })

  afterEach(() => {
    db.close()
    rmSync(testDir, { recursive: true, force: true })
  })

  function insert(name = '演示技能', purpose = '解决重复排查问题'): string {
    const id = generateWikiSkillProposalId()
    repo.insert({
      id,
      scope: 'user',
      scopeRef: null,
      name,
      purpose,
      draft,
      sourcePageIds: ['wp_src0001'],
    })
    return id
  }

  it('征集后为 pending，草稿与溯源可解析', () => {
    const id = insert()
    const row = repo.getById(id)!
    expect(row.status).toBe('pending')
    expect(row.scope).toBe('user')
    expect(repo.parseDraft(row)?.description).toBe('演示技能')
    expect(repo.parseSourcePageIds(row)).toEqual(['wp_src0001'])
  })

  it('同名新提议把旧 pending 置 superseded（不堆积重复草案）', () => {
    const first = insert()
    const second = insert()
    expect(repo.getById(first)!.status).toBe('superseded')
    expect(repo.getById(second)!.status).toBe('pending')
    expect(repo.countPending('user', null)).toBe(1)
  })

  it('同名判定大小写不敏感（normalizeSkillName 归一化）', () => {
    expect(normalizeSkillName('  Demo   Skill ')).toBe('demo skill')
    const first = insert('Demo Skill')
    insert('demo skill')
    expect(repo.getById(first)!.status).toBe('superseded')
  })

  it('拒绝后原因留档，且可从决策史读到（下次提议避免重蹈）', () => {
    const id = insert()
    const rejected = repo.reject(id, '与既有技能能力重叠')
    expect(rejected.ok).toBe(true)
    const row = repo.getById(id)!
    expect(row.status).toBe('rejected')
    expect(row.reject_reason).toBe('与既有技能能力重叠')
    expect(row.decided_at).not.toBeNull()

    const history = repo.findDecisionHistory('user', null, '演示技能')
    expect(history).toHaveLength(1)
    expect(history[0]?.reject_reason).toBe('与既有技能能力重叠')
  })

  it('已拒绝的提议不被后续同名提议改动（历史是反馈信号，不是待清理状态）', () => {
    const first = insert()
    repo.reject(first, '范围太大')
    insert()
    expect(repo.getById(first)!.status).toBe('rejected')
    expect(repo.findDecisionHistory('user', null, '演示技能')).toHaveLength(1)
  })

  it('接受是一次性状态迁移；重复接受影响 0 行', () => {
    const id = insert()
    const first = repo.accept(id)
    expect(first.ok).toBe(true)
    expect(repo.getById(id)!.status).toBe('accepted')
    // 状态已迁移但技能尚未落地：skill_id 仍为 NULL
    expect(repo.getById(id)!.skill_id).toBeNull()

    const second = repo.accept(id)
    expect(second.ok).toBe(false)
    expect(repo.getById(id)!.decided_at).toBe(first.row!.decided_at)
  })

  it('接受后回填 skill_id；回填只写一次（不覆盖既有技能）', () => {
    const id = insert()
    repo.accept(id)
    expect(repo.attachSkill(id, 'skl_abc12345')).toBe(true)
    expect(repo.getById(id)!.skill_id).toBe('skl_abc12345')
    expect(repo.attachSkill(id, 'skl_other999')).toBe(false)
    expect(repo.getById(id)!.skill_id).toBe('skl_abc12345')
  })

  it('接受会清空此前的拒绝原因（状态前进不留矛盾字段）', () => {
    const first = insert()
    repo.reject(first, '先拒')
    const second = insert()
    repo.accept(second)
    expect(repo.getById(second)!.reject_reason).toBeNull()
  })

  it('接受后技能落地失败可条件回滚；已注册技能的行不受影响', () => {
    const id = insert()
    repo.accept(id)
    // 落地失败：skill_id 仍为 NULL → 可回滚为 pending 重试
    expect(repo.revertToPendingIfUnregistered(id)).toBe(true)
    expect(repo.getById(id)!.status).toBe('pending')
    expect(repo.getById(id)!.decided_at).toBeNull()

    repo.accept(id)
    repo.attachSkill(id, 'skl_real123')
    // 已注册技能：回滚应拒绝（否则造成"技能存在但提议仍 pending"的幽灵态）
    expect(repo.revertToPendingIfUnregistered(id)).toBe(false)
    expect(repo.getById(id)!.status).toBe('accepted')
    expect(repo.getById(id)!.skill_id).toBe('skl_real123')
  })

  it('拒绝非 pending 行返回 ok=false（幂等，不重复决断）', () => {
    const id = insert()
    repo.accept(id)
    expect(repo.reject(id, '想改主意').ok).toBe(false)
    expect(repo.getById(id)!.status).toBe('accepted')
  })

  it('scope 隔离：不同 scope 的同名提议互不 supersede', () => {
    const userOne = insert()
    const projectId = generateWikiSkillProposalId()
    repo.insert({
      id: projectId,
      scope: 'project',
      scopeRef: '/repo/a',
      name: '演示技能',
      purpose: '项目侧',
      draft,
      sourcePageIds: ['wp_src0001'],
    })
    expect(repo.getById(userOne)!.status).toBe('pending')
    expect(repo.getById(projectId)!.status).toBe('pending')
    expect(repo.countPending('user', null)).toBe(1)
    expect(repo.countPending('project', '/repo/a')).toBe(1)
  })

  it('草稿 JSON 损坏时不采信', () => {
    const id = insert()
    db.raw
      .prepare(`UPDATE wiki_skill_proposal SET skill_draft_json = ? WHERE id = ?`)
      .run('{ not json', id)
    expect(repo.parseDraft(repo.getById(id)!)).toBeNull()
  })

  it('溯源列表按 scope 过滤', () => {
    insert()
    expect(repo.listByStatus('pending', { scope: 'user', scopeRef: null })).toHaveLength(1)
    expect(repo.listByStatus('pending', { scope: 'project', scopeRef: '/x' })).toHaveLength(0)
    expect(repo.listByStatus('accepted')).toHaveLength(0)
  })
})
