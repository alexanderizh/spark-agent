/**
 * WikiPageTree 排序纯函数测试 — 置顶段 / 排序方式 / 旧数据兜底。
 *
 * 这些函数决定目录树「看到什么顺序」，拖拽落点的同级重编号（WikiView
 * orderGroup）也复用同一把尺——排序口径漂移会直接表现为「拖到 A 前面却
 * 落在 A 后面」，值得单测锁死。
 */

import { describe, expect, it } from 'vitest'
import type { WikiPageMeta } from '@spark/protocol'
import { buildWikiTree, sortWikiNodes } from './WikiPageTree'

let seq = 0

function meta(overrides: Partial<WikiPageMeta>): WikiPageMeta {
  seq += 1
  return {
    id: `wp_t${seq.toString().padStart(4, '0')}`,
    spaceId: 'wsp_test',
    parentId: null,
    kind: 'knowledge',
    title: `页面${seq}`,
    slug: `p-${seq}`,
    summary: '',
    tags: [],
    status: 'published',
    version: 1,
    sortOrder: 0,
    pinned: false,
    sourceType: 'manual',
    authorRole: 'manual_user',
    hitCount: 0,
    createdAt: seq,
    updatedAt: seq,
    ...overrides,
  }
}

describe('sortWikiNodes（目录树同级排序）', () => {
  it('置顶段恒在最前，无论哪种排序方式（与会话侧栏同口径）', () => {
    // seq 递增：createdAt/updatedAt = A(1) < B(2) < C(3)
    const nodes = buildWikiTree([
      meta({ title: 'A', sortOrder: 0 }),
      meta({ title: 'B', sortOrder: 1 }),
      meta({ title: 'C', sortOrder: 2, pinned: true }),
    ])
    // manual / title：未置顶段 A、B 升序；updated：C 最新且置顶，B 次之
    expect(sortWikiNodes(nodes, 'manual').map((n) => n.page.title)).toEqual(['C', 'A', 'B'])
    expect(sortWikiNodes(nodes, 'title').map((n) => n.page.title)).toEqual(['C', 'A', 'B'])
    expect(sortWikiNodes(nodes, 'updated').map((n) => n.page.title)).toEqual(['C', 'B', 'A'])
  })

  it('manual：sort_order 优先，旧数据全 0 时按 created_at 兜底', () => {
    const nodes = buildWikiTree([
      meta({ title: '晚建', sortOrder: 0, createdAt: 30 }),
      meta({ title: '早建', sortOrder: 0, createdAt: 10 }),
      meta({ title: '置顶位', sortOrder: 9, createdAt: 20, pinned: true }),
    ])
    const titles = sortWikiNodes(nodes, 'manual').map((n) => n.page.title)
    // 置顶段在前；未置顶段 sortOrder 同为 0 → created_at 升序（服务端 ORDER BY 同口径）
    expect(titles).toEqual(['置顶位', '早建', '晚建'])
  })

  it('title：未置顶段按标题本地化排序（zh collation 为拼音序）', () => {
    const nodes = buildWikiTree([
      meta({ title: '乙', sortOrder: 0 }),
      meta({ title: '甲', sortOrder: 1 }),
      meta({ title: '丙', sortOrder: 2 }),
    ])
    const titles = sortWikiNodes(nodes, 'title').map((n) => n.page.title)
    // zh-Hans-CN 整理按拼音：丙(bǐng) < 甲(jiǎ) < 乙(yǐ)，不是 Unicode 码点序
    expect(titles).toEqual(['丙', '甲', '乙'])
  })

  it('updated：未置顶段按 updatedAt 倒序（最近动的在前）', () => {
    const nodes = buildWikiTree([
      meta({ title: '旧', sortOrder: 0, updatedAt: 10 }),
      meta({ title: '新', sortOrder: 1, updatedAt: 99 }),
    ])
    const titles = sortWikiNodes(nodes, 'updated').map((n) => n.page.title)
    expect(titles).toEqual(['新', '旧'])
  })

  it('子层级递归排序（置顶的子页在其兄弟段内也浮到最前）', () => {
    const parent = meta({ title: '父' })
    const child1 = meta({ title: '子A', parentId: parent.id, sortOrder: 0 })
    const child2 = meta({ title: '子B', parentId: parent.id, sortOrder: 1, pinned: true })
    const nodes = buildWikiTree([parent, child1, child2])
    const sorted = sortWikiNodes(nodes, 'manual')
    const [first, ...rest] = sorted
    expect(first?.page.title).toBe('父')
    expect(rest).toHaveLength(0)
    expect((first?.children ?? []).map((c) => c.page.title)).toEqual(['子B', '子A'])
  })
})
