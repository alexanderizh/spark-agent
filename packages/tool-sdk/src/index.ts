import { createInterface } from 'node:readline'
import {
  TOOL_PROCESS_PROTOCOL_VERSION,
  ToolPackageManifestSchema,
  ToolProcessHostFrameSchema,
  type ToolPackageManifest,
  type ToolProcessHostFrame,
} from '@spark/protocol'
import { z } from 'zod'

export type ToolInputSchema<T> = z.ZodType<T> | Record<string, unknown>

export interface ToolInvocationContext {
  invocationId: string
  signal: AbortSignal
  context: Record<string, unknown>
  log(level: 'debug' | 'info' | 'warn' | 'error', message: string): void
  progress(progress?: number, message?: string): void
  capability<T = unknown>(name: string, input: unknown): Promise<T>
}

export interface ToolHandler<TInput = Record<string, unknown>> {
  input?: ToolInputSchema<TInput>
  run(input: TInput, context: ToolInvocationContext): Promise<unknown> | unknown
}

export interface ServeToolsOptions {
  tools: Record<string, ToolHandler<never>>
  stdin?: NodeJS.ReadableStream
  stdout?: NodeJS.WritableStream
  onInitialize?: (input: {
    packageId: string
    packageVersion: string
    capabilityProtocolVersion: 1
  }) => Promise<void> | void
}

interface PendingCapability {
  invocationId: string
  resolve(value: unknown): void
  reject(error: Error): void
}

export interface ToolServer {
  close(): void
}

export function defineTool<TInput>(handler: ToolHandler<TInput>): ToolHandler<TInput> {
  return handler
}

export function serveTools(options: ServeToolsOptions): ToolServer {
  const input = options.stdin ?? process.stdin
  const output = options.stdout ?? process.stdout
  const reader = createInterface({ input, crlfDelay: Infinity })
  let sequence = 0
  const active = new Map<string, AbortController>()
  const pendingCapabilities = new Map<string, PendingCapability>()

  const send = (frame: Record<string, unknown>): void => {
    output.write(
      `${JSON.stringify({ protocolVersion: TOOL_PROCESS_PROTOCOL_VERSION, sequence: sequence++, ...frame })}\n`,
    )
  }

  // Frames pipelined before the initialize handshake finishes must not emit
  // output ahead of `ready`, so gate every non-initialize frame on the barrier.
  let readyGate: Promise<void> | null = null

  const handle = async (frame: ToolProcessHostFrame): Promise<void> => {
    if (frame.type === 'initialize') {
      const handshake = (async () => {
        await options.onInitialize?.({
          packageId: frame.packageId,
          packageVersion: frame.packageVersion,
          capabilityProtocolVersion: frame.capabilityProtocolVersion,
        })
        send({ type: 'ready', requestId: frame.requestId })
      })()
      readyGate = handshake
      await handshake
      return
    }
    if (readyGate != null) await readyGate
    if (frame.type === 'cancel') {
      active.get(frame.invocationId)?.abort()
      rejectInvocationCapabilities(frame.invocationId, pendingCapabilities)
      return
    }
    if (frame.type === 'capability.result' || frame.type === 'capability.error') {
      const pending = pendingCapabilities.get(frame.requestId)
      if (pending == null) return
      pendingCapabilities.delete(frame.requestId)
      if (frame.type === 'capability.error') {
        pending.reject(new Error(`${frame.code}: ${frame.message}`))
      } else {
        pending.resolve(frame.result)
      }
      return
    }
    if (frame.type === 'shutdown') {
      for (const controller of active.values()) controller.abort()
      reader.close()
      return
    }
    if (frame.type !== 'invoke') return
    const tool = options.tools[frame.toolName]
    if (tool == null) {
      send({
        type: 'error',
        requestId: frame.requestId,
        invocationId: frame.invocationId,
        code: 'TOOL_NOT_FOUND',
        message: `Tool not found: ${frame.toolName}`,
      })
      return
    }
    const controller = new AbortController()
    active.set(frame.invocationId, controller)
    const context: ToolInvocationContext = {
      invocationId: frame.invocationId,
      signal: controller.signal,
      context: frame.context,
      log: (level, message) =>
        send({
          type: 'log',
          requestId: frame.requestId,
          invocationId: frame.invocationId,
          level,
          message,
        }),
      progress: (progress, message) =>
        send({
          type: 'progress',
          requestId: frame.requestId,
          invocationId: frame.invocationId,
          ...(progress != null ? { progress } : {}),
          ...(message != null ? { message } : {}),
        }),
      capability: (name, capabilityInput) => {
        const requestId = `${frame.invocationId}:capability:${sequence}`
        return new Promise((resolve, reject) => {
          pendingCapabilities.set(requestId, { invocationId: frame.invocationId, resolve, reject })
          send({
            type: 'capability.request',
            requestId,
            invocationId: frame.invocationId,
            capability: name,
            input: capabilityInput,
          })
        })
      },
    }
    try {
      const parsed = parseInput(tool.input, frame.input)
      const result = await tool.run(parsed as never, context)
      send({
        type: 'result',
        requestId: frame.requestId,
        invocationId: frame.invocationId,
        result,
      })
    } catch (error) {
      send({
        type: 'error',
        requestId: frame.requestId,
        invocationId: frame.invocationId,
        code: controller.signal.aborted ? 'CANCELLED' : errorCode(error),
        message: boundedMessage(error),
      })
    } finally {
      active.delete(frame.invocationId)
      rejectInvocationCapabilities(frame.invocationId, pendingCapabilities)
    }
  }

  reader.on('line', (line) => {
    let parsed: ToolProcessHostFrame
    try {
      parsed = ToolProcessHostFrameSchema.parse(JSON.parse(line) as unknown)
    } catch (error) {
      send({
        type: 'error',
        requestId: 'invalid-frame',
        code: 'INVALID_FRAME',
        message: boundedMessage(error),
      })
      return
    }
    void handle(parsed).catch((error) => {
      send({
        type: 'error',
        requestId: parsed.requestId,
        ...('invocationId' in parsed ? { invocationId: parsed.invocationId } : {}),
        code: errorCode(error),
        message: boundedMessage(error),
      })
    })
  })

  return {
    close: () => {
      for (const controller of active.values()) controller.abort()
      for (const pending of pendingCapabilities.values()) {
        pending.reject(new Error('Tool server closed'))
      }
      active.clear()
      pendingCapabilities.clear()
      reader.close()
    },
  }
}

function rejectInvocationCapabilities(
  invocationId: string,
  pendingCapabilities: Map<string, PendingCapability>,
): void {
  for (const [requestId, pending] of pendingCapabilities) {
    if (pending.invocationId !== invocationId) continue
    pendingCapabilities.delete(requestId)
    pending.reject(new DOMException('Tool invocation was cancelled', 'AbortError'))
  }
}

export function validateManifest(value: unknown): ToolPackageManifest {
  return ToolPackageManifestSchema.parse(value)
}

function parseInput(schema: ToolInputSchema<unknown> | undefined, input: unknown): unknown {
  if (schema == null) return input
  if ('safeParse' in schema) return (schema as z.ZodType).parse(input)
  return z.fromJSONSchema(schema).parse(input)
}

function errorCode(error: unknown): string {
  if (error instanceof z.ZodError) return 'INVALID_INPUT'
  if (error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.name)) return error.name
  return 'TOOL_FAILED'
}

function boundedMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.slice(0, 4_000) || 'Tool failed'
}

export type { ToolPackageManifest }
