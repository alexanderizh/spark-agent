import { describe, expect, it, vi } from 'vitest'
import type { CodexNativeThreadBinding } from '../../../sdk/types.js'
import {
  buildCodexNativeThreadIdentityScope,
  buildPersistentCodexAppServerConfig,
  createCodexNativeThreadMetadataPatch,
} from '../../../services/session/codex-native-thread-binding.js'

const RUNTIME_FINGERPRINT = 'a'.repeat(64)
const THREAD_FINGERPRINT = 'b'.repeat(64)

function binding(bindingKey: string, threadId: string): CodexNativeThreadBinding {
  return {
    bindingKey,
    threadId,
    runtimeFingerprint: RUNTIME_FINGERPRINT,
    threadFingerprint: THREAD_FINGERPRINT,
  }
}

describe('SessionService persistent Codex runtime config policy', () => {
  it('普通 Host 与 mention turn 按 Agent 身份生成不同 native thread scope', () => {
    expect(buildCodexNativeThreadIdentityScope({ agentId: 'agent-1', isMentionTurn: false })).toBe(
      'native:host:agent-1',
    )
    expect(buildCodexNativeThreadIdentityScope({ agentId: 'agent-1', isMentionTurn: true })).toBe(
      'native:mention:agent-1',
    )
    expect(
      buildCodexNativeThreadIdentityScope({ agentId: 'agent-2', isMentionTurn: false }),
    ).not.toBe('native:host:agent-1')
  })

  it('为 Host 读取同 binding key 的候选并保留 fresh/fallback 历史', async () => {
    const expectedBinding = binding('host-binding', 'thread-host')
    const unrelatedBinding = binding('member-binding', 'thread-member')
    const metadata = {
      ...createCodexNativeThreadMetadataPatch({}, expectedBinding),
    }
    const withUnrelated = {
      ...metadata,
      ...createCodexNativeThreadMetadataPatch(metadata, unrelatedBinding),
    }
    const onBinding = vi.fn()

    const config = buildPersistentCodexAppServerConfig({
      runtimeLeaseKey: 'host:session-1',
      bindingKey: expectedBinding.bindingKey,
      metadataJson: JSON.stringify(withUnrelated),
      resumeFallbackSystemPrompt: 'RECOVERY_HISTORY',
      onBinding,
    })

    expect(config).toMatchObject({
      codexRuntimeLeaseKey: 'host:session-1',
      codexNativeThreadBindingKey: 'host-binding',
      codexNativeThreadBindings: [expectedBinding],
      resumeFallbackSystemPrompt: 'RECOVERY_HISTORY',
    })
    await config.codexNativeThreadBindingObserver?.(expectedBinding)
    expect(onBinding).toHaveBeenCalledOnce()
    expect(onBinding).toHaveBeenCalledWith(expectedBinding)
  })

  it('为 Host 与 Team member 生成互不相同的 lease，并在无候选时省略绑定数组', () => {
    const host = buildPersistentCodexAppServerConfig({
      runtimeLeaseKey: 'host:session-1',
      bindingKey: 'host-binding',
      metadataJson: null,
      onBinding: vi.fn(),
    })
    const member = buildPersistentCodexAppServerConfig({
      runtimeLeaseKey: 'member:session-1:discussion-member',
      bindingKey: 'discussion-member',
      metadataJson: null,
      onBinding: vi.fn(),
    })

    expect(host.codexRuntimeLeaseKey).not.toBe(member.codexRuntimeLeaseKey)
    expect(host).not.toHaveProperty('codexNativeThreadBindings')
    expect(member).not.toHaveProperty('codexNativeThreadBindings')
  })

  it('拒绝空 lease/binding key 与 turn 中途变更的 binding key', () => {
    expect(() =>
      buildPersistentCodexAppServerConfig({
        runtimeLeaseKey: ' ',
        bindingKey: 'binding',
        metadataJson: null,
        onBinding: vi.fn(),
      }),
    ).toThrow(/non-empty lease and binding keys/)

    const onBinding = vi.fn()
    const config = buildPersistentCodexAppServerConfig({
      runtimeLeaseKey: 'host:session-1',
      bindingKey: 'binding',
      metadataJson: null,
      onBinding,
    })
    expect(() => config.codexNativeThreadBindingObserver?.(binding('changed', 'thread-1'))).toThrow(
      /binding key changed/,
    )
    expect(onBinding).not.toHaveBeenCalled()
  })
})
