/**
 * 移动桥渠道切换会话引擎校准的聚焦测试。
 *
 * 背景：移动端 PATCH /v1/sessions/:id 只带 provider/model，不带引擎；此前
 * codex 会话切到 Anthropic 协议渠道不校准，下一轮 turn 撞
 * assertEngineProviderCompatible 守卫直接报错（小程序「切换模型报错」根因）。
 * 覆盖：跨协议校准 + 权限档位回落、兼容不动、悬空渠道 id 拒绝、会话行缺失放行。
 */
import { describe, expect, it } from 'vitest'

import { SparkError } from '@spark/shared'
import type { ProviderProfile } from '@spark/protocol'

import { calibrateMobileBridgeSessionAdapter } from './mobile-bridge-session-adapter.js'

function chatProvider(overrides: Partial<ProviderProfile> & { id: string }): ProviderProfile {
  return {
    name: overrides.id,
    provider: 'anthropic',
    providerType: 'anthropic',
    enabled: true,
    defaultModel: 'glm-5.3',
    modelIds: ['glm-5.3'],
    keystoreRef: '',
    isDefault: false,
    ...overrides,
  } as ProviderProfile
}

const anthropicChannel = chatProvider({
  id: 'ark',
  provider: 'anthropic',
  providerType: 'anthropic',
})
const openaiChannel = chatProvider({
  id: 'openai',
  provider: 'openai',
  providerType: 'openai',
  defaultModel: 'gpt-5.2',
  modelIds: ['gpt-5.2'],
})

function buildInput(overrides: {
  providers?: ProviderProfile[]
  currentAdapter?: string | null
  providerProfileId?: string
}) {
  const providers = overrides.providers ?? [anthropicChannel, openaiChannel]
  return {
    sessionId: 's1',
    providerProfileId: overrides.providerProfileId ?? 'ark',
    providers,
    getCurrentAdapter: () =>
      overrides.currentAdapter !== undefined ? overrides.currentAdapter : 'codex',
  }
}

describe('calibrateMobileBridgeSessionAdapter', () => {
  it('codex 会话切 Anthropic 渠道：校准 claude-sdk 并回落权限档位（根因组合）', async () => {
    const calibration = await calibrateMobileBridgeSessionAdapter(buildInput({}))
    expect(calibration).toEqual({ agentAdapter: 'claude-sdk', permissionMode: 'claude-auto' })
  })

  it('claude-sdk 会话切 OpenAI 渠道：校准 codex 并回落 codex 权限档位', async () => {
    const calibration = await calibrateMobileBridgeSessionAdapter(
      buildInput({ providerProfileId: 'openai', currentAdapter: 'claude-sdk' }),
    )
    expect(calibration).toEqual({
      agentAdapter: 'codex',
      permissionMode: 'codex-auto-review',
    })
  })

  it('引擎兼容时返回 null（不动会话引擎与权限）', async () => {
    await expect(
      calibrateMobileBridgeSessionAdapter(buildInput({ currentAdapter: 'claude-sdk' })),
    ).resolves.toBeNull()
    await expect(
      calibrateMobileBridgeSessionAdapter(
        buildInput({ providerProfileId: 'openai', currentAdapter: 'codex' }),
      ),
    ).resolves.toBeNull()
    // spark 引擎可执行 Anthropic 渠道，保留不校准
    await expect(
      calibrateMobileBridgeSessionAdapter(buildInput({ currentAdapter: 'spark' })),
    ).resolves.toBeNull()
  })

  it('悬空渠道 id 抛 SparkError（此前假成功、下一轮 turn 才报错）', async () => {
    await expect(
      calibrateMobileBridgeSessionAdapter(buildInput({ providerProfileId: 'deleted' })),
    ).rejects.toBeInstanceOf(SparkError)
  })

  it('会话行缺失返回 null（交由 SessionService 按既有行为报错）', async () => {
    await expect(
      calibrateMobileBridgeSessionAdapter(buildInput({ currentAdapter: null })),
    ).resolves.toBeNull()
  })
})
