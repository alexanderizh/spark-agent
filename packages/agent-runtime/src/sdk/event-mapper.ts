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
import type { AgentEvent, RuntimeEventOrigin } from '@spark/protocol'
import type {
  SDKMessage,
  SDKAssistantMessage,
  SDKAssistantMessageError,
  SDKAuthStatusMessage,
  SDKRateLimitEvent,
  SDKResultMessage,
  SDKSystemMessage,
  SDKStreamEvent,
  SDKContentBlock,
  SDKUserMessage,
} from './types.js'
import { mapExtendedContentBlock, serializePublicContent } from './content-block-mapper.js'
import { mapSDKToolName } from './tool-name-mapper.js'
import { buildUnifiedDiff } from './unified-diff.js'

interface EventContext {
  sessionId: string
  turnId: string
  toolNamesById?: Map<string, string>
  /** Last plan emitted in this turn, used to collapse identical ExitPlanMode retries. */
  lastPlanProposal?: string
  /** 存储工具调用结果，用于提取 diff */
  toolResultsById?: Map<string, string>
  /** SDK async Task launch receipts map internal agent ids back to the original Agent tool call. */
  asyncSubagentLaunchesByAgentId?: Map<string, { toolCallId: string; name: string }>
  /** SDK message UUID -> emitted Spark event IDs, used by refusal fallback retractions. */
  sdkEventIdsByMessageId?: Map<string, string[]>
  /** SDK task id -> stable Spark subagent card identity. */
  subagentTasksById?: Map<string, SubagentTaskState>
  /** Per-subagent streaming segments keep nested transcripts out of host segments. */
  subagentSegments?: Map<string, SegmentState>
  /** Running SDK subagents used to attribute provider signals that omit parent_tool_use_id. */
  activeSubagents?: Map<string, { name: string }>
}

