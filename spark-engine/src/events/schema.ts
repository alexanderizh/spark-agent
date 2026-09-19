import { z } from 'zod'

export const CURRENT_SCHEMA_VERSION = 1 as const
export const SchemaVersionSchema = z.literal(CURRENT_SCHEMA_VERSION)

export const ErrorInfoSchema = z.object({
  code: z.string().min(1),
  message: z.string(),
  retryable: z.boolean(),
  detail: z.unknown().optional(),
})

export const UsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative().default(0),
  cacheWriteTokens: z.number().int().nonnegative().default(0),
  // Tokens the provider spent on hidden reasoning (OpenAI reports them apart
  // from output_tokens); 0 for providers that fold reasoning into output.
  reasoningTokens: z.number().int().nonnegative().default(0),
})

export const ArtifactRefSchema = z.object({
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  bytes: z.number().int().nonnegative(),
  mediaType: z.string().min(1),
  summary: z.string(),
  readHint: z.string(),
})

/**
 * One image attached to a `turn.started` input. Only the content-addressed
 * artifact reference is recorded: the ledger stays small, identical images
 * de-duplicate, and replay re-reads the same bytes.
 */
export const TurnInputImageSchema = z.object({
  ref: ArtifactRefSchema,
  name: z.string().min(1).optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
})

export const ToolCallSchema = z.object({
  callId: z.string().min(1),
  name: z.string().min(1),
  args: z.unknown(),
})

export const AssistantMessageSchema = z.object({
  text: z.string().optional(),
  thinking: z.string().optional(),
  toolCalls: z.array(ToolCallSchema).default([]),
  continuation: z
    .object({
      protocol: z.enum(['anthropic-messages', 'openai-responses']),
      data: z.unknown(),
    })
    .optional(),
})

export const TurnStatsSchema = z.object({
  steps: z.number().int().nonnegative(),
  toolCalls: z.number().int().nonnegative(),
  usage: UsageSchema,
  wallMs: z.number().int().nonnegative(),
  // Summed LLM call time across steps (excludes tool execution); the basis for
  // generation throughput. 0 keeps ledgers written before timing landed valid.
  llmMs: z.number().int().nonnegative().default(0),
  // Time to the turn's first content token (first LLM call); 0 when unreported.
  ttftMs: z.number().int().nonnegative().default(0),
  costUsd: z.number().nonnegative().default(0),
  // Context compactions performed while running this turn. 0 keeps older
  // ledgers valid.
  compactions: z.number().int().nonnegative().default(0),
  // Tool-result bodies sunk to artifacts by microcompact during this turn.
  slimmedToolResults: z.number().int().nonnegative().default(0),
  // Active model context window, when the route reports one; lets hosts
  // render headroom without re-deriving the model budget.
  contextWindowTokens: z.number().int().positive().optional(),
  // Input tokens of the turn's final LLM call — the provider's own view of
  // the context footprint. Omitted when the provider reported nothing.
  lastInputTokens: z.number().int().nonnegative().optional(),
})

const envelope = {
  schemaVersion: SchemaVersionSchema,
  sessionId: z.string().min(1),
  seq: z.number().int().nonnegative(),
  ts: z.number().int().nonnegative(),
}

const SessionStartedEventSchema = z.object({
  ...envelope,
  type: z.literal('session.started'),
  engineVersion: z.string().min(1),
  cwd: z.string(),
  configSnapshot: z.string(),
})

const TurnStartedEventSchema = z.object({
  ...envelope,
  type: z.literal('turn.started'),
  turnId: z.string().min(1),
  // `images` is additive within schema v1: engines that predate it drop the
  // field while reading, and ledgers written before it stay valid.
  input: z.object({
    kind: z.literal('text'),
    text: z.string(),
    images: z.array(TurnInputImageSchema).optional(),
  }),
  parentId: z.string().optional(),
})

const TurnQueuedEventSchema = z.object({
  ...envelope,
  type: z.literal('turn.queued'),
  turnId: z.string().min(1),
})

const TurnCompletedEventSchema = z.object({
  ...envelope,
  type: z.literal('turn.completed'),
  turnId: z.string().min(1),
  reason: z.enum(['final', 'budget']),
  stats: TurnStatsSchema,
})

const TurnCancelledEventSchema = z.object({
  ...envelope,
  type: z.literal('turn.cancelled'),
  turnId: z.string().min(1),
  partial: z.array(z.number().int().nonnegative()).default([]),
})

const TurnFailedEventSchema = z.object({
  ...envelope,
  type: z.literal('turn.failed'),
  turnId: z.string().min(1),
  error: ErrorInfoSchema,
  recoveryHint: z.string().optional(),
})

const StepStartedEventSchema = z.object({
  ...envelope,
  type: z.literal('step.started'),
  stepId: z.string().min(1),
  turnId: z.string().min(1),
})

const AssistantCompletedEventSchema = z.object({
  ...envelope,
  type: z.literal('assistant.completed'),
  stepId: z.string().min(1),
  turnId: z.string().min(1),
  message: AssistantMessageSchema,
  usage: UsageSchema,
  // Per-call timing (analogous to tool.result.durationMs); 0 before timing
  // landed or when the provider adapter could not measure it.
  llmMs: z.number().int().nonnegative().default(0),
  ttftMs: z.number().int().nonnegative().default(0),
})

const ToolCallEventSchema = z.object({
  ...envelope,
  type: z.literal('tool.call'),
  callId: z.string().min(1),
  stepId: z.string().min(1),
  tool: z.string().min(1),
  args: z.unknown(),
})

const ToolIntentEventSchema = z.object({
  ...envelope,
  type: z.literal('tool.intent'),
  callId: z.string().min(1),
})

