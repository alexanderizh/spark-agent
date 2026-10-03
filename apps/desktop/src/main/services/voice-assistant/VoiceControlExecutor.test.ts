import { describe, expect, it, vi } from 'vitest'
import { VoiceControlExecutor } from './VoiceControlExecutor.js'
import type { VoiceRouteBinding } from './VoiceRouteBinding.js'

interface Harness {
  executor: VoiceControlExecutor
  binding: {
    defaultSessionId?: string
    defaultWorkspaceId?: string
  }
  workspaces: Array<{ id: string; name: string }>
  recentSessions: Array<{ id: string; title: string }>
  models: { models: string[]; unsupportedReason?: string }
  bindingUpdates: Array<Record<string, unknown>>
  focusEvents: Array<{ sessionId: string; cause: string }>
  modelUpdates: Array<{ sessionId: string; modelId: string }>
}

function createHarness(overrides: Partial<Harness> = {}): Harness {
  const binding: Harness['binding'] = {
    defaultSessionId: 'session-voice-1',
    defaultWorkspaceId: 'ws-1',
    ...overrides.binding,
  }
  const workspaces = overrides.workspaces ?? [
    { id: 'ws-1', name: 'Spark-Agent' },
    { id: 'ws-2', name: '个人项目' },
  ]
  const recentSessions = overrides.recentSessions ?? [
    { id: 'session-voice-1', title: '语音会话' },
    { id: 'session-b', title: '画布功能讨论' },
  ]
  const models = overrides.models ?? {
    models: ['claude-sonnet-4-5', 'gpt-4o-mini'],
  }
  const bindingUpdates: Harness['bindingUpdates'] = []
  const focusEvents: Harness['focusEvents'] = []
  const modelUpdates: Harness['modelUpdates'] = []

  const route = {
    get current() {
      return binding
    },
    updateBinding: (patch: Record<string, unknown>) => {
      bindingUpdates.push(patch)
      Object.assign(binding, patch)
    },
    createNewSession: vi.fn(async () => {
      binding.defaultSessionId = 'session-new-1'
      return { sessionId: 'session-new-1' }
    }),
  } as unknown as VoiceRouteBinding

  const executor = new VoiceControlExecutor({
    route,
    listRecentSessions: async (limit) => recentSessions.slice(0, limit),
    listWorkspaces: async () => workspaces,
    findLatestSessionIdInWorkspace: async (workspaceId) =>
      workspaceId === 'ws-2' ? 'session-in-ws2' : null,
    listSessionModels: async () => models,
    updateSessionModel: async (sessionId, modelId) => {
      modelUpdates.push({ sessionId, modelId })
    },
    emitSessionFocus: (event) => focusEvents.push(event),
  })

  return {
    executor,
    binding,
    workspaces,
    recentSessions,
    models,
    bindingUpdates,
    focusEvents,
    modelUpdates,
  }
}