interface SubagentTaskState {
  toolCallId: string
  name: string
  description: string
  skipTranscript: boolean
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

function getSubagentSegmentState(ctx: EventContext, toolCallId: string): SegmentState {
  const states = (ctx.subagentSegments ??= new Map())
  let state = states.get(toolCallId)
  if (state == null) {
    state = { currentText: null, currentThinking: null }
    states.set(toolCallId, state)
  }
  return state
}

function currentSubagentSegment(
  ctx: EventContext,
  toolCallId: string,
  kind: 'text' | 'thinking',
): string {
  const state = getSubagentSegmentState(ctx, toolCallId)
  const key = kind === 'text' ? 'currentText' : 'currentThinking'
  if (state[key] == null) state[key] = randomUUID()
  return state[key]
}

function closeSubagentSegments(ctx: EventContext, toolCallId: string): void {
  ctx.subagentSegments?.delete(toolCallId)
}

function getSubagentTasks(ctx: EventContext): Map<string, SubagentTaskState> {
  return (ctx.subagentTasksById ??= new Map())
}

function registerActiveSubagent(ctx: EventContext, toolCallId: string, name: string): void {
  const active = (ctx.activeSubagents ??= new Map())
  active.set(toolCallId, { name })
}

function unregisterActiveSubagent(ctx: EventContext, toolCallId: string): void {
  ctx.activeSubagents?.delete(toolCallId)
}

function subagentEventOrigin(
  ctx: EventContext,
  toolCallId: string,
  fallbackName?: string,
): RuntimeEventOrigin {
  return {
    kind: 'subagent',
    toolCallId,
    name: fallbackName ?? ctx.activeSubagents?.get(toolCallId)?.name ?? 'Subagent',
  }
}

function providerSignalOrigin(ctx: EventContext, agentId?: string): RuntimeEventOrigin {
  const correlated = agentId != null ? ctx.asyncSubagentLaunchesByAgentId?.get(agentId) : undefined
  if (correlated != null) {
    return {
      kind: 'subagent',
      toolCallId: correlated.toolCallId,
      name: correlated.name,
    }
  }
  const active = [...(ctx.activeSubagents?.entries() ?? [])]
  if (active.length === 1) {
    const [toolCallId, subagent] = active[0]!
    return { kind: 'subagent', toolCallId, name: subagent.name }
  }
  return {
    kind: 'runtime',
    name: active.length > 1 ? 'Claude SDK（协作来源未明确）' : 'Claude SDK',
  }
}

function subagentTaskIdentity(
  ctx: EventContext,
  taskId: string,
  toolUseId?: string,
  fallback?: Partial<SubagentTaskState>,
): SubagentTaskState {
  const tasks = getSubagentTasks(ctx)
  const previous = tasks.get(taskId)
  const next = {
    toolCallId: toolUseId ?? previous?.toolCallId ?? `claude-task:${taskId}`,
    name: fallback?.name ?? previous?.name ?? 'Subagent',
    description: fallback?.description ?? previous?.description ?? 'Background task',
    skipTranscript: fallback?.skipTranscript ?? previous?.skipTranscript ?? false,
  }
  tasks.set(taskId, next)
  return next
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
  let events: AgentEvent[]
  switch (message.type) {
    case 'system':
      events = mapSystemMessage(message as SDKSystemMessage, ctx)
      break
    case 'assistant':
      events = mapAssistantMessage(message as SDKAssistantMessage, ctx)
      break
    case 'stream_event':
      events = mapStreamEvent(message as SDKStreamEvent, ctx)
      break
    case 'result':
      events = mapResultMessage(message as SDKResultMessage, ctx)
      break
    case 'user':
      events = mapUserMessage(message as SDKUserMessage, ctx)
      break
    case 'auth_status':
      events = mapAuthStatusMessage(message as SDKAuthStatusMessage, ctx)
      break
    case 'rate_limit_event':
      events = mapRateLimitMessage(message as SDKRateLimitEvent, ctx)
      break
    default:
      events = []
  }

  const retraction = buildTranscriptRetraction(message, ctx)
  if (retraction != null) events.unshift(retraction)
  rememberSDKMessageEvents(message, events, ctx)
  return events
}

function mapSystemMessage(msg: SDKSystemMessage, ctx: EventContext): AgentEvent[] {
  if (msg.subtype === 'task_started') {
    const task = subagentTaskIdentity(ctx, msg.task_id, msg.tool_use_id, {
      name: msg.subagent_type ?? msg.workflow_name ?? msg.task_type ?? 'Subagent',
      description: msg.description,
      skipTranscript: msg.skip_transcript === true,
    })
    registerActiveSubagent(ctx, task.toolCallId, task.name)
    if (task.skipTranscript) return []
    return [
      {
        ...baseEvent(ctx),
        type: 'subagent_started',
        toolCallId: task.toolCallId,
        taskId: msg.task_id,
        name: task.name,
        role: msg.description,
        task: msg.prompt ?? msg.description,
      },
    ]
  }

  if (msg.subtype === 'task_progress') {
    const task = subagentTaskIdentity(ctx, msg.task_id, msg.tool_use_id, {
      ...(msg.subagent_type != null ? { name: msg.subagent_type } : {}),
      description: msg.description,
    })
    registerActiveSubagent(ctx, task.toolCallId, task.name)
    if (task.skipTranscript) return []
    return [
      {
        ...baseEvent(ctx),
        type: 'subagent_progress',
        toolCallId: task.toolCallId,
        taskId: msg.task_id,
        description: msg.description,
        ...(msg.summary != null ? { summary: msg.summary } : {}),
        ...(msg.last_tool_name != null ? { lastToolName: mapSDKToolName(msg.last_tool_name) } : {}),
        totalTokens: msg.usage.total_tokens,
        toolUses: msg.usage.tool_uses,
        durationMs: msg.usage.duration_ms,
        status: 'running',
      },
    ]
  }

  if (msg.subtype === 'task_updated') {
    const task = subagentTaskIdentity(ctx, msg.task_id, undefined, {
      ...(msg.patch.description != null ? { description: msg.patch.description } : {}),
    })
    const status = msg.patch.status === 'killed' ? 'stopped' : msg.patch.status
    if (status === 'completed' || status === 'failed' || status === 'stopped') {
      unregisterActiveSubagent(ctx, task.toolCallId)
    } else if (status === 'pending' || status === 'running' || status === 'paused') {
      registerActiveSubagent(ctx, task.toolCallId, task.name)
    }
    if (task.skipTranscript) return []
    return [
      {
        ...baseEvent(ctx),
        type: 'subagent_progress',
        toolCallId: task.toolCallId,
        taskId: msg.task_id,
        ...(msg.patch.description != null ? { description: msg.patch.description } : {}),
        ...(msg.patch.error != null ? { summary: msg.patch.error } : {}),
        ...(status != null ? { status } : {}),
      },
    ]
  }

  if (msg.subtype === 'task_notification') {
    const task = subagentTaskIdentity(ctx, msg.task_id, msg.tool_use_id, {
      skipTranscript: msg.skip_transcript === true,
    })
    unregisterActiveSubagent(ctx, task.toolCallId)
    if (task.skipTranscript) return []
    return [
      {
        ...baseEvent(ctx),
        type: 'subagent_completed',
        toolCallId: task.toolCallId,
        name: task.name,
        status:
          msg.status === 'completed' ? 'success' : msg.status === 'stopped' ? 'stopped' : 'error',
        resultSummary: msg.summary,
        output: msg.summary,
        ...(msg.usage != null
          ? {
              totalTokens: msg.usage.total_tokens,
              toolUses: msg.usage.tool_uses,
              durationMs: msg.usage.duration_ms,
            }
          : {}),
      },
    ]
  }

  if (msg.subtype === 'background_tasks_changed') {
    const descriptions = msg.tasks.map((task) => task.description).filter(Boolean)
    return [
      {
        ...baseEvent(ctx),
        type: 'runtime_signal',
        signal: 'background_tasks',
        level: 'info',
        title: msg.tasks.length > 0 ? '后台任务正在运行' : '后台任务已结束',
        message:
          msg.tasks.length > 0
            ? `${msg.tasks.length} 个后台任务仍在运行。`
            : '当前没有运行中的后台任务。',
        code: 'CLAUDE_BACKGROUND_TASKS_CHANGED',
        details: [
          { label: '运行中', value: String(msg.tasks.length) },
          ...(descriptions.length > 0 ? [{ label: '任务', value: descriptions.join('; ') }] : []),
        ],
      },
    ]
  }

  if (msg.subtype === 'api_retry') {
    return [
      {
        ...baseEvent(ctx),
        type: 'runtime_signal',
        signal: 'api_retry',
        level: 'warning',
        title: 'Claude API 正在重试',
        message: describeClaudeAssistantError(msg.error).message,
        code: `CLAUDE_API_RETRY_${msg.error.toUpperCase()}`,
        origin: providerSignalOrigin(ctx),
        actionHint: 'SDK 会自动重试，无需重复发送。',
        details: [
          { label: '重试进度', value: `${msg.attempt}/${msg.max_retries}` },
          { label: '等待时间', value: `${msg.retry_delay_ms} ms` },
          ...(msg.error_status != null
            ? [{ label: 'HTTP 状态', value: String(msg.error_status) }]
            : []),
        ],
      },
    ]
  }

  if (msg.subtype === 'permission_denied') {
    return [
      {
        ...baseEvent(ctx),
        type: 'runtime_signal',
        signal: 'permission_denied',
        level: 'warning',
        title: '工具权限已拒绝',
        message: msg.message,
        code: 'CLAUDE_PERMISSION_DENIED',
        origin: providerSignalOrigin(ctx, msg.agent_id),
        actionHint: '调整会话权限模式或项目规则后再试。',
        details: [
          { label: '工具', value: msg.tool_name },
          ...(msg.decision_reason_type != null
            ? [{ label: '拒绝来源', value: msg.decision_reason_type }]
            : []),
          ...(msg.decision_reason != null ? [{ label: '原因', value: msg.decision_reason }] : []),
        ],
      },
    ]
  }

  if (msg.subtype === 'session_state_changed') {
    const status =
      msg.state === 'idle'
        ? 'completed'
        : msg.state === 'requires_action'
          ? 'waiting_user'
          : 'thinking'
    return [
      {
        ...baseEvent(ctx),
        type: 'agent_status',
        status,
        message:
          msg.state === 'idle'
            ? 'Claude session is idle'
            : msg.state === 'requires_action'
              ? 'Claude session requires action'
              : 'Claude session is running',
      },
    ]
  }

  if (msg.subtype === 'model_refusal_fallback') {
    return [
      {
        ...baseEvent(ctx),
        type: 'runtime_signal',
        signal: 'model_refusal_fallback',
        level: 'warning',
        title: '主模型拒绝，已切换备用模型',
        message: msg.content,
        code: 'CLAUDE_MODEL_REFUSAL_FALLBACK',
        actionHint: '备用模型正在继续本轮请求。',
        details: [
          { label: '原模型', value: msg.original_model },
          { label: '备用模型', value: msg.fallback_model },
          ...(msg.api_refusal_category != null
            ? [{ label: '拒绝类别', value: msg.api_refusal_category }]
            : []),
        ],
      },
    ]
  }

  if (msg.subtype === 'model_refusal_no_fallback') {
    return [
      {
        ...baseEvent(ctx),
        type: 'agent_error',
        code: 'CLAUDE_MODEL_REFUSAL',
        title: '模型拒绝了本次请求',
        message: msg.content,
        retryable: true,
        actionHint: '可改写请求、缩小范围或切换模型后重试。',
        details: [
          { label: '模型', value: msg.original_model },
          ...(msg.api_refusal_category != null
            ? [{ label: '拒绝类别', value: msg.api_refusal_category }]
            : []),
          ...(msg.api_refusal_explanation != null
            ? [{ label: '说明', value: msg.api_refusal_explanation }]
            : []),
        ],
      },
      {
        ...baseEvent(ctx),
        type: 'agent_status',
        status: 'error',
        message: 'Claude model refused the request without a fallback.',
      },
    ]
  }

  if (msg.subtype === 'notification') {
    return [
      {
        ...baseEvent(ctx),
        type: 'runtime_signal',
        signal: 'notification',
        level: msg.priority === 'high' || msg.priority === 'immediate' ? 'warning' : 'info',
        title: 'Claude 运行通知',
        message: msg.text,
        code: msg.key,
        details: [{ label: '优先级', value: msg.priority }],
      },
    ]
  }

  if (msg.subtype === 'mirror_error') {
    return [
      {
        ...baseEvent(ctx),
        type: 'runtime_signal',
        signal: 'mirror_error',
        level: 'error',
        title: '会话镜像写入失败',
        message: msg.error,
        code: 'CLAUDE_MIRROR_ERROR',
        actionHint: '本地会话仍可继续，但外部镜像可能缺少这批记录。',
        details: [
          { label: '项目', value: msg.key.projectKey },
          { label: 'SDK 会话', value: msg.key.sessionId },
        ],
      },
    ]
  }

  if (msg.subtype === 'worker_shutting_down') {
    return [
      {
        ...baseEvent(ctx),
        type: 'runtime_signal',
        signal: 'worker_shutdown',
        level: 'error',
        title: 'Claude worker 已停止',
        message: `Worker shutdown reason: ${msg.reason}`,
        code: 'CLAUDE_WORKER_SHUTDOWN',
        retryable: true,
        actionHint: '重新发送上一条消息可启动新的 worker。',
        details: [{ label: '原因', value: msg.reason }],
      },
      {
        ...baseEvent(ctx),
        type: 'agent_status',
        status: 'error',
        message: `Claude worker stopped: ${msg.reason}`,
      },
    ]
  }

  if (msg.subtype === 'status') {
    const events: AgentEvent[] = []
    if (msg.status === 'compacting') {
      events.push({
        ...baseEvent(ctx),
        type: 'context_compaction',
        provider: 'claude',
        source: 'claude_code',
        phase: 'started',
        rawType: 'system/status',
      })
    }
    if (msg.compact_result === 'success') {
      events.push({
        ...baseEvent(ctx),
        type: 'context_compaction',
        provider: 'claude',
        source: 'claude_code',
        phase: 'completed',
        rawType: 'system/status',
      })
    }
    if (msg.compact_result === 'failed') {
      events.push({
        ...baseEvent(ctx),
        type: 'context_compaction',
        provider: 'claude',
        source: 'claude_code',
        phase: 'failed',
        ...(msg.compact_error != null ? { message: msg.compact_error } : {}),
        rawType: 'system/status',
      })
    }
    return events
  }

  if (msg.subtype === 'compact_boundary') {
    return [
      {
        ...baseEvent(ctx),
        type: 'context_compaction',
        provider: 'claude',
        source: 'claude_code',
        phase: 'boundary',
        trigger: msg.compact_metadata.trigger,
        preTokens: msg.compact_metadata.pre_tokens,
        ...(msg.compact_metadata.post_tokens != null
          ? { postTokens: msg.compact_metadata.post_tokens }
          : {}),
        ...(msg.compact_metadata.duration_ms != null
          ? { durationMs: msg.compact_metadata.duration_ms }
          : {}),
        rawType: 'system/compact_boundary',
      },
    ]
  }

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
    if (isSubagentMessage && (block.type === 'text' || block.type === 'thinking')) {
      const content = block.type === 'text' ? block.text : block.thinking
      if (content.length > 0) {
        events.push({
          ...baseEvent(ctx),
          type: 'subagent_message',
          toolCallId: msg.parent_tool_use_id!,
          contentKind: block.type,
          mode: 'complete',
          content,
          segmentId: currentSubagentSegment(ctx, msg.parent_tool_use_id!, block.type),
        })
      }
      continue
    }
    events.push(...mapContentBlock(block, ctx))
  }
  if (isSubagentMessage) closeSubagentSegments(ctx, msg.parent_tool_use_id!)
  else closeSegments(ctx)

