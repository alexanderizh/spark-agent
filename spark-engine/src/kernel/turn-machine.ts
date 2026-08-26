import { SessionLedger } from '../events/ledger.js';
import {
  type AgentEvent,
  type BoundEventDraft,
  type TurnStats,
  type Usage,
} from '../events/schema.js';
import { consumeLlmStream } from '../llm/consume.js';
import type { LlmDelta, LlmRequest } from '../llm/types.js';
import type { PermissionMode } from '../permission/types.js';
import type { AgentEnv, BudgetLimits } from '../seams.js';
import { CancellationTree, isAbortError, throwIfAborted } from './cancellation.js';
import { toErrorInfo } from './errors.js';
import { ToolRunner } from './tool-runner.js';
import { TurnGate } from './turn-gate.js';

type TerminalEvent = Extract<
  AgentEvent,
  { type: 'turn.completed' | 'turn.cancelled' | 'turn.failed' }
>;

export interface RunTurnOptions {
  readonly sessionId: string;
  readonly turnId: string;
  readonly input: string;
  readonly cwd: string;
  readonly permissionMode: PermissionMode;
  readonly parentId?: string;
  readonly signal?: AbortSignal;
  readonly budget?: Partial<BudgetLimits>;
  readonly maxTokens?: number;
  readonly onEvent?: (event: AgentEvent) => Promise<void> | void;
  readonly onDelta?: (delta: LlmDelta) => Promise<void> | void;
}

export interface TurnResult {
  readonly turnId: string;
  readonly terminal: TerminalEvent;
}

export class TurnMachine {
  constructor(private readonly env: AgentEnv) {}

