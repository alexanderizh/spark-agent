/**
 * 移动桥接侧栏同步端点（项目置顶 / 侧栏手动排序 / 会话标记）的聚焦测试。
 *
 * 覆盖：路由命中、请求体白名单校验、SparkError → HTTP 状态码映射、
 * 写成功后的 notifySidebarChanged 广播（桌面端侧栏实时回流）。
 * 通过公开入口 invokeRelay 驱动（与中继同一路径），不触碰私有路由方法。
 */
import { describe, expect, it, vi } from 'vitest'
import { SparkError } from '@spark/shared'
import { MobileBridgeService, type MobileBridgeDeps } from './MobileBridgeService.js'
import type { SidebarOrderState } from '@spark/protocol'

const ORDER_STATE: SidebarOrderState = {
  projectIds: ['p1', 'p2'],
  sessionIdsByProject: { p1: ['s1'] },
  pinnedSessionIdsByProject: { p1: ['s2'] },
}

function buildService(overrides: Partial<MobileBridgeDeps> = {}): {
  service: MobileBridgeService
  deps: MobileBridgeDeps
  notify: ReturnType<typeof vi.fn>
} {
  const notify = vi.fn()
  // 测试桩只覆盖本文件测的端点；其余 deps（含其他特性并行新增的必填项）
  // 用整体断言跳过逐字补齐，避免接口每次扩张都要改这里。
  const deps = {
    listProjects: vi.fn(async () => ({ projects: [], total: 0 })),
    listSessions: vi.fn(async () => ({ sessions: [], total: 0 })),
    createSession: vi.fn(async () => {
      throw new Error('not used')
    }),
    updateSession: vi.fn(async (_sessionId, patch) => ({
      id: 's1',
      title: 't',
      status: 'idle',
      updatedAt: '2026-01-01T00:00:00.000Z',
      preview: '',
      projectId: 'p1',
      pinnedAt: patch.pinned === true ? '2026-01-01T00:00:00.000Z' : null,
      sessionLabel: patch.sessionLabel ?? null,
      labeledAt: patch.sessionLabel != null ? '2026-01-01T00:00:00.000Z' : null,
    })),
    deleteSession: vi.fn(async () => ({ deleted: true })),
    updateProject: vi.fn(async (projectId, patch) => ({
      id: projectId,
      // 回显语义：name/archived 仅在请求携带时变化（与装配层 updateWorkspace 回显一致）
      name: patch.name ?? 'proj',
      rootPath: '',
      projectKind: 'web',
      pinnedAt: patch.pinned === true ? '2026-01-01T00:00:00.000Z' : null,
      archivedAt: patch.archived === true ? '2026-01-01T00:00:00.000Z' : null,
      updatedAt: '2026-01-01T00:00:00.000Z',
      sessionCount: 0,
    })),
    deleteProject: vi.fn(async () => ({ deleted: true })),
    searchSessions: vi.fn(async () => ({ results: [] })),
    getSidebarOrder: vi.fn(() => ORDER_STATE),
    updateSidebarOrder: vi.fn(async (request) => ({ itemIds: request.itemIds })),
    notifySidebarChanged: notify,
    getHistory: vi.fn(async () => ({ events: [], running: false })),
    getStreamEvents: vi.fn(async () => ({ events: [], nextSeq: 0 })),
    submitTurn: vi.fn(async () => ({ turnId: 't1' })),
    cancelTurn: vi.fn(async () => undefined),
    getCatalog: vi.fn(async () => ({
      agents: [],
      workflows: [],
      providers: [],
      permissionModes: {},
      reasoningEfforts: [],
    })),
    getSessionRuntime: vi.fn(async () => null),
    getWorkflowBinding: vi.fn(async () => ({
      binding: null,
      effectiveName: null,
      canChange: true,
      error: null,
    })),
    setWorkflowBinding: vi.fn(async () => ({
      binding: null,
      effectiveName: null,
      canChange: true,
      error: null,
    })),
    saveAttachments: vi.fn(async () => []),
    readAttachmentContent: vi.fn(async () => null),
    transcribeAudio: vi.fn(async () => ({ kind: 'failed' as const, message: 'unused' })),
    listSessionTasks: vi.fn(async () => []),
    createSessionTask: vi.fn(async () => {
      throw new Error('not used')
    }),
    updateSessionTask: vi.fn(async () => null),
    deleteSessionTask: vi.fn(async () => true),
    toggleSessionTask: vi.fn(async () => null),
    runSessionTaskNow: vi.fn(async () => ({ started: true })),
    listCommands: vi.fn(async () => []),
    executeCommand: vi.fn(async () => ({ isCommand: false, forwardToAgent: false })),
    ...overrides,
  } as unknown as MobileBridgeDeps
  const service = new MobileBridgeService()
  service.setDeps(deps)
  return { service, deps, notify }
}

