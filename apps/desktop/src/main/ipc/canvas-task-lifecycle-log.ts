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

type CanvasTaskFailureFields = {
  code: string
  message: string
  runtimeTaskId?: string | null | undefined
  provider?: string | null | undefined
  model?: string | null | undefined
}

type LifecycleLogger = Pick<ReturnType<typeof createLogger>, 'info' | 'warn'>

type CanvasTaskLifecycleDependencies = {
  logger?: LifecycleLogger
  now?: () => number
}

export const canvasTaskLogger = createLogger('canvas:task')
const MAX_ERROR_MESSAGE_CHARS = 500

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

  return {
    started(): void {
      logger.info(`event=started ${base}`)
    },
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

function field(value: string | null | undefined): string {
  const normalized = value?.trim()
  if (!normalized) return '(n/a)'
  return /\s/.test(normalized) ? JSON.stringify(normalized) : normalized
}