  if (msg.error != null) {
    const error = describeClaudeAssistantError(msg.error)
    events.push({
      ...baseEvent(ctx),
      type: 'agent_error',
      code: `CLAUDE_${msg.error.toUpperCase()}`,
      title: error.title,
      message: error.message,
      retryable: error.retryable,
      actionHint: error.actionHint,
      ...(isSubagentMessage
        ? {
            origin: subagentEventOrigin(
              ctx,
              msg.parent_tool_use_id!,
              msg.subagent_type ?? msg.task_description,
            ),
          }
        : {}),
      rawError: msg.error,
    })
    if (!isSubagentMessage) {
      events.push({
        ...baseEvent(ctx),
        type: 'agent_status',
        status: 'error',
        message: error.title,
      })
    }
  }

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
  const parentToolUseId = msg.parent_tool_use_id
  if (typeof msg.message.content === 'string') {
    if (parentToolUseId == null || msg.message.content.length === 0) return []
    const event: AgentEvent = {
      ...baseEvent(ctx),
      type: 'subagent_message',
      toolCallId: parentToolUseId,
      contentKind: 'text',
      mode: 'complete',
      content: msg.message.content,
      segmentId: currentSubagentSegment(ctx, parentToolUseId, 'text'),
    }
    closeSubagentSegments(ctx, parentToolUseId)
    return [event]
  }
  const events = msg.message.content.flatMap((block) => {
    if (parentToolUseId != null && block.type === 'text') {
      return [
        {
          ...baseEvent(ctx),
          type: 'subagent_message' as const,
          toolCallId: parentToolUseId,
          contentKind: 'text' as const,
          mode: 'complete' as const,
          content: block.text,
          segmentId: currentSubagentSegment(ctx, parentToolUseId, 'text'),
        },
      ]
    }
    return mapContentBlock(block, ctx)
  })
  // user 消息（工具结果等）到达即意味着上一段 assistant 输出已结束
  if (parentToolUseId != null) closeSubagentSegments(ctx, parentToolUseId)
  else closeSegments(ctx)
  return events
}

