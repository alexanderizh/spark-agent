import { describe, expect, it } from 'vitest'

import {
  assertWorkspaceCreateReservedName,
  assertWorkspaceUpdateReservedName,
  type WorkspaceNameRow,
} from './workspace-reserved-name.js'

function row(overrides: Partial<WorkspaceNameRow> = {}): WorkspaceNameRow {
  return {
    id: 'ws-1',
    name: '我的项目',
    rootPath: '/tmp/projects/my-project',
    ...overrides,
  }
}

const RESERVED = '不使用项目'

describe('assertWorkspaceUpdateReservedName', () => {
  it('allows ordinary renames and non-name patches on regular workspaces', () => {
    const target = row()
    expect(() => assertWorkspaceUpdateReservedName(target, { name: '新名字' })).not.toThrow()
    // name/archived 均缺省的配置类补丁（pinned、agent 配置等）不做守卫
    expect(() => assertWorkspaceUpdateReservedName(target, {})).not.toThrow()
  })

  it('rejects renaming a regular workspace to the reserved name', () => {
    const target = row()
    expect(() => assertWorkspaceUpdateReservedName(target, { name: RESERVED })).toThrow(
      /不能作为项目名/,
    )
  })

  it('rejects renaming or archiving the reserved workspace itself', () => {
    const target = row({ id: 'ws-no-project', name: RESERVED })
    expect(() => assertWorkspaceUpdateReservedName(target, { name: '新名字' })).toThrow(/不能改名/)
    // 空白变体同样破坏精确匹配查找
    expect(() => assertWorkspaceUpdateReservedName(target, { name: ` ${RESERVED}` })).toThrow(
      /不能改名/,
    )
    expect(() => assertWorkspaceUpdateReservedName(target, { archived: true })).toThrow(/不能归档/)
  })

  it('allows a no-op rename to the exact reserved name and unarchiving', () => {
    const target = row({ id: 'ws-no-project', name: RESERVED })
    expect(() =>
      assertWorkspaceUpdateReservedName(target, { name: RESERVED, archived: false }),
    ).not.toThrow()
  })

  it('passes through when the target workspace does not exist', () => {
    expect(() =>
      assertWorkspaceUpdateReservedName(null, { name: RESERVED, archived: true }),
    ).not.toThrow()
  })
})

describe('assertWorkspaceCreateReservedName', () => {
  it('allows ordinary names even when the reserved workspace exists', () => {
    expect(() =>
      assertWorkspaceCreateReservedName({
        rootPath: '/tmp/projects/other',
        createName: '其他项目',
        existingNoProject: row({ name: RESERVED }),
      }),
    ).not.toThrow()
  })

  it('allows the first creation of the reserved workspace', () => {
    expect(() =>
      assertWorkspaceCreateReservedName({
        rootPath: '/tmp/temp/no-project',
        createName: RESERVED,
        existingNoProject: null,
      }),
    ).not.toThrow()
  })

  it('rejects creating a second reserved-name workspace via create.name', () => {
    expect(() =>
      assertWorkspaceCreateReservedName({
        rootPath: '/tmp/projects/dup',
        createName: RESERVED,
        existingNoProject: row({ name: RESERVED, rootPath: '/tmp/temp/no-project' }),
      }),
    ).toThrow(/已存在同名项目/)
  })

  it('allows re-opening the reserved workspace root path (idempotent reuse)', () => {
    expect(() =>
      assertWorkspaceCreateReservedName({
        rootPath: '/tmp/temp/no-project',
        createName: RESERVED,
        existingNoProject: row({ name: RESERVED, rootPath: '/tmp/temp/no-project' }),
      }),
    ).not.toThrow()
  })

  it('rejects when the fallback basename collides with the reserved name', () => {
    expect(() =>
      assertWorkspaceCreateReservedName({
        rootPath: '/tmp/projects/不使用项目',
        createName: undefined,
        existingNoProject: row({ name: RESERVED, rootPath: '/tmp/temp/no-project' }),
      }),
    ).toThrow(/已存在同名项目/)
    // 无同名时（未首建）放行
    expect(() =>
      assertWorkspaceCreateReservedName({
        rootPath: '/tmp/projects/不使用项目',
        createName: undefined,
        existingNoProject: null,
      }),
    ).not.toThrow()
  })
})
