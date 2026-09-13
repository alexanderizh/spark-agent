import type {
  HookDefinitionV1,
  HookEventEnvelopeV1,
  HookErrorCodeV1,
  HookValueExpressionV1,
} from '@spark/protocol'
import { evaluateValueExpression } from './hook-expression.js'
import { summarizeValue } from './hook-redaction.js'

/**
 * 动作执行边界（设计方案 §5/§8.1）：
 * - 内置动作（notification/sound）由宿主注入实现，agent-runtime 不直接依赖 Electron。
 * - 工具动作经 HookToolGateway 走统一工具目录；递归防护由 Worker 保证
 *   （invocationSource='hook' 的调用不再发出产品层工具 Hook 事件）。
 */

export interface HookBuiltinActionHandlers {
  notification(input: {
    title: string
    body?: string
    sessionId: string
    eventId: string
    hookRunId: string
  }): Promise<unknown>
  sound(input: { sessionId: string; eventId: string; hookRunId: string }): Promise<unknown>
}

export interface HookToolDescribeResult {
  found: boolean
  governance?: {
    risk: 'read' | 'low-write' | 'high-write' | 'destructive'
    effect: string
    idempotency: 'safe' | 'keyed' | 'unsafe'
    enabled: boolean
    version?: string
  }
}

export interface HookToolInvokeRequest {
  target: {
    sourceKind: 'connector' | 'custom-tool' | 'tool-package'
    sourceId: string
    version?: string
    toolName: string
    qualifiedName: string
  }
  input: Record<string, unknown>
  timeoutMs: number
  /** keyed 重试时由宿主强制注入的稳定幂等键（eventId+hookId+action 派生）。 */
  idempotencyKey?: string
  attribution: {
    hookId: string
    hookRunId: string
    eventId: string
    sessionId: string
    turnId: string
  }
}

export interface HookToolInvokeResult {
  ok: boolean
  errorCode?: HookErrorCodeV1
  message?: string
  result?: unknown
  invocationId?: string
  correlationId?: string
}

export interface HookToolGateway {
  describeTool(target: HookToolInvokeRequest['target']): Promise<HookToolDescribeResult>
  invokeTool(request: HookToolInvokeRequest): Promise<HookToolInvokeResult>
}

export class HookActionError extends Error {
  constructor(
    readonly errorCode: HookErrorCodeV1,
    message: string,
    readonly transient = false,
  ) {
    super(message)
    this.name = 'HookActionError'
  }
}

export interface HookExecutionRequest {
  runId: string
  definition: HookDefinitionV1
  envelope: HookEventEnvelopeV1
  mappedInput: Record<string, unknown>
  idempotencyKey?: string
  signal?: AbortSignal
}

export interface HookExecutionOutcome {
  status: 'succeeded' | 'failed'
  errorCode?: HookErrorCodeV1
  errorMessage?: string
  outputSummary?: Record<string, unknown>
  invocationId?: string
  correlationId?: string
}

const BUILTIN_NOTIFICATION_TITLES: Record<string, string> = {
  'turn.completed': 'SparkWork - 任务完成',
  'turn.failed': 'SparkWork - 任务失败',
  'turn.cancelled': 'SparkWork - 任务已取消',
  'permission.requested': 'SparkWork - 需要审批',
  'question.requested': 'SparkWork - 需要您的输入',
  'turn.started': 'SparkWork - 任务开始',
  'response.committed': 'SparkWork - 回答已生成',
}

export class HookActionExecutor {
  constructor(
    private readonly builtins: HookBuiltinActionHandlers,
    private readonly toolGateway: HookToolGateway,
  ) {}

