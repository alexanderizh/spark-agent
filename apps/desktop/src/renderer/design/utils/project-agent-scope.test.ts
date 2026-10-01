import { describe, expect, it } from 'vitest'

import type { ManagedAgent, WorkspaceInfo } from '@spark/protocol'

import {
  PLATFORM_DEFAULT_AGENT_ID,
  filterAgentsByProjectScope,
  resolveProjectDefaultAgentId,
} from './project-agent-scope'

function makeAgent(id: string, overrides: Partial<ManagedAgent> = {}): ManagedAgent {
  return {
    id,
    name: `agent-${id}`,
    description: '',
    enabled: true,
    isDefault: false,
    builtIn: false,
    ...overrides,
  } as ManagedAgent
}

const platformAgent = makeAgent(PLATFORM_DEFAULT_AGENT_ID, {
  name: 'Spark助手',
  isDefault: true,
  builtIn: true,
})

describe('filterAgentsByProjectScope', () => {
  const agents = [
    platformAgent,
    makeAgent('a-1'),
    makeAgent('a-2'),
    makeAgent('a-3'),
  ]

  it('未绑定（null）时返回全量列表', () => {
    const ws = { allowedAgentIds: null } as Pick<WorkspaceInfo, 'allowedAgentIds'>
    expect(filterAgentsByProjectScope(agents, ws)).toBe(agents)
  })

  it('空数组视为未绑定，返回全量列表', () => {
    const ws = { allowedAgentIds: [] } as Pick<WorkspaceInfo, 'allowedAgentIds'>
    expect(filterAgentsByProjectScope(agents, ws)).toBe(agents)
  })

  it('workspace 缺失（旧版本主进程）时返回全量列表', () => {
    expect(filterAgentsByProjectScope(agents, null)).toBe(agents)
    expect(filterAgentsByProjectScope(agents, undefined)).toBe(agents)
  })

  it('白名单命中时只保留命中的 Agent（平台默认助手保底补回）', () => {
    const ws = { allowedAgentIds: ['a-1', 'a-3'] } as Pick<WorkspaceInfo, 'allowedAgentIds'>
    const result = filterAgentsByProjectScope(agents, ws)
    expect(result.map((a) => a.id)).toEqual(['a-1', 'a-3', PLATFORM_DEFAULT_AGENT_ID])
  })

  it('白名单不含平台默认助手时自动补回（始终可用）', () => {
    const ws = { allowedAgentIds: ['a-1'] } as Pick<WorkspaceInfo, 'allowedAgentIds'>
    const result = filterAgentsByProjectScope(agents, ws)
    expect(result.map((a) => a.id)).toEqual(['a-1', PLATFORM_DEFAULT_AGENT_ID])
  })

  it('白名单已含平台默认助手时不重复补', () => {
    const ws = { allowedAgentIds: [PLATFORM_DEFAULT_AGENT_ID, 'a-2'] } as Pick<
      WorkspaceInfo,
      'allowedAgentIds'
    >
    const result = filterAgentsByProjectScope(agents, ws)
    expect(result.map((a) => a.id)).toEqual([PLATFORM_DEFAULT_AGENT_ID, 'a-2'])
  })

  it('白名单全部悬空（Agent 已删除）时回退全量列表，不把用户锁死', () => {
    const ws = { allowedAgentIds: ['gone-1', 'gone-2'] } as Pick<WorkspaceInfo, 'allowedAgentIds'>
    expect(filterAgentsByProjectScope(agents, ws)).toBe(agents)
  })

  it('悬空 ID 混杂时只过滤出仍存在的（平台默认助手保底补回）', () => {
    const ws = { allowedAgentIds: ['a-2', 'gone-1'] } as Pick<WorkspaceInfo, 'allowedAgentIds'>
    const result = filterAgentsByProjectScope(agents, ws)
    expect(result.map((a) => a.id)).toEqual(['a-2', PLATFORM_DEFAULT_AGENT_ID])
  })
})

describe('resolveProjectDefaultAgentId', () => {
  const agents = [platformAgent, makeAgent('a-1')]

  it('未设置（null）返回 null', () => {
    const ws = { defaultAgentId: null } as Pick<WorkspaceInfo, 'defaultAgentId'>
    expect(resolveProjectDefaultAgentId(agents, ws)).toBeNull()
  })

  it('workspace 缺失（旧版本主进程）返回 null', () => {
    expect(resolveProjectDefaultAgentId(agents, null)).toBeNull()
  })

  it('悬空 ID（Agent 已删除/禁用）视为未设置', () => {
    const ws = { defaultAgentId: 'gone-1' } as Pick<WorkspaceInfo, 'defaultAgentId'>
    expect(resolveProjectDefaultAgentId(agents, ws)).toBeNull()
  })

  it('内置平台助手可作为项目默认（非 UUID ID 合法）', () => {
    const ws = { defaultAgentId: PLATFORM_DEFAULT_AGENT_ID } as Pick<
      WorkspaceInfo,
      'defaultAgentId'
    >
    expect(resolveProjectDefaultAgentId(agents, ws)).toBe(PLATFORM_DEFAULT_AGENT_ID)
  })

  it('有效 ID 原样返回', () => {
    const ws = { defaultAgentId: 'a-1' } as Pick<WorkspaceInfo, 'defaultAgentId'>
    expect(resolveProjectDefaultAgentId(agents, ws)).toBe('a-1')
  })
})
