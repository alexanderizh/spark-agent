import { z } from 'zod';

export const CURRENT_SCHEMA_VERSION = 1 as const;
export const SchemaVersionSchema = z.literal(CURRENT_SCHEMA_VERSION);

export const ErrorInfoSchema = z.object({
  code: z.string().min(1),
  message: z.string(),
  retryable: z.boolean(),
  detail: z.unknown().optional(),
});

export const UsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheReadTokens: z.number().int().nonnegative().default(0),
  cacheWriteTokens: z.number().int().nonnegative().default(0),
});

export const ArtifactRefSchema = z.object({
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  bytes: z.number().int().nonnegative(),
  mediaType: z.string().min(1),
  summary: z.string(),
  readHint: z.string(),
});

export const ToolCallSchema = z.object({
  callId: z.string().min(1),
  name: z.string().min(1),
  args: z.unknown(),
});

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
});

export const TurnStatsSchema = z.object({
  steps: z.number().int().nonnegative(),
  toolCalls: z.number().int().nonnegative(),
  usage: UsageSchema,
  wallMs: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative().default(0),
});

const envelope = {
  schemaVersion: SchemaVersionSchema,
  sessionId: z.string().min(1),
  seq: z.number().int().nonnegative(),
  ts: z.number().int().nonnegative(),
};

const SessionStartedEventSchema = z.object({
  ...envelope,
  type: z.literal('session.started'),
  engineVersion: z.string().min(1),
  cwd: z.string(),
  configSnapshot: z.string(),
});

const TurnStartedEventSchema = z.object({
  ...envelope,
  type: z.literal('turn.started'),
  turnId: z.string().min(1),
  input: z.object({ kind: z.literal('text'), text: z.string() }),
  parentId: z.string().optional(),
});

const TurnQueuedEventSchema = z.object({
  ...envelope,
  type: z.literal('turn.queued'),
  turnId: z.string().min(1),
});

const TurnCompletedEventSchema = z.object({
  ...envelope,
  type: z.literal('turn.completed'),
  turnId: z.string().min(1),
  reason: z.enum(['final', 'budget']),
  stats: TurnStatsSchema,
});

const TurnCancelledEventSchema = z.object({
  ...envelope,
  type: z.literal('turn.cancelled'),
  turnId: z.string().min(1),
  partial: z.array(z.number().int().nonnegative()).default([]),
});

const TurnFailedEventSchema = z.object({
  ...envelope,
  type: z.literal('turn.failed'),
  turnId: z.string().min(1),
  error: ErrorInfoSchema,
  recoveryHint: z.string().optional(),
});

const StepStartedEventSchema = z.object({
  ...envelope,
  type: z.literal('step.started'),
  stepId: z.string().min(1),
  turnId: z.string().min(1),
});

const AssistantCompletedEventSchema = z.object({
  ...envelope,
  type: z.literal('assistant.completed'),
  stepId: z.string().min(1),
  turnId: z.string().min(1),
  message: AssistantMessageSchema,
  usage: UsageSchema,
});

const ToolCallEventSchema = z.object({
  ...envelope,
  type: z.literal('tool.call'),
  callId: z.string().min(1),
  stepId: z.string().min(1),
  tool: z.string().min(1),
  args: z.unknown(),
});

const ToolIntentEventSchema = z.object({
  ...envelope,
  type: z.literal('tool.intent'),
  callId: z.string().min(1),
});

const ToolResultEventSchema = z.object({
  ...envelope,
  type: z.literal('tool.result'),
  callId: z.string().min(1),
  durationMs: z.number().int().nonnegative(),
  ok: z.boolean(),
  content: z.string(),
  artifact: ArtifactRefSchema.optional(),
});

const PermissionRequestedEventSchema = z.object({
  ...envelope,
  type: z.literal('permission.requested'),
  requestId: z.string().min(1),
  callId: z.string().min(1),
  risk: z.object({ tool: z.string(), argsPreview: z.string() }),
});

const PermissionEvaluatedEventSchema = z.object({
  ...envelope,
  type: z.literal('permission.evaluated'),
  callId: z.string().min(1),
  mode: z.enum(['default', 'acceptEdits', 'plan', 'bypass']),
  decision: z.enum(['allow', 'deny', 'ask']),
  reason: z.string().optional(),
  rule: z
    .object({
      id: z.string().min(1),
      source: z.enum(['builtin', 'user', 'project', 'cli', 'host']),
    })
    .optional(),
  allowedGrantScopes: z.array(z.enum(['once', 'session'])).optional(),
});

const PermissionDecidedEventSchema = z.object({
  ...envelope,
  type: z.literal('permission.decided'),
  requestId: z.string().min(1),
  decision: z.enum(['allow', 'deny']),
  grantScope: z.enum(['once', 'session']).optional(),
  reason: z.string().optional(),
});

const ContextCompactedEventSchema = z.object({
  ...envelope,
  type: z.literal('context.compacted'),
  summaryRef: ArtifactRefSchema.optional(),
  droppedRanges: z.array(z.tuple([z.number().int(), z.number().int()])),
});

const LogRewindEventSchema = z.object({
  ...envelope,
  type: z.literal('log.rewind'),
  toSeq: z.number().int().nonnegative(),
});

const PluginActivatedEventSchema = z.object({
  ...envelope,
  type: z.literal('plugin.activated'),
  pluginId: z.string().min(1),
  effects: z.array(z.string()),
});

const PluginDeactivatedEventSchema = z.object({
  ...envelope,
  type: z.literal('plugin.deactivated'),
  pluginId: z.string().min(1),
});

const UserAnsweredEventSchema = z.object({
  ...envelope,
  type: z.literal('user.answered'),
  requestId: z.string().min(1),
  answer: z.unknown(),
});

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
  LogRewindEventSchema,
  PluginActivatedEventSchema,
  PluginDeactivatedEventSchema,
  UserAnsweredEventSchema,
]);

export type AgentEvent = z.output<typeof AgentEventSchema>;
export type ErrorInfo = z.output<typeof ErrorInfoSchema>;
export type Usage = z.output<typeof UsageSchema>;
export type ArtifactRef = z.output<typeof ArtifactRefSchema>;
export type AssistantMessage = z.output<typeof AssistantMessageSchema>;
export type TurnStats = z.output<typeof TurnStatsSchema>;

export type EventDraft = AgentEvent extends infer Event
  ? Event extends AgentEvent
    ? Omit<Event, 'seq' | 'ts'>
    : never
  : never;

export type BoundEventDraft = EventDraft extends infer Event
  ? Event extends EventDraft
    ? Omit<Event, 'sessionId'>
    : never
  : never;

export type EventType = AgentEvent['type'];

export function isTerminalEvent(
  event: AgentEvent,
): event is Extract<AgentEvent, { type: 'turn.completed' | 'turn.cancelled' | 'turn.failed' }> {
  return (
    event.type === 'turn.completed' ||
    event.type === 'turn.cancelled' ||
    event.type === 'turn.failed'
  );
}
