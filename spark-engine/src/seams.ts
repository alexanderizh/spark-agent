import type { AgentEvent, ArtifactRef } from './events/schema.js';
import type { LlmDelta, LlmRequest, SystemSection } from './llm/types.js';
import type {
  PermissionDecision,
  PermissionCheckContext,
  PermissionMode,
  PermissionRequest,
  PolicyDecision,
} from './permission/types.js';
import type {
  ResolvedToolCall,
  ToolDefinition,
  ToolOutcome,
} from './tools/contract.js';

export interface Clock {
  now(): number;
  monotonicMs(): number;
}

export interface IdGen {
  next(prefix?: string): string;
}

export interface SessionMeta {
  readonly sessionId: string;
  readonly projectDir: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly latestSeq: number;
}

export interface SessionStore {
  append(sessionId: string, event: AgentEvent): Promise<void>;
  read(sessionId: string, fromSeq?: number): AsyncIterable<AgentEvent>;
  latestSeq(sessionId: string): Promise<number>;
  fork(sessionId: string, uptoSeq: number): Promise<string>;
  list(projectDir: string | null): Promise<SessionMeta[]>;
}

export interface ArtifactStore {
  put(content: string | Uint8Array, mediaType: string): Promise<ArtifactRef>;
  get(ref: ArtifactRef): Promise<string | Uint8Array>;
}

export interface LlmCallContext {
  readonly signal: AbortSignal;
  readonly turnId: string;
  readonly stepId: string;
}

export interface LlmService {
  stream(request: LlmRequest, context: LlmCallContext): AsyncIterable<LlmDelta>;
}

export interface ToolRegistry {
  get(name: string): ToolDefinition | undefined;
  list(): readonly ToolDefinition[];
}

export interface ToolCallContext {
  readonly signal: AbortSignal;
  readonly timeoutMs: number;
}

export interface ToolExecutor {
  execute(call: ResolvedToolCall, context: ToolCallContext): Promise<ToolOutcome>;
}

export interface PermissionPolicy {
  check(call: ResolvedToolCall, context: PermissionCheckContext): Promise<PolicyDecision>;
  recordDecision?(
    call: ResolvedToolCall,
    decision: PermissionDecision,
    context: PermissionCheckContext,
  ): Promise<void> | void;
}

export interface Approver {
  ask(request: PermissionRequest, signal: AbortSignal): Promise<PermissionDecision>;
}

export interface ProjectorConfig {
  readonly cwd: string;
  readonly warning?: string;
  readonly permissionMode?: PermissionMode;
}

export interface ProjectedContext {
  readonly messages: LlmRequest['messages'];
  readonly sourceSeqs: readonly number[];
}

export interface ContextProjector {
  project(events: readonly AgentEvent[], config: ProjectorConfig): ProjectedContext;
}

export interface SessionFacts {
  readonly sessionId: string;
  readonly cwd: string;
  readonly warning?: string;
  readonly permissionMode?: PermissionMode;
}

export interface PromptComposer {
  compose(facts: SessionFacts, config: ProjectorConfig): readonly SystemSection[];
}

export interface BudgetLimits {
  readonly maxInputTokens: number;
  readonly maxCostUsd: number;
  readonly maxWallMs: number;
  readonly maxSteps: number;
  readonly maxToolCalls: number;
}

export interface BudgetSnapshot {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costUsd: number;
  readonly wallMs: number;
  readonly steps: number;
  readonly toolCalls: number;
}

export type BudgetAction =
  | { readonly kind: 'continue' }
  | { readonly kind: 'warn'; readonly message: string }
  | { readonly kind: 'stop'; readonly reason: string };

export interface StepLedgerEntry {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheWriteTokens: number;
  readonly costUsd: number;
  readonly toolCalls: number;
}

export interface BudgetKeeper {
  onStep(step: StepLedgerEntry): BudgetAction;
  snapshot(): BudgetSnapshot;
}

export interface BudgetFactory {
  create(overrides?: Partial<BudgetLimits>): BudgetKeeper;
}

export interface Telemetry {
  counter(name: string, attributes?: Readonly<Record<string, string | number>>): void;
  hist(
    name: string,
    value: number,
    attributes?: Readonly<Record<string, string | number>>,
  ): void;
}

export interface AgentEnv {
  readonly clock: Clock;
  readonly ids: IdGen;
  readonly store: SessionStore;
  readonly artifacts: ArtifactStore;
  readonly llm: LlmService;
  readonly tools: {
    readonly registry: ToolRegistry;
    readonly executor: ToolExecutor;
  };
  readonly permission: {
    readonly policy: PermissionPolicy;
    readonly approver: Approver;
  };
  readonly projector: ContextProjector;
  readonly prompt: PromptComposer;
  readonly budgets: BudgetFactory;
  readonly telemetry: Telemetry;
}