function mapStreamEvent(msg: SDKStreamEvent, ctx: EventContext): AgentEvent[] {
  const event = msg.event
  if (event == null) return []

  if (msg.parent_tool_use_id != null && event.type === 'content_block_delta') {
    const delta = event.delta
    if (delta?.type === 'text_delta' && delta.text != null) {
      return [
        {
          ...baseEvent(ctx),
          type: 'subagent_message',
          toolCallId: msg.parent_tool_use_id,
          contentKind: 'text',
          mode: 'delta',
          content: delta.text,
          segmentId: currentSubagentSegment(ctx, msg.parent_tool_use_id, 'text'),
        },
      ]
    }
    if (delta?.type === 'thinking_delta' && delta.thinking != null) {
      return [
        {
          ...baseEvent(ctx),
          type: 'subagent_message',
          toolCallId: msg.parent_tool_use_id,
          contentKind: 'thinking',
          mode: 'delta',
          content: delta.thinking,
          segmentId: currentSubagentSegment(ctx, msg.parent_tool_use_id, 'thinking'),
        },
      ]
    }
    return []
  }

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
  } else {
    const errorMsg = msg.errors?.join('; ') ?? `Turn ended: ${msg.subtype}`
    const nonRetryable =
      msg.subtype === 'error_max_budget_usd' ||
      msg.subtype === 'error_max_structured_output_retries'
    events.push({
      ...baseEvent(ctx),
      type: 'agent_error',
      code: msg.subtype.toUpperCase(),
      title:
        msg.subtype === 'error_max_structured_output_retries'
          ? '结构化输出校验失败'
          : 'Claude 执行失败',
      message: errorMsg,
      retryable: !nonRetryable,
      actionHint:
        msg.subtype === 'error_max_structured_output_retries'
          ? '调整结构化输出约束或模型后重试。'
          : msg.subtype === 'error_max_budget_usd'
            ? '提高预算上限或缩小任务范围。'
            : '可重新发送上一条消息。',
    })
    events.push({
      ...baseEvent(ctx),
      type: 'agent_status',
      status: 'error',
    })
  }

  return events
}

