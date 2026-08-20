import { describe, expect, it } from 'vitest'
import {
  createCodexNativeThreadMetadataPatch,
  readCodexNativeThreadBinding,
  readCodexNativeThreadBindings,
  shouldUsePersistentCodexAppServer,
} from '../../../services/session/codex-native-thread-binding.js'
import type { CodexNativeThreadBinding } from '../../../sdk/types.js'

const RUNTIME_FINGERPRINT = 'a'.repeat(64)
const THREAD_FINGERPRINT = 'b'.repeat(64)

function binding(index = 1): CodexNativeThreadBinding {
  return {
    bindingKey: `binding-${index}`,
    threadId: `thread-${index}`,
    runtimeFingerprint: RUNTIME_FINGERPRINT,
    threadFingerprint: THREAD_FINGERPRINT,
  }
}

describe('Codex native thread binding metadata', () => {
  it('仅对持久 responses 文本 App Server turn 启用', () => {
    const base = {
      enabled: true,
      adapterKind: 'codex' as const,
      useLocalConfig: false,
      codexApiKind: 'responses' as const,
      hasImageAttachments: false,
    }
    expect(shouldUsePersistentCodexAppServer(base)).toBe(true)
    expect(shouldUsePersistentCodexAppServer({ ...base, enabled: false })).toBe(false)
    expect(shouldUsePersistentCodexAppServer({ ...base, useLocalConfig: true })).toBe(false)
    expect(shouldUsePersistentCodexAppServer({ ...base, codexApiKind: 'chat' })).toBe(false)
    expect(shouldUsePersistentCodexAppServer({ ...base, hasImageAttachments: true })).toBe(false)
    expect(shouldUsePersistentCodexAppServer({ ...base, adapterKind: 'claude-sdk' })).toBe(false)
  })

  it('在 metadata 中往返真实 thread 绑定并保留其他 App Server 字段', () => {
    const patch = createCodexNativeThreadMetadataPatch(
      { codexAppServer: { diagnosticsEnabled: true } },
      binding(),
      '2026-08-21T00:00:00.000Z',
    )
    const metadataJson = JSON.stringify({ existing: true, ...patch })

    expect(readCodexNativeThreadBinding(metadataJson, 'binding-1')).toEqual(binding())
    expect(patch).toMatchObject({
      codexAppServer: {
        diagnosticsEnabled: true,
        version: 1,
      },
    })
  })

  it('同 key 更新覆盖旧 thread，并把历史绑定限制在最近 12 条', () => {
    let metadata: Record<string, unknown> = {}
    for (let index = 1; index <= 14; index += 1) {
      metadata = {
        ...metadata,
        ...createCodexNativeThreadMetadataPatch(
          metadata,
          binding(index),
          `2026-08-21T00:${String(index).padStart(2, '0')}:00.000Z`,
        ),
      }
    }
    const updated = { ...binding(14), threadId: 'thread-14-new' }
    metadata = {
      ...metadata,
      ...createCodexNativeThreadMetadataPatch(metadata, updated, '2026-08-21T01:00:00.000Z'),
    }

    const stored = (metadata.codexAppServer as { nativeThreadBindings: unknown[] })
      .nativeThreadBindings
    expect(stored).toHaveLength(12)
    expect(readCodexNativeThreadBinding(JSON.stringify(metadata), 'binding-14')).toEqual(updated)
    expect(readCodexNativeThreadBinding(JSON.stringify(metadata), 'binding-1')).toBeNull()
  })

  it('同一 binding key 保留不同 fingerprint 候选，支持配置切回后恢复旧 thread', () => {
    const first = binding()
    const alternate = {
      ...first,
      threadId: 'thread-alternate',
      runtimeFingerprint: 'c'.repeat(64),
    }
    let metadata: Record<string, unknown> = createCodexNativeThreadMetadataPatch(
      {},
      first,
      '2026-08-21T00:00:00.000Z',
    )
    metadata = {
      ...metadata,
      ...createCodexNativeThreadMetadataPatch(metadata, alternate, '2026-08-21T00:01:00.000Z'),
    }

    expect(readCodexNativeThreadBindings(JSON.stringify(metadata), first.bindingKey)).toEqual([
      alternate,
      first,
    ])
  })

  it('拒绝非 SHA-256 fingerprint，避免不可信元数据参与 resume', () => {
    expect(() =>
      createCodexNativeThreadMetadataPatch(
        {},
        {
          ...binding(),
          runtimeFingerprint: 'plain-secret-or-invalid-hash',
        },
      ),
    ).toThrow(/SHA-256/)
  })
})
