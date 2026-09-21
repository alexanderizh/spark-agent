import { describe, expect, it } from 'vitest'
import {
  buildOrchestrationModeSystemPrompt,
  resolveAutoRouterWorkerBinding,
  resolveOrchestrationSource,
  shouldExposeDispatchTools,
} from '../../../services/session/session-pure-utils'
import { createDefaultAutoRouterConfig } from '@spark/protocol'

/**
 * AutoRouter decomposed 轮次的派发面口径（P1/P6 回归）。
 *
 * P1：decomposed 轮次把一次性强度 worker 并入派发花名册后，Host 必须真的拿到
 * agent_dispatch / agent_dispatch_batch 工具面，否则只收到"请派发"的提示却没有工具，
 * decomposed 静默退化为单模型执行（多模型同轮协作失效）。
 * P6：子任务 worker 必须直接绑定执行器渠道，缺配置时回落本轮主执行器，绝不能沿用
 * host 绑定（router 会话里 host 绑的是 router 行 → 成员侧二次分流）。
 */

describe('shouldExposeDispatchTools', () => {
  it('团队成员 → 暴露派发工具面', () => {
    expect(
      shouldExposeDispatchTools({
        hasDispatchableTeamMembers: true,
        hasAutoRouterSubtasks: false,
      }),
    ).toBe(true)
  })

  it('只有 AutoRouter 一次性 worker → 同样暴露派发工具面（P1 回归）', () => {
    expect(
      shouldExposeDispatchTools({
        hasDispatchableTeamMembers: false,
        hasAutoRouterSubtasks: true,
      }),
    ).toBe(true)
  })

  it('两者都没有（仅托管工作流）→ 不暴露派发工具面', () => {
    expect(
      shouldExposeDispatchTools({
        hasDispatchableTeamMembers: false,
        hasAutoRouterSubtasks: false,
      }),
    ).toBe(false)
  })
})

describe('resolveOrchestrationSource', () => {
  it('优先级：团队 > AutoRouter > 托管工作流', () => {
    expect(
      resolveOrchestrationSource({ hasDispatchableTeamMembers: true, hasAutoRouterSubtasks: true }),
    ).toBe('team')
    expect(
      resolveOrchestrationSource({
        hasDispatchableTeamMembers: false,
        hasAutoRouterSubtasks: true,
      }),
    ).toBe('auto-router')
    expect(
      resolveOrchestrationSource({
        hasDispatchableTeamMembers: false,
        hasAutoRouterSubtasks: false,
      }),
    ).toBe('workflow')
  })

  it('auto-router 来源的编排提示词说明真实原因，不谎报挂了工作流', () => {
    const prompt = buildOrchestrationModeSystemPrompt('auto-router', 3)
    expect(prompt).toContain('AutoRouter')
    expect(prompt).toContain('3 member(s)')
    expect(prompt).not.toContain('workflow attached')
  })
})

describe('resolveAutoRouterWorkerBinding', () => {
  function configWith(executors: Array<{ intensity: 'high' | 'balanced' | 'low'; providerProfileId: string; modelId: string }>) {
    const config = createDefaultAutoRouterConfig('claude')
    config.executors = executors.map((entry, index) => ({
      id: `e-${index}`,
      intensity: entry.intensity,
      providerProfileId: entry.providerProfileId,
      modelId: entry.modelId,
      enabled: true,
    }))
    return config
  }

  it('该强度档配了执行器 → 绑定该执行器', () => {
    const binding = resolveAutoRouterWorkerBinding({
      config: configWith([
        { intensity: 'low', providerProfileId: 'p-low', modelId: 'haiku-small' },
      ]),
      intensity: 'low',
      fallback: { providerProfileId: 'p-router', modelId: '' },
    })
    expect(binding).toEqual({ providerProfileId: 'p-low', modelId: 'haiku-small' })
  })

  it('该强度档未配置 → 回落本轮主执行器，绝不回落 host/router 绑定（P6 回归）', () => {
    const binding = resolveAutoRouterWorkerBinding({
      config: configWith([
        { intensity: 'balanced', providerProfileId: 'p-bal', modelId: 'sonnet-mid' },
      ]),
      intensity: 'high',
      fallback: { providerProfileId: 'p-bal', modelId: 'sonnet-mid' },
    })
    expect(binding).toEqual({ providerProfileId: 'p-bal', modelId: 'sonnet-mid' })
    expect(binding.providerProfileId).not.toBe('p-router')
  })

  it('停用的同强度条目不算数（走回落）', () => {
    const config = configWith([
      { intensity: 'high', providerProfileId: 'p-high', modelId: 'opus-max' },
    ])
    config.executors[0]!.enabled = false
    const binding = resolveAutoRouterWorkerBinding({
      config,
      intensity: 'high',
      fallback: { providerProfileId: 'p-bal', modelId: 'sonnet-mid' },
    })
    expect(binding).toEqual({ providerProfileId: 'p-bal', modelId: 'sonnet-mid' })
  })
})
