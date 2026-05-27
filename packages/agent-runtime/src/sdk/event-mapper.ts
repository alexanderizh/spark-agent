/**
 * Maps Claude Agent SDK messages → Spark AgentEvent stream.
 *
 * The SDK delivers messages via an AsyncGenerator. Each message has a `type`
 * field indicating what it represents. We convert these to Spark's granular
 * event types so the existing UI timeline renders correctly.
 *
 * Message flow (with streaming):
 *   system(init) → stream_event(content_block_delta)... → assistant(complete)
 *   → tool execution → user(tool_result) → ... → result(success/error)
 */

import { randomUUID } from 'node:crypto'
import type { AgentEvent } from '@spark/protocol'
import type {
  SDKMessage,
  SDKAssistantMessage,
  SDKResultMessage,
  SDKSystemMessage,
  SDKStreamEvent,
  SDKContentBlock,
  SDKUserMessage,
} from './types.js'

interface EventContext {
  sessionId: string
  turnId: string
  toolNamesById?: Map<string, string>
}

function baseEvent(ctx: EventContext) {
  return {
    id: randomUUID(),
    sessionId: ctx.sessionId,
    turnId: ctx.turnId,
    timestamp: new Date().toISOString(),
    seq: 0,
  }
}

/**
 * Convert a single SDK message into a sequence of AgentEvents.
 * Called once for each message yielded by the SDK's AsyncGenerator.
 */
export function mapSDKMessageToEvents(
  message: SDKMessage,
  ctx: EventContext,
): AgentEvent[] {
  switch (message.type) {
    case 'system':
      return mapSystemMessage(message as SDKSystemMessage, ctx)
    case 'assistant':
      return mapAssistantMessage(message as SDKAssistantMessage, ctx)
    case 'stream_event':
      return mapStreamEvent(message as SDKStreamEvent, ctx)
    case 'result':
      return mapResultMessage(message as SDKResultMessage, ctx)
    case 'user':
      return mapUserMessage(message as SDKUserMessage, ctx)
    default:
      return []
  }
}

function mapSystemMessage(msg: SDKSystemMessage, ctx: EventContext): AgentEvent[] {
  if (msg.subtype !== 'init') return []
  return [{
    ...baseEvent(ctx),
    type: 'agent_status',
    status: 'thinking',
    message: `Initialized with model ${msg.model}, ${msg.tools.length} tools, ${msg.mcp_servers.length} MCP servers`,
  }]
}

function mapAssistantMessage(msg: SDKAssistantMessage, ctx: EventContext): AgentEvent[] {
  const events: AgentEvent[] = []
  const content = msg.message.content

  for (const block of content) {
    events.push(...mapContentBlock(block, ctx))
  }

  // Emit usage if available
  if (msg.message.usage) {
    const cacheHit = msg.message.usage.cache_read_input_tokens
    events.push({
      ...baseEvent(ctx),
      type: 'usage_update',
      provider: 'claude',
      model: msg.message.model ?? '',
      inputTokens: msg.message.usage.input_tokens,
      outputTokens: msg.message.usage.output_tokens,
      ...(cacheHit != null ? { cacheHitTokens: cacheHit } : {}),
    })
  }

  return events
}

function mapUserMessage(msg: SDKUserMessage, ctx: EventContext): AgentEvent[] {
  if (!Array.isArray(msg.message.content)) return []
  return msg.message.content.flatMap((block) => mapContentBlock(block, ctx))
}

