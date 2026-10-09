/**
 * wiki-tree-guard 守卫纯函数测试 — 目录树结构合法性。
 *
 * validateWikiMoveTarget 是 UI move / wiki_update / Agent 桥三条写入路径
 * 共用的同一道闸（父节点存在性 / 同空间 / 文件夹约束 / 防环），口径漂移会
 * 直接表现为「UI 拦住了、Agent 却能造出脏层级」，值得单测锁死。
 */

import { describe, expect, it } from 'vitest'
import { isWikiDescendant, validateWikiMoveTarget } from '../../services/wiki/wiki-tree-guard.js'

interface Row {
  id: string
  parent_id: string | null
  space_id: string
  kind?: string
}

function repo(rows: Row[]): { getById(id: string): Row | null } {
  const map = new Map(rows.map((r) => [r.id, r]))
  return { getById: (id) => map.get(id) ?? null }
}

const SPACE = 'wsp_1'

describe('validateWikiMoveTarget', () => {
  const base = {
    repo: repo([
      { id: 'folder_a', parent_id: null, space_id: SPACE, kind: 'folder' },
      { id: 'folder_b', parent_id: 'folder_a', space_id: SPACE, kind: 'folder' },
      { id: 'page_x', parent_id: 'folder_a', space_id: SPACE, kind: 'knowledge' },
      { id: 'page_y', parent_id: 'page_x', space_id: SPACE, kind: 'note' },
      { id: 'foreign', parent_id: null, space_id: 'wsp_other', kind: 'folder' },
    ]),
  }

  it('挂到根（parentId=null）直接通过', () => {
    expect(
      validateWikiMoveTarget({ ...base, pageId: 'page_x', spaceId: SPACE, parentId: null }),
    ).toBeNull()
  })

  it('目标父节点不存在 / 跨空间 → 拒绝', () => {
    expect(
      validateWikiMoveTarget({ ...base, pageId: 'page_x', spaceId: SPACE, parentId: 'nope' }),
    ).toMatch(/父节点不存在/)
    expect(
      validateWikiMoveTarget({ ...base, pageId: 'page_x', spaceId: SPACE, parentId: 'foreign' }),
    ).toMatch(/跨空间/)
  })

  it('父节点必须是文件夹：页面下挂任何节点都拒绝（文件夹/页面同口径）', () => {
    expect(
      validateWikiMoveTarget({ ...base, pageId: 'folder_a', spaceId: SPACE, parentId: 'page_x' }),
    ).toMatch(/只能移动到文件夹下/)
    expect(
      validateWikiMoveTarget({ ...base, pageId: 'page_y', spaceId: SPACE, parentId: 'page_x' }),
    ).toMatch(/只能移动到文件夹下/)
  })

  it('移动到自己下面 / 自己的子树内 → 防环拒绝（目标为合法父节点=文件夹时）', () => {
    expect(
      validateWikiMoveTarget({ ...base, pageId: 'folder_a', spaceId: SPACE, parentId: 'folder_a' }),
    ).toMatch(/自己下面/)
    expect(
      validateWikiMoveTarget({ ...base, pageId: 'folder_a', spaceId: SPACE, parentId: 'folder_b' }),
    ).toMatch(/自己的子节点下/)
  })

  it('文件夹 → 子文件夹的合法移动通过', () => {
    expect(
      validateWikiMoveTarget({ ...base, pageId: 'folder_b', spaceId: SPACE, parentId: 'folder_a' }),
    ).toBeNull()
  })

  it('脏数据 kind 缺失时保持向后兼容（不因旧 repo 类型误拒）', () => {
    const legacyRepo = repo([
      { id: 'parent', parent_id: null, space_id: SPACE },
      { id: 'page_x', parent_id: 'parent', space_id: SPACE },
    ])
    expect(
      validateWikiMoveTarget({
        repo: legacyRepo,
        pageId: 'page_x',
        spaceId: SPACE,
        parentId: 'parent',
      }),
    ).toBeNull()
  })
})

describe('isWikiDescendant', () => {
  const r = repo([
    { id: 'a', parent_id: null, space_id: SPACE, kind: 'folder' },
    { id: 'b', parent_id: 'a', space_id: SPACE, kind: 'folder' },
    { id: 'c', parent_id: 'b', space_id: SPACE },
  ])

  it('c 在 a 子树内，a 不在 c 子树内', () => {
    expect(isWikiDescendant(r, SPACE, 'c', 'a')).toBe(true)
    expect(isWikiDescendant(r, SPACE, 'a', 'c')).toBe(false)
  })

  it('跨空间链 / 断链视为「不是后代」', () => {
    expect(
      isWikiDescendant(
        repo([
          { id: 'x', parent_id: 'a', space_id: 'wsp_other' },
          { id: 'a', parent_id: null, space_id: SPACE },
        ]),
        SPACE,
        'x',
        'a',
      ),
    ).toBe(false)
    expect(isWikiDescendant(r, SPACE, 'ghost', 'a')).toBe(false)
  })
})
