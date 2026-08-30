import type { AgentEvent } from '../src/events/schema.js';
import type { AgentSession } from '../src/sdk/agent.js';

export async function collectEvents(session: AgentSession): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of session.events()) events.push(event);
  return events;
}

export function eventTypes(events: readonly AgentEvent[]): string[] {
  return events.map((event) => event.type);
}