describe('MobileBridgeService 侧栏同步端点', () => {
  it('PATCH /v1/projects/:id 置顶成功并广播', async () => {
    const { service, deps, notify } = buildService()
    const result = await service.invokeRelay('PATCH', '/v1/projects/p1', { pinned: true })
    expect(result.status).toBe(200)
    const body = result.body as { project: { id: string; pinnedAt: string | null } }
    expect(body.project.id).toBe('p1')
    expect(body.project.pinnedAt).not.toBeNull()
    expect(deps.updateProject).toHaveBeenCalledWith('p1', { pinned: true })
    expect(notify).toHaveBeenCalledTimes(1)
  })

  it('PATCH /v1/projects/:id 重命名成功（trim + 回显）并广播', async () => {
    const { service, deps, notify } = buildService()
    const result = await service.invokeRelay('PATCH', '/v1/projects/p1', { name: '  新名字  ' })
    expect(result.status).toBe(200)
    const body = result.body as { project: { name: string } }
    expect(body.project.name).toBe('新名字')
    expect(deps.updateProject).toHaveBeenCalledWith('p1', { name: '新名字' })
    expect(notify).toHaveBeenCalledTimes(1)
  })

  it('PATCH /v1/projects/:id 归档成功并广播', async () => {
    const { service, deps, notify } = buildService()
    const result = await service.invokeRelay('PATCH', '/v1/projects/p1', { archived: true })
    expect(result.status).toBe(200)
    const body = result.body as { project: { archivedAt: string | null } }
    expect(body.project.archivedAt).not.toBeNull()
    expect(deps.updateProject).toHaveBeenCalledWith('p1', { archived: true })
    expect(notify).toHaveBeenCalledTimes(1)
  })

  it('PATCH /v1/projects/:id 拒绝空请求体与空项目名', async () => {
    const { service, notify } = buildService()
    const empty = await service.invokeRelay('PATCH', '/v1/projects/p1', {})
    expect(empty.status).toBe(400)
    const blank = await service.invokeRelay('PATCH', '/v1/projects/p1', { name: '   ' })
    expect(blank.status).toBe(400)
    expect(notify).not.toHaveBeenCalled()
  })

  it('PATCH /v1/projects/:id 保留项目守卫经 SparkError 映射 400', async () => {
    const guarded = buildService({
      updateProject: vi.fn(async () => {
        throw new SparkError('VALIDATION_FAILED', '「不使用项目」是系统保留项目，不能改名或归档')
      }),
    })
    const result = await guarded.service.invokeRelay('PATCH', '/v1/projects/np', {
      name: '改名',
    })
    expect(result.status).toBe(400)
    expect((result.body as { error: { message: string } }).error.message).toContain('保留项目')
    expect(guarded.notify).not.toHaveBeenCalled()
  })

  it('PATCH /v1/projects/:id 改名为保留名同样被守卫拒绝', async () => {
    const guarded = buildService({
      updateProject: vi.fn(async () => {
        throw new SparkError('VALIDATION_FAILED', '「不使用项目」是系统保留名称，不能作为项目名')
      }),
    })
    const result = await guarded.service.invokeRelay('PATCH', '/v1/projects/p1', {
      name: '不使用项目',
    })
    expect(result.status).toBe(400)
    expect((result.body as { error: { message: string } }).error.message).toContain('保留名称')
    expect(guarded.notify).not.toHaveBeenCalled()
  })

  it('DELETE /v1/projects/:id 成功并广播；deps 校验失败映射 400', async () => {
    const { service, deps, notify } = buildService()
    const ok = await service.invokeRelay('DELETE', '/v1/projects/p1', null)
    expect(ok.status).toBe(200)
    expect(ok.body).toEqual({ deleted: true })
    expect(deps.deleteProject).toHaveBeenCalledWith('p1')
    expect(notify).toHaveBeenCalledTimes(1)

    const guarded = buildService({
      deleteProject: vi.fn(async () => {
        throw new SparkError('VALIDATION_FAILED', '「不使用项目」是系统保留项目，不能删除')
      }),
    })
    const bad = await guarded.service.invokeRelay('DELETE', '/v1/projects/np', null)
    expect(bad.status).toBe(400)
    expect(guarded.notify).not.toHaveBeenCalled()
  })

  it('GET /v1/search 缺关键词 400，合法请求透传 projectId 与 limit', async () => {
    const { service, deps } = buildService()
    const missing = await service.invokeRelay('GET', '/v1/search', null)
    expect(missing.status).toBe(400)

    const ok = await service.invokeRelay('GET', '/v1/search?q=关键词&projectId=p1&limit=99', null)
    expect(ok.status).toBe(200)
    expect(deps.searchSessions).toHaveBeenCalledWith('关键词', 'p1', 50)
  })

  it('GET /v1/sidebar-order 原样返回排序状态', async () => {
    const { service } = buildService()
    const result = await service.invokeRelay('GET', '/v1/sidebar-order', null)
    expect(result.status).toBe(200)
    expect(result.body).toEqual(ORDER_STATE)
  })

  it('PUT /v1/sidebar-order 合法请求落库并广播', async () => {
    const { service, deps, notify } = buildService()
    const result = await service.invokeRelay('PUT', '/v1/sidebar-order', {
      scope: 'projects',
      itemIds: ['p2', 'p1'],
    })
    expect(result.status).toBe(200)
    expect(result.body).toEqual({ itemIds: ['p2', 'p1'] })
    expect(deps.updateSidebarOrder).toHaveBeenCalled()
    expect(notify).toHaveBeenCalledTimes(1)
  })

  it('PUT /v1/sidebar-order 非法 scope / 缺 projectId / 重复 itemIds 都返回 400', async () => {
    const { service, notify } = buildService()
    const badScope = await service.invokeRelay('PUT', '/v1/sidebar-order', {
      scope: 'nope',
      itemIds: [],
    })
    expect(badScope.status).toBe(400)
    const missingProject = await service.invokeRelay('PUT', '/v1/sidebar-order', {
      scope: 'sessions',
      itemIds: ['s1'],
    })
    expect(missingProject.status).toBe(400)
    const duplicates = await service.invokeRelay('PUT', '/v1/sidebar-order', {
      scope: 'projects',
      itemIds: ['p1', 'p1'],
    })
    expect(duplicates.status).toBe(400)
    expect(notify).not.toHaveBeenCalled()
  })

  it('PUT /v1/sidebar-order 排序校验失败按 SparkError 映射状态码', async () => {
    const notFound = buildService({
      updateSidebarOrder: vi.fn(async () => {
        throw new SparkError('NOT_FOUND', '排序中的项目不存在或已被删除')
      }),
    })
    const miss = await notFound.service.invokeRelay('PUT', '/v1/sidebar-order', {
      scope: 'projects',
      itemIds: ['gone'],
    })
    expect(miss.status).toBe(404)
    expect((miss.body as { error: { message: string } }).error.message).toContain('不存在')

    const invalid = buildService({
      updateSidebarOrder: vi.fn(async () => {
        throw new SparkError('VALIDATION_FAILED', '会话只能在所属项目内部排序')
      }),
    })
    const bad = await invalid.service.invokeRelay('PUT', '/v1/sidebar-order', {
      scope: 'sessions',
      projectId: 'p1',
      itemIds: ['s9'],
    })
    expect(bad.status).toBe(400)
    expect((bad.body as { error: { message: string } }).error.message).toContain('排序')
  })

  it('PATCH /v1/sessions/:id 放行合法标记并透传给 deps', async () => {
    const { service, deps, notify } = buildService()
    const result = await service.invokeRelay('PATCH', '/v1/sessions/s1', {
      sessionLabel: 'suspended',
    })
    expect(result.status).toBe(200)
    expect(deps.updateSession).toHaveBeenCalledWith('s1', { sessionLabel: 'suspended' })
    expect(notify).toHaveBeenCalledTimes(1)
  })

  it('PATCH /v1/sessions/:id null 表示清除标记，非法值 400', async () => {
    const { service, deps, notify } = buildService()
    const clear = await service.invokeRelay('PATCH', '/v1/sessions/s1', { sessionLabel: null })
    expect(clear.status).toBe(200)
    expect(deps.updateSession).toHaveBeenCalledWith('s1', { sessionLabel: null })

    const bogus = await service.invokeRelay('PATCH', '/v1/sessions/s1', {
      sessionLabel: 'not-a-label',
    })
    expect(bogus.status).toBe(400)
    // 非法值不得触发广播（合法 null 清除的那 1 次除外）
    expect(notify).toHaveBeenCalledTimes(1)
  })

  it('PATCH /v1/sessions/:id 纯运行时配置不广播，侧栏字段才广播', async () => {
    const { service, notify } = buildService()
    // 快速发起建会话后紧跟的模型/权限/推理补丁：侧栏不展示这些字段，不应触发全量重拉
    await service.invokeRelay('PATCH', '/v1/sessions/s1', {
      providerProfileId: 'prof1',
      modelId: 'm1',
      permissionMode: 'default',
      reasoningEffort: 'medium',
    })
    expect(notify).not.toHaveBeenCalled()

    // 项目归属变化影响侧栏分组，必须广播
    await service.invokeRelay('PATCH', '/v1/sessions/s1', { projectId: 'p2' })
    expect(notify).toHaveBeenCalledTimes(1)
  })

  it('POST /v1/sessions 建会话成功并广播（桌面端侧栏实时出现新会话）', async () => {
    const { service, deps, notify } = buildService({
      createSession: vi.fn(async () => ({
        id: 's-new',
        title: '移动端会话',
        status: 'idle',
        updatedAt: '2026-01-01T00:00:00.000Z',
        preview: '',
        projectId: 'p1',
        pinnedAt: null,
        sessionLabel: null,
        labeledAt: null,
      })),
    })
    const result = await service.invokeRelay('POST', '/v1/sessions', { projectId: 'p1' })
    expect(result.status).toBe(200)
    expect(deps.createSession).toHaveBeenCalledWith({ projectId: 'p1' })
    expect(notify).toHaveBeenCalledTimes(1)
  })

  it('DELETE /v1/sessions/:id 删除成功并广播（否则桌面端侧栏滞留已删会话）', async () => {
    const { service, deps, notify } = buildService()
    const result = await service.invokeRelay('DELETE', '/v1/sessions/s1', null)
    expect(result.status).toBe(200)
    expect(deps.deleteSession).toHaveBeenCalledWith('s1')
    expect(notify).toHaveBeenCalledTimes(1)
  })
})
