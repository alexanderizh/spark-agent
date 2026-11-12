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
})
