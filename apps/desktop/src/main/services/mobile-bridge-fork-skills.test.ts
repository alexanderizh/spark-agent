/**
 * 移动桥接「会话分支 + 技能列表 + 附件白名单」聚焦测试。
 *
 * 覆盖（经公开入口 invokeRelay 驱动，与中继同一路径，不起 Electron）：
 *   - POST /v1/sessions/:id/fork   路由命中 / anchorTurnId·title 非法 400 /
 *                                  SparkError 错误映射（404/400）/ 成功透传 + 侧栏通知
 *   - GET  /v1/sessions/:id/lineage 血缘透传
 *   - POST /v1/tasks/:id/run       NOT_FOUND → 404
 *   - GET  /v1/skills              sessionId 透传
 *   - GET  /v1/attachments/content 白名单拒绝（deps 返回 null）→ 404 合同
 *   - isPathWithinRoots            前缀比对边界：目录内 / 目录外 / ../ 逃逸 /
 *                                  前缀相似目录 / 空串候选
 */
import { describe, expect, it, vi } from 'vitest'
import { SparkError } from '@spark/shared'
import { MobileBridgeService, type MobileBridgeDeps } from './MobileBridgeService.js'
import type { MobileBridgeForkSessionResponse, MobileBridgeLineageResponse } from '@spark/protocol'
import { isPathWithinRoots } from '../ipc/mobile-bridge-path-policy.js'

function buildService(overrides: Partial<MobileBridgeDeps> = {}): MobileBridgeService {
  // 测试桩只补齐本文件触达的端点；其余 deps 用断言桩占位，
  // 避免接口每次扩张都要同步修改这里（与 mobile-bridge-sidebar-sync.test.ts 同策略）。
  const deps = {
    listProjects: vi.fn(async () => ({ projects: [], total: 0 })),
    listSessions: vi.fn(async () => ({ sessions: [], total: 0 })),
    createSession: vi.fn(async () => {
      throw new Error('not used')
    }),
    updateSession: vi.fn(async () => {
      throw new Error('not used')
    }),
    deleteSession: vi.fn(async () => ({ deleted: true })),
    updateProject: vi.fn(async () => {
      throw new Error('not used')
    }),
    getSidebarOrder: vi.fn(() => ({
      projectIds: [],
      sessionIdsByProject: {},
      pinnedSessionIdsByProject: {},
    })),
    updateSidebarOrder: vi.fn(async () => ({ itemIds: [] })),
    notifySidebarChanged: vi.fn(),
    getHistory: vi.fn(async () => ({ events: [], running: false })),
    getStreamEvents: vi.fn(async () => ({ events: [], nextSeq: 0 })),
    submitTurn: vi.fn(async () => ({ turnId: 't1' })),
    cancelTurn: vi.fn(async () => undefined),
    listPendingInteractions: vi.fn(async () => ({ approvals: [], questions: [] })),
    resolveApproval: vi.fn(async () => true),
    answerQuestion: vi.fn(async () => true),
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
    transcribeAudio: vi.fn(async () => ({ kind: 'failed' as const, message: 'not used' })),
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
    forkSession: vi.fn(async () => {
      throw new Error('not used')
    }),
    getSessionLineage: vi.fn(async () => ({ lineage: null, children: [] })),
    listSkills: vi.fn(async () => ({ skills: [] })),
    ...overrides,
  } as unknown as MobileBridgeDeps
  const service = new MobileBridgeService()
  service.setDeps(deps)
  return service
}

