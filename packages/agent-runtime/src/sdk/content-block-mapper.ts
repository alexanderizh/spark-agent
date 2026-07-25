import { randomUUID } from 'node:crypto'
import type { AgentEvent, BaseEvent } from '@spark/protocol'
import { clipTextHeadTail } from '@spark/shared'
import { mapSDKToolName } from './tool-name-mapper.js'

export interface ExtendedContentBlockContext {
  sessionId: string
  turnId: string
  toolNamesById?: Map<string, string>
}

type UnknownRecord = Record<string, unknown>

const RESULT_TOOL_NAMES: Readonly<Record<string, string>> = {
  web_search_tool_result: 'web_search',
  web_fetch_tool_result: 'web_fetch',
  code_execution_tool_result: 'code_execution',
  bash_code_execution_tool_result: 'bash_code_execution',
  text_editor_code_execution_tool_result: 'text_editor_code_execution',
  advisor_tool_result: 'advisor',
  tool_search_tool_result: 'tool_search',
}

const RESULT_BLOCK_TYPES = new Set([...Object.keys(RESULT_TOOL_NAMES), 'mcp_tool_result'])
const SENSITIVE_KEYS = new Set(['data', 'encrypted_content', 'encrypted_stdout', 'signature'])
/**
 * 工具结果序列化后的 token 上限（D-08 改造）。
 *
 * 旧值 MAX_SERIALIZED_RESULT_CHARS=100_000 按字符算：
 *   - 英文 ~25k tokens（合理）
 *   - 中文 ~50k tokens（过大，挤占 context window）
 * 改 25k tokens 后中英文都受控，且头尾保留可让 stdout 顶部的命令/上下文 + 底部的
 * 最终输出都保留（替换原来的"前 N 字符"粗暴截断）。
 */
const MAX_SERIALIZED_RESULT_TOKENS = 25_000

export function mapExtendedContentBlock(
  block: unknown,
  ctx: ExtendedContentBlockContext,
): AgentEvent[] {
  if (!isRecord(block) || typeof block.type !== 'string') {
    return [contentBlockNotice(ctx, 'unknown', 'Claude 返回了无法识别的内容块。')]
  }

  switch (block.type) {
    case 'server_tool_use':
      return mapServerToolUse(block, ctx)
    case 'mcp_tool_use':
      return mapMcpToolUse(block, ctx)
    case 'redacted_thinking':
      return [
        contentBlockNotice(
          ctx,
          block.type,
          'Claude 返回了一段受保护的思考内容，Spark 不会显示其加密载荷。',
          'info',
          '思考内容已隐藏',
        ),
      ]
    case 'compaction':
      return [
        {
          ...eventBase(ctx),
          type: 'context_compaction',
          provider: 'claude',
          source: 'claude_code',
          phase: typeof block.content === 'string' ? 'completed' : 'failed',
          ...(typeof block.content === 'string' ? { summary: block.content } : {}),
          ...(block.content == null ? { message: 'Claude 未生成有效的压缩摘要。' } : {}),
          rawType: 'content_block/compaction',
        },
      ]
    case 'container_upload':
      return [
        contentBlockNotice(
          ctx,
          block.type,
          'Claude 已将文件上传到执行容器。',
          'info',
          '容器文件已上传',
        ),
      ]
    case 'fallback':
      return [
        contentBlockNotice(
          ctx,
          block.type,
          describeFallback(block),
          'warning',
          'Claude 已切换备用模型',
        ),
      ]
    default:
      if (RESULT_BLOCK_TYPES.has(block.type)) return mapToolResult(block, ctx)
      return [contentBlockNotice(ctx, block.type, `Claude 返回了尚未适配的内容块：${block.type}`)]
  }
}

function mapServerToolUse(block: UnknownRecord, ctx: ExtendedContentBlockContext): AgentEvent[] {
  if (typeof block.id !== 'string' || typeof block.name !== 'string') {
    return [contentBlockNotice(ctx, 'server_tool_use', 'Claude 返回了字段不完整的服务器工具调用。')]
  }
  const toolName = mapSDKToolName(block.name)
  ctx.toolNamesById?.set(block.id, toolName)
  return [
    {
      ...eventBase(ctx),
      type: 'tool_call',
      toolCallId: block.id,
      toolName,
      toolInput: normalizeToolInput(block.input),
      source: 'builtin',
    },
  ]
}

