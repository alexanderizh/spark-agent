/**
 * @module wiki-agent-parent-move.e2e.test
 *
 * P1 修复行为锁 —— wiki_update 的 parent_id 三态语义：
 *
 *   1. 缺省 = 不动父节点；null = 移回空间根层；字符串 = 移入该文件夹
 *      （页面 / 文件夹同口径；防环与父合法性由写入服务统一守卫）；
 *   2. mjs 瘦桥文本层：wiki_update 的 null 显式透传；wiki_write 载荷键
 *      camel 对齐 —— snake `parent_id` 曾被平台桥 camel 读取静默丢弃，
 *      MCP 路径「新建页面挂到指定文件夹」从未生效过；
 *   3. 契约与 mjs 两侧 schema 均放宽为 ['string', 'null']。
 *
 * 真实 SQLite + 真实文件系统；HOME 指向临时目录。桥层直调
 * bridgeWikiUpdate（SDK runner 与 wiki_admin 二级入口共用同一 runners
 * map，zod nullable 由 tsc 锁定，不在此重复驱动）。
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { SparkDatabase } from '@spark/storage'
import { SessionService } from '../../services/session.service.js'
import { createWikiServiceStack } from '../../services/wiki/wiki-service-stack.js'

const MCP_SERVER_SRC = path.join(process.cwd(), 'src/tools/spark-wiki-mcp-server.mjs')
const CONTRACT_SRC = path.join(process.cwd(), 'src/tools/wiki-tool-contract.ts')

describe('wiki_update parent_id 三态（P1：null 移回根层）', () => {
  let db: SparkDatabase
  let testDir: string
  let service: SessionService
  let sessionId: string
  let spaceId: string
  /** 顶层文件夹（移动目标） */
  let folderId: string
  /** folderId 下的嵌套文件夹（folder 移回根层用例） */
  let nestedFolderId: string
  /** folderId 下的内容页（null 移回根层主用例） */
  let pageId: string
  /** folderId 下的另一内容页（缺省不动用例） */
  let siblingPageId: string
  let originalHome: string | undefined

  beforeEach(async () => {
    testDir = mkdtempSync(path.join(tmpdir(), 'spark-wiki-parent-move-'))
    originalHome = process.env.HOME
    process.env.HOME = testDir

    db = new SparkDatabase(path.join(testDir, 'test.db'))
    db.runMigrations(path.join(process.cwd(), '..', 'storage', 'migrations'))

    const seed = createWikiServiceStack({ db })
    const space = await seed.writeService.createSpace({
      scope: 'user',
      scopeRef: null,
      name: '个人空间',
    })
    expect(space.ok).toBe(true)
    if (!space.ok) throw new Error(`space create failed: ${space.message}`)
    spaceId = space.row.id

    const folder = await seed.writeService.commitPage({
      spaceId,
      title: '目标文件夹',
      kind: 'folder',
      authorRole: 'manual_user',
    })
    expect(folder.ok).toBe(true)
    if (!folder.ok) throw new Error(`folder create failed: ${folder.message}`)
    folderId = folder.row.id

    const nested = await seed.writeService.commitPage({
      spaceId,
      title: '嵌套文件夹',
      kind: 'folder',
      parentId: folderId,
      authorRole: 'manual_user',
    })
    expect(nested.ok).toBe(true)
    if (!nested.ok) throw new Error(`nested folder create failed: ${nested.message}`)
    nestedFolderId = nested.row.id

    for (const [title, ref] of [
      ['文件夹下的页面', 'main'],
      ['旁边的页面', 'sibling'],
    ] as const) {
      const page = await seed.writeService.commitPage({
        spaceId,
        title,
        body: `${title}的正文。`,
        parentId: folderId,
        authorRole: 'manual_user',
      })
      expect(page.ok).toBe(true)
      if (!page.ok) throw new Error(`page create failed: ${page.message}`)
      if (ref === 'main') pageId = page.row.id
      else siblingPageId = page.row.id
    }

    service = new SessionService(db, () => {})
    sessionId = (await service.createSession({ providerProfileId: 'provider-test' })).sessionId
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

  it('null 移回根层：页面脱离原文件夹，版本 +1', async () => {
    const move = await service.bridgeWikiUpdate({
      sessionId,
      pageId,
      expectedVersion: 1,
      parentId: null,
    })
    expect(move.ok).toBe(true)
    if (move.ok) expect(move.version).toBe(2)

    const root = await service.bridgeWikiList({ sessionId, spaceId })
    expect(root.items.map((n) => n.id)).toContain(pageId)

    const underFolder = await service.bridgeWikiList({ sessionId, spaceId, parentId: folderId })
    expect(underFolder.items.map((n) => n.id)).not.toContain(pageId)
  })

  it('缺省不动：不带 parentId 的更新不改变父节点', async () => {
    // 内容页改标题须带 body（写入服务既有约束）
    const rename = await service.bridgeWikiUpdate({
      sessionId,
      pageId: siblingPageId,
      expectedVersion: 1,
      title: '旁边的页面（改名）',
      body: '改名后的正文。',
    })
    expect(rename.ok).toBe(true)

    const underFolder = await service.bridgeWikiList({ sessionId, spaceId, parentId: folderId })
    expect(underFolder.items.map((n) => n.id)).toContain(siblingPageId)
  })

  it('folder 同口径：嵌套文件夹用 null 移回根层', async () => {
    const move = await service.bridgeWikiUpdate({
      sessionId,
      pageId: nestedFolderId,
      expectedVersion: 1,
      parentId: null,
    })
    expect(move.ok).toBe(true)

    const root = await service.bridgeWikiList({ sessionId, spaceId })
    expect(root.items.map((n) => n.id)).toContain(nestedFolderId)

    const underFolder = await service.bridgeWikiList({ sessionId, spaceId, parentId: folderId })
    expect(underFolder.items.map((n) => n.id)).not.toContain(nestedFolderId)
  })

  it('字符串父 id 仍正常移入（null 修复不回归既有路径）', async () => {
    // 前置：先把 pageId 移回根层（v2），再移入文件夹
    const toRoot = await service.bridgeWikiUpdate({
      sessionId,
      pageId,
      expectedVersion: 1,
      parentId: null,
    })
    expect(toRoot.ok).toBe(true)

    const intoFolder = await service.bridgeWikiUpdate({
      sessionId,
      pageId,
      expectedVersion: 2,
      parentId: folderId,
    })
    expect(intoFolder.ok).toBe(true)
    if (intoFolder.ok) expect(intoFolder.version).toBe(3)

    const underFolder = await service.bridgeWikiList({ sessionId, spaceId, parentId: folderId })
    expect(underFolder.items.map((n) => n.id)).toContain(pageId)
  })
})

describe('parent_id 修复的 mjs / 契约文本层（静态断言）', () => {
  it('wiki_update IMPL：null 显式透传（不被 optionalStr 吞成缺省）', () => {
    const src = readFileSync(MCP_SERVER_SRC, 'utf8')
    expect(src).toContain('args.parent_id === null')
    // 载荷键对齐 camel：平台桥 handler 读 params.parentId
    expect(src).toContain('{ parentId: args.parent_id }')
  })

  it('wiki_write 载荷键 camel 对齐：不再发 snake parent_id（曾被平台桥静默丢弃）', () => {
    const src = readFileSync(MCP_SERVER_SRC, 'utf8')
    expect(src).not.toContain('{ parent_id: args.parent_id }')
  })

  it('契约与 mjs 两侧 schema 均放宽为 [string, null]', () => {
    const contract = readFileSync(CONTRACT_SRC, 'utf8')
    const mjs = readFileSync(MCP_SERVER_SRC, 'utf8')
    expect(contract).toContain("type: ['string', 'null']")
    expect(mjs).toContain("type: ['string', 'null']")
  })
})
