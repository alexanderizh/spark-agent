import type { AgentEvent } from './schema.js';

export interface OrphanIntent {
  readonly callId: string;
  readonly intentSeq: number;
  readonly tool?: string;
  readonly args?: unknown;
}

export function scanOrphanIntents(events: readonly AgentEvent[]): OrphanIntent[] {
  const calls = new Map<string, Extract<AgentEvent, { type: 'tool.call' }>>();
  const intents = new Map<string, Extract<AgentEvent, { type: 'tool.intent' }>>();
  const results = new Set<string>();
  for (const event of events) {
    if (event.type === 'tool.call') calls.set(event.callId, event);
    else if (event.type === 'tool.intent') intents.set(event.callId, event);
    else if (event.type === 'tool.result') results.add(event.callId);
  }
  return [...intents.values()]
    .filter((intent) => !results.has(intent.callId))
    .map((intent) => {
      const call = calls.get(intent.callId);
      return {
        callId: intent.callId,
        intentSeq: intent.seq,
        ...(call === undefined ? {} : { tool: call.tool, args: call.args }),
      };
    })
    .sort((left, right) => left.intentSeq - right.intentSeq);
}

export function findInterruptedTurn(events: readonly AgentEvent[]): string | undefined {
  const active = new Set<string>();
  for (const event of events) {
    if (event.type === 'turn.started') active.add(event.turnId);
    else if (
      event.type === 'turn.completed' ||
      event.type === 'turn.cancelled' ||
      event.type === 'turn.failed'
    ) {
      active.delete(event.turnId);
    }
  }
  return [...active].at(-1);
}
