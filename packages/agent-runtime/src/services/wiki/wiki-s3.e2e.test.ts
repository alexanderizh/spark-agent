/**
 * Wiki S3 e2e — 技能提议闭环（提议 → 决策 → 落地 → 溯源）。
 *
 * 覆盖不变量（方案 §4 设计原则 1 / §13 S3 出口）：
 *   - 提议只写草案：不创建技能、不改动 wiki_page（知识零损失）；
 *   - 强制溯源：编造的 page id 一律拒绝；
 *   - 草稿不可解析时在提议阶段就拒绝（比接受后失败更好）；
 *   - 接受 → 落盘 SKILL.md + PURPOSE.md + 登记 skills 表，skill_id 回填；
 *   - 拒绝原因留档，下一轮提议能读到（"上次为何被拒"）；
 *   - 技能被拒/回滚不影响源知识页（仍在、仍可检索）。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'path'
import { mkdirSync, rmSync, readFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { SparkDatabase, SkillRepository } from '@spark/storage'
import type { SkillRepository as SkillRepositoryType } from '@spark/storage'
import { createWikiServiceStack, type WikiServiceStack } from './wiki-service-stack.js'

const SKILL_MD = `---
name: flaky-test-triage
description: 排查间歇失败测试时按固定顺序取证
---

# Flaky Test Triage

1. 先看失败率与时间分布
2. 再固定随机种子复跑
3. 最后才怀疑业务逻辑
`

describe('Wiki S3 e2e（技能提议 / 接受 / 拒绝 / 溯源）', () => {
  let db: SparkDatabase
  let testDir: string
  let skillsDir: string
  let stack: WikiServiceStack
  let skillRepo: SkillRepositoryType

  beforeEach(async () => {
    testDir = join(tmpdir(), `spark-wiki-s3-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    skillsDir = join(testDir, 'skills')
    mkdirSync(testDir, { recursive: true })
    db = new SparkDatabase(join(testDir, 'test.db'))
    db.runMigrations(join(process.cwd(), '../storage/migrations'))
    skillRepo = new SkillRepository(db)
    stack = createWikiServiceStack({
      db,
      appHomeDir: join(testDir, 'home'),
      skillsRootDir: skillsDir,
    })
    // 造两个知识页（走统一写入原语，与真实链路一致）
    const created = await stack.writeService.createSpace({
      scope: 'user',
      scopeRef: null,
      name: '我的知识库',
    })
    expect(created.ok).toBe(true)
    if (!created.ok) throw new Error(created.message)
    const spaceId = created.row.id
    for (const title of ['测试排障经验', '重试与超时约定']) {
      await stack.writeService.commitPage({
        spaceId,
        kind: 'pattern',
        title,
        summary: `${title}摘要`,
        body: `${title}正文`,
        tags: ['testing'],
        status: 'published',
        authorRole: 'manual_user',
      })
    }
  })

  afterEach(() => {
    db.close()
    rmSync(testDir, { recursive: true, force: true })
  })

  function pageIds(): string[] {
    const space = stack.spaceRepo.listByScopes([{ scope: 'user', scopeRef: null }])[0]
    if (space == null) return []
    return stack.pageRepo.listBySpace(space.id).map((p) => p.id)
  }

  it('提议只写草案：不创建技能、不新增/改动任何知识页', () => {
    const before = pageIds()
    const beforeSkills = skillRepo.list().length

    const result = stack.skillProposerService.propose({
      scope: 'user',
      scopeRef: null,
      name: 'flaky-test-triage',
      purpose: '把反复口述的测试排障顺序固化成可复用流程',
      skillMd: SKILL_MD,
      triggers: ['测试失败', 'flaky'],
      sourcePageIds: before,
    })

    expect(result.ok).toBe(true)
    expect(result.id).toMatch(/^wskp_/)
    // 草案落库
    expect(stack.skillProposerService.pendingTotal()).toBe(1)
    // 没有创建任何技能
    expect(skillRepo.list().length).toBe(beforeSkills)
    // 知识页一个没动（数量与内容都不变）
    expect(pageIds()).toEqual(before)
  })

  it('强制溯源：编造的页面 id 一律拒绝', () => {
    const result = stack.skillProposerService.propose({
      scope: 'user',
      scopeRef: null,
      name: 'fake-skill',
      purpose: '无依据的技能',
      skillMd: SKILL_MD,
      sourcePageIds: ['wp_deadbeef', 'wp_00000000'],
    })
    expect(result.ok).toBe(false)
    expect(result.message).toContain('溯源')
    expect(stack.skillProposerService.pendingTotal()).toBe(0)
  })

  it('草稿不可解析时在提议阶段就拒绝（缺 name/description）', () => {
    const result = stack.skillProposerService.propose({
      scope: 'user',
      scopeRef: null,
      name: 'broken-skill',
      purpose: '草稿坏了',
      // 有 frontmatter 分隔线但缺必填字段
      skillMd: '---\nversion: 1\n---\n\n正文',
      sourcePageIds: pageIds(),
    })
    expect(result.ok).toBe(false)
    expect(result.message).toContain('无法解析')
  })

  it('无 frontmatter 的草稿自动补齐（name + description）', () => {
    const result = stack.skillProposerService.propose({
      scope: 'user',
      scopeRef: null,
      name: 'auto-frontmatter',
      purpose: '验证自动补齐',
      description: '自动补齐描述',
      skillMd: '# 正文\n\n没有 frontmatter。',
      sourcePageIds: pageIds(),
    })
    expect(result.ok).toBe(true)
    const row = stack.skillProposalRepo.getById(result.id!)!
    const draft = stack.skillProposalRepo.parseDraft(row)!
    expect(draft.skillMd.startsWith('---\n')).toBe(true)
    expect(draft.skillMd).toContain('name: auto-frontmatter')
    expect(draft.skillMd).toContain('description: "自动补齐描述"')
  })

  it('接受 → 落盘 SKILL.md + PURPOSE.md + 登记 skills 表 + 回填 skill_id', async () => {
    const pages = pageIds()
    const proposed = stack.skillProposerService.propose({
      scope: 'user',
      scopeRef: null,
      name: 'flaky-test-triage',
      purpose: '把反复口述的测试排障顺序固化成可复用流程',
      skillMd: SKILL_MD,
      triggers: ['测试失败', 'flaky'],
      sourcePageIds: pages,
    })
    const accepted = await stack.skillProposerService.accept(proposed.id!)
    expect(accepted.ok).toBe(true)
    expect(accepted.skillId).toBeTruthy()

    // 落盘：SKILL.md 原文 + PURPOSE.md
    const rootPath = accepted.rootPath!
    expect(existsSync(join(rootPath, 'SKILL.md'))).toBe(true)
    expect(readFileSync(join(rootPath, 'SKILL.md'), 'utf-8')).toBe(SKILL_MD)
    const purpose = readFileSync(join(rootPath, 'PURPOSE.md'), 'utf-8')
    expect(purpose).toContain('flaky-test-triage')
    // PURPOSE 溯源：每个源页面 id 都在
    for (const id of pages) expect(purpose).toContain(id)

    // 登记：skills 表有一条，且 manifest 带溯源
    const skill = skillRepo.get(accepted.skillId!)!
    expect(skill.name).toBe('flaky-test-triage')
    expect(skill.scope).toBe('user')
    expect(skill.enabled).toBe(1)
    const manifest = JSON.parse(skill.manifest_json) as Record<string, unknown>
    expect(manifest.source).toBe('wiki-proposal')
    expect(manifest.sourcePageIds).toEqual(pages)

    // 回填：提议行 accepted + skill_id
    const row = stack.skillProposalRepo.getById(proposed.id!)!
    expect(row.status).toBe('accepted')
    expect(row.skill_id).toBe(accepted.skillId)

    // 知识页仍在（技能落地不影响知识）
    expect(pageIds()).toEqual(pages)
  })

  it('重复接受同一提议：第二次失败且不产生重复技能', async () => {
    const proposed = stack.skillProposerService.propose({
      scope: 'user',
      scopeRef: null,
      name: 'once-only',
      purpose: '一次性',
      skillMd: SKILL_MD,
      sourcePageIds: pageIds(),
    })
    const first = await stack.skillProposerService.accept(proposed.id!)
    expect(first.ok).toBe(true)
    const skillsAfterFirst = skillRepo.list().length

    const second = await stack.skillProposerService.accept(proposed.id!)
    expect(second.ok).toBe(false)
    expect(second.message).toContain('accepted')
    expect(skillRepo.list().length).toBe(skillsAfterFirst)
  })

  it('接受后重新提议同名技能：复用同一 root_path，不产生重复条目', async () => {
    const pages = pageIds()
    const first = stack.skillProposerService.propose({
      scope: 'user',
      scopeRef: null,
      name: 'evolving-skill',
      purpose: '第一版',
      skillMd: SKILL_MD,
      sourcePageIds: pages,
    })
    await stack.skillProposerService.accept(first.id!)

    const second = stack.skillProposerService.propose({
      scope: 'user',
      scopeRef: null,
      name: 'evolving-skill',
      purpose: '第二版（补充步骤）',
      skillMd: `${SKILL_MD}\n4. 补充：保留现场日志\n`,
      sourcePageIds: pages,
    })
    const accepted = await stack.skillProposerService.accept(second.id!)
    expect(accepted.ok).toBe(true)
    expect(accepted.rootPath).toBe(join(skillsDir, 'evolving-skill'))
    expect(skillRepo.list()).toHaveLength(1)
    // 文件已更新为最新草案
    expect(readFileSync(join(accepted.rootPath!, 'SKILL.md'), 'utf-8')).toContain(
      '补充：保留现场日志',
    )
  })

  it('拒绝原因留档；下一轮提议能读到"上次为何被拒"', () => {
    const first = stack.skillProposerService.propose({
      scope: 'user',
      scopeRef: null,
      name: 'rejected-skill',
      purpose: '会被拒',
      skillMd: SKILL_MD,
      sourcePageIds: pageIds(),
    })
    expect(stack.skillProposerService.reject(first.id!, '与既有 commit 技能能力重叠').ok).toBe(true)

    const second = stack.skillProposerService.propose({
      scope: 'user',
      scopeRef: null,
      name: 'rejected-skill',
      purpose: '再试一次',
      skillMd: SKILL_MD,
      sourcePageIds: pageIds(),
    })
    expect(second.ok).toBe(true)
    // 上一轮的拒绝原因被带回给调用方（模型据此调整草稿）
    expect(second.rejectionHistory).toEqual(['与既有 commit 技能能力重叠'])

    // 空原因拒绝（反馈信号不能丢）
    const third = stack.skillProposerService.propose({
      scope: 'user',
      scopeRef: null,
      name: 'another-skill',
      purpose: 'x',
      skillMd: SKILL_MD,
      sourcePageIds: pageIds(),
    })
    expect(stack.skillProposerService.reject(third.id!, '   ').ok).toBe(false)
  })

  it('技能被拒不影响源知识页（知识永不随技能回滚丢失）', () => {
    const pages = pageIds()
    const proposed = stack.skillProposerService.propose({
      scope: 'user',
      scopeRef: null,
      name: 'doomed-skill',
      purpose: '会被拒的技能',
      skillMd: SKILL_MD,
      sourcePageIds: pages,
    })
    stack.skillProposerService.reject(proposed.id!, '方向不对')

    // 页面仍在且正文可读
    expect(pageIds()).toEqual(pages)
    for (const id of pages) {
      const page = stack.pageRepo.getById(id)!
      expect(page.status).not.toBe('archived')
    }
    // 技能没有落地
    expect(skillRepo.list()).toHaveLength(0)
    // 拒绝史可查
    const history = stack.skillProposalRepo.findDecisionHistory('user', null, 'doomed-skill')
    expect(history).toHaveLength(1)
    expect(history[0]?.reject_reason).toBe('方向不对')
  })

  it('提议区列表带溯源页面标题（UI 无需逐条查询）', () => {
    const pages = pageIds()
    stack.skillProposerService.propose({
      scope: 'user',
      scopeRef: null,
      name: 'with-sources',
      purpose: '验证溯源展示',
      skillMd: SKILL_MD,
      sourcePageIds: pages,
    })
    const list = stack.skillProposerService.list('pending', { scope: 'user', scopeRef: null })
    expect(list.items).toHaveLength(1)
    expect(list.pendingTotal).toBe(1)
    const item = list.items[0]!
    expect(item.sourcePageIds).toEqual(pages)
    expect(item.sourcePages.map((p) => p.title)).toContain('测试排障经验')
    expect(item.skillMd).toBe(SKILL_MD)
    expect(item.purpose).toBe('验证溯源展示')
  })

  it('未配置技能目录时拒绝接受（不猜路径、不落一半）', async () => {
    const bareStack = createWikiServiceStack({ db })
    const proposed = bareStack.skillProposerService.propose({
      scope: 'user',
      scopeRef: null,
      name: 'no-dir-skill',
      purpose: '没有目录',
      skillMd: SKILL_MD,
      sourcePageIds: pageIds(),
    })
    const result = await bareStack.skillProposerService.accept(proposed.id!)
    expect(result.ok).toBe(false)
    expect(result.message).toContain('技能目录')
    // 失败后提议回滚为 pending（可重试）
    expect(bareStack.skillProposalRepo.getById(proposed.id!)!.status).toBe('pending')
    expect(skillRepo.list()).toHaveLength(0)
  })
})
