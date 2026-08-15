import { describe, expect, it } from 'vitest'
import type { SDKExecutorConfig } from '../../../sdk/index.js'
import {
  ClaudeSDKExecutor,
  CodexCliExecutor,
  CodexOpenAIExecutor,
  CodexSdkExecutor,
} from '../../../sdk/index.js'
import {
  createCodexExecutorForConfig,
  createDefaultEngineRegistry,
  EngineRegistry,
  type EngineDescriptor,
} from '../../../services/session/engine-registry.js'

/**
 * engine-registry 引擎注册表单测（P1-W1-D5）。
 * 锁定：descriptor 注册/读取（未注册 fail-loud）、resolveExecutor 的
 * adapter→引擎→载具三段解析、两引擎能力声明、checkAvailability 契约。
 * codex 载具三选一经 registry API 断言（原 session.service 工厂测试的等价迁移）。
 */

const anyConfig = {} as SDKExecutorConfig

describe('EngineRegistry', () => {
  it('默认注册表两引擎齐备，get 返回对应 descriptor', () => {
    const registry = createDefaultEngineRegistry()
    expect(registry.get('claude-sdk').kind).toBe('claude-sdk')
    expect(registry.get('codex').kind).toBe('codex')
  })

  it('未注册 kind 时 get 抛错（fail-loud，不静默回落）', () => {
    const registry = new EngineRegistry()
    expect(() => registry.get('claude-sdk')).toThrow(/No engine descriptor registered/)
  })

  it('register 后可覆盖同 kind descriptor（测试注入点）', () => {
    const registry = createDefaultEngineRegistry()
    const stub: EngineDescriptor = {
      kind: 'codex',
      createExecutor: () => new CodexSdkExecutor(),
      capabilities: registry.get('codex').capabilities,
      checkAvailability: async () => ({ available: true }),
    }
    registry.register(stub)
    expect(registry.get('codex')).toBe(stub)
  })
})

describe('resolveExecutor（adapter → 引擎 → 执行器）', () => {
  it("claude / claude-sdk 都解析到 ClaudeSDKExecutor（'claude' 历史值归并）", () => {
    const registry = createDefaultEngineRegistry()
    expect(registry.resolveExecutor('claude', anyConfig)).toBeInstanceOf(ClaudeSDKExecutor)
    expect(registry.resolveExecutor('claude-sdk', anyConfig)).toBeInstanceOf(ClaudeSDKExecutor)
  })

  it('codex 载具三选一：useLocalConfig → CodexCli', () => {
    const registry = createDefaultEngineRegistry()
    const executor = registry.resolveExecutor('codex', { ...anyConfig, useLocalConfig: true })
    expect(executor).toBeInstanceOf(CodexCliExecutor)
  })

  it('codex 载具三选一：codexApiKind chat / provider wireApi chat → CodexOpenAI', () => {
    const registry = createDefaultEngineRegistry()
    expect(
      registry.resolveExecutor('codex', { ...anyConfig, codexApiKind: 'chat' }),
    ).toBeInstanceOf(CodexOpenAIExecutor)
    expect(
      registry.resolveExecutor('codex', {
        ...anyConfig,
        codexCliProvider: { id: 'p1', wireApi: 'chat' },
      }),
    ).toBeInstanceOf(CodexOpenAIExecutor)
  })

  it('codex 载具三选一：默认 responses → CodexSdk', () => {
    const registry = createDefaultEngineRegistry()
    expect(registry.resolveExecutor('codex', anyConfig)).toBeInstanceOf(CodexSdkExecutor)
  })
})

describe('createCodexExecutorForConfig（原 session.service 工厂等价迁移）', () => {
  it('useLocalConfig 优先级最高，遮蔽 codexApiKind', () => {
    expect(
      createCodexExecutorForConfig({ useLocalConfig: true, codexApiKind: 'chat' }),
    ).toBeInstanceOf(CodexCliExecutor)
  })

  it('显式 codexApiKind 遮蔽 provider wireApi', () => {
    expect(
      createCodexExecutorForConfig({
        codexApiKind: 'responses',
        codexCliProvider: { id: 'p1', wireApi: 'chat' },
      }),
    ).toBeInstanceOf(CodexSdkExecutor)
  })
})

describe('能力声明与可用性检查', () => {
  it('claude：四能力全开；codex：四能力全关（P1 声明面，W2 消费）', () => {
    const registry = createDefaultEngineRegistry()
    expect(registry.get('claude-sdk').capabilities).toEqual({
      nativeResume: true,
      permissionHotSwitch: true,
      checkpointRewind: true,
      subagentTool: true,
    })
    expect(registry.get('codex').capabilities).toEqual({
      nativeResume: false,
      permissionHotSwitch: false,
      checkpointRewind: false,
      subagentTool: false,
    })
  })

  it('checkAvailability 返回契约形状；codex 现状恒可用（无二进制预检）', async () => {
    const registry = createDefaultEngineRegistry()
    const codex = await registry.get('codex').checkAvailability(anyConfig)
    expect(codex.available).toBe(true)
    const claude = await registry.get('claude-sdk').checkAvailability(anyConfig)
    expect(typeof claude.available).toBe('boolean')
    if (!claude.available) expect(claude.reason).toBeTruthy()
  })
})
