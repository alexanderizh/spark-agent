import { describe, expect, it } from 'vitest'
import type { HookConditionV1, HookEventEnvelopeV1, HookValueExpressionV1 } from '@spark/protocol'
import {
  computeExecutionHash,
  deriveEventId,
  evaluateCondition,
  evaluateInputMapping,
  evaluateValueExpression,
  HookMappingError,
  isAllowedEventPath,
  validateDefinitionInput,
} from './hook-expression.js'

function makeEnvelope(overrides: Partial<HookEventEnvelopeV1> = {}): HookEventEnvelopeV1 {
  return {
    schemaVersion: 1,
    eventId: 'evt-1',
    eventName: 'response.committed',
    occurredAt: '2026-09-12T00:00:00.000Z',
    source: 'host',
    session: { id: 'session-1', title: '测试会话' },
    turn: { id: 'turn-1' },
    agent: { id: 'agent-1', name: '主 Agent' },
    workspaces: [{ id: 'ws-1', name: '项目A' }],
    primaryWorkspaceId: 'ws-1',
    payload: { response: { messageId: 'msg-1', finalText: '最终回答正文' } },
    ...overrides,
  }
}

describe('hook-expression 事件路径白名单', () => {
  it('允许信封公共字段与事件 payload 白名单', () => {
    expect(isAllowedEventPath('response.committed', 'session.id')).toBe(true)
    expect(isAllowedEventPath('response.committed', 'payload.response.finalText')).toBe(true)
    expect(isAllowedEventPath('turn.completed', 'payload.response.finalText')).toBe(false)
    expect(isAllowedEventPath('turn.failed', 'payload.message')).toBe(true)
    expect(isAllowedEventPath('response.committed', 'system.prompt')).toBe(false)
    expect(isAllowedEventPath('response.committed', '__proto__.x')).toBe(false)
    expect(isAllowedEventPath('response.committed', 'constructor.prototype')).toBe(false)
  })

  it('按路径读取事件字段；数组用数字索引', () => {
    const envelope = makeEnvelope()
    expect(evaluateValueExpression(envelope, { path: 'session.id' })).toBe('session-1')
    expect(evaluateValueExpression(envelope, { path: 'payload.response.finalText' })).toBe(
      '最终回答正文',
    )
    expect(evaluateValueExpression(envelope, { path: 'workspaces.0.name' })).toBe('项目A')
    expect(evaluateValueExpression(envelope, { path: 'payload.response.missing' })).toBeUndefined()
  })

  it('路径越权时读取返回 undefined（不抛错，映射校验单独拦截）', () => {
    const envelope = makeEnvelope()
    expect(evaluateValueExpression(envelope, { path: 'system.prompt' })).toBeUndefined()
  })
})

describe('hook-expression 条件与模板', () => {
  it('常量/模板求值', () => {
    const envelope = makeEnvelope()
    expect(evaluateValueExpression(envelope, { const: '固定值' })).toBe('固定值')
    expect(
      evaluateValueExpression(envelope, {
        template: '会话 ${session.id} 的回答已提交',
      }),
    ).toBe('会话 session-1 的回答已提交')
  })

  it('eq/notEq/exists/contains/startsWith/and/or/not', () => {
    const envelope = makeEnvelope()
    const eq = (left: HookValueExpressionV1, right: HookValueExpressionV1): HookConditionV1 => ({
      operator: 'eq',
      left,
      right,
    })
    expect(evaluateCondition(envelope, eq({ path: 'session.id' }, { const: 'session-1' }))).toBe(
      true,
    )
    expect(
      evaluateCondition(envelope, {
        operator: 'notEq',
        left: { path: 'session.id' },
        right: { const: 'other' },
      }),
    ).toBe(true)
    expect(
      evaluateCondition(envelope, { operator: 'exists', left: { path: 'session.title' } }),
    ).toBe(true)
    expect(
      evaluateCondition(envelope, { operator: 'exists', left: { path: 'agent.missing' } }),
    ).toBe(false)
    expect(
      evaluateCondition(envelope, {
        operator: 'contains',
        left: { path: 'payload.response.finalText' },
        right: { const: '回答' },
      }),
    ).toBe(true)
    expect(
      evaluateCondition(envelope, {
        operator: 'startsWith',
        left: { path: 'payload.response.finalText' },
        right: { const: '最终' },
      }),
    ).toBe(true)
    expect(
      evaluateCondition(envelope, {
        operator: 'and',
        conditions: [
          { operator: 'exists', left: { path: 'session.title' } },
          { operator: 'not', condition: { operator: 'exists', left: { path: 'agent.missing' } } },
        ],
      }),
    ).toBe(true)
    expect(
      evaluateCondition(envelope, {
        operator: 'or',
        conditions: [
          { operator: 'exists', left: { path: 'agent.missing' } },
          { operator: 'eq', left: { path: 'turn.id' }, right: { const: 'turn-1' } },
        ],
      }),
    ).toBe(true)
  })
})

