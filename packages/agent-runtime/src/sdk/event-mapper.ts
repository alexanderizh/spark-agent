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
  /** 存储工具调用结果，用于提取 diff */
  toolResultsById?: Map<string, string>
}

/**
 * 消息段状态：同一 turn 内每条 SDK assistant message（被工具调用分隔的一段
 * 正文/思考）分配一个 segmentId。complete 事件携带 segmentId 后，下游只替换
 * 同 segment 的流式文本，避免多段正文互相覆盖。
 */
interface SegmentState {
  /** 当前正在流式输出的 assistant message 对应的 segmentId */
  currentText: string | null
  currentThinking: string | null
}

function getSegmentState(ctx: EventContext): SegmentState {
  const record = ctx as EventContext & { segmentState?: SegmentState }
  if (record.segmentState == null) {
    record.segmentState = { currentText: null, currentThinking: null }
  }
  return record.segmentState
}

function currentTextSegment(ctx: EventContext): string {
  const state = getSegmentState(ctx)
  if (state.currentText == null) state.currentText = randomUUID()
  return state.currentText
}

function currentThinkingSegment(ctx: EventContext): string {
  const state = getSegmentState(ctx)
  if (state.currentThinking == null) state.currentThinking = randomUUID()
  return state.currentThinking
}