describe('mobile bridge fork / lineage / skills routes', () => {
  it('fork：anchorTurnId 为空串时返回 400', async () => {
    const service = buildService()
    const result = await service.invokeRelay('POST', '/v1/sessions/s1/fork', {
      anchorTurnId: '   ',
    })
    expect(result.status).toBe(400)
  })

  it('fork：anchorTurnId 非字符串时返回 400', async () => {
    const service = buildService()
    const result = await service.invokeRelay('POST', '/v1/sessions/s1/fork', {
      anchorTurnId: 123,
    })
    expect(result.status).toBe(400)
  })

  it('fork：合法请求透传 deps 并返回 200（含 lineage / copiedTurnCount）', async () => {
    // SessionLineage 的 id 字段是 branded SessionId：mock 裸 string 需整体断言桥接
    const forkSession = vi.fn(
      async () =>
        ({
          session: {
            id: 'child-1',
            title: '分支',
            status: 'idle',
            updatedAt: '2026-10-16T00:00:00.000Z',
            preview: '',
            projectId: 'p1',
            pinnedAt: null,
            sessionLabel: null,
            labeledAt: null,
          },
          lineage: {
            childSessionId: 'child-1',
            parentSessionId: 's1',
            forkAnchorTurnId: 'turn-9',
            forkCutoffSeq: 42,
            sourceTitleSnapshot: '源会话',
            createdAt: '2026-10-16T00:00:00.000Z',
          },
          copiedTurnCount: 7,
          sourceWasRunning: true,
        }) as MobileBridgeForkSessionResponse,
    )
    const service = buildService({ forkSession })
    const result = await service.invokeRelay('POST', '/v1/sessions/s1/fork', {
      anchorTurnId: ' turn-9 ',
      title: ' 分支 ',
    })
    expect(result.status).toBe(200)
    // 装配层（registerMobileBridgeIpc）负责 trim；route 层只做类型校验后透传
    expect(forkSession).toHaveBeenCalledWith('s1', { anchorTurnId: ' turn-9 ', title: ' 分支 ' })
    const body = result.body as MobileBridgeForkSessionResponse
    expect(body.session.id).toBe('child-1')
    expect(body.copiedTurnCount).toBe(7)
    expect(body.sourceWasRunning).toBe(true)
  })

  it('fork：空 body（缺省复制全部）也能路由成功', async () => {
    const forkSession = vi.fn(
      async () =>
        ({
          session: {
            id: 'child-2',
            title: 't',
            status: 'idle',
            updatedAt: '2026-10-16T00:00:00.000Z',
            preview: '',
          },
          lineage: {
            childSessionId: 'child-2',
            parentSessionId: 's1',
            forkAnchorTurnId: null,
            forkCutoffSeq: 0,
            sourceTitleSnapshot: 's',
            createdAt: '2026-10-16T00:00:00.000Z',
          },
          copiedTurnCount: 0,
          sourceWasRunning: false,
        }) as MobileBridgeForkSessionResponse,
    )
    const service = buildService({ forkSession })
    const result = await service.invokeRelay('POST', '/v1/sessions/s1/fork', undefined)
    expect(result.status).toBe(200)
    expect(forkSession).toHaveBeenCalledWith('s1', {})
  })

  it('fork：源会话不存在（NOT_FOUND）→ 404 而非兜底 500', async () => {
    const forkSession = vi.fn(async () => {
      throw new SparkError('NOT_FOUND', '源会话不存在或已删除')
    })
    const service = buildService({ forkSession })
    const result = await service.invokeRelay('POST', '/v1/sessions/s1/fork', {
      anchorTurnId: 'turn-1',
    })
    expect(result.status).toBe(404)
  })

  it('fork：锚点未完成（VALIDATION_FAILED）→ 400 而非兜底 500', async () => {
    const forkSession = vi.fn(async () => {
      throw new SparkError('VALIDATION_FAILED', '只能从已完成的会话轮次处分支')
    })
    const service = buildService({ forkSession })
    const result = await service.invokeRelay('POST', '/v1/sessions/s1/fork', {
      anchorTurnId: 'turn-1',
    })
    expect(result.status).toBe(400)
  })

  it('fork：title 非字符串 → 400（与 anchorTurnId 同口径）', async () => {
    const service = buildService()
    const result = await service.invokeRelay('POST', '/v1/sessions/s1/fork', { title: 123 })
    expect(result.status).toBe(400)
  })

  it('fork：成功后通知桌面端侧栏刷新（子会话是侧栏可见实体）', async () => {
    const notifySidebarChanged = vi.fn()
    const forkSession = vi.fn(
      async () =>
        ({
          session: {
            id: 'child-1',
            title: '分支',
            status: 'idle',
            updatedAt: '2026-10-16T00:00:00.000Z',
            preview: '',
            projectId: 'p1',
            pinnedAt: null,
            sessionLabel: null,
            labeledAt: null,
          },
          lineage: {
            childSessionId: 'child-1',
            parentSessionId: 's1',
            forkAnchorTurnId: null,
            forkCutoffSeq: 0,
            sourceTitleSnapshot: '分支',
            createdAt: '2026-10-16T00:00:00.000Z',
          },
          copiedTurnCount: 0,
          sourceWasRunning: false,
        }) as MobileBridgeForkSessionResponse,
    )
    const service = buildService({ forkSession, notifySidebarChanged })
    const result = await service.invokeRelay('POST', '/v1/sessions/s1/fork', {})
    expect(result.status).toBe(200)
    expect(notifySidebarChanged).toHaveBeenCalledTimes(1)
  })

  it('任务 run：NOT_FOUND → 404 而非兜底 500', async () => {
    const runSessionTaskNow = vi.fn(async () => {
      throw new SparkError('NOT_FOUND', '任务不存在')
    })
    const service = buildService({ runSessionTaskNow })
    const result = await service.invokeRelay('POST', '/v1/tasks/task-9/run', {})
    expect(result.status).toBe(404)
  })

  it('lineage：GET 透传 deps 响应', async () => {
    const getSessionLineage = vi.fn(
      async () =>
        ({
          lineage: {
            childSessionId: 's1',
            parentSessionId: 'parent-1',
            forkAnchorTurnId: 'turn-1',
            forkCutoffSeq: 10,
            sourceTitleSnapshot: '父',
            createdAt: '2026-10-16T00:00:00.000Z',
          },
          children: [],
          // branded SessionId 与裸 string 无重叠，按 TS 建议经 unknown 桥接
        }) as unknown as MobileBridgeLineageResponse,
    )
    const service = buildService({ getSessionLineage })
    const result = await service.invokeRelay('GET', '/v1/sessions/s1/lineage', undefined)
    expect(result.status).toBe(200)
    expect(getSessionLineage).toHaveBeenCalledWith('s1')
    const body = result.body as { lineage: { parentSessionId: string }; children: unknown[] }
    expect(body.lineage.parentSessionId).toBe('parent-1')
    expect(body.children).toEqual([])
  })

  it('任务 PATCH：timeoutSeconds / maxRetries 高级字段透传 deps（编辑表单可改即生效）', async () => {
    const updateSessionTask = vi.fn(async () => ({
      id: 'task-1',
      name: '日报',
      description: '',
      enabled: true,
      triggerType: 'cron' as const,
      cronExpression: '0 9 * * *',
      prompt: '写日报',
      status: 'enabled',
      executionCount: 0,
    }))
    const service = buildService({ updateSessionTask })
    const result = await service.invokeRelay('PATCH', '/v1/tasks/task-1', {
      timeoutSeconds: 600,
      maxRetries: 3,
    })
    expect(result.status).toBe(200)
    expect(updateSessionTask).toHaveBeenCalledWith(
      'task-1',
      expect.objectContaining({ timeoutSeconds: 600, maxRetries: 3 }),
    )
  })

  it('skills：sessionId query 透传 deps', async () => {
    const listSkills = vi.fn(async () => ({
      skills: [{ id: 'k1', name: 'search', description: '', enabled: true, source: 'db' as const }],
    }))
    const service = buildService({ listSkills })
    const result = await service.invokeRelay('GET', '/v1/skills?sessionId=s1', undefined)
    expect(result.status).toBe(200)
    expect(listSkills).toHaveBeenCalledWith('s1')
    const body = result.body as { skills: { name: string }[] }
    expect(body.skills[0]?.name).toBe('search')
  })
})