describe('hook-expression 映射评估', () => {
  it('映射结果包含事件字段与常量', () => {
    const mapped = evaluateInputMapping(makeEnvelope(), {
      summary: { path: 'payload.response.finalText' },
      sessionId: { path: 'session.id' },
      source: { const: 'sparkwork-hook' },
      label: { template: '[${session.title}] 回答完成' },
    })
    expect(mapped).toEqual({
      summary: '最终回答正文',
      sessionId: 'session-1',
      source: 'sparkwork-hook',
      label: '[测试会话] 回答完成',
    })
  })

  it('越权路径与缺失字段抛 HookMappingError', () => {
    expect(() => evaluateInputMapping(makeEnvelope(), { bad: { path: 'system.prompt' } })).toThrow(
      HookMappingError,
    )
    expect(() =>
      evaluateInputMapping(makeEnvelope(), { missing: { path: 'agent.missing' } }),
    ).toThrow(HookMappingError)
  })
})

describe('hook-expression 执行哈希与事件 ID', () => {
  it('executionHash 对执行字段敏感、对名称/描述不敏感', () => {
    const base = {
      eventName: 'response.committed' as const,
      action: { type: 'builtin.sound' } as const,
      inputMapping: {},
      timeoutMs: 15_000,
      retryPolicy: { mode: 'unsafe' as const, maxAttempts: 3, backoffMs: 1000 },
      concurrencyPolicy: 'serial_per_session' as const,
    }
    const hash1 = computeExecutionHash(base)
    const hash2 = computeExecutionHash({ ...base, timeoutMs: 20_000 })
    expect(hash1).not.toBe(hash2)
    // 名称/描述/enabled 不参与：通过相同执行字段得到相同哈希
    const hash3 = computeExecutionHash({ ...base })
    expect(hash1).toBe(hash3)
    // 键序不影响规范化哈希
    const hash4 = computeExecutionHash({
      concurrencyPolicy: 'serial_per_session',
      retryPolicy: { backoffMs: 1000, maxAttempts: 3, mode: 'unsafe' },
      timeoutMs: 15_000,
      inputMapping: {},
      action: { type: 'builtin.sound' },
      eventName: 'response.committed',
    })
    expect(hash1).toBe(hash4)
  })

  it('deriveEventId 确定性生成', () => {
    expect(deriveEventId('turn.completed', 'turn-9')).toBe(
      deriveEventId('turn.completed', 'turn-9'),
    )
    expect(deriveEventId('turn.completed', 'turn-9')).not.toBe(
      deriveEventId('turn.failed', 'turn-9'),
    )
  })
})

describe('hook-expression 定义静态校验', () => {
  it('合法定义无错误', () => {
    const errors = validateDefinitionInput({
      name: 'webhook',
      eventName: 'response.committed',
      action: {
        type: 'tool.invoke',
        target: {
          sourceKind: 'tool-package',
          sourceId: 'pkg',
          toolName: 'send',
          qualifiedName: 'webhook.send',
        },
      },
      inputMapping: { summary: { path: 'payload.response.finalText' } },
    })
    expect(errors).toEqual([])
  })

  it('越权映射路径与缺失工具引用会被拒绝', () => {
    const errors = validateDefinitionInput({
      name: 'bad',
      eventName: 'response.committed',
      action: {
        type: 'tool.invoke',
        target: { sourceKind: 'connector', sourceId: '', toolName: '', qualifiedName: '' },
      },
      inputMapping: { leak: { path: 'system.prompt' } },
    })
    expect(errors.length).toBeGreaterThanOrEqual(4)
    expect(errors.some((e) => e.includes('sourceId'))).toBe(true)
    expect(errors.some((e) => e.includes('system.prompt'))).toBe(true)
  })
})
