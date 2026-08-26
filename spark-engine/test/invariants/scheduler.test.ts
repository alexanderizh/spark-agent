import { describe, expect, it } from 'vitest';

import { createDeterministicEnv } from '../../src/env.js';
import { text } from '../../src/llm/fake/reply-dsl.js';
import { Agent } from '../../src/sdk/agent.js';
import { collectEvents } from '../helpers.js';

describe('session scheduler invariants', () => {
  it('serializes cross-ledger appends without duplicate sequence numbers', async () => {
    const env = createDeterministicEnv([text('first', { chunkSize: 1 }), text('second')]);
    const session = await Agent.open({ cwd: '/workspace', env }).newSession();
    const [first, second] = await Promise.all([session.turn('one'), session.turn('two')]);
    const events = await collectEvents(session);
    expect(first.terminal.type).toBe('turn.completed');
    expect(second.terminal.type).toBe('turn.completed');
    expect(events.map((event) => event.seq)).toEqual(events.map((_, index) => index));
    expect(events.filter((event) => event.type === 'turn.queued')).toHaveLength(1);
  });

  it('gives a queued turn exactly one cancelled terminal event when aborted before it runs', async () => {
    const env = createDeterministicEnv([text('first', { chunkSize: 1 })]);
    const session = await Agent.open({ cwd: '/workspace', env }).newSession();
    const queuedController = new AbortController();
    const first = session.turn('one');
    const second = session.turn('two', { signal: queuedController.signal });
    queuedController.abort('cancel queued work');
    await first;
    const secondResult = await second;
    const events = await collectEvents(session);
    const secondTurn = secondResult.turnId;
    const terminals = events.filter(
      (event) =>
        (event.type === 'turn.completed' ||
          event.type === 'turn.cancelled' ||
          event.type === 'turn.failed') &&
        event.turnId === secondTurn,
    );
    expect(secondResult.terminal.type).toBe('turn.cancelled');
    expect(terminals).toHaveLength(1);
  });
});
