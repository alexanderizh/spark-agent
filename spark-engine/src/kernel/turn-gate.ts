import type { AgentEvent } from '../events/schema.js';
import type { Telemetry } from '../seams.js';

type TerminalEvent = Extract<
  AgentEvent,
  { type: 'turn.completed' | 'turn.cancelled' | 'turn.failed' }
>;

export class TurnGate {
  #state: 'open' | 'closed' = 'open';

  constructor(private readonly telemetry: Telemetry) {}

  isClosed(): boolean {
    return this.#state === 'closed';
  }

  async finalize(make: () => Promise<TerminalEvent>): Promise<TerminalEvent | null> {
    if (this.#state !== 'open') {
      this.telemetry.counter('kernel.turn.duplicate_terminal_swallowed');
      return null;
    }
    this.#state = 'closed';
    try {
      return await make();
    } catch (error) {
      this.#state = 'open';
      throw error;
    }
  }
}