  async run(options: RunTurnOptions): Promise<TurnResult> {
    const ledger = new SessionLedger(options.sessionId, this.env.store, this.env.clock);
    const gate = new TurnGate(this.env.telemetry);
    const cancellation = new CancellationTree(options.signal);
    const budget = this.env.budgets.create(options.budget);
    const completedSteps: number[] = [];
    let budgetWarning: string | undefined;
    let cacheReadTokens = 0;
    let cacheWriteTokens = 0;

    const append = async (draft: BoundEventDraft): Promise<AgentEvent> => {
      const event = await ledger.append(draft);
      try {
        await options.onEvent?.(event);
      } catch {
        this.env.telemetry.counter('observer.event.failed', { type: event.type });
      }
      return event;
    };
    const stats = (): TurnStats => {
      const snapshot = budget.snapshot();
      return {
        steps: snapshot.steps,
        toolCalls: snapshot.toolCalls,
        usage: {
          inputTokens: snapshot.inputTokens,
          outputTokens: snapshot.outputTokens,
          cacheReadTokens,
          cacheWriteTokens,
        },
        wallMs: snapshot.wallMs,
        costUsd: snapshot.costUsd,
      };
    };

    try {
      await append({
        type: 'turn.started',
        schemaVersion: 1,
        turnId: options.turnId,
        input: { kind: 'text', text: options.input },
        ...(options.parentId === undefined ? {} : { parentId: options.parentId }),
      });

      while (true) {
        throwIfAborted(cancellation.signal);
        const stepId = this.env.ids.next('step');
        const history = await collectEvents(ledger);
        const projected = this.env.projector.project(history, {
          cwd: options.cwd,
          permissionMode: options.permissionMode,
          ...(budgetWarning === undefined ? {} : { warning: budgetWarning }),
        });
        const system = this.env.prompt.compose(
          {
            sessionId: options.sessionId,
            cwd: options.cwd,
            permissionMode: options.permissionMode,
            ...(budgetWarning === undefined ? {} : { warning: budgetWarning }),
          },
          {
            cwd: options.cwd,
            permissionMode: options.permissionMode,
            ...(budgetWarning === undefined ? {} : { warning: budgetWarning }),
          },
        );
        await append({
          type: 'step.started',
          schemaVersion: 1,
          stepId,
          turnId: options.turnId,
        });

        const request: LlmRequest = {
          system,
          messages: projected.messages,
          tools: this.env.tools.registry
            .list()
            .filter(
              (tool) => options.permissionMode !== 'plan' || tool.permissionClass === 'read',
            )
            .map((tool) => ({
              name: tool.name,
              description: tool.description,
              inputSchema: tool.inputSchema,
            })),
          maxTokens: options.maxTokens ?? 8_192,
          metadata: {
            sessionId: options.sessionId,
            turnId: options.turnId,
            stepId,
          },
        };
        const response = await consumeLlmStream(
          this.env.llm.stream(request, {
            signal: cancellation.signal,
            turnId: options.turnId,
            stepId,
          }),
          async (delta) => {
            try {
              await options.onDelta?.(delta);
            } catch {
              this.env.telemetry.counter('observer.delta.failed', { type: delta.type });
            }
          },
        );
        const assistantEvent = await append({
          type: 'assistant.completed',
          schemaVersion: 1,
          stepId,
          turnId: options.turnId,
          message: response.message,
          usage: response.usage,
        });
        completedSteps.push(assistantEvent.seq);
        cacheReadTokens += response.usage.cacheReadTokens;
        cacheWriteTokens += response.usage.cacheWriteTokens;

        if (response.message.toolCalls.length > 0) {
          const runner = new ToolRunner({
            env: this.env,
            ledger,
            stepId,
            sessionId: options.sessionId,
            cwd: options.cwd,
            permissionMode: options.permissionMode,
            signal: cancellation.signal,
            ...(options.onEvent === undefined ? {} : { onEvent: options.onEvent }),
          });
          await runner.run(response.message.toolCalls);
        }

        const action = budget.onStep({
          ...usageToBudget(response.usage),
          costUsd: 0,
          toolCalls: response.message.toolCalls.length,
        });
        if (response.message.toolCalls.length === 0) {
          const terminal = await gate.finalize(async () =>
            asTerminal(
              await append({
                type: 'turn.completed',
                schemaVersion: 1,
                turnId: options.turnId,
                reason: 'final',
                stats: stats(),
              }),
            ),
          );
          if (!terminal) throw new Error('Turn terminal event was unexpectedly swallowed');
          return { turnId: options.turnId, terminal };
        }
        if (action.kind === 'stop') {
          const terminal = await gate.finalize(async () =>
            asTerminal(
              await append({
                type: 'turn.completed',
                schemaVersion: 1,
                turnId: options.turnId,
                reason: 'budget',
                stats: stats(),
              }),
            ),
          );
          if (!terminal) throw new Error('Turn terminal event was unexpectedly swallowed');
          return { turnId: options.turnId, terminal };
        }
        budgetWarning = action.kind === 'warn' ? action.message : undefined;
      }
    } catch (error) {
      const terminal = await gate.finalize(async () => {
        if (isAbortError(error) || cancellation.signal.aborted) {
          return asTerminal(
            await append({
              type: 'turn.cancelled',
              schemaVersion: 1,
              turnId: options.turnId,
              partial: completedSteps,
            }),
          );
        }
        return asTerminal(
          await append({
            type: 'turn.failed',
            schemaVersion: 1,
            turnId: options.turnId,
            error: toErrorInfo(error),
            recoveryHint: 'Inspect the event log and retry after correcting the reported boundary failure.',
          }),
        );
      });
      if (!terminal) throw error;
      return { turnId: options.turnId, terminal };
    } finally {
      cancellation.dispose();
    }
  }
}

async function collectEvents(ledger: SessionLedger): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of ledger.read()) events.push(event);
  return events;
}

function usageToBudget(usage: Usage): Omit<
  Parameters<ReturnType<AgentEnv['budgets']['create']>['onStep']>[0],
  'costUsd' | 'toolCalls'
> {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cacheReadTokens: usage.cacheReadTokens,
    cacheWriteTokens: usage.cacheWriteTokens,
  };
}

function asTerminal(event: AgentEvent): TerminalEvent {
  if (
    event.type !== 'turn.completed' &&
    event.type !== 'turn.cancelled' &&
    event.type !== 'turn.failed'
  ) {
    throw new Error(`Expected terminal event, got ${event.type}`);
  }
  return event;
}
