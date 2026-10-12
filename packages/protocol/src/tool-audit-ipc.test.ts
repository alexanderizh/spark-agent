/**
 * 工具审计 IPC 契约测试 — 五通道的 zod 校验与「协议 ↔ storage CHECK」枚举对齐。
 *
 * 为什么值得单测：wire 枚举（protocol）与库枚举（migration 121 CHECK 约束）是
 * 两份手写清单，任何一侧加值漏改另一侧，main 侧 `as` 映射不报警、值直达
 * 渲染端才炸。这里把两侧的字面量集合钉死，漂移即测试失败。
 */

import { describe, it, expect } from 'vitest'
import type { ToolAuditIpcChannelMap } from './tool-audit.js'
import {
  ToolAuditIpcSchemaRegistry,
  type ToolAuditSourceKind,
  type ToolAuditStatus,
  type ToolAuditInvocationSource,
} from './tool-audit.js'

type Channel = keyof ToolAuditIpcChannelMap

/** migration 121 CHECK 约束的 source_kind 全集（storage 侧真值）。 */
const STORAGE_SOURCE_KINDS = [
  'sdk-builtin',
  'mcp',
  'custom-tool',
  'tool-package',
  'connector',
  'workflow',
  'hook',
  'test',
] as const

/** migration 121 CHECK 约束的 status 全集（storage 侧真值）。 */
const STORAGE_STATUSES = [
  'running',
  'ok',
  'error',
  'timeout',
  'denied',
  'cancelled',
  'stale',
] as const

/** migration 121 CHECK 约束的 invocation_source 全集（storage 侧真值）。 */
const STORAGE_INVOCATION_SOURCES = [
  'model',
  'workflow',
  'test',
  'platform',
  'nested',
  'hook',
] as const

const SESSION_ID = 'sess-0123456789abcdef'

describe('ToolAudit IPC 契约', () => {
  it('五通道齐备且都在 SchemaRegistry 里登记', () => {
    const expected: Channel[] = [
      'tool-audit:list',
      'tool-audit:detail',
      'tool-audit:read-payload',
      'tool-audit:stats',
      'tool-audit:verify-chain',
    ]
    for (const channel of expected) {
      expect(Object.keys(ToolAuditIpcSchemaRegistry)).toContain(channel)
    }
    expect(Object.keys(ToolAuditIpcSchemaRegistry)).toHaveLength(expected.length)
  })

  it('wire 枚举与 storage CHECK 约束一致（sourceKind / status / invocationSource）', () => {
    const sourceKinds: ToolAuditSourceKind[] = [...STORAGE_SOURCE_KINDS]
    const statuses: ToolAuditStatus[] = [...STORAGE_STATUSES]
    const invocationSources: ToolAuditInvocationSource[] = [...STORAGE_INVOCATION_SOURCES]
    const listSchema = ToolAuditIpcSchemaRegistry['tool-audit:list']
    for (const sourceKind of sourceKinds) {
      expect(listSchema.safeParse({ sessionId: SESSION_ID, sourceKind }).success).toBe(true)
    }
    for (const status of statuses) {
      expect(listSchema.safeParse({ sessionId: SESSION_ID, status }).success).toBe(true)
    }
    for (const invocationSource of invocationSources) {
      expect(listSchema.safeParse({ sessionId: SESSION_ID, invocationSource }).success).toBe(true)
    }
    // 封闭性：任意一侧私有值都不应通过
    expect(listSchema.safeParse({ sessionId: SESSION_ID, sourceKind: 'nope' }).success).toBe(false)
    expect(listSchema.safeParse({ sessionId: SESSION_ID, status: 'nope' }).success).toBe(false)
  })

  it('list 参数边界：limit ≤ 200、cursor 正整数、sessionId 非空', () => {
    const schema = ToolAuditIpcSchemaRegistry['tool-audit:list']
    expect(schema.safeParse({ sessionId: '' }).success).toBe(false)
    expect(schema.safeParse({ sessionId: SESSION_ID, limit: 0 }).success).toBe(false)
    expect(schema.safeParse({ sessionId: SESSION_ID, limit: 201 }).success).toBe(false)
    expect(schema.safeParse({ sessionId: SESSION_ID, limit: 200 }).success).toBe(true)
    expect(schema.safeParse({ sessionId: SESSION_ID, cursor: 0 }).success).toBe(false)
    expect(schema.safeParse({ sessionId: SESSION_ID, cursor: 1 }).success).toBe(true)
    // strict：多余字段拒绝（防渲染端手滑把行对象当过滤参数传）
    expect(schema.safeParse({ sessionId: SESSION_ID, unexpected: true }).success).toBe(false)
  })

  it('read-payload 的 artifactId 必须是 sha256 hex（64 位小写十六进制）', () => {
    const schema = ToolAuditIpcSchemaRegistry['tool-audit:read-payload']
    const sha = 'a'.repeat(64)
    expect(schema.safeParse({ artifactId: sha }).success).toBe(true)
    expect(schema.safeParse({ artifactId: 'A'.repeat(64) }).success).toBe(false)
    expect(schema.safeParse({ artifactId: 'a'.repeat(63) }).success).toBe(false)
    expect(schema.safeParse({ artifactId: '../../etc/passwd' }).success).toBe(false)
    expect(schema.safeParse({ artifactId: sha, limit: 40_001 }).success).toBe(false)
    expect(schema.safeParse({ artifactId: sha, limit: 40_000 }).success).toBe(true)
    expect(schema.safeParse({ artifactId: sha, offset: -1 }).success).toBe(false)
  })

  it('detail 只收 uuid（行 id 由采集层 randomUUID 生成）', () => {
    const schema = ToolAuditIpcSchemaRegistry['tool-audit:detail']
    expect(schema.safeParse({ id: '0f1e2d3c-4b5a-6978-8976-a5b4c3d2e1f0' }).success).toBe(true)
    expect(schema.safeParse({ id: 'not-a-uuid' }).success).toBe(false)
    expect(schema.safeParse({ id: '' }).success).toBe(false)
  })

  it('stats / verify-chain 只按会话查询（sessionId 非空上限 128）', () => {
    expect(
      ToolAuditIpcSchemaRegistry['tool-audit:stats'].safeParse({ sessionId: SESSION_ID }).success,
    ).toBe(true)
    expect(
      ToolAuditIpcSchemaRegistry['tool-audit:stats'].safeParse({ sessionId: '' }).success,
    ).toBe(false)
    expect(
      ToolAuditIpcSchemaRegistry['tool-audit:verify-chain'].safeParse({ sessionId: SESSION_ID })
        .success,
    ).toBe(true)
    expect(
      ToolAuditIpcSchemaRegistry['tool-audit:verify-chain'].safeParse({
        sessionId: 'x'.repeat(129),
      }).success,
    ).toBe(false)
  })
})
