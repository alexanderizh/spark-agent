import { describe, expect, it } from 'vitest'

import {
  createSparkLedgerBindingPatch,
  createSparkLedgerClearPatch,
  readSparkLedgerSessionId,
} from '../../../services/session/spark-ledger-binding.js'

describe('spark ledger binding', () => {
  it('无 metadata / 空 key 返回 null', () => {
    expect(readSparkLedgerSessionId(null, 'key-a')).toBeNull()
    expect(readSparkLedgerSessionId('', 'key-a')).toBeNull()
    expect(readSparkLedgerSessionId('{}', '')).toBeNull()
  })

  it('binding roundtrip：patch 写入后按 bindingKey 读回', () => {
    const metadata: Record<string, unknown> = {}
    const patch = createSparkLedgerBindingPatch(metadata, {
      bindingKey: 'key-a',
      sparkSessionId: 'engine-session-1',
    })
    Object.assign(metadata, patch)
    expect(readSparkLedgerSessionId(JSON.stringify(metadata), 'key-a')).toBe('engine-session-1')
    expect(readSparkLedgerSessionId(JSON.stringify(metadata), 'key-b')).toBeNull()
  })

  it('同 key 重复绑定去重，保留最新', () => {
    let metadata: Record<string, unknown> = {}
    metadata = {
      ...metadata,
      ...createSparkLedgerBindingPatch(metadata, {
        bindingKey: 'key-a',
        sparkSessionId: 'old-session',
      }),
    }
    metadata = {
      ...metadata,
      ...createSparkLedgerBindingPatch(metadata, {
        bindingKey: 'key-a',
        sparkSessionId: 'new-session',
      }),
    }
    const parsed = JSON.parse(JSON.stringify(metadata)) as {
      sparkLedger: { sessionBindings: Array<{ bindingKey: string }> }
    }
    const forKeyA = parsed.sparkLedger.sessionBindings.filter((b) => b.bindingKey === 'key-a')
    expect(forKeyA).toHaveLength(1)
    expect(readSparkLedgerSessionId(JSON.stringify(metadata), 'key-a')).toBe('new-session')
  })

  it('绑定数量上限 12 条，最旧的被淘汰', () => {
    let metadata: Record<string, unknown> = {}
    for (let i = 0; i < 14; i += 1) {
      metadata = {
        ...metadata,
        ...createSparkLedgerBindingPatch(metadata, {
          bindingKey: `key-${String(i).padStart(2, '0')}`,
          sparkSessionId: `session-${i}`,
        }),
      }
    }
    const parsed = JSON.parse(JSON.stringify(metadata)) as {
      sparkLedger: { sessionBindings: string[] }
    }
    expect(parsed.sparkLedger.sessionBindings).toHaveLength(12)
    // 最早两条（00/01）被淘汰，最新（13）在列。
    expect(readSparkLedgerSessionId(JSON.stringify(metadata), 'key-00')).toBeNull()
    expect(readSparkLedgerSessionId(JSON.stringify(metadata), 'key-01')).toBeNull()
    expect(readSparkLedgerSessionId(JSON.stringify(metadata), 'key-13')).toBe('session-13')
  })

  it('坏数据（非法 JSON / 缺字段 / 超长 id）静默返回 null', () => {
    expect(readSparkLedgerSessionId('not-json{', 'key-a')).toBeNull()
    const badShape = JSON.stringify({
      sparkLedger: { sessionBindings: [{ bindingKey: 'key-a' }, 'nonsense', 42] },
    })
    expect(readSparkLedgerSessionId(badShape, 'key-a')).toBeNull()
    const tooLong = JSON.stringify({
      sparkLedger: {
        sessionBindings: [{ bindingKey: 'key-a', sparkSessionId: 'x'.repeat(200), updatedAt: 't' }],
      },
    })
    expect(readSparkLedgerSessionId(tooLong, 'key-a')).toBeNull()
  })

  it('空字段 / 超长 id 写入直接抛错', () => {
    expect(() =>
      createSparkLedgerBindingPatch({}, { bindingKey: ' ', sparkSessionId: 's' }),
    ).toThrow()
    expect(() =>
      createSparkLedgerBindingPatch({}, { bindingKey: 'k', sparkSessionId: 'x'.repeat(200) }),
    ).toThrow()
  })

  it('clear patch 清空绑定并保留 sparkLedger 下其他字段', () => {
    let metadata: Record<string, unknown> = {}
    metadata = {
      ...metadata,
      ...createSparkLedgerBindingPatch(metadata, {
        bindingKey: 'key-a',
        sparkSessionId: 'session-1',
      }),
    }
    const withExtra = {
      ...metadata,
      sparkLedger: { ...(metadata.sparkLedger as object), futureField: 1 },
    }
    const cleared = createSparkLedgerClearPatch(withExtra)
    expect(cleared.sparkLedger).toMatchObject({ version: 1, sessionBindings: [], futureField: 1 })
    expect(readSparkLedgerSessionId(JSON.stringify(cleared), 'key-a')).toBeNull()
  })
})
