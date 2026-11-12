import { describe, expect, it } from 'vitest'
import type { MobileBridgeCatalog } from '@spark/protocol'
import { resolveComposerPrefsPatch, prefsFromRuntime } from './remoteComposerPrefs'
import { readComposerPrefs, rememberComposerPrefs, type RemoteViewStorage } from './remoteViewState'

const catalog: MobileBridgeCatalog = {
  agents: [],
  workflows: [],
  providers: [
    {
      id: 'auto-provider',
      name: '智能路由',
      providerType: 'auto',
      isAutoRouter: true,
      models: [],
    },
    {
      id: 'model-provider',
      name: '模型渠道',
      providerType: 'openai',
      isAutoRouter: false,
      models: [{ id: 'model-a', name: '模型 A' }],
    },
  ],
  permissionModes: {},
  reasoningEfforts: [],
}

function storage(): RemoteViewStorage {
  let value: string | null = null
  return {
    getItem: () => value,
    setItem: (_key, next) => {
      value = next
    },
  }
}

describe('remote composer prefs', () => {
  it('持久化自动路由的 null modelId', () => {
    const target = storage()

    rememberComposerPrefs('device-1', { providerProfileId: 'auto-provider', modelId: null }, target)

    expect(readComposerPrefs('device-1', target)).toEqual({
      providerProfileId: 'auto-provider',
      modelId: null,
    })
  })

  it('按目录恢复自动路由选择，而不是丢弃 null modelId', () => {
    expect(
      resolveComposerPrefsPatch({ providerProfileId: 'auto-provider', modelId: null }, catalog),
    ).toEqual({ providerProfileId: 'auto-provider', modelId: null })
  })

  it('从运行配置提取渠道默认模型选择', () => {
    expect(prefsFromRuntime({ providerProfileId: 'auto-provider', modelId: null })).toEqual({
      providerProfileId: 'auto-provider',
      modelId: null,
    })
  })

  it('记忆里的推理强度只在目录枚举内才套用', () => {
    const withEfforts: MobileBridgeCatalog = { ...catalog, reasoningEfforts: ['low', 'high'] }

    expect(resolveComposerPrefsPatch({ reasoningEffort: 'high' }, withEfforts)).toEqual({
      reasoningEffort: 'high',
    })
    // 桌面端目录已换档（或换过引擎）时，旧值不能直接 PATCH 过去
    expect(resolveComposerPrefsPatch({ reasoningEffort: 'max' }, withEfforts)).toEqual({})
    // 旧版目标端没给枚举：一律不套用，不猜
    expect(resolveComposerPrefsPatch({ reasoningEffort: 'high' }, catalog)).toEqual({})
  })

  it('推理强度随偏好一起持久化并读回', () => {
    const target = storage()

    rememberComposerPrefs('device-1', { reasoningEffort: 'xhigh' }, target)

    expect(readComposerPrefs('device-1', target)).toEqual({ reasoningEffort: 'xhigh' })
    expect(prefsFromRuntime({ reasoningEffort: 'xhigh' })).toEqual({ reasoningEffort: 'xhigh' })
  })
})
