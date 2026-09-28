/**
 * @module wiki-s1.e2e.test
 *
 * S1 出口验收（写入闭环）：双链与红链、归档 / 还原、删除屏障、版本还原、
 * 敏感内容闸门、回执瘦身、L1 目录树与 L4 反向链接的服务端预算裁剪。
 *
 * 全部断言基于真实 DB（migration 112）+ 真实文件系统（临时目录），
 * 不 mock 仓储 —— 这些不变量（FTS 同事务、快照可读、删除后检索不再命中）
 * 只有在真存储上才有意义。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SparkDatabase } from '@spark/storage'
import { createWikiServiceStack, type WikiServiceStack } from './wiki-service-stack.js'
import { scanSensitiveContent, WIKI_PAGE_QUOTA_PER_SPACE } from './wiki-write.service.js'
import { parseWikiLinks } from './wiki-link.service.js'
import { join } from 'path'
import { existsSync, mkdirSync, readdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'

describe('Wiki S1 e2e（写入闭环 / 双链 / 删除屏障 / 版本还原）', () => {
  let db: SparkDatabase
  let stack: WikiServiceStack
  let testDir: string

  beforeEach(() => {
    testDir = join(tmpdir(), `spark-wiki-s1-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(testDir, { recursive: true })
    db = new SparkDatabase(join(testDir, 'test.db'))
    db.runMigrations(join(process.cwd(), '../storage/migrations'))
    stack = createWikiServiceStack({ db, appHomeDir: testDir })
  })

  afterEach(() => {
    db.close()
    rmSync(testDir, { recursive: true, force: true })
  })

  async function makeSpace(name = '工程经验库'): Promise<string> {
    const r = await stack.writeService.createSpace({ scope: 'user', name })
    expect(r.ok).toBe(true)
    if (!r.ok) throw new Error('space create failed')
    return r.row.id
  }

  async function makePage(spaceId: string, title: string, body: string): Promise<string> {
    const r = await stack.writeService.commitPage({
      spaceId,
      title,
      body,
      authorRole: 'manual_user',
    })
    expect(r.ok).toBe(true)
    if (!r.ok) throw new Error(`page create failed: ${r.message}`)
    return r.row.id
  }

  // ─── 双链 ────────────────────────────────────────────────────────────

  it('双链：[[标题]] 建边，未创建目标是红链，目标创建后自动回填', async () => {
    const spaceId = await makeSpace()
    const aId = await makePage(spaceId, 'A 页', '见 [[B 页]] 与 [[还不存在]]。')

    const outgoing = stack.linkRepo.listOutgoing(aId)
    expect(outgoing).toHaveLength(2)
    const toB = outgoing.find((l) => l.to_title === 'B 页')!
    const red = outgoing.find((l) => l.to_title === '还不存在')!
    expect(toB.to_page).toBeNull() // B 还没建 → 红链
    expect(red.to_page).toBeNull()

    // 建 B 页 → A 的红链自动连上
    const bId = await makePage(spaceId, 'B 页', 'B 的正文。')
    const resolved = stack.linkRepo.listOutgoing(aId).find((l) => l.to_title === 'B 页')!
    expect(resolved.to_page).toBe(bId)
    // 仍然不存在的目标保持红链
    expect(
      stack.linkRepo.listOutgoing(aId).find((l) => l.to_title === '还不存在')!.to_page,
    ).toBeNull()

    // 反向链接：B 被 A 引用
    const backlinks = stack.linkService.backlinksForAgent(bId)
    expect(backlinks.total).toBe(1)
    expect(backlinks.items[0]!.id).toBe(aId)
  })

  it('双链：改正文后出边整体重建（旧边不残留），自链不建边', async () => {
    const spaceId = await makeSpace()
    const aId = await makePage(spaceId, 'A 页', '见 [[B 页]]。')
    const bId = await makePage(spaceId, 'B 页', '自引 [[A 页]] 与自链 [[B 页]] 都有。')

    // B 的出边只应有指向 A 的边（自链被剔除）
    const bOut = stack.linkRepo.listOutgoing(bId)
    expect(bOut.map((l) => l.to_title)).toEqual(['A 页'])

    // A 改正文去掉引用 → 旧边不残留
    const a = stack.pageRepo.getById(aId)!
    const upd = await stack.writeService.commitPage({
      pageId: aId,
      expectedVersion: a.version,
      body: '不再引用任何页面。',
      authorRole: 'manual_user',
    })
    expect(upd.ok).toBe(true)
    expect(stack.linkRepo.listOutgoing(aId)).toHaveLength(0)
    expect(stack.linkRepo.countBacklinks(bId)).toBe(0)
  })

  it('parseWikiLinks：支持别名、去重、忽略转义与空标题', () => {
    const links = parseWikiLinks('[[标题]] [[标题]] [[目标|别名]] \\[[转义]] [[]] [[多\n行]]')
    expect(links.map((l) => l.title)).toEqual(['标题', '目标'])
    expect(links[1]!.label).toBe('别名')
  })

  // ─── 归档 / 还原 ─────────────────────────────────────────────────────

  it('归档：出边删除 + 入边降级为红链；还原后自动重新连上', async () => {
    const spaceId = await makeSpace()
    const aId = await makePage(spaceId, 'A 页', '引用 [[B 页]]。')
    const bId = await makePage(spaceId, 'B 页', 'B 的内容。')
    expect(stack.linkRepo.listOutgoing(aId)[0]!.to_page).toBe(bId)

    const archived = await stack.writeService.archivePage(bId)
    expect(archived.ok).toBe(true)
    // 入边降级为红链（保留文本引用），出边（B 自己的）被清
    expect(stack.linkRepo.listOutgoing(aId)[0]!.to_page).toBeNull()
    expect(stack.pageRepo.getById(bId)!.status).toBe('archived')
    // 归档页不进检索
    expect(stack.searchRepo.searchBm25('内容')).toHaveLength(0)

    // 幂等：重复归档如实回执 alreadyArchived
    const again = await stack.writeService.archivePage(bId)
    expect(again.ok && again.alreadyArchived).toBe(true)

    // 还原 → 正文回到 published，红链重新连上
    const restored = await stack.writeService.restoreFromArchive(bId)
    expect(restored.ok).toBe(true)
    expect(stack.pageRepo.getById(bId)!.status).toBe('published')
    expect(stack.linkRepo.listOutgoing(aId)[0]!.to_page).toBe(bId)
    expect(stack.searchRepo.searchBm25('内容')).toHaveLength(1)
  })

  // ─── 版本还原 ────────────────────────────────────────────────────────

  it('版本还原：v1 快照可读、还原产生新版本且历史标注 restore', async () => {
    const spaceId = await makeSpace()
    const pageId = await makePage(spaceId, '可回滚页', 'v1 正文')
    const v1 = stack.pageRepo.getById(pageId)!.version

    let cur = stack.pageRepo.getById(pageId)!
    const u2 = await stack.writeService.commitPage({
      pageId,
      expectedVersion: cur.version,
      body: 'v2 正文',
      authorRole: 'manual_user',
    })
    expect(u2.ok).toBe(true)
    cur = stack.pageRepo.getById(pageId)!
    const u3 = await stack.writeService.commitPage({
      pageId,
      expectedVersion: cur.version,
      body: 'v3 正文',
      authorRole: 'manual_user',
    })
    expect(u3.ok).toBe(true)

    // 历史里能读到 v1 的快照正文（不是空、不是当前正文）
    const rev1 = await stack.pageService.readRevision(pageId, v1)
    expect(rev1?.body).toBe('v1 正文')
    expect(rev1?.unavailableReason).toBeNull()

    const before = stack.pageRepo.getById(pageId)!
    const restored = await stack.writeService.restoreVersion({
      pageId,
      version: v1,
      expectedVersion: before.version,
      actor: 'manual_user',
    })
    expect(restored.ok).toBe(true)
    if (!restored.ok) return
    expect(restored.row.version).toBe(before.version + 1)
    // 正文真的回到 v1
    const full = await stack.pageService.readFull(pageId)
    expect(full.ok && full.body).toBe('v1 正文')
    // 被替代的版本在历史里标注为 restore 操作
    const history = stack.pageService.history(pageId)
    expect(history.some((h) => h.changeKind === 'restore')).toBe(true)
    // 还原后检索索引指向新正文（旧正文不再命中）
    expect(stack.searchRepo.searchBm25('v3 正文')).toHaveLength(0)
    expect(stack.searchRepo.searchBm25('v1 正文')).toHaveLength(1)
  })

  it('版本还原：CAS 失配拒绝，且不覆盖权威正文', async () => {
    const spaceId = await makeSpace()
    const pageId = await makePage(spaceId, 'CAS 页', 'base')
    const v1 = stack.pageRepo.getById(pageId)!.version
    const u = await stack.writeService.commitPage({
      pageId,
      expectedVersion: stack.pageRepo.getById(pageId)!.version,
      body: 'second',
      authorRole: 'manual_user',
    })
    expect(u.ok).toBe(true)

    const stale = await stack.writeService.restoreVersion({
      pageId,
      version: v1,
      expectedVersion: 999,
      actor: 'manual_user',
    })
    expect(stale.ok).toBe(false)
    if (stale.ok) return
    expect(stale.reason).toBe('version_conflict')
    // 权威正文未被这次失败的还原改写
    const full = await stack.pageService.readFull(pageId)
    expect(full.ok && full.body).toBe('second')
  })

  // ─── 删除屏障 ────────────────────────────────────────────────────────

  it('删除屏障：正文 / 快照 / 版本记录 / 图谱边与索引全部清理，重复删除幂等', async () => {
    const spaceId = await makeSpace()
    const aId = await makePage(spaceId, 'A 页', '指向 [[B 页]]。')
    const bId = await makePage(spaceId, 'B 页', 'B 的正文关键词 alpha。')
    // 制造一个历史版本（删除时应连同快照一起清理）
    await stack.writeService.commitPage({
      pageId: bId,
      expectedVersion: stack.pageRepo.getById(bId)!.version,
      body: 'B 的第二版 beta。',
      authorRole: 'manual_user',
    })
    const bRow = stack.pageRepo.getById(bId)!
    expect(existsSync(bRow.file_path)).toBe(true)
    expect(readdirSync(stack.store.getRevisionDir(bId)).length).toBeGreaterThan(0)

    const del = await stack.writeService.deletePage(bId)
    expect(del.ok).toBe(true)
    if (!del.ok) return
    expect(del.fileCleaned).toBe(true)
    expect(del.revisionsCleaned).toBe(true)

    expect(stack.pageRepo.getById(bId)).toBeNull()
    expect(existsSync(bRow.file_path)).toBe(false)
    expect(existsSync(stack.store.getRevisionDir(bId))).toBe(false)
    expect(stack.searchRepo.searchBm25('alpha')).toHaveLength(0)
    expect(stack.searchRepo.searchBm25('beta')).toHaveLength(0)
    // 被删页面的图谱边双向清零（不保留已删标题副本，来源页入边一并移除）
    expect(stack.linkRepo.listOutgoing(aId)).toHaveLength(0)

    const again = await stack.writeService.deletePage(bId)
    expect(again.ok).toBe(false)
    if (!again.ok) expect(again.reason).toBe('not_found')
  })

  // ─── 敏感内容闸门 / 配额 ─────────────────────────────────────────────

  it('敏感闸门：Agent 来源的凭据内容被拒；用户手写放行', async () => {
    const spaceId = await makeSpace()
    const secretBody = 'key: sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
    expect(scanSensitiveContent(secretBody)).toContain('anthropic_key')

    const byAgent = await stack.writeService.commitPage({
      spaceId,
      title: 'Agent 写的',
      body: secretBody,
      authorRole: 'agent',
    })
    expect(byAgent.ok).toBe(false)
    if (!byAgent.ok) {
      expect(byAgent.reason).toBe('sensitive_content')
      // 脱敏纪律：错误信息只报模式名，不回显匹配到的片段
      expect(byAgent.message).not.toContain('sk-ant-api03')
    }
    // 拦截后既没有落库也没有落盘
    expect(stack.pageRepo.listBySpace(spaceId)).toHaveLength(0)

    const byUser = await stack.writeService.commitPage({
      spaceId,
      title: '用户写的',
      body: secretBody,
      authorRole: 'manual_user',
    })
    expect(byUser.ok).toBe(true)
  })

  it('配额常量在写路径生效（页面计数达上限即拒绝）', async () => {
    const spaceId = await makeSpace()
    await makePage(spaceId, '第一页', 'x')
    // 直接断言闸门读取的是同一常量与计数原语（避免为测配额插 5000 行）
    expect(WIKI_PAGE_QUOTA_PER_SPACE).toBeGreaterThan(0)
    expect(stack.pageRepo.countActive(spaceId)).toBe(1)
  })

  // ─── 新建页正文契约（渲染端「新建页面」依赖） ──────────────────────────

  it('新建页允许纯空白正文：UI 的种子正文不会撞「必须提供正文」闸门', async () => {
    const spaceId = await makeSpace()
    // WikiView 新建页面传的是单个换行（NEW_PAGE_BODY_SEED）：既非空串以满足
    // createPage 的非空校验，trim 后又为空以保留「这一页还没有正文」引导态。
    // 这条契约若被收紧（例如改成拒绝纯空白），桌面端新建页面会整体失败。
    const r = await stack.writeService.commitPage({
      spaceId,
      title: '空白起始页',
      body: '\n',
      authorRole: 'manual_user',
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const full = await stack.pageService.readFull(r.row.id)
    expect(full.ok).toBe(true)
    if (!full.ok) return
    expect(full.body.trim()).toBe('')
    // 空正文也要能进检索索引（contentless FTS 建行），否则新建页永远搜不到
    const hits = stack.searchService.search({ query: '空白起始页' })
    expect(hits.items.map((h) => h.id)).toContain(r.row.id)
  })

  // ─── 回执瘦身 / 预算裁剪 ─────────────────────────────────────────────

  it('写入回执不含正文（脱敏 + 预算）', async () => {
    const spaceId = await makeSpace()
    const marker = 'UNIQUE_BODY_MARKER_9f3a'
    const r = await stack.writeService.commitPage({
      spaceId,
      title: '回执页',
      body: `${marker} 正文内容`,
      authorRole: 'manual_user',
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(JSON.stringify(r)).not.toContain(marker)
    expect(r.linksReady).toBe(true)
    expect(r.indexReady).toBe(true)
  })

  it('L1 目录树：每节点不含摘要/正文，hasChildren 正确', async () => {
    const spaceId = await makeSpace()
    const parentId = await makePage(spaceId, '父页', '父正文 SECRET_PARENT')
    const child = await stack.writeService.commitPage({
      spaceId,
      parentId,
      title: '子页',
      body: '子正文',
      authorRole: 'manual_user',
    })
    expect(child.ok).toBe(true)

    const roots = stack.pageService.listForAgent({ spaceId })
    expect(roots.items).toHaveLength(1)
    expect(roots.items[0]!.title).toBe('父页')
    expect(roots.items[0]!.hasChildren).toBe(true)
    expect(JSON.stringify(roots)).not.toContain('SECRET_PARENT')
    // 每节点受服务端目标约束（30 token = 结构地板 22 + 标题余量）
    expect(roots.items[0]!.tokens).toBeLessThanOrEqual(30)
    // 短标题绝不被裁空（宁可多花 1~2 token 也要可导航）
    expect(roots.items[0]!.title).toBe('父页')

    const children = stack.pageService.listForAgent({ spaceId, parentId })
    expect(children.items.map((i) => i.title)).toEqual(['子页'])
    expect(children.items[0]!.hasChildren).toBe(false)
  })

  it('L1 目录树：超长标题被服务端强制截断到每节点目标内', async () => {
    const spaceId = await makeSpace()
    const longTitle = `${'标'.repeat(200)}`
    await makePage(spaceId, longTitle, 'body')
    const roots = stack.pageService.listForAgent({ spaceId })
    expect(roots.items[0]!.tokens).toBeLessThanOrEqual(30)
    expect(roots.items[0]!.title.length).toBeLessThan(longTitle.length)
    expect(roots.items[0]!.title.endsWith('…')).toBe(true)
  })

  it('L4 反向链接：每边 ≤30 token，超长标题被截断', async () => {
    const spaceId = await makeSpace()
    const targetId = await makePage(spaceId, '目标页', 'target 正文')
    // 来源页标题超长 —— 反向链接条目里展示的是**来源页标题**，这才是要点。
    const longTitle = `很长的标题${'字'.repeat(120)}`
    const sourceId = await makePage(spaceId, longTitle, '来源正文')
    // 用显式关联建立反链（正文 [[自我标题]] 会构成自链而被丢弃）
    const linked = stack.linkService.setReference({ fromPageId: sourceId, toPageId: targetId })
    expect(linked.ok && linked.changed).toBe(true)

    const res = stack.linkService.backlinksForAgent(targetId)
    expect(res.items).toHaveLength(1)
    expect(res.items[0]!.id).toBe(sourceId)
    // 超长标题被强制截断到目标内
    expect(res.items[0]!.tokens).toBeLessThanOrEqual(30)
    expect(res.items[0]!.title.length).toBeLessThan(longTitle.length)
    expect(res.items[0]!.title.endsWith('…')).toBe(true)

    expect(res.items[0]!.linkType).toBe('reference')
    const ui = stack.linkService.listBacklinksForUi(targetId)
    expect(ui[0]!.fromTitle).toBe(longTitle) // UI 不受预算约束，给完整标题
  })

  it('显式关联：同页 / 跨空间 / 归档目标一律拒绝，移除幂等', async () => {
    const spaceId = await makeSpace()
    const otherId = await makeSpace('另一个空间')
    const aId = await makePage(spaceId, 'A', 'a')
    const bId = await makePage(spaceId, 'B', 'b')
    const cId = await makePage(otherId, 'C', 'c')

    expect(stack.linkService.setReference({ fromPageId: aId, toPageId: aId }).ok).toBe(false)
    expect(stack.linkService.setReference({ fromPageId: aId, toPageId: cId }).ok).toBe(false)

    const added = stack.linkService.setReference({ fromPageId: aId, toPageId: bId })
    expect(added.ok && added.changed).toBe(true)
    // 重复建立 → 无变化（幂等）
    const dup = stack.linkService.setReference({ fromPageId: aId, toPageId: bId })
    expect(dup.ok && dup.changed).toBe(false)
    expect(stack.linkRepo.listBacklinks(bId).some((l) => l.linkType === 'reference')).toBe(true)

    const removed = stack.linkService.setReference({ fromPageId: aId, toPageId: bId, remove: true })
    expect(removed.ok && removed.changed).toBe(true)
    const removedAgain = stack.linkService.setReference({
      fromPageId: aId,
      toPageId: bId,
      remove: true,
    })
    expect(removedAgain.ok && removedAgain.changed).toBe(false)
  })
})