  async execute(request: HookExecutionRequest): Promise<HookExecutionOutcome> {
    const { definition, envelope, mappedInput } = request
    try {
      if (definition.action.type === 'builtin.sound') {
        await this.withTimeout(
          this.builtins.sound({
            sessionId: envelope.session.id,
            eventId: envelope.eventId,
            hookRunId: request.runId,
          }),
          definition.timeoutMs,
          request.signal,
        )
        return { status: 'succeeded' }
      }
      if (definition.action.type === 'builtin.notification') {
        // 标题/正文表达式按事件白名单路径求值（const/path/template）；
        // 求值为空时回退到事件默认文案，不允许发出空标题通知。
        const titleValue =
          definition.action.title != null
            ? this.renderText(definition.action.title, envelope)
            : undefined
        const bodyValue =
          definition.action.body != null
            ? this.renderText(definition.action.body, envelope)
            : undefined
        const fallbackTitle = BUILTIN_NOTIFICATION_TITLES[envelope.eventName] ?? 'SparkWork 通知'
        const effectiveTitle =
          titleValue != null && titleValue.trim() !== '' ? titleValue : fallbackTitle
        await this.withTimeout(
          this.builtins.notification({
            title: effectiveTitle,
            ...(bodyValue != null && bodyValue.trim() !== '' ? { body: bodyValue } : {}),
            sessionId: envelope.session.id,
            eventId: envelope.eventId,
            hookRunId: request.runId,
          }),
          definition.timeoutMs,
          request.signal,
        )
        return { status: 'succeeded' }
      }

      // tool.invoke
      const invoked = await this.withTimeout(
        this.toolGateway.invokeTool({
          target: definition.action.target,
          input: mappedInput,
          timeoutMs: definition.timeoutMs,
          ...(request.idempotencyKey != null ? { idempotencyKey: request.idempotencyKey } : {}),
          attribution: {
            hookId: definition.id,
            hookRunId: request.runId,
            eventId: envelope.eventId,
            sessionId: envelope.session.id,
            turnId: envelope.turn.id,
          },
        }),
        definition.timeoutMs,
        request.signal,
      )
      if (!invoked.ok) {
        return {
          status: 'failed',
          ...(invoked.errorCode != null
            ? { errorCode: invoked.errorCode }
            : { errorCode: 'action_failed' as const }),
          ...(invoked.message != null ? { errorMessage: invoked.message } : {}),
          outputSummary: summarizeValue({ error: invoked.message ?? 'tool invoke failed' }),
          ...(invoked.invocationId != null ? { invocationId: invoked.invocationId } : {}),
          ...(invoked.correlationId != null ? { correlationId: invoked.correlationId } : {}),
        }
      }
      return {
        status: 'succeeded',
        outputSummary: summarizeValue(invoked.result),
        ...(invoked.invocationId != null ? { invocationId: invoked.invocationId } : {}),
        ...(invoked.correlationId != null ? { correlationId: invoked.correlationId } : {}),
      }
    } catch (error) {
      if (error instanceof HookActionError) {
        return {
          status: 'failed',
          errorCode: error.errorCode,
          errorMessage: error.message,
          outputSummary: summarizeValue({ error: error.message }),
        }
      }
      if (error instanceof Error && error.name === 'HookTimeoutError') {
        return {
          status: 'failed',
          errorCode: 'timeout',
          errorMessage: `动作超过 ${definition.timeoutMs}ms 超时限制`,
          outputSummary: summarizeValue({ error: error.message }),
        }
      }
      return {
        status: 'failed',
        errorCode: 'action_failed',
        errorMessage: error instanceof Error ? error.message : String(error),
        outputSummary: summarizeValue({
          error: error instanceof Error ? error.message : String(error),
        }),
      }
    }
  }

  private renderText(expression: HookValueExpressionV1, envelope: HookEventEnvelopeV1): string {
    const value = evaluateValueExpression(envelope, expression)
    if (value == null) return ''
    if (typeof value === 'object') return JSON.stringify(value)
    return String(value)
  }

  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<T> {
    if (signal?.aborted) {
      throw new HookActionError('outcome_unknown', '动作已被宿主取消，结果未知')
    }
    return await new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        const error = new Error(`hook action timed out after ${timeoutMs}ms`)
        error.name = 'HookTimeoutError'
        reject(error)
      }, timeoutMs)
      const onAbort = (): void => {
        clearTimeout(timer)
        reject(new HookActionError('outcome_unknown', '动作已被宿主取消，结果未知'))
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      promise.then(
        (value) => {
          clearTimeout(timer)
          signal?.removeEventListener('abort', onAbort)
          resolve(value)
        },
        (err) => {
          clearTimeout(timer)
          signal?.removeEventListener('abort', onAbort)
          reject(err)
        },
      )
    })
  }
}
