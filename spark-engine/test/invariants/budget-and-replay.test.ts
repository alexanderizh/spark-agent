import { describe, expect, it } from 'vitest';

import { createDeterministicEnv } from '../../src/env.js';
import { text, toolCall } from '../../src/llm/fake/reply-dsl.js';
import { Agent } from '../../src/sdk/agent.js';
import { collectEvents } from '../helpers.js';

describe('invariants: budgets and replay', () => {
  it('injects a soft warning into the next model request', async () => {
    const env = createDeterministicEnv([
      toolCall('read-1', 'read', { path: 'a.ts' }, { usage: { inputTokens: 80 } }),
      text('Converged after the warning.'),
    ], { files: { 'a.ts': 'x' } });
    const session = await Agent.open({ cwd: '/workspace', env }).newSession();
    await session.turn('read then answer', { budget: { maxInputTokens: 100 } });
    expect(env.fixtures.model.requests[1]?.system).toContainEqual(
      expect.objectContaining({ id: 'budget-warning', content: expect.stringContaining('80%') }),
    );
  });

  it('stops at a hard step budget after closing tool effects', async () => {
    const env = createDeterministicEnv([toolCall('read-1', 'read', { path: 'a.ts' })], {
      files: { 'a.ts': 'x' },
    });
    const session = await Agent.open({ cwd: '/workspace', env }).newSession();
    const result = await session.turn('read', { budget: { maxSteps: 1 } });
    expect(result.terminal).toMatchObject({ type: 'turn.completed', reason: 'budget' });
  });

  it('forks an exact event prefix and continues with a contiguous sequence', async () => {
    const env = createDeterministicEnv([text('done')]);
    const agent = Agent.open({ cwd: '/workspace', env });
    const session = await agent.newSession();
    await session.turn('hello');
    const original = await collectEvents(session);
    const forkId = await session.fork(2);
    const forkEvents = [];
    for await (const event of env.store.read(forkId)) forkEvents.push(event);
    expect(forkEvents).toEqual(original.filter((event) => event.seq <= 2));
    expect(await env.store.latestSeq(forkId)).toBe(2);
  });
});
