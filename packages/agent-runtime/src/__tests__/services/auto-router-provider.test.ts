/**
 * AutoRouter Provider 行（provider_type='auto-router'）专项测试：
 * router CRUD、读取侧有效性校验（失效执行器剔除）、导入导出 name 引用重映射、
 * 旧魔法 id 会话回退渠道解析。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ProviderService } from '../../services/provider.service.js'
import { resolveLegacyRouterFallbackProviderRow } from '../../services/session/session-pure-utils.js'
import {
  AUTO_ROUTER_PROVIDER_TYPE,
  createDefaultAutoRouterConfig,
  type AutoRouterConfig,
} from '@spark/protocol'

vi.mock('@spark/shared/keystore', () => ({
  makeKeystoreRef: (provider: string, id: string) => `${provider}-${id}`,
  setSecret: vi.fn(),
  getSecret: vi.fn(),
  deleteSecret: vi.fn(),
  maskSecret: (s: string) => s.slice(0, 4) + '****',
}))

vi.mock('@spark/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@spark/shared')>()
  return {
    ...actual,
    createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  }
})

const cliExecMock = vi.hoisted(() => ({ resolve: (_cmd: string): boolean => false }))
vi.mock('node:util', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:util')>()
  return {
    ...actual,
    promisify: () => async (cmd: string) => {
      if (cliExecMock.resolve(cmd)) return { stdout: 'claude x.y.z\n', stderr: '' }
      const err = new Error(`ENOENT: ${cmd}`) as NodeJS.ErrnoException
      err.code = 'ENOENT'
      throw err
    },
  }
})

function makeRepo() {
  const rows = new Map<string, Record<string, unknown>>()
  return {
    rows,
    create: vi.fn((params) => {
      const row = {
        id: params.id,
        provider_type: params.providerType,
        name: params.name,
        config_json: JSON.stringify(params.config),
        enabled: 1,
        keystore_ref: params.keystoreRef,
        is_default: params.isDefault ? 1 : 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
      rows.set(params.id, row)
      return row
    }),
    get: vi.fn((id: string) => rows.get(id) ?? null),
    listAll: vi.fn(() => [...rows.values()]),
    update: vi.fn((id: string, patch: Record<string, unknown>) => {
      const current = rows.get(id)
      if (!current) return null
      const next = {
        ...current,
        ...(patch.providerType !== undefined && { provider_type: patch.providerType }),
        ...(patch.name !== undefined && { name: patch.name }),
        ...(patch.enabled !== undefined && { enabled: patch.enabled ? 1 : 0 }),
        ...(patch.config !== undefined && { config_json: JSON.stringify(patch.config) }),
      }
      rows.set(id, next)
      return next
    }),
    setDefault: vi.fn((id: string) => {
      for (const [key, row] of rows) {
        rows.set(key, { ...row, is_default: key === id ? 1 : 0 })
      }
    }),
    delete: vi.fn((id: string) => rows.delete(id)),
    findByProviderType: vi.fn(() => []),
  }
}

function addTextProvider(
  repo: ReturnType<typeof makeRepo>,
  id: string,
  name: string,
  models: string[],
): void {
  repo.rows.set(id, {
    id,
    provider_type: 'anthropic',
    name,
    config_json: JSON.stringify({ defaultModel: models[0] ?? '', modelIds: models }),
    enabled: 1,
    keystore_ref: '',
    is_default: 0,
    created_at: '',
    updated_at: '',
  })
}

function routerConfig(): AutoRouterConfig {
  return {
    ...createDefaultAutoRouterConfig('claude'),
    dispatcher: { providerProfileId: 'p-dispatch', modelId: 'haiku-mini', timeoutMs: 5_000 },
    executors: [
      { id: 'e-high', providerProfileId: 'p-high', modelId: 'opus-max', intensity: 'high', enabled: true },
      { id: 'e-bal', providerProfileId: 'p-bal', modelId: 'sonnet-mid', intensity: 'balanced', enabled: true },
      { id: 'e-low', providerProfileId: 'p-low', modelId: 'haiku-mini', intensity: 'low', enabled: true },
    ],
  }
}

describe('ProviderService AutoRouter CRUD', () => {
  let repo: ReturnType<typeof makeRepo>
  let service: ProviderService

  beforeEach(() => {
    repo = makeRepo()
    service = new ProviderService(repo as never)
    addTextProvider(repo, 'p-dispatch', 'Dispatch Co', ['haiku-mini'])
    addTextProvider(repo, 'p-high', 'High Co', ['opus-max'])
    addTextProvider(repo, 'p-bal', 'Balanced Co', ['sonnet-mid'])
    addTextProvider(repo, 'p-low', 'Low Co', ['haiku-mini'])
  })

  it('createAutoRouter 落库为 provider_type=auto-router 且返回校验后配置', async () => {
    const profile = await service.createAutoRouter({ name: '主力路由', config: routerConfig() })

    expect(profile.providerType).toBe(AUTO_ROUTER_PROVIDER_TYPE)
    expect(profile.defaultModel).toBe('')
    expect(profile.modelIds).toEqual([])
    expect(profile.autoRouterConfig?.executors).toHaveLength(3)
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ providerType: AUTO_ROUTER_PROVIDER_TYPE, keystoreRef: '' }),
    )
  })

  it('createAutoRouter 拒绝非法配置', async () => {
    await expect(
      service.createAutoRouter({ name: 'bad', config: { ...routerConfig(), adapter: 'wrong' as never } }),
    ).rejects.toThrow(/Invalid auto-router config/)
  })

  it('读取侧剔除引用失效的执行器（渠道被删 / 模型被移除 / 渠道停用）', async () => {
    await service.createAutoRouter({ name: '主力路由', config: routerConfig() })
    // 模拟 p-low 渠道被删、p-high 模型被移除
    repo.rows.delete('p-low')
    repo.rows.set('p-high', {
      ...repo.rows.get('p-high')!,
      config_json: JSON.stringify({ defaultModel: 'other-model', modelIds: ['other-model'] }),
    })

    const listed = await service.listProviders()
    const router = listed.find((item) => item.providerType === AUTO_ROUTER_PROVIDER_TYPE)
    expect(router?.autoRouterConfig?.executors.map((e) => e.id)).toEqual(['e-bal'])
  })

  it('config_json 结构损坏时 autoRouterConfig 缺省但不抛异常', async () => {
    repo.rows.set('broken-router', {
      id: 'broken-router',
      provider_type: AUTO_ROUTER_PROVIDER_TYPE,
      name: 'broken',
      config_json: '{not json',
      enabled: 1,
      keystore_ref: '',
      is_default: 0,
      created_at: '',
      updated_at: '',
    })
    const listed = await service.listProviders()
    const router = listed.find((item) => item.id === 'broken-router')
    expect(router?.autoRouterConfig).toBeUndefined()
    expect(router?.providerType).toBe(AUTO_ROUTER_PROVIDER_TYPE)
  })

  it('updateProvider 拒绝在普通渠道编辑面板改写 router 行（只放行启停）', async () => {
    const profile = await service.createAutoRouter({ name: '主力路由', config: routerConfig() })
    // 普通渠道编辑面板会下发 provider 协议格式 → 若不拦截，router 行会被改成
    // anthropic/openai，留下带 AutoRouterConfig 的脏行（不再被识别为 router）。
    await expect(
      service.updateProvider({ id: profile.id, provider: 'anthropic', name: '被改写' }),
    ).rejects.toThrow('自动路由只能在「渠道管理 → 自动路由」中修改')
    // 启停属于 router 合法操作，放行
    await expect(
      service.updateProvider({ id: profile.id, enabled: false }),
    ).resolves.toBeDefined()
    const row = repo.rows.get(profile.id)
    expect(row?.provider_type).toBe(AUTO_ROUTER_PROVIDER_TYPE)
    expect(row?.name).toBe('主力路由')
  })

  it('deleteProvider 允许删除 router 行（去掉旧拒删特判）', async () => {
    const profile = await service.createAutoRouter({ name: '主力路由', config: routerConfig() })
    await expect(service.deleteProvider(profile.id)).resolves.toBeUndefined()
    expect(repo.rows.has(profile.id)).toBe(false)
  })

  it('导出携带 router 配置与引用渠道 name 清单，导入按 name 重建引用', async () => {
    await service.createAutoRouter({ name: '主力路由', config: routerConfig() })
    const payload = await service.exportProviders()

    const exportedRouter = payload.profiles.find((p) => p.provider === AUTO_ROUTER_PROVIDER_TYPE)
    expect(exportedRouter?.autoRouterConfig).toBeDefined()
    // 顺序 = dispatcher 在前、executors 其后
    expect(exportedRouter?.autoRouterReferencedNames).toEqual([
      'Dispatch Co',
      'High Co',
      'Balanced Co',
      'Low Co',
    ])

    // 模拟目标机器：同名渠道但 id 全新
    const targetRepo = makeRepo()
    addTextProvider(targetRepo, 'new-dispatch', 'Dispatch Co', ['haiku-mini'])
    addTextProvider(targetRepo, 'new-high', 'High Co', ['opus-max'])
    addTextProvider(targetRepo, 'new-bal', 'Balanced Co', ['sonnet-mid'])
    // 目标机器没有 Low Co（引用匹配不到 → 保留原 id，读取侧校验剔除）
    const targetService = new ProviderService(targetRepo as never)
    const result = await targetService.importProviders(payload, 'merge')

    // 导入新建 = router 行 + 缺失的 Low Co 渠道；三个同名渠道 merge 跳过
    expect(result.imported).toBe(2)
    const importedRouter = (await targetService.listProviders()).find(
      (profile) => profile.providerType === AUTO_ROUTER_PROVIDER_TYPE,
    )
    expect(importedRouter?.autoRouterConfig).toBeDefined()
    const importedConfig = importedRouter?.autoRouterConfig as AutoRouterConfig
    expect(importedConfig.dispatcher.providerProfileId).toBe('new-dispatch')
    // 读取视图：Low Co 在目标机器不存在 → 读取侧有效性校验剔除该条目（UI 不显示失效引用）
    expect(importedConfig.executors.map((e) => e.providerProfileId)).toEqual([
      'new-high',
      'new-bal',
    ])
    // 落库原值：失配引用保留导出机器原 id（换回渠道后自动恢复可用）
    const storedRow = targetRepo.rows.get(importedRouter?.id ?? '') as
      | { config_json?: string }
      | undefined
    const storedConfig = JSON.parse(storedRow?.config_json ?? '{}') as AutoRouterConfig
    expect(storedConfig.executors.map((e) => e.providerProfileId)).toEqual([
      'new-high',
      'new-bal',
      'p-low',
    ])
  })
})

describe('resolveLegacyRouterFallbackProviderRow', () => {
  const row = (id: string, providerType: string, enabled: number, isDefault: number) => ({
    id,
    provider_type: providerType,
    enabled,
    is_default: isDefault,
  })

  it('优先取启用的默认渠道', () => {
    const rows = [
      row('a', 'anthropic', 1, 0),
      row('b', 'openai', 1, 1),
      row('r', AUTO_ROUTER_PROVIDER_TYPE, 1, 1),
    ]
    expect(resolveLegacyRouterFallbackProviderRow(rows)?.id).toBe('b')
  })

  it('无默认渠道时取第一个启用的普通渠道', () => {
    const rows = [row('disabled', 'anthropic', 0, 1), row('a', 'openai', 1, 0)]
    expect(resolveLegacyRouterFallbackProviderRow(rows)?.id).toBe('a')
  })

  it('仅剩 router 行时返回 null（无可回退渠道）', () => {
    const rows = [row('r', AUTO_ROUTER_PROVIDER_TYPE, 1, 1)]
    expect(resolveLegacyRouterFallbackProviderRow(rows)).toBeNull()
  })

  it('空列表返回 null', () => {
    expect(resolveLegacyRouterFallbackProviderRow([])).toBeNull()
  })
})
