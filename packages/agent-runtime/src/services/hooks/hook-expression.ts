import { createHash } from 'node:crypto'
import type {
  HookConditionV1,
  HookDefinitionInputV1,
  HookDefinitionV1,
  HookEventEnvelopeV1,
  HookEventNameV1,
  HookValueExpressionV1,
} from '@spark/protocol'

/**
 * 受限表达式模型（设计方案 §8.2）：路径只允许访问当前事件 Schema 中公开的字段，
 * 不提供任意反射、宿主对象或文件/环境读取能力。
 */

const COMMON_ALLOWED_PATHS = new Set([
  'schemaVersion',
  'eventId',
  'eventName',
  'occurredAt',
  'source',
  'session',
  'session.id',
  'session.title',
  'turn',
  'turn.id',
  'agent',
  'agent.id',
  'agent.name',
  'workspaces',
  'primaryWorkspaceId',
])

const PAYLOAD_PATHS_BY_EVENT: Record<HookEventNameV1, readonly string[]> = {
  'turn.started': [],
  'permission.requested': [
    'payload',
    'payload.requestId',
    'payload.toolName',
    'payload.action',
    'payload.riskLevel',
  ],
  'question.requested': ['payload', 'payload.questionId', 'payload.questions'],
  'response.committed': [
    'payload',
    'payload.response',
    'payload.response.messageId',
    'payload.response.finalText',
  ],
  'turn.completed': ['payload', 'payload.message'],
  'turn.failed': ['payload', 'payload.message'],
  'turn.cancelled': ['payload', 'payload.message'],
}

/** 校验路径是否在事件白名单内（仅做静态校验，不做求值）。 */
export function isAllowedEventPath(eventName: HookEventNameV1, path: string): boolean {
  if (!/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)*$/.test(path)) return false
  if (COMMON_ALLOWED_PATHS.has(path)) return true
  // 数组索引形式：workspaces.<n>.id / workspaces.<n>.name
  if (/^workspaces\.\d+\.(id|name)$/.test(path)) return true
  return (PAYLOAD_PATHS_BY_EVENT[eventName] ?? []).includes(path)
}

/** 按白名单路径读取事件信封字段；数组用数字段索引（如 workspaces.0.id）。 */
export function readEventPath(envelope: HookEventEnvelopeV1, path: string): unknown {
  if (!isAllowedEventPath(envelope.eventName, path)) return undefined
  const segments = path.split('.')
  let current: unknown = envelope
  for (const segment of segments) {
    if (current == null) return undefined
    if (Array.isArray(current)) {
      const index = Number(segment)
      if (!Number.isInteger(index) || index < 0 || index >= current.length) return undefined
      current = current[index]
      continue
    }
    if (typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

export function evaluateValueExpression(
  envelope: HookEventEnvelopeV1,
  expression: HookValueExpressionV1,
): unknown {
  if ('const' in expression) return expression.const
  if ('path' in expression) return readEventPath(envelope, expression.path)
  // 模板字符串：${path} 占位符替换；占位符路径同样受白名单约束。
  const template = expression.template
  const evaluated = template.replace(/\$\{([^}]+)\}/g, (_match, rawPath: string) => {
    const value = readEventPath(envelope, rawPath.trim())
    if (value == null) return ''
    return typeof value === 'object' ? JSON.stringify(value) : String(value)
  })
  return evaluated
}

function asComparableText(value: unknown): string | null {
  if (value == null) return null
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return null
}

export function evaluateCondition(
  envelope: HookEventEnvelopeV1,
  condition: HookConditionV1,
): boolean {
  switch (condition.operator) {
    case 'and':
      return condition.conditions.every((inner) => evaluateCondition(envelope, inner))
    case 'or':
      return condition.conditions.some((inner) => evaluateCondition(envelope, inner))
    case 'not':
      return !evaluateCondition(envelope, condition.condition)
    case 'exists':
      return 'path' in condition.left && readEventPath(envelope, condition.left.path) != null
    case 'eq': {
      const left = evaluateValueExpression(envelope, condition.left)
      const right = evaluateValueExpression(envelope, condition.right)
      if (typeof left === 'object' || typeof right === 'object') return false
      return left === right
    }
    case 'notEq': {
      const left = evaluateValueExpression(envelope, condition.left)
      const right = evaluateValueExpression(envelope, condition.right)
      if (typeof left === 'object' || typeof right === 'object') return true
      return left !== right
    }
    case 'contains': {
      const left = asComparableText(evaluateValueExpression(envelope, condition.left))
      const right = asComparableText(evaluateValueExpression(envelope, condition.right))
      if (left == null || right == null) return false
      return left.includes(right)
    }
    case 'startsWith': {
      const left = asComparableText(evaluateValueExpression(envelope, condition.left))
      const right = asComparableText(evaluateValueExpression(envelope, condition.right))
      if (left == null || right == null) return false
      return left.startsWith(right)
    }
    default:
      return false
  }
}

/** 映射失败错误：执行前映射评估失败时不得调用动作。 */
export class HookMappingError extends Error {
  constructor(
    message: string,
    readonly field: string,
  ) {
    super(message)
    this.name = 'HookMappingError'
  }
}

export function evaluateInputMapping(
  envelope: HookEventEnvelopeV1,
  mapping: Record<string, HookValueExpressionV1>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [field, expression] of Object.entries(mapping)) {
    if ('path' in expression) {
      if (!isAllowedEventPath(envelope.eventName, expression.path)) {
        throw new HookMappingError(`映射路径越权：${expression.path}`, field)
      }
    }
    const value = evaluateValueExpression(envelope, expression)
    if (value === undefined) {
      throw new HookMappingError(`映射字段 ${field} 在事件中不存在`, field)
    }
    result[field] = value
  }
  return result
}

// ─── 定义静态校验 ─────────────────────────────────────────────────────────────

function collectValueExpressionIssues(
  eventName: HookEventNameV1,
  expression: HookValueExpressionV1,
  context: string,
  errors: string[],
): void {
  if ('path' in expression && !isAllowedEventPath(eventName, expression.path)) {
    errors.push(`${context}: 映射路径不在事件白名单内（${expression.path}）`)
  }
  if ('template' in expression) {
    const placeholderPaths = [...expression.template.matchAll(/\$\{([^}]+)\}/g)].map(
      (m) => m[1]?.trim() ?? '',
    )
    for (const path of placeholderPaths) {
      if (!isAllowedEventPath(eventName, path)) {
        errors.push(`${context}: 模板占位路径不在事件白名单内（${path}）`)
      }
    }
  }
}

