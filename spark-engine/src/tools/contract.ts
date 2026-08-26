export type JsonSchema = Readonly<Record<string, unknown>> | boolean;

export type ToolApproval = 'never' | 'once' | 'session' | 'always';
export type ToolConcurrency = 'parallel' | 'serial' | 'exclusive';
export type ToolCostClass = 'io' | 'cpu' | 'network';
export type ToolPermissionClass = 'read' | 'workspace-write' | 'command' | 'external';

export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: JsonSchema;
  readonly readonly: boolean;
  readonly destructive?: boolean;
  readonly permissionClass: ToolPermissionClass;
  readonly approval: ToolApproval;
  readonly concurrency: ToolConcurrency;
  readonly timeoutMs: number;
  readonly interruptible: boolean;
  readonly costClass: ToolCostClass;
}

export interface ResolvedToolCall {
  readonly callId: string;
  readonly name: string;
  readonly args: unknown;
  readonly definition: ToolDefinition;
}

export interface ToolOutcome {
  readonly ok: boolean;
  readonly content: string;
}

export interface ToolImplementationContext {
  readonly signal: AbortSignal;
}

export type ToolImplementation = (
  args: unknown,
  context: ToolImplementationContext,
) => Promise<ToolOutcome>;