function mapMcpToolUse(block: UnknownRecord, ctx: ExtendedContentBlockContext): AgentEvent[] {
  if (typeof block.id !== 'string' || typeof block.name !== 'string') {
    return [contentBlockNotice(ctx, 'mcp_tool_use', 'Claude 返回了字段不完整的 MCP 工具调用。')]
  }
  const toolName = mapSDKToolName(block.name)
  ctx.toolNamesById?.set(block.id, toolName)
  return [
    {
      ...eventBase(ctx),
      type: 'tool_call',
      toolCallId: block.id,
      toolName,
      toolInput: normalizeToolInput(block.input),
      source: 'mcp',
      mcpServerId: typeof block.server_name === 'string' ? block.server_name : 'unknown',
    },
  ]
}

function mapToolResult(block: UnknownRecord, ctx: ExtendedContentBlockContext): AgentEvent[] {
  const toolCallId = typeof block.tool_use_id === 'string' ? block.tool_use_id : randomUUID()
  const fallbackToolName = RESULT_TOOL_NAMES[String(block.type)] ?? 'mcp'
  const toolName = ctx.toolNamesById?.get(toolCallId) ?? fallbackToolName
  const isError = block.is_error === true || containsErrorResult(block.content)
  const rendered = serializePublicContent(block.content)

  return [
    {
      ...eventBase(ctx),
      type: 'tool_result',
      toolCallId,
      toolName,
      status: isError ? 'error' : 'success',
      ...(isError ? { error: rendered || 'Claude 工具执行失败。' } : { output: rendered }),
    },
  ]
}

export function serializePublicContent(value: unknown): string {
  if (typeof value === 'string') return truncateResult(value)
  if (Array.isArray(value) && value.every((item) => isRecord(item) && item.type === 'text')) {
    return truncateResult(value.map((item) => String(item.text ?? '')).join('\n'))
  }

  const seen = new WeakSet<object>()
  const serialized = JSON.stringify(value, (key, nestedValue: unknown) => {
    if (SENSITIVE_KEYS.has(key)) return '[redacted]'
    if (typeof nestedValue === 'object' && nestedValue != null) {
      if (seen.has(nestedValue)) return '[circular]'
      seen.add(nestedValue)
    }
    return nestedValue
  })
  return truncateResult(serialized ?? '')
}

function containsErrorResult(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsErrorResult)
  if (!isRecord(value)) return false
  if (typeof value.type === 'string' && value.type.includes('error')) return true
  return Object.values(value).some(containsErrorResult)
}

function truncateResult(value: string): string {
  // D-08：token+头尾保留替换字符粗暴截断。tool result 头部通常是工具调用上下文
  // （命令、文件路径），尾部是最终输出（exit code、关键结果）——两侧都重要。
  return clipTextHeadTail(value, MAX_SERIALIZED_RESULT_TOKENS, {
    ellipsis: '\n[tool result truncated by Spark — middle omitted]\n',
  })
}

function describeFallback(block: UnknownRecord): string {
  const from =
    isRecord(block.from) && typeof block.from.model === 'string' ? block.from.model : '当前模型'
  const to = isRecord(block.to) && typeof block.to.model === 'string' ? block.to.model : '备用模型'
  return `${from} 未能继续，Claude 已切换到 ${to}。`
}

function contentBlockNotice(
  ctx: ExtendedContentBlockContext,
  blockType: string,
  message: string,
  level: 'info' | 'warning' | 'error' = 'warning',
  title = 'Claude 内容块需要关注',
): AgentEvent {
  return {
    ...eventBase(ctx),
    type: 'runtime_signal',
    signal: 'notification',
    level,
    title,
    message,
    details: [{ label: 'Content Block', value: blockType }],
  }
}

function eventBase(ctx: ExtendedContentBlockContext): Omit<BaseEvent, 'type'> {
  return {
    id: randomUUID(),
    sessionId: ctx.sessionId,
    turnId: ctx.turnId,
    timestamp: new Date().toISOString(),
    seq: 0,
  }
}

function normalizeToolInput(input: unknown): Record<string, unknown> {
  if (isRecord(input)) return input
  return input == null ? {} : { value: input }
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value != null && !Array.isArray(value)
}
