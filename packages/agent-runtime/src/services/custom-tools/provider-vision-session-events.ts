import crypto from 'node:crypto'
import type { AgentEvent } from '@spark/protocol'
import type { ProviderVisionRouteResult } from './provider-vision-router.js'

export const HOST_PROVIDER_VISION_TOOL_NAME = 'spark_host_provider_vision'

interface ProviderVisionSessionEventInput {
  route: ProviderVisionRouteResult
  sessionId: string
  turnId: string
  now?: () => string
  idFactory?: () => string
}

/**
 * Build the observable host-side vision fallback event pair.
 *
 * The payload deliberately excludes image paths/names, headers, credentials,
 * full URLs and provider output. The original observation remains only in the
 * executor prompt; the timeline receives routing facts and the local Trace ID.
 */
export function createProviderVisionSessionEvents(
  input: ProviderVisionSessionEventInput,
): AgentEvent[] {
  if (input.route.status === 'not-applicable') return []

  const timestamp = (input.now ?? (() => new Date().toISOString()))()
  const nextId = input.idFactory ?? (() => crypto.randomUUID())
  const toolCallId = `host-provider-vision:${input.turnId}`
  const common = {
    sessionId: input.sessionId,
    turnId: input.turnId,
    timestamp,
    seq: 0,
  }
  const toolInput: Record<string, unknown> = {
    route: 'host-deterministic',
    reason: 'text-model-with-image-attachments',
    imageCount: input.route.imageCount ?? 0,
    ...(input.route.toolId != null ? { toolId: input.route.toolId } : {}),
    ...(input.route.toolTitle != null ? { toolTitle: input.route.toolTitle } : {}),
    ...(input.route.targetOrigin != null ? { targetOrigin: input.route.targetOrigin } : {}),
    ...(input.route.model != null ? { model: input.route.model } : {}),
  }

  const callEvent: AgentEvent = {
    ...common,
    id: nextId(),
    type: 'tool_call',
    toolCallId,
    toolName: HOST_PROVIDER_VISION_TOOL_NAME,
    toolInput,
    source: 'builtin',
  }
  const succeeded = input.route.status === 'succeeded'
  const resultOutput = {
    status: succeeded ? 'completed' : 'failed',
    route: 'host-deterministic',
    ...(input.route.toolId != null ? { toolId: input.route.toolId } : {}),
    ...(input.route.traceId != null ? { traceId: input.route.traceId } : {}),
    ...(input.route.targetOrigin != null ? { targetOrigin: input.route.targetOrigin } : {}),
    ...(input.route.model != null ? { model: input.route.model } : {}),
  }
  const resultEvent: AgentEvent = {
    ...common,
    id: nextId(),
    type: 'tool_result',
    toolCallId,
    toolName: HOST_PROVIDER_VISION_TOOL_NAME,
    status: succeeded ? 'success' : 'error',
    output: resultOutput,
    ...(succeeded
      ? {}
      : {
          error:
            input.route.errorCode === 'NO_TOOL'
              ? '没有可用的自动路由图像理解工具'
              : '宿主图像理解调用失败',
        }),
    ...(input.route.durationMs != null ? { durationMs: input.route.durationMs } : {}),
  }
  return [callEvent, resultEvent]
}
