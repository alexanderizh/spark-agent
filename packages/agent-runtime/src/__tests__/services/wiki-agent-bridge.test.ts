/**
 * @module wiki-agent-bridge.test
 *
 * Agent wiki 桥（bridgeWiki*）的 P0 修复行为锁：
 *
 *   1. **Repo Wiki 空间对 Agent 可见** —— repo 扫描建的空间是 project/NULL
 *      （触发时无会话上下文）。scope 集合并入 project/NULL 后，
 *      无 workspace 与有 workspace 的会话都必须能看到它；
 *   2. **路径身份一致** —— 会话栈带着 workspaceRootPath 时，project/NULL
 *      空间的正文仍必须解析到 home 侧 project-orphan（与 UI 路径一致），
 *      否则可见性修复只会把「看不见」变成「读不到正文」；
 *   3. **CAS 版本链** —— wiki_read 透出 version；update 失配回执透出
 *      currentVersion，Agent 不必重读全文即可重试；
 *   4. **越权防线不回归** —— 并入 project/NULL 不得把其他 workspace 的
 *      project 空间一并打穿。
 *
 * 真实 SQLite + 真实文件系统；HOME 指向临时目录，避免污染 ~/.spark-agent。
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { SparkDatabase, WorkspaceRepository } from '@spark/storage'
import { SessionService } from '../../services/session.service.js'
import { createWikiServiceStack } from '../../services/wiki/wiki-service-stack.js'
import { WIKI_ITEM_TOKEN_TARGETS } from '../../services/wiki/wiki-context-budget.js'

describe('Agent wiki 桥（repo 空间可见 / CAS 版本链）', () => {
  let db: SparkDatabase
  let testDir: string
  let service: SessionService
  let repoSpaceId: string
  let foreignSpaceId: string
  /** user 空间 id（列表所有权标记的普通空间对照） */
  let userSpaceId: string
  let pageId: string
  /** repo 空间内 source_type='repo-scan' 的生成态内容页（守卫/感知主用例） */
  let generatedPageId: string
  /** repo 空间内生成态 folder（守卫粒度：folder 改名放行） */
  let generatedFolderId: string
  /** repo 空间内 source_type='repo-scan-ignored' 的忽略态页 */
  let ignoredPageId: string
  /** user 空间的普通页面（set_ownership 应拒绝：非 repo 空间） */
  let userSpacePageId: string
  /** 其他 workspace 空间的页面（越权对照） */
  let foreignPageId: string
  let noWorkspaceSessionId: string
  let workspaceSessionId: string
  let originalHome: string | undefined

  beforeEach(async () => {
    testDir = mkdtempSync(path.join(tmpdir(), 'spark-wiki-agent-bridge-'))
    // SessionService 的 WikiStoreService 用 os.homedir()（无 appHomeDir 注入时）
    // 解析 project-orphan 路径；测试里把 HOME 指到临时目录，种子栈与桥栈
    // 两个装配实例才会落在同一份文件上。
    originalHome = process.env.HOME
    process.env.HOME = testDir

    db = new SparkDatabase(path.join(testDir, 'test.db'))
    db.runMigrations(path.join(process.cwd(), '..', 'storage', 'migrations'))

    // 种子数据用 UI 同款装配（无 workspaceRootPath → project/NULL 落 project-orphan）
    const seed = createWikiServiceStack({ db })
    const space = await seed.writeService.createSpace({
      scope: 'project',
      scopeRef: null,
      spaceType: 'repo',
      name: 'Spark-Agent 仓库',
      repoPath: path.join(testDir, 'fake-repo'),
    })
    expect(space.ok).toBe(true)
    if (!space.ok) throw new Error(`repo space create failed: ${space.message}`)
    repoSpaceId = space.row.id

    const page = await seed.writeService.commitPage({
      spaceId: repoSpaceId,
      title: 'src 模块',
      body: 'src 目录的骨架说明。',
      authorRole: 'manual_user',
    })
    expect(page.ok).toBe(true)
    if (!page.ok) throw new Error(`repo page create failed: ${page.message}`)
    pageId = page.row.id

    // 越权对照组：别的 workspace 的 project 空间（不该被 project/NULL 并入打穿）
    const foreign = await seed.writeService.createSpace({
      scope: 'project',
      scopeRef: 'ws-other',
      name: '别的项目的空间',
    })
    expect(foreign.ok).toBe(true)
    if (!foreign.ok) throw new Error(`foreign space create failed: ${foreign.message}`)
    foreignSpaceId = foreign.row.id

    // 所有权三态种子：生成态内容页 / 生成态 folder / 忽略态页（scan 同款标记）
    const generatedPage = await seed.writeService.commitPage({
      spaceId: repoSpaceId,
      title: 'repo 生成页',
      body: '扫描生成的骨架内容。',
      authorRole: 'import',
      sourceType: 'repo-scan',
    })
    expect(generatedPage.ok).toBe(true)
    if (!generatedPage.ok) throw new Error(`generated page create failed: ${generatedPage.message}`)
    generatedPageId = generatedPage.row.id

    const generatedFolder = await seed.writeService.commitPage({
      spaceId: repoSpaceId,
      title: 'repo 目录',
      kind: 'folder',
      authorRole: 'import',
      sourceType: 'repo-scan',
    })
    expect(generatedFolder.ok).toBe(true)
    if (!generatedFolder.ok) {
      throw new Error(`generated folder create failed: ${generatedFolder.message}`)
    }
    generatedFolderId = generatedFolder.row.id

    const ignoredPage = await seed.writeService.commitPage({
      spaceId: repoSpaceId,
      title: 'repo 忽略页',
      body: '被忽略的页面。',
      authorRole: 'import',
      sourceType: 'repo-scan-ignored',
    })
    expect(ignoredPage.ok).toBe(true)
    if (!ignoredPage.ok) throw new Error(`ignored page create failed: ${ignoredPage.message}`)
    ignoredPageId = ignoredPage.row.id

    // 普通空间对照组：user 空间的页面没有"重建覆写"语义
    const userSpace = await seed.writeService.createSpace({
      scope: 'user',
      scopeRef: null,
      name: '个人空间',
    })
    expect(userSpace.ok).toBe(true)
    if (!userSpace.ok) throw new Error(`user space create failed: ${userSpace.message}`)
    userSpaceId = userSpace.row.id
    const userPage = await seed.writeService.commitPage({
      spaceId: userSpace.row.id,
      title: '个人笔记',
      body: '普通页面。',
      authorRole: 'manual_user',
    })
    expect(userPage.ok).toBe(true)
    if (!userPage.ok) throw new Error(`user page create failed: ${userPage.message}`)
    userSpacePageId = userPage.row.id

    const foreignPage = await seed.writeService.commitPage({
      spaceId: foreignSpaceId,
      title: '别的项目的页',
      body: '越权对照页。',
      authorRole: 'manual_user',
    })
    expect(foreignPage.ok).toBe(true)
    if (!foreignPage.ok) throw new Error(`foreign page create failed: ${foreignPage.message}`)
    foreignPageId = foreignPage.row.id

    service = new SessionService(db, () => {})
    noWorkspaceSessionId = (await service.createSession({ providerProfileId: 'provider-test' }))
      .sessionId

    new WorkspaceRepository(db).create({
      id: 'ws-1',
      name: '项目A',
      rootPath: path.join(testDir, 'ws1-root'),
    })
    workspaceSessionId = (
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

  it('repo 空间（project/NULL）对无 workspace 会话可见', async () => {
    const { items } = await service.bridgeWikiListSpaces({ sessionId: noWorkspaceSessionId })
    expect(items.map((s) => s.id)).toContain(repoSpaceId)
  })

  it('repo 空间对有 workspace 会话可见，且检索可命中', async () => {
    const { items } = await service.bridgeWikiListSpaces({ sessionId: workspaceSessionId })
    expect(items.map((s) => s.id)).toContain(repoSpaceId)

    const search = await service.bridgeWikiSearch({
      sessionId: workspaceSessionId,
      query: '骨架',
    })
    expect('items' in search).toBe(true)
    if ('items' in search) {
      expect(search.items.map((h) => h.id)).toContain(pageId)
    }
  })

  it('repo 空间正文路径跨装配一致：会话栈带 workspaceRootPath 也能读到 UI 写入的正文', async () => {
    // 修复前：workspace 会话栈把 project/NULL 解析到 <ws1-root>/.spark-agent/wiki/
    // → 与 UI 写入的 home 侧 project-orphan 指向两个文件 → 「正文文件缺失」
    const read = await service.bridgeWikiRead({
      sessionId: workspaceSessionId,
      pageId,
    })
    expect('error' in read && read.error != null).toBe(false)
    if (!('error' in read)) {
      expect(read.version).toBe(1)
      expect(read.body).toContain('src 目录的骨架说明')
    }

    const readNoWorkspace = await service.bridgeWikiRead({
      sessionId: noWorkspaceSessionId,
      pageId,
    })
    expect('error' in readNoWorkspace && readNoWorkspace.error != null).toBe(false)
  })

  it('CAS 版本链：read 透出 version，update 失配回执透出 currentVersion', async () => {
    // 先把页面推到 v2（模拟并发修改）
    const seed = createWikiServiceStack({ db })
    const bump = await seed.writeService.commitPage({
      pageId,
      expectedVersion: 1,
      body: 'v2 的正文。',
      authorRole: 'manual_user',
    })
    expect(bump.ok).toBe(true)

    // 陈旧版本号更新 → 结构化失败 + 当前版本
    const stale = await service.bridgeWikiUpdate({
      sessionId: workspaceSessionId,
      pageId,
      expectedVersion: 1,
      body: '过时的改动',
    })
    expect(stale.ok).toBe(false)
    expect(stale.currentVersion).toBe(2)

    // 以回执的 currentVersion 重试 → 成功
    const retry = await service.bridgeWikiUpdate({
      sessionId: workspaceSessionId,
      pageId,
      expectedVersion: stale.currentVersion ?? 0,
      body: '以回传版本重试的改动',
    })
    expect(retry.ok).toBe(true)
    if (retry.ok) expect(retry.version).toBe(3)
  })

  it('越权防线不回归：其他 workspace 的 project 空间仍不可见不可写', async () => {
    const { items } = await service.bridgeWikiListSpaces({ sessionId: workspaceSessionId })
    expect(items.map((s) => s.id)).not.toContain(foreignSpaceId)
    // list 返回空集而非报错（不探测、不泄漏空间存在性）
    const list = await service.bridgeWikiList({
      sessionId: workspaceSessionId,
      spaceId: foreignSpaceId,
    })
    expect(list).toEqual({ items: [], total: 0, truncated: false })

    const write = await service.bridgeWikiWrite({
      sessionId: workspaceSessionId,
      spaceId: foreignSpaceId,
      title: '越权写入',
      body: 'x',
    })
    expect(write.ok).toBe(false)
  })

  // ── P0-3 所有权隔离：感知 + 设置 + 生成页守卫 ────────────────────────────

  it('read 透出 repoOwnership：生成页/忽略页有标记，普通页与人工接管页无威胁标记', async () => {
    const generated = await service.bridgeWikiRead({
      sessionId: workspaceSessionId,
      pageId: generatedPageId,
    })
    expect('error' in generated && generated.error != null).toBe(false)
    if (!('error' in generated)) expect(generated.repoOwnership).toBe('generated')

    const ignored = await service.bridgeWikiRead({
      sessionId: workspaceSessionId,
      pageId: ignoredPageId,
    })
    if (!('error' in ignored)) expect(ignored.repoOwnership).toBe('ignored')

    // repo 空间内人工建页（source_type='manual'）：重建本就跳过，不该标"生成态"威胁
    const manual = await service.bridgeWikiRead({ sessionId: workspaceSessionId, pageId })
    if (!('error' in manual)) expect(manual.repoOwnership).toBeUndefined()

    // 普通空间页面没有 repo 语义
    const userPage = await service.bridgeWikiRead({
      sessionId: workspaceSessionId,
      pageId: userSpacePageId,
    })
    if (!('error' in userPage)) expect(userPage.repoOwnership).toBeUndefined()
  })

  it('生成页内容更新守卫：拒绝并指引接管；接管后同一更新放行', async () => {
    const blocked = await service.bridgeWikiUpdate({
      sessionId: workspaceSessionId,
      pageId: generatedPageId,
      expectedVersion: 1,
      body: '想直接改生成页',
    })
    expect(blocked.ok).toBe(false)
    expect(blocked.error).toContain('wiki_set_ownership')
    expect(blocked.error).toContain(generatedPageId)

    // 接管 → 回执带接管后的新版本（元数据 patch 也推版本），
    // 以它为 expected_version 的更新必须一次成功（CAS 链与所有权链闭环）
    const claim = await service.bridgeWikiSetOwnership({
      sessionId: workspaceSessionId,
      pageId: generatedPageId,
      ownership: 'manual',
    })
    expect(claim.ok).toBe(true)
    expect(claim.note).toContain('人工接管')
    expect(claim.version).toBe(2)

    const allowed = await service.bridgeWikiUpdate({
      sessionId: workspaceSessionId,
      pageId: generatedPageId,
      expectedVersion: claim.version ?? 0,
      body: '接管后的修改',
    })
    expect(allowed.ok).toBe(true)
  })

  it('守卫粒度与 rebuild 覆写面对齐：folder 改名 / 纯移动 / 纯标签放行', async () => {
    // rebuild 对已存在 folder 只复用不覆写标题 → folder 改名不该被守卫拦
    const folderRename = await service.bridgeWikiUpdate({
      sessionId: workspaceSessionId,
      pageId: generatedFolderId,
      expectedVersion: 1,
      title: 'repo 目录（改名）',
    })
    expect(folderRename.ok).toBe(true)

    // rebuild 从不改 parentId → 纯移动放行
    const move = await service.bridgeWikiUpdate({
      sessionId: workspaceSessionId,
      pageId: generatedPageId,
      expectedVersion: 1,
      parentId: generatedFolderId,
    })
    expect(move.ok).toBe(true)

    // rebuild 不动 tags → 纯标签更新放行
    const tags = await service.bridgeWikiUpdate({
      sessionId: workspaceSessionId,
      pageId: generatedPageId,
      expectedVersion: 2,
      tags: ['repo', 'scan'],
    })
    expect(tags.ok).toBe(true)
  })

  it('set_ownership 语义回执：ignored 跳过重建，回归 generated 警告覆写', async () => {
    const ignore = await service.bridgeWikiSetOwnership({
      sessionId: workspaceSessionId,
      pageId: ignoredPageId,
      ownership: 'ignored',
    })
    expect(ignore.ok).toBe(true)
    expect(ignore.note).toContain('忽略')

    // 忽略态页不挡内容更新（rebuild 跳过它，改了也不会被覆写）
    const editIgnored = await service.bridgeWikiUpdate({
      sessionId: workspaceSessionId,
      pageId: ignoredPageId,
      expectedVersion: 1,
      body: '忽略态下自由编辑',
    })
    expect(editIgnored.ok).toBe(true)

    // 回归生成态：回执必须明确警告覆写（这是唯一有数据损失风险的切换）
    const regress = await service.bridgeWikiSetOwnership({
      sessionId: workspaceSessionId,
      pageId: ignoredPageId,
      ownership: 'generated',
    })
    expect(regress.ok).toBe(true)
    expect(regress.note).toContain('覆写')
  })

  it('set_ownership 边界：非 repo 空间页面拒绝，越权页面拒绝', async () => {
    const notRepo = await service.bridgeWikiSetOwnership({
      sessionId: workspaceSessionId,
      pageId: userSpacePageId,
      ownership: 'manual',
    })
    expect(notRepo.ok).toBe(false)
    expect(notRepo.error).toContain('Repo Wiki')

    const foreignPage = await service.bridgeWikiSetOwnership({
      sessionId: workspaceSessionId,
      pageId: foreignPageId,
      ownership: 'manual',
    })
    expect(foreignPage.ok).toBe(false)
    expect(foreignPage.error).toContain('可见范围')
  })

  // ── P1 生成页删除/归档守卫：行消失会让 rebuild 走新建分支复活 ────────────

  it('删除/归档守卫：repo 三态页全拦并指引 ignored，页面原样保留', async () => {
    // 生成态：delete 与 archive 都拒绝，指引带 pageId 可直接照抄
    const del = await service.bridgeWikiDelete({
      sessionId: workspaceSessionId,
      pageId: generatedPageId,
    })
    expect(del.ok).toBe(false)
    expect(del.error).toContain('wiki_set_ownership')
    expect(del.error).toContain(generatedPageId)

    const arc = await service.bridgeWikiArchive({
      sessionId: workspaceSessionId,
      pageId: generatedPageId,
    })
    expect(arc.ok).toBe(false)
    expect(arc.error).toContain('归档')

    // manual / ignored 同样拦截：删除丢身份、归档卡行且复活
    await service.bridgeWikiSetOwnership({
      sessionId: workspaceSessionId,
      pageId: generatedPageId,
      ownership: 'manual',
    })
    const delManual = await service.bridgeWikiDelete({
      sessionId: workspaceSessionId,
      pageId: generatedPageId,
    })
    expect(delManual.ok).toBe(false)

    const delIgnored = await service.bridgeWikiDelete({
      sessionId: workspaceSessionId,
      pageId: ignoredPageId,
    })
    expect(delIgnored.ok).toBe(false)
    const arcIgnored = await service.bridgeWikiArchive({
      sessionId: workspaceSessionId,
      pageId: ignoredPageId,
    })
    expect(arcIgnored.ok).toBe(false)

    // 生成态 folder 容器删了 rebuild 同样会重建 → 拦
    const delFolder = await service.bridgeWikiDelete({
      sessionId: workspaceSessionId,
      pageId: generatedFolderId,
    })
    expect(delFolder.ok).toBe(false)

    // 拒绝必须无副作用：页面原样可读
    const still = await service.bridgeWikiRead({
      sessionId: workspaceSessionId,
      pageId: generatedPageId,
    })
    expect('error' in still && still.error != null).toBe(false)
  })

  it('守卫按所有权标记而非空间判定：无标记页与普通空间页放行', async () => {
    // repo 空间里 source_type 为空的页（扫描前手工建的）不受守卫影响
    const delUnmarked = await service.bridgeWikiDelete({
      sessionId: workspaceSessionId,
      pageId,
    })
    expect(delUnmarked.ok).toBe(true)

    // 普通空间页面归档/还原照常
    const arc = await service.bridgeWikiArchive({
      sessionId: workspaceSessionId,
      pageId: userSpacePageId,
    })
    expect(arc.ok).toBe(true)
    const restore = await service.bridgeWikiRestore({
      sessionId: workspaceSessionId,
      pageId: userSpacePageId,
    })
    expect(restore.ok).toBe(true)
  })

  // ── P1 感知补全：列表节点级所有权标记 + read 附带 AI 导读 ────────────────

  it('wiki_list 节点级所有权标记：repo 三态有标记，普通页与普通空间零标记', async () => {
    const list = await service.bridgeWikiList({
      sessionId: workspaceSessionId,
      spaceId: repoSpaceId,
    })
    const byId = new Map(list.items.map((i) => [i.id, i]))
    expect(byId.get(generatedPageId)?.repoOwnership).toBe('generated')
    expect(byId.get(ignoredPageId)?.repoOwnership).toBe('ignored')
    // folder 容器同样带标记（导航层即可辨哪些目录会被重建）
    expect(byId.get(generatedFolderId)?.repoOwnership).toBe('generated')
    // repo 空间内无扫描标记的手工页：零标记
    expect(byId.get(pageId)?.repoOwnership).toBeUndefined()

    // 普通空间全树零标记（repoOwnershipFromSourceType 对非 repo 源返回 null）
    const userList = await service.bridgeWikiList({
      sessionId: workspaceSessionId,
      spaceId: userSpaceId,
    })
    expect(userList.items.length).toBeGreaterThan(0)
    expect(userList.items.every((i) => i.repoOwnership === undefined)).toBe(true)

    // 计量诚实：所有权字段纳入载荷后，节点成本仍受 listNode 目标约束
    expect(list.items.every((i) => i.tokens <= WIKI_ITEM_TOKEN_TARGETS.listNode)).toBe(true)
  })

  it('wiki_list 长标题 repo 页按 listNode 目标截断（所有权字段不挤爆节点预算）', async () => {
    const seed = createWikiServiceStack({ db })
    const long = await seed.writeService.commitPage({
      spaceId: repoSpaceId,
      title: '超长标题模块页'.repeat(12),
      body: 'x',
      authorRole: 'import',
      sourceType: 'repo-scan',
    })
    expect(long.ok).toBe(true)

    const list = await service.bridgeWikiList({
      sessionId: workspaceSessionId,
      spaceId: repoSpaceId,
    })
    const item = list.items.find((i) => i.id === (long.ok ? long.row.id : ''))
    expect(item).toBeDefined()
    if (item != null) {
      expect(item.tokens).toBeLessThanOrEqual(WIKI_ITEM_TOKEN_TARGETS.listNode)
      expect(item.title.endsWith('…')).toBe(true)
      expect(item.repoOwnership).toBe('generated')
    }
  })

  it('wiki_read 首页附带 AI 导读：生成态 + rev 命中 + ready 段 + 预算内', async () => {
    const seed = createWikiServiceStack({ db })
    seed.spaceRepo.update(repoSpaceId, { repo_rev: 'rev-abc123' })
    const slug = seed.pageRepo.getById(generatedPageId)?.slug
    expect(slug).toBeDefined()
    seed.repoEnrichRepo.upsert({
      spaceId: repoSpaceId,
      slug: slug as string,
      repoRev: 'rev-abc123',
      section: '## 模块职责\n该模块负责会话与消息管理。\n## 关键入口\n- createSession',
      status: 'ready',
      model: 'test-model',
      provider: 'test',
    })

    const read = await service.bridgeWikiRead({
      sessionId: workspaceSessionId,
      pageId: generatedPageId,
    })
    expect('error' in read && read.error != null).toBe(false)
    if (!('error' in read)) {
      expect(read.repoEnrich).toBeDefined()
      expect(read.repoEnrich?.repoRev).toBe('rev-abc123')
      expect(read.repoEnrich?.section).toContain('模块职责')
      // 导读是附加而非替换：正文骨架原样在场
      expect(read.body).toContain('扫描生成的骨架内容')
    }
  })

  it('wiki_read 导读闸门不误拦合法中文段：o200k 对中文 ≈1 token/字符（校验上限 1500 字符内的密集段必须附上）', async () => {
    const seed = createWikiServiceStack({ db })
    seed.spaceRepo.update(repoSpaceId, { repo_rev: 'rev-zh' })
    const slug = seed.pageRepo.getById(generatedPageId)?.slug as string
    // 1400 字符纯中文 = 1400 token：按「2 字符/token」旧口径会误判为异常肥段而丢弃
    seed.repoEnrichRepo.upsert({
      spaceId: repoSpaceId,
      slug,
      repoRev: 'rev-zh',
      section: '模'.repeat(1400),
      status: 'ready',
    })

    const read = await service.bridgeWikiRead({
      sessionId: workspaceSessionId,
      pageId: generatedPageId,
    })
    expect('error' in read && read.error != null).toBe(false)
    if (!('error' in read)) {
      expect(read.repoEnrich).toBeDefined()
      expect(read.repoEnrich?.section.length).toBe(1400)
    }
  })

  it('wiki_read 导读五重闸门：任一不满足即零痕迹', async () => {
    const seed = createWikiServiceStack({ db })
    seed.spaceRepo.update(repoSpaceId, { repo_rev: 'rev-now' })
    const slug = seed.pageRepo.getById(generatedPageId)?.slug as string

    // 闸门①：续读（offset>0）不重复附——先放好命中的段再带 offset 读
    seed.repoEnrichRepo.upsert({
      spaceId: repoSpaceId,
      slug,
      repoRev: 'rev-now',
      section: '## 模块职责\n首屏导读。',
      status: 'ready',
    })
    const continuation = await service.bridgeWikiRead({
      sessionId: workspaceSessionId,
      pageId: generatedPageId,
      offset: 1,
    })
    expect('error' in continuation && continuation.error != null).toBe(false)
    if (!('error' in continuation)) {
      expect(continuation.repoEnrich).toBeUndefined()
    }

    // 闸门②：人工接管页不附（与渲染端「人工维护页零痕迹」镜像）
    await service.bridgeWikiSetOwnership({
      sessionId: workspaceSessionId,
      pageId: generatedPageId,
      ownership: 'manual',
    })
    const manualRead = await service.bridgeWikiRead({
      sessionId: workspaceSessionId,
      pageId: generatedPageId,
    })
    if (!('error' in manualRead)) {
      expect(manualRead.repoEnrich).toBeUndefined()
    }
    // 还原生成态，继续验证其余闸门
    await service.bridgeWikiSetOwnership({
      sessionId: workspaceSessionId,
      pageId: generatedPageId,
      ownership: 'generated',
    })

    // 闸门③：rev 失配（缓存停在旧 rev，空间已前进）不附
    seed.spaceRepo.update(repoSpaceId, { repo_rev: 'rev-newer' })
    const revMiss = await service.bridgeWikiRead({
      sessionId: workspaceSessionId,
      pageId: generatedPageId,
    })
    if (!('error' in revMiss)) expect(revMiss.repoEnrich).toBeUndefined()

    // 闸门④：status='failed' 的行不附（当前 rev 命中但段为空）
    seed.repoEnrichRepo.upsert({
      spaceId: repoSpaceId,
      slug,
      repoRev: 'rev-newer',
      section: '',
      status: 'failed',
      error: 'no_provider',
    })
    const failedRead = await service.bridgeWikiRead({
      sessionId: workspaceSessionId,
      pageId: generatedPageId,
    })
    if (!('error' in failedRead)) expect(failedRead.repoEnrich).toBeUndefined()

    // 闸门⑤：异常肥段（> 800 token）不附——宁可没有也不能撑爆读取预算
    seed.repoEnrichRepo.upsert({
      spaceId: repoSpaceId,
      slug,
      repoRev: 'rev-newer',
      section: '长'.repeat(2400),
      status: 'ready',
    })
    const fatRead = await service.bridgeWikiRead({
      sessionId: workspaceSessionId,
      pageId: generatedPageId,
    })
    if (!('error' in fatRead)) expect(fatRead.repoEnrich).toBeUndefined()
  })
})