function mapAuthStatusMessage(msg: SDKAuthStatusMessage, ctx: EventContext): AgentEvent[] {
  const hasError = msg.error != null && msg.error.length > 0
  const message = hasError
    ? (msg.error ?? 'Claude authentication failed.')
    : msg.output.join('\n') || 'Authentication state updated.'
  return [
    {
      ...baseEvent(ctx),
      type: 'runtime_signal',
      signal: 'auth_status',
      level: hasError ? 'error' : 'info',
      title: hasError
        ? 'Claude 认证失败'
        : msg.isAuthenticating
          ? 'Claude 正在认证'
          : 'Claude 认证完成',
      message,
      code: hasError ? 'CLAUDE_AUTH_STATUS_ERROR' : 'CLAUDE_AUTH_STATUS',
      actionHint: hasError ? '重新登录或检查本地 Claude 凭据。' : '按提示完成认证流程。',
    },
  ]
}

function mapRateLimitMessage(msg: SDKRateLimitEvent, ctx: EventContext): AgentEvent[] {
  const info = msg.rate_limit_info
  const rejected = info.status === 'rejected' || info.overageStatus === 'rejected'
  const warning = info.status === 'allowed_warning' || info.overageStatus === 'allowed_warning'
  const details = [
    ...(info.rateLimitType != null ? [{ label: '额度窗口', value: info.rateLimitType }] : []),
    ...(info.utilization != null
      ? [
          {
            label: '使用率',
            value: `${Math.round(info.utilization <= 1 ? info.utilization * 100 : info.utilization)}%`,
          },
        ]
      : []),
    ...(info.resetsAt != null
      ? [{ label: '重置时间', value: formatSDKTimestamp(info.resetsAt) }]
      : []),
    ...(info.overageDisabledReason != null
      ? [{ label: '超额不可用', value: info.overageDisabledReason }]
      : []),
  ]

  return [
    {
      ...baseEvent(ctx),
      type: 'runtime_signal',
      signal: 'rate_limit',
      level: rejected ? 'error' : warning ? 'warning' : 'info',
      title: rejected ? 'Claude 额度已用尽' : warning ? 'Claude 额度即将用尽' : 'Claude 额度状态',
      message: rejected
        ? '当前额度窗口拒绝了新请求。'
        : warning
          ? '当前额度窗口接近上限。'
          : '当前请求仍在额度范围内。',
      code: rejected
        ? 'CLAUDE_RATE_LIMIT_REJECTED'
        : warning
          ? 'CLAUDE_RATE_LIMIT_WARNING'
          : 'CLAUDE_RATE_LIMIT_ALLOWED',
      retryable: rejected,
      actionHint: rejected ? '额度重置后重试，或购买/启用额外额度。' : '可继续当前任务。',
      details,
    },
  ]
}

