import { describe, expect, it } from 'vitest'
import type { ProviderProfile } from '@spark/protocol'
import {
  buildModelSettingsDraft,
  buildModelSettingsSections,
  buildModelSettingsUpdates,
  countCustomizedModels,
  listProviderModelIds,
  modelSettingsDraftKey,
} from './model-settings-draft'

function profile(
  partial: Partial<ProviderProfile> & Pick<ProviderProfile, 'id' | 'name'>,
): ProviderProfile {
  return {
    provider: 'anthropic',
    defaultModel: '',
    modelIds: [],
    ...partial,
  } as ProviderProfile
}

describe('listProviderModelIds', () => {
  it('modelIds 优先，去重保序并丢弃空值/空白', () => {
    expect(
      listProviderModelIds(
        profile({ id: 'p', name: 'P', modelIds: [' a ', 'b', 'a', '', '  '], defaultModel: 'c' }),
      ),
    ).toEqual(['a', 'b'])
  })

  it('modelIds 为空时回落 defaultModel', () => {
    expect(
      listProviderModelIds(profile({ id: 'p', name: 'P', modelIds: [], defaultModel: 'only' })),
    ).toEqual(['only'])
  })

  it('都没有时返回空数组', () => {
    expect(listProviderModelIds(profile({ id: 'p', name: 'P' }))).toEqual([])
  })
})

describe('buildModelSettingsSections', () => {
  const host = profile({ id: 'cli', name: 'Claude CLI', modelIds: ['host-model'] })
  const sparkA = profile({ id: 'spark-a', name: 'OpenCode', modelIds: ['glm-5.3'] })
  const sparkB = profile({ id: 'spark-b', name: '空渠道', modelIds: [] })

  it('主渠道一组，CLI spark 子渠道各成一组并带父渠道名', () => {
    const sections = buildModelSettingsSections({
      conversationalProviders: [host],
      cliSparkProvidersByPrimaryId: new Map([['cli', [sparkA, sparkB]]]),
    })
    expect(sections.map((section) => section.provider.id)).toEqual(['cli', 'spark-a'])
    expect(sections[0]?.parentProviderName).toBeUndefined()
    expect(sections[1]?.parentProviderName).toBe('Claude CLI')
    expect(sections[1]?.models).toEqual([{ modelId: 'glm-5.3', label: 'glm-5.3' }])
  })

  it('resolveModelLabel 生效，且无模型的分组被跳过', () => {
    const sections = buildModelSettingsSections({
      conversationalProviders: [profile({ id: 'empty', name: '空' }), host],
      resolveModelLabel: (_provider, modelId) => `显示 ${modelId}`,
    })
    expect(sections).toHaveLength(1)
    expect(sections[0]?.models[0]?.label).toBe('显示 host-model')
  })
})

describe('buildModelSettingsDraft', () => {
  it('推理/显隐读 modelSettings，模型级上下文读 modelContextWindows', () => {
    const provider = profile({
      id: 'p',
      name: 'P',
      modelIds: ['m1', 'm2'],
      modelSettings: { m1: { reasoningEffort: 'high', hidden: true } },
      modelContextWindows: { m1: 400_000 },
    })
    const sections = buildModelSettingsSections({ conversationalProviders: [provider] })
    const draft = buildModelSettingsDraft(sections)
    expect(draft[modelSettingsDraftKey('p', 'm1')]).toEqual({
      reasoningEffort: 'high',
      hidden: true,
      contextWindow: 400_000,
    })
    expect(draft[modelSettingsDraftKey('p', 'm2')]).toEqual({
      reasoningEffort: null,
      hidden: false,
      contextWindow: 0,
    })
  })

  it('countCustomizedModels 只统计存在覆盖的模型', () => {
    const provider = profile({
      id: 'p',
      name: 'P',
      modelIds: ['m1', 'm2', 'm3'],
      modelSettings: { m1: { reasoningEffort: 'low' }, m2: { hidden: true } },
      modelContextWindows: { m3: 200_000 },
    })
    const sections = buildModelSettingsSections({ conversationalProviders: [provider] })
    const draft = buildModelSettingsDraft(sections)
    expect(countCustomizedModels(sections, draft)).toBe(3)
    draft[modelSettingsDraftKey('p', 'm3')] = {
      reasoningEffort: null,
      hidden: false,
      contextWindow: 0,
    }
    expect(countCustomizedModels(sections, draft)).toBe(2)
  })
})