function mapStreamEvent(msg: SDKStreamEvent, ctx: EventContext): AgentEvent[] {
  const event = msg.event
  if (event == null) return []

  switch (event.type) {
    case 'content_block_delta': {
      const delta = event.delta
      if (delta == null) return []

      if (delta.type === 'text_delta' && delta.text != null) {
        return [{
          ...baseEvent(ctx),
          type: 'assistant_message',
          mode: 'delta',
          content: delta.text,
          provider: 'claude',
          isFinal: false,
        }]
      }

      if (delta.type === 'thinking_delta' && delta.thinking != null) {
        return [{
          ...baseEvent(ctx),
          type: 'agent_thinking',
          mode: 'delta',
          content: delta.thinking,
        }]
      }

      return []
    }

    case 'content_block_start': {
      const block = event.content_block
      if (block == null) return []

      if (block.type === 'tool_use' && block.id != null && block.name != null) {
        return [{
          ...baseEvent(ctx),
          type: 'agent_status',
          status: 'calling_tool',
          message: `Calling ${mapSDKToolName(block.name)}`,
        }]
      }
      return []
    }

    case 'message_start': {
      const usage = event.message?.usage
      if (usage) {
        return [{
          ...baseEvent(ctx),
          type: 'usage_update',
          provider: 'claude',
          model: '',
          inputTokens: usage.input_tokens,
          outputTokens: usage.output_tokens,
        }]
      }
      return []
    }

    default:
      return []
  }
}

function mapResultMessage(msg: SDKResultMessage, ctx: EventContext): AgentEvent[] {
  const events: AgentEvent[] = []

  // Final usage update
  events.push({
    ...baseEvent(ctx),
    type: 'usage_update',
    provider: 'claude',
    model: '',
    inputTokens: msg.usage.input_tokens,
    outputTokens: msg.usage.output_tokens,
    cacheHitTokens: msg.usage.cache_read_input_tokens,
    estimatedCostUsd: msg.total_cost_usd,
  })

  if (msg.checkpoint != null) {
    const checkpointId = msg.checkpoint.id ?? msg.checkpoint.checkpoint_id
    if (checkpointId != null && checkpointId.length > 0) {
      events.push({
        ...baseEvent(ctx),
        type: 'checkpoint',
        checkpointId,
        ...(msg.checkpoint.label != null ? { label: msg.checkpoint.label } : {}),
        ...(msg.checkpoint.path != null ? { path: msg.checkpoint.path } : {}),
        ...normalizeCheckpointFiles(msg.checkpoint),
      })
    }
  }

  if (msg.subtype === 'success') {
    if (msg.result != null && msg.result.length > 0) {
      events.push({
        ...baseEvent(ctx),
        type: 'assistant_message',
        mode: 'complete',
        content: msg.result,
        provider: 'claude',
        isFinal: true,
      })
    }
    events.push({
      ...baseEvent(ctx),
      type: 'agent_status',
      status: 'completed',
    })
  } else {
    const errorMsg = msg.errors?.join('; ') ?? `Turn ended: ${msg.subtype}`
    events.push({
      ...baseEvent(ctx),
      type: 'agent_error',
      code: msg.subtype.toUpperCase(),
      message: errorMsg,
      retryable: msg.subtype !== 'error_max_budget_usd',
    })
    events.push({
      ...baseEvent(ctx),
      type: 'agent_status',
      status: 'error',
    })
  }

  return events
}

