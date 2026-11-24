import { describe, expect, it, vi } from 'vitest'
import { SparkError } from '@spark/shared'
import { MobileBridgeService, type MobileBridgeDeps } from './MobileBridgeService.js'

/**
 * 会话运行配置 + Hooks 端点（2026-11-25 远程配置面板数据源）：
 *   GET  /v1/sessions/:id/runtime-config   prompt/env/filter 三层聚合读
 *   PUT  /v1/runtime-config/:kind          单层写（scope/scopeRef 校验）
 *   GET/PUT /v1/sessions/:id/hooks         会话 Hooks 生效列表 / 会话覆盖绑定
 */

const aggregate = {
  workspaceId: 'ws-1',
  prompt: {
    system: { enabled: true, content: 'sys' },
    agent: { enabled: false, content: '' },
    project: { enabled: true, content: 'p' },
    session: { enabled: false, content: '' },
    effectivePrompt: 'sys',
  },
  env: {
    project: { enabled: true, vars: [] },
    session: { enabled: true, vars: [] },
    effectiveEnv: {},
  },
  filter: {
    project: { configured: false, disabledSources: [] },
    session: { configured: false, disabledSources: [] },
    effectiveDisabledSources: [],
  },
}

describe('MobileBridgeService 会话运行配置端点', () => {
  it('GET /v1/sessions/:id/runtime-config returns the aggregate config', async () => {
    const getSessionRuntimeConfig = vi.fn(async () => aggregate)
    const service = new MobileBridgeService()
    service.setDeps({ getSessionRuntimeConfig } as unknown as MobileBridgeDeps)

    const result = await service.invokeRelay(
      'GET',
      '/v1/sessions/session%201/runtime-config',
      undefined,
    )

    expect(result.status).toBe(200)
    expect(result.body).toEqual(aggregate)
    expect(getSessionRuntimeConfig).toHaveBeenCalledWith('session 1')
  })

  it('PUT /v1/runtime-config/env forwards the payload to deps', async () => {
    const updateRuntimeConfigLayer = vi.fn(async () => undefined)
    const service = new MobileBridgeService()
    service.setDeps({ updateRuntimeConfigLayer } as unknown as MobileBridgeDeps)

    const payload = {
      scope: 'session',
      scopeRef: 'session 1',
      value: { enabled: true, vars: [{ key: 'K', value: 'V' }] },
    }
    const result = await service.invokeRelay('PUT', '/v1/runtime-config/env', payload)

    expect(result.status).toBe(200)
    expect(result.body).toEqual({ ok: true })
    expect(updateRuntimeConfigLayer).toHaveBeenCalledWith('env', payload)
  })

  it('PUT rejects an invalid scope/scopeRef without touching deps', async () => {
    const updateRuntimeConfigLayer = vi.fn()
    const service = new MobileBridgeService()
    service.setDeps({ updateRuntimeConfigLayer } as unknown as MobileBridgeDeps)

    const badScope = await service.invokeRelay('PUT', '/v1/runtime-config/prompt', {
      scope: 'agent',
      scopeRef: 'x',
    })
    expect(badScope.status).toBe(400)

    const emptyRef = await service.invokeRelay('PUT', '/v1/runtime-config/prompt', {
      scope: 'project',
      scopeRef: '',
    })
    expect(emptyRef.status).toBe(400)
    expect(updateRuntimeConfigLayer).not.toHaveBeenCalled()
  })

  it('PUT prompt-filter passes disabledSources through (undefined = 删层恢复继承)', async () => {
    const updateRuntimeConfigLayer = vi.fn(async () => undefined)
    const service = new MobileBridgeService()
    service.setDeps({ updateRuntimeConfigLayer } as unknown as MobileBridgeDeps)

    const result = await service.invokeRelay('PUT', '/v1/runtime-config/prompt-filter', {
      scope: 'session',
      scopeRef: 's1',
      disabledSources: undefined,
    })

    expect(result.status).toBe(200)
    expect(updateRuntimeConfigLayer).toHaveBeenCalledWith('prompt-filter', {
      scope: 'session',
      scopeRef: 's1',
      disabledSources: undefined,
    })
  })

  it('surfaces dep NOT_FOUND as 404（控制端据此降级旧版本占位）', async () => {
    const getSessionRuntimeConfig = vi.fn(async () => {
      throw new SparkError('NOT_FOUND', '会话不存在')
    })
    const service = new MobileBridgeService()
    service.setDeps({ getSessionRuntimeConfig } as unknown as MobileBridgeDeps)

    const result = await service.invokeRelay('GET', '/v1/sessions/s1/runtime-config', undefined)
    expect(result.status).toBe(404)
  })
})

describe('MobileBridgeService 会话 Hooks 端点', () => {
  const hookItem = {
    hook: { id: 'hook-1', name: '通知', eventName: 'turn.completed', executionHash: 'h1' },
    sourceScope: 'session',
    shadowedBy: [],
    disabled: false,
    binding: { state: 'active', enabled: true },
  }

  it('GET /v1/sessions/:id/hooks returns the effective list', async () => {
    const listSessionHooks = vi.fn(async () => ({ items: [hookItem] }))
    const service = new MobileBridgeService()
    service.setDeps({ listSessionHooks } as unknown as MobileBridgeDeps)

    const result = await service.invokeRelay('GET', '/v1/sessions/s1/hooks', undefined)

    expect(result.status).toBe(200)
    expect(result.body).toEqual({ items: [hookItem] })
    expect(listSessionHooks).toHaveBeenCalledWith('s1')
  })

  it('PUT /v1/sessions/:id/hooks validates hookId/enabled and forwards the binding', async () => {
    const upsertSessionHookBinding = vi.fn(async () => undefined)
    const service = new MobileBridgeService()
    service.setDeps({ upsertSessionHookBinding } as unknown as MobileBridgeDeps)

    const missing = await service.invokeRelay('PUT', '/v1/sessions/s1/hooks', { enabled: true })
    expect(missing.status).toBe(400)
    expect(upsertSessionHookBinding).not.toHaveBeenCalled()

    const ok = await service.invokeRelay('PUT', '/v1/sessions/s1/hooks', {
      hookId: 'hook-1',
      enabled: true,
      authorizeExecutionHash: 'h1',
      authorizedEffect: 'builtin.notification',
    })
    expect(ok.status).toBe(200)
    expect(upsertSessionHookBinding).toHaveBeenCalledWith('s1', {
      hookId: 'hook-1',
      enabled: true,
      authorizeExecutionHash: 'h1',
      authorizedEffect: 'builtin.notification',
    })
  })
})