function describeClaudeAssistantError(error: SDKAssistantMessageError): {
  title: string
  message: string
  retryable: boolean
  actionHint: string
} {
  const descriptions: Record<
    SDKAssistantMessageError,
    {
      title: string
      message: string
      retryable: boolean
      actionHint: string
    }
  > = {
    authentication_failed: {
      title: 'Claude 认证失败',
      message: 'Claude 无法验证当前凭据。',
      retryable: false,
      actionHint: '重新登录或检查 API 凭据。',
    },
    oauth_org_not_allowed: {
      title: '当前组织不允许 Claude Code',
      message: 'OAuth 账号所属组织未开放 Claude Code。',
      retryable: false,
      actionHint: '切换到已授权的组织账号。',
    },
    billing_error: {
      title: 'Claude 账户额度不可用',
      message: '账单或额度状态阻止了本次请求。',
      retryable: false,
      actionHint: '检查账单、套餐或余额设置。',
    },
    rate_limit: {
      title: 'Claude 请求受到限流',
      message: '当前请求超过了 Claude 的额度或速率限制。',
      retryable: true,
      actionHint: '等待额度窗口重置后重试。',
    },
    overloaded: {
      title: 'Claude 服务繁忙',
      message: 'Claude 当前负载过高，暂时无法完成请求。',
      retryable: true,
      actionHint: '稍后重试，或切换到其他可用模型。',
    },
    invalid_request: {
      title: 'Claude 请求无效',
      message: '当前模型或请求参数不被 Claude 接受。',
      retryable: false,
      actionHint: '检查模型、上下文和请求配置。',
    },
    model_not_found: {
      title: 'Claude 模型不可用',
      message: '配置的 Claude 模型不存在或当前账号无权使用。',
      retryable: false,
      actionHint: '切换到账号可用的模型。',
    },
    server_error: {
      title: 'Claude 服务端错误',
      message: 'Claude 服务端未能完成本次请求。',
      retryable: true,
      actionHint: '稍后重新发送上一条消息。',
    },
    unknown: {
      title: 'Claude 返回未知错误',
      message: 'Claude SDK 未提供更具体的错误分类。',
      retryable: true,
      actionHint: '可重试；若持续失败，请检查运行日志。',
    },
    max_output_tokens: {
      title: 'Claude 输出达到上限',
      message: '模型在完成回答前达到了最大输出 token。',
      retryable: true,
      actionHint: '缩小请求范围，或继续下一轮让模型补全。',
    },
  }
  return descriptions[error] ?? descriptions.unknown
}