const ToolResultEventSchema = z.object({
  ...envelope,
  type: z.literal('tool.result'),
  callId: z.string().min(1),
  durationMs: z.number().int().nonnegative(),
  ok: z.boolean(),
  content: z.string(),
  /** Structured provenance for task results; absent on ordinary tools and legacy ledgers. */
  childSessionId: z.string().min(1).optional(),
  artifact: ArtifactRefSchema.optional(),
})

const PermissionRequestedEventSchema = z.object({
  ...envelope,
  type: z.literal('permission.requested'),
  requestId: z.string().min(1),
  callId: z.string().min(1),
  risk: z.object({ tool: z.string(), argsPreview: z.string() }),
})

const PermissionEvaluatedEventSchema = z.object({
  ...envelope,
  type: z.literal('permission.evaluated'),
  callId: z.string().min(1),
  // New three-mode values plus pre-consolidation values kept replayable:
  // decodeLine re-parses every stored event, so dropping the legacy enum would
  // break openSession() on existing ledgers.
  mode: z.enum(['manual', 'auto', 'bypass', 'default', 'acceptEdits', 'plan']),
  decision: z.enum(['allow', 'deny', 'ask']),
  reason: z.string().optional(),
  rule: z
    .object({
      id: z.string().min(1),
      source: z.enum(['builtin', 'user', 'project', 'cli', 'host']),
    })
    .optional(),
  allowedGrantScopes: z.array(z.enum(['once', 'session'])).optional(),
})

const PermissionDecidedEventSchema = z.object({
  ...envelope,
  type: z.literal('permission.decided'),
  requestId: z.string().min(1),
  decision: z.enum(['allow', 'deny']),
  grantScope: z.enum(['once', 'session']).optional(),
  reason: z.string().optional(),
})

const ContextCompactedEventSchema = z.object({
  ...envelope,
  type: z.literal('context.compacted'),
  // Dropped ranges are half-open [from, to) sequence windows covering whole
  // turns only, so tool call/result pairs are never split.
  summaryRef: ArtifactRefSchema.optional(),
  // Inline summary text so replay never needs an artifact read; summaryRef
  // keeps the same content addressable for audits.
  summary: z.string().min(1).optional(),
  droppedRanges: z.array(z.tuple([z.number().int(), z.number().int()])),
})

const SlimmedToolResultSchema = z.object({
  callId: z.string().min(1),
  /** Artifact holding the complete original body; the ledger keeps context. */
  fullRef: ArtifactRefSchema,
  /** Head+tail stub that replaces the body in every later projection. */
  slimmedContent: z.string().min(1),
  /** Estimated tokens freed from the per-step request. */
  savedTokens: z.number().int().nonnegative(),
})

/**
 * Microcompact record: stale tool bodies are sunk into the artifact store
 * and replaced by stubs. Pure token hygiene — the message itself stays, so
 * no tool pairing changes and the original content stays recoverable.
 */
const ToolResultsSlimmedEventSchema = z.object({
  ...envelope,
  type: z.literal('context.tool_results_slimmed'),
  slimmed: z.array(SlimmedToolResultSchema).min(1),
})

const LogRewindEventSchema = z.object({
  ...envelope,
  type: z.literal('log.rewind'),
  toSeq: z.number().int().nonnegative(),
})

const PluginActivatedEventSchema = z.object({
  ...envelope,
  type: z.literal('plugin.activated'),
  pluginId: z.string().min(1),
  effects: z.array(z.string()),
})

const PluginDeactivatedEventSchema = z.object({
  ...envelope,
  type: z.literal('plugin.deactivated'),
  pluginId: z.string().min(1),
})

const UserAnsweredEventSchema = z.object({
  ...envelope,
  type: z.literal('user.answered'),
  requestId: z.string().min(1),
  answer: z.unknown(),
})

export const AgentEventSchema = z.discriminatedUnion('type', [
  SessionStartedEventSchema,
  TurnStartedEventSchema,
  TurnQueuedEventSchema,
  TurnCompletedEventSchema,
  TurnCancelledEventSchema,
  TurnFailedEventSchema,
  StepStartedEventSchema,
  AssistantCompletedEventSchema,
  ToolCallEventSchema,
  ToolIntentEventSchema,
  ToolResultEventSchema,
  PermissionEvaluatedEventSchema,
  PermissionRequestedEventSchema,
  PermissionDecidedEventSchema,
  ContextCompactedEventSchema,
  ToolResultsSlimmedEventSchema,
  LogRewindEventSchema,
  PluginActivatedEventSchema,
  PluginDeactivatedEventSchema,
  UserAnsweredEventSchema,
])

export type AgentEvent = z.output<typeof AgentEventSchema>
export type ErrorInfo = z.output<typeof ErrorInfoSchema>
export type Usage = z.output<typeof UsageSchema>
export type ArtifactRef = z.output<typeof ArtifactRefSchema>
export type TurnInputImage = z.output<typeof TurnInputImageSchema>
export type AssistantMessage = z.output<typeof AssistantMessageSchema>
export type TurnStats = z.output<typeof TurnStatsSchema>

export type EventDraft = AgentEvent extends infer Event
  ? Event extends AgentEvent
    ? Omit<Event, 'seq' | 'ts'>
    : never
  : never

export type BoundEventDraft = EventDraft extends infer Event
  ? Event extends EventDraft
    ? Omit<Event, 'sessionId'>
    : never
  : never

export type EventType = AgentEvent['type']

export function isTerminalEvent(
  event: AgentEvent,
): event is Extract<AgentEvent, { type: 'turn.completed' | 'turn.cancelled' | 'turn.failed' }> {
  return (
    event.type === 'turn.completed' ||
    event.type === 'turn.cancelled' ||
    event.type === 'turn.failed'
  )
}
