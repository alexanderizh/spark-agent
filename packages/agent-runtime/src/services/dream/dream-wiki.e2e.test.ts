/**
 * @module dream-wiki.e2e.test
 *
 * AutoDream wiki 轨端到端聚焦测试（真实 DB + 真实 wiki 服务栈，不联网）：
 *   - 候选 action 扩展路由：update → 目标页版本+1；delete → 软删（archived）；
 *     merge → 正文并入保留方 + 被并方归档；
 *   - DreamWikiProposalSink.apply：create 提案 pending / auto-applied 两路分流；
 *   - 目标页不存在 / 已归档时提案前置拒收（防幻觉 id）。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SparkDatabase } from '@spark/storage'
import { join } from 'path'
import { mkdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { createWikiServiceStack, type WikiServiceStack } from '../wiki/wiki-service-stack.js'
import { DreamWikiProposalSink } from './dream-wiki-sink.js'
import type { DreamWikiProposal } from '@spark/protocol'

describe('Dream wiki 轨 e2e（action 路由 / sink 分流）', () => {
  let db: SparkDatabase
  let stack: WikiServiceStack
  let dir: string
  let sink: DreamWikiProposalSink
  let spaceId: string

  beforeEach(async () => {
    dir = join(tmpdir(), `spark-dream-wiki-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(dir, { recursive: true })
    db = new SparkDatabase(join(dir, 'test.db'))
    db.runMigrations(join(process.cwd(), '../storage/migrations'))
    stack = createWikiServiceStack({ db, appHomeDir: dir })
    sink = new DreamWikiProposalSink({
      candidateService: stack.candidateService,
      candidateRepo: stack.candidateRepo,
      spaceRepo: stack.spaceRepo,
      pageRepo: stack.pageRepo,
    })
    const space = await stack.writeService.createSpace({ name: '测试空间', scope: 'user' })
    spaceId = space.ok ? space.row.id : ''
  })

  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  async function createPage(title: string, body: string): Promise<string> {
    const written = await stack.writeService.commitPage({
      spaceId,
      kind: 'knowledge',
      title,
      summary: `${title} 摘要`,
      body,
      tags: [],
      authorRole: 'manual_user',
    })
    if (!written.ok) throw new Error(`测试建页失败: ${written.message}`)
    return written.row.id
  }

  function wikiProposal(overrides: Partial<DreamWikiProposal> = {}): DreamWikiProposal {
    return {
      kind: 'wiki',
      op: 'create',
      confidence: 0.9,
      rationale: '会话中沉淀的高价值知识',
      sourceRefs: [{ kind: 'session', id: 'sess-1', note: '第 2 轮明确结论' }],
      spaceId,
      payload: {
        title: '新知识页',
        summary: '摘要',
        body: '# 内容\n正文',
        kind: 'knowledge',
        tags: ['test'],
      },
      ...overrides,
    }
  }

  it('update 候选确认后目标页版本 +1（action 路由）', async () => {
    const pageId = await createPage('旧标题', '旧正文')
    const { inserted, row } = stack.candidateRepo.insertPending({
      scope: 'user',
      scopeRef: null,
      spaceId,
      payload: {
        kind: 'knowledge',
        title: '新标题',
        summary: '更新摘要',
        body: '更新后的正文',
        tags: [],
        confidence: 0.9,
        sources: [{ sessionId: 'sess-1', turnIndex: 1, excerpt: '依据' }],
        rationale: '信息已过时',
        action: 'update',
        targetId: pageId,
      },
    })
    expect(inserted).toBe(true)
    const confirmed = await stack.candidateService.confirm({
      id: row!.id,
      digest: row!.content_digest,
    })
    expect(confirmed.ok).toBe(true)
    expect(confirmed.pageId).toBe(pageId)
    const updated = stack.pageRepo.getById(pageId)
    expect(updated?.version).toBe(2)
    expect(updated?.title).toBe('新标题')
  })

  it('delete 候选确认后软删（archived，可恢复）', async () => {
    const pageId = await createPage('待删除', '正文')
    const { row } = stack.candidateRepo.insertPending({
      scope: 'user',
      scopeRef: null,
      spaceId,
      payload: {
        kind: 'knowledge',
        title: '待删除',
        summary: '',
        body: '（删除提案）',
        tags: [],
        confidence: 0.95,
        sources: [{ sessionId: 'sess-1', turnIndex: 1, excerpt: '已失效' }],
        action: 'delete',
        targetId: pageId,
      },
    })
    const confirmed = await stack.candidateService.confirm({
      id: row!.id,
      digest: row!.content_digest,
    })
    expect(confirmed.ok).toBe(true)
    expect(stack.pageRepo.getById(pageId)?.status).toBe('archived')
  })

  it('merge 候选确认后保留方更新、被并方归档', async () => {
    const keepId = await createPage('保留页', '保留正文')
    const dropId = await createPage('重复页', '重复正文')
    const { row } = stack.candidateRepo.insertPending({
      scope: 'user',
      scopeRef: null,
      spaceId,
      payload: {
        kind: 'knowledge',
        title: '保留页',
        summary: '',
        body: '合并后的完整正文',
        tags: [],
        confidence: 0.9,
        sources: [{ sessionId: 'sess-1', turnIndex: 1, excerpt: '两页重复' }],
        action: 'merge',
        targetId: dropId,
        mergeTargetId: keepId,
      },
    })
    const confirmed = await stack.candidateService.confirm({
      id: row!.id,
      digest: row!.content_digest,
    })
    expect(confirmed.ok).toBe(true)
    const keepPage = stack.pageRepo.getById(keepId)
    expect(keepPage != null).toBe(true)
    const keepBody = await stack.store.readBody(keepPage!.file_path)
    expect(keepBody).toContain('合并后的完整正文')
    expect(stack.pageRepo.getById(dropId)?.status).toBe('archived')
  })

  it('sink：create 提案 pending 分流进候选区', async () => {
    const r = await sink.apply(wikiProposal({ confidence: 0.5 }), 'pending-review')
    expect(r.outcome).toBe('pending-review')
    expect(stack.candidateService.pendingTotal()).toBe(1)
  })

  it('sink：create 提案 auto-applied 分流直接确认落库', async () => {
    const r = await sink.apply(wikiProposal({ confidence: 0.95 }), 'auto-applied')
    expect(r.outcome).toBe('auto-applied')
    expect(stack.candidateService.pendingTotal()).toBe(0)
    const pages = stack.pageRepo.listBySpace(spaceId, { parentId: null })
    expect(pages.some((p) => p.title === '新知识页')).toBe(true)
  })

  it('sink：幻觉 targetId 前置拒收', async () => {
    const r = await sink.apply(
      wikiProposal({ op: 'update', targetId: 'page_ghost' }),
      'pending-review',
    )
    expect(r.outcome).toBe('rejected-invalid')
    expect(r.note).toContain('不存在')
  })

  it('sink：Orient 快照包含空间与页面标题', async () => {
    await createPage('快照页A', '正文')
    const digest = sink.buildOrientDigest(10)
    expect(digest).toContain('测试空间')
    expect(digest).toContain('快照页A')
  })
})