describe('buildModelSettingsUpdates', () => {
  const provider = profile({
    id: 'p',
    name: 'P',
    modelIds: ['m1', 'm2'],
    modelSettings: { m1: { reasoningEffort: 'high' }, m2: { hidden: true } },
    modelContextWindows: { m2: 400_000 },
  })

  it('无改动时不产生任何渠道更新', () => {
    const sections = buildModelSettingsSections({ conversationalProviders: [provider] })
    const draft = buildModelSettingsDraft(sections)
    expect(buildModelSettingsUpdates(sections, draft)).toEqual([])
  })

  it('整表下发：未改动的模型覆盖也被保留（避免整表替换误删）', () => {
    const sections = buildModelSettingsSections({ conversationalProviders: [provider] })
    const draft = buildModelSettingsDraft(sections)
    draft[modelSettingsDraftKey('p', 'm1')] = {
      reasoningEffort: 'low',
      hidden: false,
      contextWindow: 0,
    }
    expect(buildModelSettingsUpdates(sections, draft)).toEqual([
      {
        id: 'p',
        modelSettings: {
          m1: { reasoningEffort: 'low' },
          m2: { hidden: true, contextWindow: 400_000 },
        },
      },
    ])
  })

  it('清除某个模型的全部覆盖：以空对象表达（服务层据此删除模型级上下文窗口）', () => {
    const sections = buildModelSettingsSections({ conversationalProviders: [provider] })
    const draft = buildModelSettingsDraft(sections)
    draft[modelSettingsDraftKey('p', 'm1')] = {
      reasoningEffort: null,
      hidden: false,
      contextWindow: 0,
    }
    expect(buildModelSettingsUpdates(sections, draft)).toEqual([
      { id: 'p', modelSettings: { m1: {}, m2: { hidden: true, contextWindow: 400_000 } } },
    ])
  })

  it('从未配置过的模型不出现在载荷里（保持最小增量）', () => {
    const plain = profile({ id: 'plain', name: 'Plain', modelIds: ['x', 'y'] })
    const sections = buildModelSettingsSections({ conversationalProviders: [plain] })
    const draft = buildModelSettingsDraft(sections)
    draft[modelSettingsDraftKey('plain', 'y')] = {
      reasoningEffort: 'medium',
      hidden: false,
      contextWindow: 0,
    }
    expect(buildModelSettingsUpdates(sections, draft)).toEqual([
      { id: 'plain', modelSettings: { y: { reasoningEffort: 'medium' } } },
    ])
  })

  it('仅设置模型级上下文窗口也算改动并进入载荷', () => {
    const sections = buildModelSettingsSections({ conversationalProviders: [provider] })
    const draft = buildModelSettingsDraft(sections)
    draft[modelSettingsDraftKey('p', 'm1')] = {
      reasoningEffort: 'high',
      hidden: false,
      contextWindow: 1_000_000,
    }
    expect(buildModelSettingsUpdates(sections, draft)).toEqual([
      {
        id: 'p',
        modelSettings: {
          m1: { reasoningEffort: 'high', contextWindow: 1_000_000 },
          m2: { hidden: true, contextWindow: 400_000 },
        },
      },
    ])
  })

  it('只返回有改动的渠道（多渠道路径互不干扰）', () => {
    const untouched = profile({
      id: 'q',
      name: 'Q',
      modelIds: ['x'],
      modelSettings: { x: { reasoningEffort: 'max' } },
    })
    const sections = buildModelSettingsSections({ conversationalProviders: [provider, untouched] })
    const draft = buildModelSettingsDraft(sections)
    draft[modelSettingsDraftKey('p', 'm2')] = {
      reasoningEffort: null,
      hidden: false,
      contextWindow: 0,
    }
    const updates = buildModelSettingsUpdates(sections, draft)
    expect(updates.map((update) => update.id)).toEqual(['p'])
    expect(updates[0]?.modelSettings).toEqual({ m1: { reasoningEffort: 'high' }, m2: {} })
  })
})
