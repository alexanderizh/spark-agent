import { describe, expect, it } from 'vitest'
import type { ProviderProfile } from '@spark/protocol'
import { buildScheduledTaskModelOptions } from './scheduled-task-model-options'

/**
 * 定时任务模型候选（Phase 4 入口闭环）：
 * AutoRouter 元渠道以「名称（智能路由）」出现，value 为 router 的 provider id，
 * 让定时任务也能走分流（主进程按 router id 命中并置空 modelId）。
 */

function profile(partial: Partial<ProviderProfile> & Pick<ProviderProfile, 'id' | 'name'>): ProviderProfile {
  return {
    provider: 'anthropic',
    defaultModel: '',
    modelIds: [],
    supportsMillionContext: false,
    keystoreRef: '',
    isDefault: false,
    createdAt: '',
    ...partial,
  } as ProviderProfile
}

describe('buildScheduledTaskModelOptions', () => {
  const router = profile({
    id: 'router-1',
    name: '分流路由',
    provider: 'auto-router',
    providerType: 'auto-router',
  })
  const claude = profile({
    id: 'p-claude',
    name: 'Claude',
    defaultModel: 'sonnet-4-5',
    modelIds: ['sonnet-4-5', 'haiku-4-5'],
  })
  const openai = profile({
    id: 'p-openai',
    name: 'OpenAI',
    provider: 'openai',
    defaultModel: 'gpt-5',
    modelIds: ['gpt-5'],
  })

  it('router 以 router id 为 value 出现，且不把空模型清单混进模型项', () => {
    const options = buildScheduledTaskModelOptions([router, claude, openai])
    expect(options[0]).toEqual({ label: '分流路由（智能路由）', value: 'router-1' })
    expect(options.filter((option) => option.value === 'router-1')).toHaveLength(1)
    expect(options.some((option) => option.label === '')).toBe(false)
  })

  it('普通渠道的模型去重后按原序追加', () => {
    const options = buildScheduledTaskModelOptions([claude, openai])
    expect(options.map((option) => option.value)).toEqual([
      'sonnet-4-5',
      'haiku-4-5',
      'gpt-5',
    ])
  })

  it('同一模型被多渠道共享时只出现一次', () => {
    const shared = profile({
      id: 'p-shared',
      name: 'Shared',
      defaultModel: 'sonnet-4-5',
      modelIds: ['sonnet-4-5'],
    })
    const options = buildScheduledTaskModelOptions([claude, shared])
    expect(options.filter((option) => option.value === 'sonnet-4-5')).toHaveLength(1)
  })
})