/** 一条 assistant message 收尾后，下一段正文/思考属于新 segment */
function closeSegments(ctx: EventContext): void {
  const state = getSegmentState(ctx)
  state.currentText = null
  state.currentThinking = null
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
export function mapSDKMessageToEvents(message: SDKMessage, ctx: EventContext): AgentEvent[] {
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
  return [
    {
      ...baseEvent(ctx),
      type: 'agent_status',
      status: 'thinking',
      message: `Initialized with model ${msg.model}, ${msg.tools.length} tools, ${msg.mcp_servers.length} MCP servers`,
    },
  ]
}

function mapAssistantMessage(msg: SDKAssistantMessage, ctx: EventContext): AgentEvent[] {
  const events: AgentEvent[] = []
  const content = msg.message.content
  const isSubagentMessage = msg.parent_tool_use_id != null

  // Subagent assistant messages carry parent_tool_use_id pointing to the
  // Agent tool_use that spawned them. Accumulate their usage so we can attach
  // it to the eventual subagent_completed event.
  if (isSubagentMessage && msg.message.usage) {
    const acc = getSubagentUsage(ctx)
    const prev = acc.get(msg.parent_tool_use_id!) ?? { inputTokens: 0, outputTokens: 0 }
    acc.set(msg.parent_tool_use_id!, {
      inputTokens: prev.inputTokens + (msg.message.usage.input_tokens ?? 0),
      outputTokens: prev.outputTokens + (msg.message.usage.output_tokens ?? 0),
    })
  }

  for (const block of content) {
    // Subagent 的正文/思考属于其内部过程，不能混入主时间线（会覆盖 Host 正文）；
    // 其产出统一由 subagent_completed 的 output 呈现。工具事件仍透传（执行日志）。
    if (isSubagentMessage && (block.type === 'text' || block.type === 'thinking')) continue
    events.push(...mapContentBlock(block, ctx))
  }
  if (!isSubagentMessage) closeSegments(ctx)

  // Emit usage if available
  if (msg.message.usage) {
    const cacheHit = msg.message.usage.cache_read_input_tokens
    const cacheWrite = msg.message.usage.cache_creation_input_tokens
    events.push({
      ...baseEvent(ctx),
      type: 'usage_update',
      provider: 'claude',
      model: msg.message.model ?? '',
      inputTokens: msg.message.usage.input_tokens,
      outputTokens: msg.message.usage.output_tokens,
      ...(cacheHit != null ? { cacheHitTokens: cacheHit } : {}),
      ...(cacheWrite != null ? { cacheWriteTokens: cacheWrite } : {}),
    })
  }

  return events
}

function mapUserMessage(msg: SDKUserMessage, ctx: EventContext): AgentEvent[] {
  if (!Array.isArray(msg.message.content)) return []
  const events = msg.message.content.flatMap((block) => mapContentBlock(block, ctx))
  // user 消息（工具结果等）到达即意味着上一段 assistant 输出已结束
  closeSegments(ctx)
  return events
}

function mapStreamEvent(msg: SDKStreamEvent, ctx: EventContext): AgentEvent[] {
  const event = msg.event
  if (event == null) return []

  // Subagent 的流式增量不进入主时间线（与 mapAssistantMessage 的过滤保持一致），
  // 否则 Host 正文会被并行运行的 subagent 文本污染。
  if (msg.parent_tool_use_id != null && event.type === 'content_block_delta') return []

  switch (event.type) {
    case 'content_block_delta': {
      const delta = event.delta
      if (delta == null) return []

      if (delta.type === 'text_delta' && delta.text != null) {
        return [
          {
            ...baseEvent(ctx),
            type: 'assistant_message',
            mode: 'delta',
            content: delta.text,
            provider: 'claude',
            isFinal: false,
            segmentId: currentTextSegment(ctx),
          },
        ]
      }

      if (delta.type === 'thinking_delta' && delta.thinking != null) {
        return [
          {
            ...baseEvent(ctx),
            type: 'agent_thinking',
            mode: 'delta',
            content: delta.thinking,
            segmentId: currentThinkingSegment(ctx),
          },
        ]
      }

      return []
    }

    case 'content_block_start': {
      const block = event.content_block
      if (block == null) return []

      if (block.type === 'tool_use' && block.id != null && block.name != null) {
        return [
          {
            ...baseEvent(ctx),
            type: 'agent_status',
            status: 'calling_tool',
            message: `Calling ${mapSDKToolName(block.name)}`,
          },
        ]
      }
      return []
    }

    case 'message_start': {
      const usage = event.message?.usage
      if (usage) {
        return [
          {
            ...baseEvent(ctx),
            type: 'usage_update',
            provider: 'claude',
            model: '',
            inputTokens: usage.input_tokens,
            outputTokens: usage.output_tokens,
          },
        ]
      }
      return []
    }

    default:
      return []
  }
}

function mapResultMessage(msg: SDKResultMessage, ctx: EventContext): AgentEvent[] {
  const events: AgentEvent[] = []
  const checkpoint = msg.checkpoint
  const checkpointId = checkpoint?.checkpoint_id ?? checkpoint?.id
  const checkpointFilePaths = checkpoint?.file_paths ?? checkpoint?.files

  // Final usage update
  events.push({
    ...baseEvent(ctx),
    type: 'usage_update',
    provider: 'claude',
    model: '',
    inputTokens: msg.usage.input_tokens,
    outputTokens: msg.usage.output_tokens,
    cacheHitTokens: msg.usage.cache_read_input_tokens,
    cacheWriteTokens: msg.usage.cache_creation_input_tokens,
    estimatedCostUsd: msg.total_cost_usd,
  })

  if (checkpointId) {
    events.push({
      ...baseEvent(ctx),
      type: 'checkpoint',
      checkpointId,
      ...(checkpoint?.label ? { label: checkpoint.label } : {}),
      ...(checkpoint?.path ? { path: checkpoint.path } : {}),
      ...(checkpointFilePaths != null ? { filePaths: checkpointFilePaths } : {}),
      ...(msg.session_id ? { sdkSessionId: msg.session_id } : {}),
    })
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
      return [
        {
          ...baseEvent(ctx),
          type: 'assistant_message',
          mode: 'complete',
          content: block.text,
          provider: 'claude',
          isFinal: false,
          // 与本条消息的流式 delta 共用同一 segmentId，complete 仅替换该段
          segmentId: currentTextSegment(ctx),
        },
      ]

    case 'thinking':
      return [
        {
          ...baseEvent(ctx),
          type: 'agent_thinking',
          mode: 'complete',
          content: block.thinking,
          segmentId: currentThinkingSegment(ctx),
        },
      ]

    case 'tool_use':
      ctx.toolNamesById?.set(block.id, mapSDKToolName(block.name))
      getToolInputs(ctx).set(block.id, normalizeToolInput(block.input))
      // Intercept Agent tool calls → emit SubagentStartedEvent
      if (block.name === 'Agent' || mapSDKToolName(block.name) === 'subagent') {
        const input = normalizeToolInput(block.input)
        return [
          {
            ...baseEvent(ctx),
            type: 'subagent_started',
            toolCallId: block.id,
            name: typeof input.agent === 'string' ? input.agent : 'Subagent',
            role: typeof input.description === 'string' ? input.description : '',
            task: typeof input.prompt === 'string' ? input.prompt : '',
          },
        ]
      }
      if (isPlanProposalTool(block.name)) {
        const plan = extractPlanText(normalizeToolInput(block.input))
        return plan != null
          ? [
              {
                ...baseEvent(ctx),
                type: 'plan_proposed',
                plan,
              },
            ]
          : []
      }
      return [
        {
          ...baseEvent(ctx),
          type: 'tool_call',
          toolCallId: block.id,
          toolName: mapSDKToolName(block.name),
          toolInput: normalizeToolInput(block.input),
          source: isSDKMcpTool(block.name) ? 'mcp' : 'builtin',
          ...(isSDKMcpTool(block.name) ? { mcpServerId: extractMcpServerId(block.name) } : {}),
        },
      ]

    case 'tool_result': {
      const isError = block.is_error === true
      const content =
        typeof block.content === 'string' ? block.content : flattenContentBlocks(block.content)
      const toolName = ctx.toolNamesById?.get(block.tool_use_id) ?? 'unknown'

      // 存储工具结果供后续提取 diff 使用
      if (!isError && content) {
        getToolResults(ctx).set(block.tool_use_id, content)
      }

      if (toolName === 'exit_plan_mode') {
        const plan = extractPlanTextFromToolResult(content)
        return plan != null
          ? [
              {
                ...baseEvent(ctx),
                type: 'plan_proposed',
                plan,
              },
            ]
          : []
      }

      // Intercept subagent tool results → emit SubagentCompletedEvent
      if (toolName === 'subagent') {
        const subagentInput = getToolInputs(ctx).get(block.tool_use_id)
        const name = typeof subagentInput?.agent === 'string' ? subagentInput.agent : 'Subagent'
        const summary = content.length > 200 ? `${content.slice(0, 197)}...` : content
        const usage = getSubagentUsage(ctx).get(block.tool_use_id)
        return [
          {
            ...baseEvent(ctx),
            type: 'subagent_completed',
            toolCallId: block.tool_use_id,
            name,
            status: isError ? 'error' : 'success',
            resultSummary: isError ? (content || 'Subagent failed') : summary,
            output: content || '',
            ...(usage != null
              ? { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens }
              : {}),
          },
        ]
      }

      const events: AgentEvent[] = [
        {
          ...baseEvent(ctx),
          type: 'tool_result',
          toolCallId: block.tool_use_id,
          toolName,
          status: isError ? 'error' : 'success',
          ...(isError ? { error: content } : { output: content }),
        },
      ]
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

function buildFileChangeEvent(
  toolCallId: string,
  toolName: string,
  ctx: EventContext,
): AgentEvent | null {
  if (toolName !== 'edit_file' && toolName !== 'write_file' && toolName !== 'multi_edit')
    return null
  const input = findToolInput(toolCallId, ctx)
  const path = stringField(input, 'file_path') || stringField(input, 'path')
  if (!path) return null

  // 提取或生成 diff
  const toolResult = findToolResult(toolCallId, ctx)
  const diff = extractOrGenerateDiff(toolResult, toolName, input, path)

  return {
    ...baseEvent(ctx),
    type: 'file_change',
    changeType: determineChangeType(toolName, toolResult, input),
    path,
    ...(diff ? { diff } : {}),
  }
}

/** 确定文件变更类型 */
function determineChangeType(
  toolName: string,
  toolResult: string | null,
  input: Record<string, unknown> | null,
): 'create' | 'modify' | 'delete' {
  // write_file 创建新文件的情况
  if (toolName === 'write_file') {
    // 检查工具结果中是否有 "created" 或 "new file" 的提示
    if (toolResult) {
      const lowerResult = toolResult.toLowerCase()
      if (lowerResult.includes('created') || lowerResult.includes('new file')) {
        return 'create'
      }
    }
    return 'modify'
  }
  return 'modify'
}

/** 从工具结果提取 diff 或从输入参数生成 diff */
function extractOrGenerateDiff(
  toolResult: string | null,
  toolName: string,
  input: Record<string, unknown> | null,
  filePath: string,
): string | null {
  // 策略 1：尝试从工具结果中提取 unified diff
  if (toolResult && containsUnifiedDiff(toolResult)) {
    return extractUnifiedDiffSection(toolResult)
  }

  // 策略 2：从工具输入参数生成 diff
  if (toolName === 'edit_file' && input) {
    return generateEditFileDiff(input, filePath)
  }
  if (toolName === 'multi_edit' && input) {
    return generateMultiEditDiff(input, filePath)
  }
  if (toolName === 'write_file' && input) {
    return generateWriteFileDiff(input, filePath, toolResult)
  }

  return null
}

/** 检测文本是否包含 unified diff 格式 */
function containsUnifiedDiff(text: string): boolean {
  return text.includes('--- ') && text.includes('+++ ') && text.includes('@@')
}

/** 从工具结果中提取 unified diff 部分 */
function extractUnifiedDiffSection(text: string): string | null {
  const lines = text.split('\n')
  const diffStartIndex = lines.findIndex((line) => line.startsWith('--- '))
  if (diffStartIndex === -1) return null

  // 找到 diff 的结束位置（下一个非 diff 行或文件结束）
  let diffEndIndex = lines.length
  for (let i = diffStartIndex + 1; i < lines.length; i++) {
    const line = lines[i]
    if (line == null) continue
    // diff 行以 ---, +++ 或 @@ 开头，或者以空格、+、- 开头
    if (
      !line.startsWith('--- ') &&
      !line.startsWith('+++ ') &&
      !line.startsWith('@@') &&
      !line.startsWith(' ') &&
      !line.startsWith('+') &&
      !line.startsWith('-') &&
      !line.startsWith('\\') &&
      line.trim().length > 0
    ) {
      diffEndIndex = i
      break
    }
  }

  return lines.slice(diffStartIndex, diffEndIndex).join('\n')
}

/** 为 edit_file 工具生成 unified diff */
function generateEditFileDiff(input: Record<string, unknown>, filePath: string): string | null {
  const oldString = stringField(input, 'old_string')
  const newString = stringField(input, 'new_string')

  if (!oldString && !newString) return null

  // 生成简单的 unified diff
  const oldLines = oldString ? oldString.split('\n') : []
  const newLines = newString ? newString.split('\n') : []

  return buildUnifiedDiff(filePath, oldLines, newLines)
}

/** 为 multi_edit 工具生成 unified diff */
function generateMultiEditDiff(input: Record<string, unknown>, filePath: string): string | null {
  const edits = input['edits']
  if (!Array.isArray(edits) || edits.length === 0) return null

  // 合并所有编辑为一个 diff
  const diffParts: string[] = []
  for (const edit of edits) {
    if (typeof edit === 'object' && edit != null) {
      const editInput = edit as Record<string, unknown>
      const oldString = stringField(editInput, 'old_string')
      const newString = stringField(editInput, 'new_string')
      if (oldString || newString) {
        const oldLines = oldString ? oldString.split('\n') : []
        const newLines = newString ? newString.split('\n') : []
        const diff = buildUnifiedDiff(filePath, oldLines, newLines)
        if (diff) diffParts.push(diff)
      }
    }
  }

  return diffParts.length > 0 ? diffParts.join('\n') : null
}

/** 为 write_file 工具生成 unified diff */
function generateWriteFileDiff(
  input: Record<string, unknown>,
  filePath: string,
  toolResult: string | null,
): string | null {
  const content = stringField(input, 'content')
  if (!content) return null

  const newLines = content.split('\n')

  // 如果工具结果中提到了 "created" 或 "new file"，则视为创建新文件
  if (toolResult) {
    const lowerResult = toolResult.toLowerCase()
    if (lowerResult.includes('created') || lowerResult.includes('new file')) {
      // 新文件：所有内容都是新增
      return buildUnifiedDiff(filePath, [], newLines)
    }
  }

  // 否则视为修改文件（无法知道原始内容，生成一个全量 diff）
  // 使用空原始内容，显示为全量新增
  return buildUnifiedDiff(filePath, [], newLines)
}

/** 构建 unified diff 格式 */
function buildUnifiedDiff(filePath: string, oldLines: string[], newLines: string[]): string | null {
  if (oldLines.length === 0 && newLines.length === 0) return null

  // 简单的 diff 生成：当新旧内容完全不同时，显示为全量替换
  // 这不是精确的行级 diff，但足以让 UI 展示变更概览

  const diffLines: string[] = []

  // diff 头部
  diffLines.push(`--- a/${filePath}`)
  diffLines.push(`+++ b/${filePath}`)

  // 计算 hunks
  const oldStart = 1
  const newStart = 1
  const oldCount = oldLines.length
  const newCount = newLines.length

  // hunk header
  diffLines.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`)

  // 添加删除的行
  for (const line of oldLines) {
    diffLines.push(`-${line}`)
  }

  // 添加新增的行
  for (const line of newLines) {
    diffLines.push(`+${line}`)
  }

  return diffLines.join('\n')
}

function findToolInput(toolCallId: string, ctx: EventContext): Record<string, unknown> | null {
  const toolInputs = getToolInputs(ctx)
  return toolInputs.get(toolCallId) ?? null
}

function findToolResult(toolCallId: string, ctx: EventContext): string | null {
  const toolResults = getToolResults(ctx)
  return toolResults.get(toolCallId) ?? null
}

function getToolInputs(ctx: EventContext): Map<string, Record<string, unknown>> {
  const record = ctx as EventContext & { toolInputsById?: Map<string, Record<string, unknown>> }
  if (record.toolInputsById == null) record.toolInputsById = new Map()
  return record.toolInputsById
}

function getToolResults(ctx: EventContext): Map<string, string> {
  const record = ctx as EventContext & { toolResultsById?: Map<string, string> }
  if (record.toolResultsById == null) record.toolResultsById = new Map()
  return record.toolResultsById
}

function getSubagentUsage(
  ctx: EventContext,
): Map<string, { inputTokens: number; outputTokens: number }> {
  const record = ctx as EventContext & {
    subagentUsageById?: Map<string, { inputTokens: number; outputTokens: number }>
  }
  if (record.subagentUsageById == null) record.subagentUsageById = new Map()
  return record.subagentUsageById
}

/**
 * The SDK uses tool names like "Read", "Edit", "Bash", "mcp__server__tool".
 * Map them to Spark's display naming for the UI.
 */
function mapSDKToolName(sdkName: string): string {
  const mapping: Record<string, string> = {
    Read: 'read_file',
    Write: 'write_file',
    Edit: 'edit_file',
    MultiEdit: 'multi_edit',
    Bash: 'bash',
    Glob: 'search_files',
    Grep: 'grep',
    TodoRead: 'todo_read',
    TodoWrite: 'todo_write',
    WebFetch: 'web_fetch',
    WebSearch: 'web_search',
    Agent: 'subagent',
    ExitPlanMode: 'exit_plan_mode',
    EnterPlanMode: 'enter_plan_mode',
    AskUserQuestion: 'ask_user_question',
    TaskCreate: 'task_create',
    TaskUpdate: 'task_update',
    TaskGet: 'task_get',
    TaskList: 'task_list',
    TaskOutput: 'task_output',
    TaskStop: 'task_stop',
  }
  return mapping[sdkName] ?? sdkName
}

function isPlanProposalTool(name: string): boolean {
  return name === 'ExitPlanMode' || mapSDKToolName(name) === 'exit_plan_mode'
}

function extractPlanText(input: Record<string, unknown>): string | null {
  const plan = input['plan']
  return typeof plan === 'string' && plan.trim().length > 0 ? plan : null
}

function extractPlanTextFromToolResult(content: string): string | null {
  try {
    const parsed = JSON.parse(content) as unknown
    if (parsed != null && typeof parsed === 'object') {
      return extractPlanText(parsed as Record<string, unknown>)
    }
  } catch {
    // Some SDK tool results are plain rendered text; only JSON carries a stable plan field.
  }
  return null
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