describe('mobile bridge attachment whitelist contract', () => {
  it('白名单外的附件路径由 deps 拒绝 → 404（route 合同）', async () => {
    const service = buildService()
    const result = await service.invokeRelay(
      'GET',
      `/v1/attachments/content?path=${encodeURIComponent('/etc/passwd')}`,
      undefined,
    )
    expect(result.status).toBe(404)
  })
})

describe('isPathWithinRoots（附件白名单纯函数）', () => {
  const roots = [
    '/Users/demo/work/project-a',
    '/Users/demo/Library/Application Support/app/attachments',
  ]

  it('根目录本身放行', () => {
    expect(isPathWithinRoots('/Users/demo/work/project-a', roots)).toBe(true)
  })

  it('根内子路径放行', () => {
    expect(isPathWithinRoots('/Users/demo/work/project-a/src/index.ts', roots)).toBe(true)
  })

  it('根外路径拒绝', () => {
    expect(isPathWithinRoots('/Users/demo/.ssh/id_rsa', roots)).toBe(false)
    expect(isPathWithinRoots('/etc/passwd', roots)).toBe(false)
  })

  it('../ 逃逸在规范化后仍拒绝', () => {
    expect(
      isPathWithinRoots('/Users/demo/work/project-a/src/../../project-b-secret/file', roots),
    ).toBe(false)
  })

  it('空串/空白串候选直接拒绝（不落 cwd）', () => {
    expect(isPathWithinRoots('', ['/tmp/ws'])).toBe(false)
    expect(isPathWithinRoots('   ', ['/tmp/ws'])).toBe(false)
  })

  it('前缀相似但不构成路径边界的目录不误放行', () => {
    // project-a-secret 与 project-a 是兄弟目录，不能因字符串前缀命中
    expect(isPathWithinRoots('/Users/demo/work/project-a-secret/file', roots)).toBe(false)
  })

  it('空/非法 root 被忽略', () => {
    expect(isPathWithinRoots('/etc/passwd', ['', '/etc/passwd/../x'])).toBe(false)
  })
})
