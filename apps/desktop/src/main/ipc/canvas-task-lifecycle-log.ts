import { createLogger } from '@spark/shared'

type CanvasTaskLogKind = 'media' | 'text'

type CanvasTaskLogContext = {
  kind: CanvasTaskLogKind
  projectId?: string | undefined
  clientTaskId?: string | undefined
  operation: string
  providerProfileId?: string | null | undefined
  modelId?: string | null | undefined
  background: boolean
  inputCount?: number
}

type CanvasTaskTerminalFields = {
  status: string
  runtimeTaskId?: string | null | undefined
  providerRequestId?: string | null | undefined
  provider?: string | null | undefined
  model?: string | null | undefined
  assetCount?: number
  outputChars?: number
  error?: { code: string; message: string } | null | undefined
}

type CanvasTaskSubmittedFields = {
  runtimeTaskId?: string | null | undefined
  providerRequestId: string
  response?: unknown
}

type CanvasTaskFailureFields = {
  code: string
  message: string
  runtimeTaskId?: string | null | undefined
  provider?: string | null | undefined
  model?: string | null | undefined
}

type CanvasTaskTextRequestFields = {
  model: string
  apiKind: 'chat' | 'responses' | string
  executionPath: string
  adapter?: string | null | undefined
  systemPromptChars: number
  userPromptChars: number
  maxTokens?: number | undefined
  maxTokensSource?: string | undefined
  temperature?: number | undefined
  reasoningEffort?: string | undefined
  responseFormat?: string | undefined
  attachmentCount?: number | undefined
}

type CanvasTaskTextResponseFields = {
  textChars: number
  finishReason?: string | undefined
  usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number } | undefined
  reasoningContentChars?: number | undefined
  durationMs?: number | undefined
}

type LifecycleLogger = Pick<ReturnType<typeof createLogger>, 'info' | 'warn' | 'error'>

type CanvasTaskLifecycleDependencies = {
  logger?: LifecycleLogger
  now?: () => number
}

export const canvasTaskLogger = createLogger('canvas:task')
const MAX_ERROR_MESSAGE_CHARS = 500
const MAX_RESPONSE_CHARS = 2_000

export const CANVAS_TASK_LOG_NAMESPACE_PREFIXES = [
  'canvas:',
  'media:',
] as const