describe('VoiceControlExecutor', () => {
  it('非语音绑定会话一律拒绝（纵深防御）', async () => {
    const h = createHarness()
    const results = [
      await h.executor.listProjects('other-session'),
      await h.executor.switchProject('other-session', { name: '个人项目' }),
      await h.executor.listSessions('other-session', 20),
      await h.executor.switchSession('other-session', { name: '画布' }),
      await h.executor.newSession('other-session'),
      await h.executor.listModels('other-session'),
      await h.executor.switchModel('other-session', { name: 'gpt' }),
    ]
    expect(results.every((r) => r.ok === false)).toBe(true)
    expect(h.bindingUpdates).toEqual([])
    expect(h.focusEvents).toEqual([])
    expect(h.modelUpdates).toEqual([])
  })

  it('list_projects 标记当前项目', async () => {
    const h = createHarness()
    const result = await h.executor.listProjects('session-voice-1')
    expect(result.ok).toBe(true)
    expect(result.items).toEqual([
      { id: 'ws-1', name: 'Spark-Agent', isCurrent: true },
      { id: 'ws-2', name: '个人项目', isCurrent: false },
    ])
  })

  it('switch_project 命中：有最近会话则改绑续聊并聚焦', async () => {
    const h = createHarness()
    const result = await h.executor.switchProject('session-voice-1', { name: '个人项目' })
    expect(result.ok).toBe(true)
    expect(result.message).toContain('个人项目')
    expect(h.bindingUpdates).toEqual([
      { defaultWorkspaceId: 'ws-2', defaultSessionId: 'session-in-ws2' },
    ])
    expect(h.focusEvents).toEqual([{ sessionId: 'session-in-ws2', cause: 'command-workspace' }])
  })

  it('switch_project 未命中：返回候选供 agent 澄清', async () => {
    const h = createHarness()
    const result = await h.executor.switchProject('session-voice-1', { name: '不存在的' })
    expect(result.ok).toBe(false)
    expect(result.candidates?.length).toBe(2)
    expect(h.bindingUpdates).toEqual([])
  })

  it('switch_project 幂等：目标即当前项目时短路', async () => {
    const h = createHarness()
    const result = await h.executor.switchProject('session-voice-1', { id: 'ws-1' })
    expect(result.ok).toBe(true)
    expect(result.message).toContain('已经在')
    expect(h.bindingUpdates).toEqual([])
  })

  it('switch_session 命中改绑；当前会话短路', async () => {
    const h = createHarness()
    const switched = await h.executor.switchSession('session-voice-1', { name: '画布' })
    expect(switched.ok).toBe(true)
    expect(h.bindingUpdates).toEqual([{ defaultSessionId: 'session-b' }])
    expect(h.focusEvents).toEqual([{ sessionId: 'session-b', cause: 'command-switch' }])

    const same = await h.executor.switchSession('session-b', { id: 'session-b' })
    expect(same.ok).toBe(true)
    expect(same.message).toContain('当前就在')
  })

  it('new_session：创建改绑并聚焦', async () => {
    const h = createHarness()
    const result = await h.executor.newSession('session-voice-1')
    expect(result.ok).toBe(true)
    expect(h.binding.defaultSessionId).toBe('session-new-1')
    expect(h.focusEvents).toEqual([{ sessionId: 'session-new-1', cause: 'command-new' }])
  })

  it('list_models / switch_model：正常渠道', async () => {
    const h = createHarness()
    const listed = await h.executor.listModels('session-voice-1')
    expect(listed.ok).toBe(true)
    expect(listed.items?.length).toBe(2)

    // 精确 id
    const exact = await h.executor.switchModel('session-voice-1', { id: 'gpt-4o-mini' })
    expect(exact.ok).toBe(true)
    // 宽松名称（丢连字符点号的转述）
    const fuzzy = await h.executor.switchModel('session-voice-1', { name: 'claude sonnet 4 5' })
    expect(fuzzy.ok).toBe(true)
    expect(h.modelUpdates).toEqual([
      { sessionId: 'session-voice-1', modelId: 'gpt-4o-mini' },
      { sessionId: 'session-voice-1', modelId: 'claude-sonnet-4-5' },
    ])
  })

  it('list_models 不支持渠道（内置 CLI / 路由）：返回失败说明', async () => {
    const h = createHarness({
      models: { models: [], unsupportedReason: '当前渠道不支持切换模型。' },
    })
    const listed = await h.executor.listModels('session-voice-1')
    expect(listed.ok).toBe(false)
    expect(listed.message).toContain('不支持')
    const switched = await h.executor.switchModel('session-voice-1', { name: 'x' })
    expect(switched.ok).toBe(false)
  })

  it('switch_model 未命中：返回候选', async () => {
    const h = createHarness()
    const result = await h.executor.switchModel('session-voice-1', { name: 'gemini' })
    expect(result.ok).toBe(false)
    expect(result.candidates?.length).toBe(2)
    expect(h.modelUpdates).toEqual([])
  })

  it('list_sessions 标记当前会话并按 limit 截取', async () => {
    const h = createHarness({
      recentSessions: Array.from({ length: 8 }, (_, i) => ({
        id: `s-${i}`,
        title: `会话${i}`,
      })),
    })
    const result = await h.executor.listSessions('session-voice-1', 5)
    // harness 里 defaultSessionId 是 session-voice-1，不在 8 条里 → 全部 isCurrent=false
    expect(result.items?.length).toBe(5)
    expect(result.items?.every((item) => item.isCurrent === false)).toBe(true)
  })
})