function mapContentBlock(block: SDKContentBlock, ctx: EventContext): AgentEvent[] {
  switch (block.type) {
    case 'text':
      return [{
        ...baseEvent(ctx),
        type: 'assistant_message',
        mode: 'complete',
        content: block.text,
        provider: 'claude',
        isFinal: false,
      }]

    case 'thinking':
      return [{
        ...baseEvent(ctx),
        type: 'agent_thinking',
        mode: 'complete',
        content: block.thinking,
      }]

    case 'tool_use':
      ctx.toolNamesById?.set(block.id, mapSDKToolName(block.name))
      getToolInputs(ctx).set(block.id, normalizeToolInput(block.input))
      return [{
        ...baseEvent(ctx),
        type: 'tool_call',
        toolCallId: block.id,
        toolName: mapSDKToolName(block.name),
        toolInput: normalizeToolInput(block.input),
        source: isSDKMcpTool(block.name) ? 'mcp' : 'builtin',
        ...(isSDKMcpTool(block.name) ? { mcpServerId: extractMcpServerId(block.name) } : {}),
      }]

    case 'tool_result': {
      const isError = block.is_error === true
      const content = typeof block.content === 'string'
        ? block.content
        : flattenContentBlocks(block.content)
      const toolName = ctx.toolNamesById?.get(block.tool_use_id) ?? 'unknown'
      const events: AgentEvent[] = [{
        ...baseEvent(ctx),
        type: 'tool_result',
        toolCallId: block.tool_use_id,
        toolName,
        status: isError ? 'error' : 'success',
        ...(isError ? { error: content } : { output: content }),
      }]
      if (!isError) {
        const fileChange = buildFileChangeEvent(block.tool_use_id, toolName, ctx)
        if (fileChange != null) events.push(fileChange)
      }
      return events
    }

    default:
      return []
  }
}

function normalizeCheckpointFiles(checkpoint: SDKResultMessage['checkpoint']): { filePaths?: string[] } {
  const files = checkpoint?.file_paths ?? checkpoint?.files
  if (!Array.isArray(files)) return {}
  const filePaths = files.filter((file): file is string => typeof file === 'string' && file.length > 0)
  return filePaths.length > 0 ? { filePaths } : {}
}

function buildFileChangeEvent(toolCallId: string, toolName: string, ctx: EventContext): AgentEvent | null {
  if (toolName !== 'edit_file' && toolName !== 'write_file' && toolName !== 'multi_edit') return null
  const input = findToolInput(toolCallId, ctx)
  const path = stringField(input, 'file_path') || stringField(input, 'path')
  if (!path) return null
  return {
    ...baseEvent(ctx),
    type: 'file_change',
    changeType: toolName === 'write_file' ? 'modify' : 'modify',
    path,
  }
}

function findToolInput(toolCallId: string, ctx: EventContext): Record<string, unknown> | null {
  const toolInputs = getToolInputs(ctx)
  return toolInputs.get(toolCallId) ?? null
}

function getToolInputs(ctx: EventContext): Map<string, Record<string, unknown>> {
  const record = ctx as EventContext & { toolInputsById?: Map<string, Record<string, unknown>> }
  if (record.toolInputsById == null) record.toolInputsById = new Map()
  return record.toolInputsById
}

/**
 * The SDK uses tool names like "Read", "Edit", "Bash", "mcp__server__tool".
 * Map them to Spark's display naming for the UI.
 */
function mapSDKToolName(sdkName: string): string {
  const mapping: Record<string, string> = {
    'Read': 'read_file',
    'Write': 'write_file',
    'Edit': 'edit_file',
    'MultiEdit': 'multi_edit',
    'Bash': 'bash',
    'Glob': 'search_files',
    'Grep': 'grep',
    'TodoRead': 'todo_read',
    'TodoWrite': 'todo_write',
    'WebFetch': 'web_fetch',
    'WebSearch': 'web_search',
    'Agent': 'subagent',
  }
  return mapping[sdkName] ?? sdkName
}

function isSDKMcpTool(name: string): boolean {
  return name.startsWith('mcp__')
}

function extractMcpServerId(name: string): string {
  const parts = name.split('__')
  return parts[1] ?? 'unknown'
}

function normalizeToolInput(input: unknown): Record<string, unknown> {
  if (input == null) return {}
  if (typeof input === 'object' && !Array.isArray(input)) return input as Record<string, unknown>
  return { value: input }
}

function stringField(input: Record<string, unknown> | null, key: string): string {
  const value = input?.[key]
  return typeof value === 'string' ? value : ''
}

function flattenContentBlocks(blocks: SDKContentBlock[]): string {
  return blocks
    .map((b) => {
      if (b.type === 'text') return b.text
      return JSON.stringify(b)
    })
    .join('\n')
}