export function createCanvasTaskLifecycleLog(
  context: CanvasTaskLogContext,
  dependencies: CanvasTaskLifecycleDependencies = {},
) {
  const logger = dependencies.logger ?? canvasTaskLogger
  const now = dependencies.now ?? Date.now
  const startedAt = now()
  const base = [
    `kind=${context.kind}`,
    `projectId=${field(context.projectId)}`,
    `clientTaskId=${field(context.clientTaskId)}`,
    `operation=${field(context.operation)}`,
    `providerProfileId=${field(context.providerProfileId)}`,
    `modelId=${field(context.modelId)}`,
    `background=${context.background}`,
    ...(context.inputCount == null ? [] : [`inputs=${context.inputCount}`]),
  ].join(' ')

  const finished = (fields: CanvasTaskTerminalFields): void => {
    logger.info(
      [
        'event=finished',
        base,
        `status=${field(fields.status)}`,
        `runtimeTaskId=${field(fields.runtimeTaskId)}`,
        `providerRequestId=${field(fields.providerRequestId)}`,
        `provider=${field(fields.provider)}`,
        `model=${field(fields.model)}`,
        ...(fields.assetCount == null ? [] : [`assets=${fields.assetCount}`]),
        ...(fields.outputChars == null ? [] : [`outputChars=${fields.outputChars}`]),
        `elapsedMs=${Math.max(0, now() - startedAt)}`,
      ].join(' '),
    )
  }

  const failed = (fields: CanvasTaskFailureFields): void => {
    const message = fields.message.replace(/\s+/g, ' ').trim().slice(0, MAX_ERROR_MESSAGE_CHARS)
    logger.warn(
      [
        'event=failed',
        base,
        `code=${field(fields.code)}`,
        `runtimeTaskId=${field(fields.runtimeTaskId)}`,
        `provider=${field(fields.provider)}`,
        `model=${field(fields.model)}`,
        `message=${JSON.stringify(message)}`,
        `elapsedMs=${Math.max(0, now() - startedAt)}`,
      ].join(' '),
    )
  }

  const textCallRequest = (fields: CanvasTaskTextRequestFields): number => {
    const requestStartedAt = now()
    try {
      logger.info(
        [
          'event=text-request',
          base,
          `model=${field(fields.model)}`,
          `apiKind=${field(fields.apiKind)}`,
          `executionPath=${field(fields.executionPath)}`,
          `adapter=${field(fields.adapter)}`,
          `systemChars=${fields.systemPromptChars}`,
          `userChars=${fields.userPromptChars}`,
          fields.attachmentCount != null ? `attachments=${fields.attachmentCount}` : null,
          `maxTokens=${fields.maxTokens ?? '(provider-default)'}`,
          `maxTokensSource=${field(fields.maxTokensSource)}`,
          fields.temperature != null ? `temperature=${fields.temperature}` : null,
          fields.reasoningEffort ? `reasoningEffort=${JSON.stringify(fields.reasoningEffort)}` : null,
          fields.responseFormat ? `responseFormat=${JSON.stringify(fields.responseFormat)}` : null,
        ]
          .filter((part): part is string => part != null)
          .join(' '),
      )
    } catch {
      /* 日志失败不影响业务 */
    }
    return requestStartedAt
  }

  const textCallResponse = (
    fields: CanvasTaskTextResponseFields,
    requestStartedAt: number,
  ): void => {
    try {
      logger.info(
        [
          'event=text-response',
          base,
          `textChars=${fields.textChars}`,
          fields.reasoningContentChars != null
            ? `reasoningChars=${fields.reasoningContentChars}`
            : null,
          fields.finishReason ? `finishReason=${JSON.stringify(fields.finishReason)}` : null,
          fields.usage?.promptTokens != null ? `promptTokens=${fields.usage.promptTokens}` : null,
          fields.usage?.completionTokens != null
            ? `completionTokens=${fields.usage.completionTokens}`
            : null,
          fields.usage?.totalTokens != null ? `totalTokens=${fields.usage.totalTokens}` : null,
          `durationMs=${Math.max(0, now() - requestStartedAt)}`,
        ]
          .filter((part): part is string => part != null)
          .join(' '),
      )
    } catch {
      /* 日志失败不影响业务 */
    }
  }

  return {
    started(): void {
      logger.info(`event=started ${base}`)
    },
    submitted(fields: CanvasTaskSubmittedFields): void {
      const response = safeResponse(fields.response)
      logger.info(
        [
          'event=provider-submitted',
          base,
          `runtimeTaskId=${field(fields.runtimeTaskId)}`,
          `providerRequestId=${field(fields.providerRequestId)}`,
          ...(response ? [`response=${response}`] : []),
          `elapsedMs=${Math.max(0, now() - startedAt)}`,
        ].join(' '),
      )
    },
    textCallRequest,
    textCallResponse,
    finished,
    failed,
    settled(fields: CanvasTaskTerminalFields): void {
      if (fields.error || fields.status === 'failed') {
        failed({
          code: fields.error?.code ?? 'task_failed',
          message: fields.error?.message ?? 'Task failed without an error message',
          runtimeTaskId: fields.runtimeTaskId,
          provider: fields.provider,
          model: fields.model,
        })
        return
      }
      finished(fields)
    },
  }
}

function safeResponse(value: unknown): string {
  if (value == null) return ''
  try {
    return JSON.stringify(value).slice(0, MAX_RESPONSE_CHARS)
  } catch {
    return '"[unserializable]"'
  }
}

function field(value: string | null | undefined): string {
  const normalized = value?.trim()
  if (!normalized) return '(n/a)'
  return /\s/.test(normalized) ? JSON.stringify(normalized) : normalized
}