function formatSDKTimestamp(value: number): string {
  if (!Number.isFinite(value)) return String(value)
  const epochMs = value < 1_000_000_000_000 ? value * 1000 : value
  const date = new Date(epochMs)
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString()
}

function buildTranscriptRetraction(message: SDKMessage, ctx: EventContext): AgentEvent | null {
  const sdkMessageIds =
    message.type === 'assistant' && Array.isArray(message.supersedes)
      ? message.supersedes
      : message.type === 'system' &&
          message.subtype === 'model_refusal_fallback' &&
          Array.isArray(message.retracted_message_uuids)
        ? message.retracted_message_uuids
        : []
  if (sdkMessageIds.length === 0) return null

  const eventIds = sdkMessageIds.flatMap(
    (messageId) => ctx.sdkEventIdsByMessageId?.get(messageId) ?? [],
  )
  if (eventIds.length === 0) return null
  return {
    ...baseEvent(ctx),
    type: 'transcript_retraction',
    eventIds: [...new Set(eventIds)],
    reason: 'model_refusal_fallback',
  }
}

function rememberSDKMessageEvents(
  message: SDKMessage,
  events: AgentEvent[],
  ctx: EventContext,
): void {
  if (typeof message.uuid !== 'string') return
  if (ctx.sdkEventIdsByMessageId == null) ctx.sdkEventIdsByMessageId = new Map()
  ctx.sdkEventIdsByMessageId.set(
    message.uuid,
    events.filter((event) => event.type !== 'transcript_retraction').map((event) => event.id),
  )
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

    case 'tool_use': {
      ctx.toolNamesById?.set(block.id, mapSDKToolName(block.name))
      const toolInput = normalizeToolInput(block.input)
      getToolInputs(ctx).set(block.id, toolInput)
      // 追踪计划文件写入：新版 CLI 计划模式要求 agent 先把计划 Write 到
      // .claude/plans/*.md，ExitPlanMode 的 input 里不再带 plan 文本。
      // 这里把指向计划文件的 Write/Edit 内容记下来，ExitPlanMode 时取用它。
      if (isPlanFileWriteTool(block.name) && getPlanFilePath(toolInput) != null) {
        const content = typeof toolInput.content === 'string' ? toolInput.content : ''
        if (content.trim().length > 0) {
          getLastPlanWrite(ctx).content = content
        }
      }
      // Intercept Agent tool calls → emit SubagentStartedEvent
      if (block.name === 'Agent' || mapSDKToolName(block.name) === 'subagent') {
        const name = typeof toolInput.agent === 'string' ? toolInput.agent : 'Subagent'
        registerActiveSubagent(ctx, block.id, name)
        return [
          {
            ...baseEvent(ctx),
            type: 'subagent_started',
            toolCallId: block.id,
            name,
            role: typeof toolInput.description === 'string' ? toolInput.description : '',
            task: typeof toolInput.prompt === 'string' ? toolInput.prompt : '',
          },
        ]
      }
      if (isPlanProposalTool(block.name)) {
        // 优先用 ExitPlanMode input.plan；取不到则回退到本 turn 追踪到的计划文件内容。
        const plan = extractPlanText(toolInput) ?? getLastPlanWrite(ctx).content
        return mapPlanProposal(plan, ctx)
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
    }

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
        return mapPlanProposal(plan, ctx)
      }

      // Intercept subagent tool results → emit SubagentCompletedEvent
      if (toolName === 'subagent') {
        const subagentInput = getToolInputs(ctx).get(block.tool_use_id)
        const name = typeof subagentInput?.agent === 'string' ? subagentInput.agent : 'Subagent'
        if (!isError && isAsyncSubagentLaunchResult(content)) {
          const agentId = extractAsyncSubagentAgentId(content)
          if (agentId != null) {
            getAsyncSubagentLaunches(ctx).set(agentId, { toolCallId: block.tool_use_id, name })
          }
          return []
        }
        unregisterActiveSubagent(ctx, block.tool_use_id)
        const summary = content.length > 200 ? `${content.slice(0, 197)}...` : content
        const usage = getSubagentUsage(ctx).get(block.tool_use_id)
        return [
          {
            ...baseEvent(ctx),
            type: 'subagent_completed',
            toolCallId: block.tool_use_id,
            name,
            status: isError ? 'error' : 'success',
            resultSummary: isError ? content || 'Subagent failed' : summary,
            output: content || '',
            ...(usage != null
              ? { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens }
              : {}),
          },
        ]
      }

      const asyncSubagent = findAsyncSubagentForSendMessage(ctx, block.tool_use_id, toolName)
      if (asyncSubagent != null) {
        unregisterActiveSubagent(ctx, asyncSubagent.toolCallId)
        const summary = content.length > 200 ? `${content.slice(0, 197)}...` : content
        return [
          {
            ...baseEvent(ctx),
            type: 'subagent_completed',
            toolCallId: asyncSubagent.toolCallId,
            name: asyncSubagent.name,
            status: isError ? 'error' : 'success',
            resultSummary: isError ? content || 'Subagent failed' : summary,
            output: content || '',
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
      return mapExtendedContentBlock(block, ctx)
  }
}

function isAsyncSubagentLaunchResult(content: string): boolean {
  return (
    content.includes('Async agent launched successfully') &&
    content.includes('The agent is working in the background') &&
    content.includes('output_file:')
  )
}

function extractAsyncSubagentAgentId(content: string): string | null {
  const match = content.match(/(?:^|\n)agentId:\s*([^\s]+)/)
  return match?.[1] ?? null
}

function findAsyncSubagentForSendMessage(
  ctx: EventContext,
  toolCallId: string,
  toolName: string,
): { toolCallId: string; name: string } | null {
  if (toolName !== 'SendMessage') return null
  const input = getToolInputs(ctx).get(toolCallId)
  const to = input?.to ?? input?.agentId
  if (typeof to !== 'string') return null
  return getAsyncSubagentLaunches(ctx).get(to) ?? null
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

/**
 * 本 turn 内最后一次「计划文件写入」的内容。
 *
 * 新版 CLI 计划模式：agent 把计划 Write 到 .claude/plans/*.md，ExitPlanMode 的
 * input 不再带 plan 文本。我们在 tool_use 阶段记下这次写入的内容，等
 * ExitPlanMode 到来时用它作为 plan_proposed 的 plan 文本。
 */
function getLastPlanWrite(ctx: EventContext): { content: string } {
  const record = ctx as EventContext & { lastPlanWrite?: { content: string } }
  if (record.lastPlanWrite == null) record.lastPlanWrite = { content: '' }
  return record.lastPlanWrite
}

function isPlanFileWriteTool(sdkName: string): boolean {
  const mapped = mapSDKToolName(sdkName)
  return mapped === 'write_file' || mapped === 'edit_file'
}

function getPlanFilePath(input: Record<string, unknown>): string | null {
  const raw = input?.file_path ?? input?.filePath ?? input?.path
  if (typeof raw !== 'string') return null
  if (raw.includes('.claude/plans/') || raw.endsWith('-plan.md') || raw.endsWith('/plan.md')) {
    return raw
  }
  return null
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

function getAsyncSubagentLaunches(
  ctx: EventContext,
): Map<string, { toolCallId: string; name: string }> {
  if (ctx.asyncSubagentLaunchesByAgentId == null) {
    ctx.asyncSubagentLaunchesByAgentId = new Map()
  }
  return ctx.asyncSubagentLaunchesByAgentId
}

function isPlanProposalTool(name: string): boolean {
  return name === 'ExitPlanMode' || mapSDKToolName(name) === 'exit_plan_mode'
}

function mapPlanProposal(plan: string | null, ctx: EventContext): AgentEvent[] {
  if (plan == null || plan.trim().length === 0 || ctx.lastPlanProposal === plan) return []
  ctx.lastPlanProposal = plan
  return [
    {
      ...baseEvent(ctx),
      type: 'plan_proposed',
      plan,
    },
  ]
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
  return serializePublicContent(blocks)
}