/** 保存/启用前的静态校验（设计方案 §8.2：按事件 Schema 完成校验）。 */
export function validateDefinitionInput(input: HookDefinitionInputV1): string[] {
  const errors: string[] = []
  if (input.action.type === 'tool.invoke') {
    const target = input.action.target
    if (target.sourceId.trim() === '') errors.push('tool.invoke 目标缺少 sourceId')
    if (target.toolName.trim() === '') errors.push('tool.invoke 目标缺少 toolName')
    if (target.qualifiedName.trim() === '') errors.push('tool.invoke 目标缺少 qualifiedName')
  }
  if (input.condition != null) {
    validateConditionPaths(input.eventName, input.condition, 'condition', errors)
  }
  for (const [field, expression] of Object.entries(input.inputMapping ?? {})) {
    collectValueExpressionIssues(input.eventName, expression, `inputMapping.${field}`, errors)
  }
  if (input.action.type === 'builtin.notification') {
    if (input.action.title != null) {
      collectValueExpressionIssues(input.eventName, input.action.title, 'action.title', errors)
    }
    if (input.action.body != null) {
      collectValueExpressionIssues(input.eventName, input.action.body, 'action.body', errors)
    }
  }
  return errors
}

function validateConditionPaths(
  eventName: HookEventNameV1,
  condition: HookConditionV1,
  context: string,
  errors: string[],
): void {
  switch (condition.operator) {
    case 'and':
    case 'or':
      condition.conditions.forEach((inner, index) =>
        validateConditionPaths(eventName, inner, `${context}.conditions[${index}]`, errors),
      )
      break
    case 'not':
      validateConditionPaths(eventName, condition.condition, `${context}.condition`, errors)
      break
    case 'exists':
      if (!('path' in condition.left) || !isAllowedEventPath(eventName, condition.left.path)) {
        errors.push(`${context}: exists 条件必须是事件白名单内的路径表达式`)
      }
      break
    default:
      collectValueExpressionIssues(eventName, condition.left, `${context}.left`, errors)
      collectValueExpressionIssues(eventName, condition.right, `${context}.right`, errors)
      break
  }
}

// ─── 执行哈希 ────────────────────────────────────────────────────────────────

/** 规范化序列化：键递归排序，保证同语义定义得到同一哈希。 */
function stableStringify(value: unknown): string {
  if (value == null) return 'null'
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`)
    return `{${entries.join(',')}}`
  }
  return JSON.stringify(value)
}

/**
 * executionHash：对事件、条件、映射、动作目标、超时、重试和并发策略做规范化哈希。
 * 名称、描述、enabled 不参与——修改它们不会使授权失效（设计方案 §10.1）。
 */
export function computeExecutionHash(
  input: Pick<
    HookDefinitionInputV1 | HookDefinitionV1,
    | 'eventName'
    | 'condition'
    | 'action'
    | 'inputMapping'
    | 'timeoutMs'
    | 'retryPolicy'
    | 'concurrencyPolicy'
  >,
): string {
  const canonical = {
    eventName: input.eventName,
    condition: input.condition ?? null,
    action: input.action,
    inputMapping: input.inputMapping ?? {},
    timeoutMs: input.timeoutMs,
    retryPolicy: input.retryPolicy,
    concurrencyPolicy: input.concurrencyPolicy,
  }
  return createHash('sha256').update(stableStringify(canonical)).digest('hex')
}

/** 确定性事件 ID：sha256(eventName:sourceId)（设计方案 §13.2）。 */
export function deriveEventId(eventName: HookEventNameV1, sourceId: string): string {
  return `hev_${createHash('sha256').update(`${eventName}:${sourceId}`).digest('hex')}`
}

/** keyed 重试的宿主强制幂等键：eventId + hookId + action identity 派生。 */
export function deriveIdempotencyKey(definition: HookDefinitionV1, eventId: string): string {
  return createHash('sha256')
    .update(stableStringify({ eventId, hookId: definition.id, action: definition.action }))
    .digest('hex')
}
