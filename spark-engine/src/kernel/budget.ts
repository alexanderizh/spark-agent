import type {
  BudgetAction,
  BudgetFactory,
  BudgetKeeper,
  BudgetLimits,
  BudgetSnapshot,
  Clock,
  StepLedgerEntry,
} from '../seams.js';

export const DEFAULT_BUDGET_LIMITS: BudgetLimits = {
  maxInputTokens: 1_000_000,
  maxCostUsd: 100,
  maxWallMs: 60 * 60 * 1000,
  maxSteps: 100,
  maxToolCalls: 1_000,
};

export class DefaultBudgetFactory implements BudgetFactory {
  constructor(
    private readonly clock: Clock,
    private readonly defaults: BudgetLimits = DEFAULT_BUDGET_LIMITS,
  ) {}

  create(overrides?: Partial<BudgetLimits>): BudgetKeeper {
    return new DefaultBudgetKeeper(this.clock, { ...this.defaults, ...overrides });
  }
}

export class DefaultBudgetKeeper implements BudgetKeeper {
  readonly #startedAt: number;
  readonly #warned = new Set<keyof BudgetLimits>();
  #inputTokens = 0;
  #outputTokens = 0;
  #costUsd = 0;
  #steps = 0;
  #toolCalls = 0;

  constructor(
    private readonly clock: Clock,
    private readonly limits: BudgetLimits,
  ) {
    this.#startedAt = clock.monotonicMs();
  }

  onStep(step: StepLedgerEntry): BudgetAction {
    this.#inputTokens += step.inputTokens;
    this.#outputTokens += step.outputTokens;
    this.#costUsd += step.costUsd;
    this.#steps += 1;
    this.#toolCalls += step.toolCalls;

    const snapshot = this.snapshot();
    const dimensions: readonly {
      readonly key: keyof BudgetLimits;
      readonly value: number;
      readonly limit: number;
      readonly label: string;
    }[] = [
      { key: 'maxInputTokens', value: snapshot.inputTokens, limit: this.limits.maxInputTokens, label: 'input tokens' },
      { key: 'maxCostUsd', value: snapshot.costUsd, limit: this.limits.maxCostUsd, label: 'cost' },
      { key: 'maxWallMs', value: snapshot.wallMs, limit: this.limits.maxWallMs, label: 'wall time' },
      { key: 'maxSteps', value: snapshot.steps, limit: this.limits.maxSteps, label: 'steps' },
      { key: 'maxToolCalls', value: snapshot.toolCalls, limit: this.limits.maxToolCalls, label: 'tool calls' },
    ];

    for (const dimension of dimensions) {
      if (dimension.value >= dimension.limit) {
        return { kind: 'stop', reason: `${dimension.label} budget exhausted` };
      }
    }
    for (const dimension of dimensions) {
      if (dimension.value >= dimension.limit * 0.8 && !this.#warned.has(dimension.key)) {
        this.#warned.add(dimension.key);
        return {
          kind: 'warn',
          message: `Budget warning: ${dimension.label} is at least 80% consumed. Converge on a final answer.`,
        };
      }
    }
    return { kind: 'continue' };
  }

  snapshot(): BudgetSnapshot {
    return {
      inputTokens: this.#inputTokens,
      outputTokens: this.#outputTokens,
      costUsd: this.#costUsd,
      wallMs: Math.max(0, this.clock.monotonicMs() - this.#startedAt),
      steps: this.#steps,
      toolCalls: this.#toolCalls,
    };
  }
}
