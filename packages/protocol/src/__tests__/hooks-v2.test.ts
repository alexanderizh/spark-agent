import { describe, expect, it } from 'vitest'
import { HOOK_V2_CHANNELS, HookV2IpcSchemaRegistry } from '../hooks-v2'

/**
 * hookV2 IPC 通道契约：每个通道在 IpcSchemaRegistry 中注册的 zod schema 必须接受
 * 处理器实际会产生的请求形状——防止 TS 类型与 zod 校验漂移导致渲染层调用在
 * 运行时被拒（typedIpcHandle 请求侧走 schema.parse）。
 */

const SAMPLE_REQUESTS: Record<(typeof HOOK_V2_CHANNELS)[number], unknown> = {
  'hookV2:list-definitions': {},
  'hookV2:create-definition': {
    definition: {
      name: '回答落库后发 Webhook',
      eventName: 'response.committed',
      action: {
        type: 'tool.invoke',
        target: {
          sourceKind: 'tool-package',
          sourceId: 'webhook-package',
          version: '1.0.0',
          toolName: 'send',
          qualifiedName: 'webhook.send',
        },
      },
      inputMapping: { summary: { path: 'payload.response.finalText' } },
    },
  },
  'hookV2:update-definition': {
    id: 'def-1',
    patch: { timeoutMs: 20_000 },
  },
  'hookV2:delete-definition': { id: 'def-1' },
  'hookV2:validate-definition': {
    definition: {
      name: 'sound',
      eventName: 'turn.completed',
      action: { type: 'builtin.sound' },
    },
  },
  'hookV2:list-bindings': { hookId: 'def-1' },
  'hookV2:upsert-binding': {
    binding: {
      hookId: 'def-1',
      scopeKind: 'application',
      enabled: true,
      authorizeExecutionHash: 'hash',
    },
  },
  'hookV2:list-effective': { sessionId: 'session-1' },
  'hookV2:list-runs': { sessionId: 'session-1', limit: 20 },
  'hookV2:get-run': { id: 'run-1' },
  'hookV2:retry-run': { id: 'run-1' },
  'hookV2:cancel-run': { id: 'run-1' },
  'hookV2:get-system-status': {},
  'hookV2:set-enabled': { enabled: false },
  'hookV2:list-tool-candidates': {},
  'hookV2:preview': {
    definition: {
      name: 'preview',
      eventName: 'response.committed',
      action: { type: 'builtin.notification', title: { const: '新回答' } },
      inputMapping: { sessionId: { path: 'session.id' } },
    },
  },
  'hookV2:test-run': {
    definition: {
      name: 'test run',
      eventName: 'response.committed',
      action: { type: 'builtin.notification', title: { const: '测试通知' } },
      inputMapping: {},
    },
  },
}

describe('hookV2 IPC contracts', () => {
  it('每个 hookV2 通道都有 schema 注册且样例请求可通过校验', () => {
    for (const channel of HOOK_V2_CHANNELS) {
      const schema = HookV2IpcSchemaRegistry[channel]
      expect(schema, `missing schema for ${channel}`).toBeDefined()
      expect(
        schema.parse(SAMPLE_REQUESTS[channel]),
        `schema rejects sample for ${channel}`,
      ).toEqual(expect.anything())
    }
  })

  it('通道清单与 schema registry 键完全一致（无遗漏/多余）', () => {
    expect(Object.keys(HookV2IpcSchemaRegistry).sort()).toEqual([...HOOK_V2_CHANNELS].sort())
  })

  it('拒绝非法载荷：未知字段、越权事件名、destructive 之外的结构错误', () => {
    expect(() => HookV2IpcSchemaRegistry['hookV2:set-enabled'].parse({ enabled: 'yes' })).toThrow()
    expect(() =>
      HookV2IpcSchemaRegistry['hookV2:list-definitions'].parse({ eventName: 'tool.before' }),
    ).toThrow()
    expect(() =>
      HookV2IpcSchemaRegistry['hookV2:create-definition'].parse({
        definition: { name: 'x', eventName: 'turn.completed' },
      }),
    ).toThrow()
    expect(() =>
      HookV2IpcSchemaRegistry['hookV2:get-run'].parse({ id: 'run-1', extra: true }),
    ).toThrow()
  })
})
