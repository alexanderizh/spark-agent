import { describe, expect, it } from 'vitest';

import { createDeterministicEnv } from '../../src/env.js';
import { scanOrphanIntents } from '../../src/events/recovery.js';
import { text, toolCall } from '../../src/llm/fake/reply-dsl.js';
import { Agent } from '../../src/sdk/agent.js';
import { collectEvents } from '../helpers.js';

describe('invariant: all work is cancellable and recoverable', () => {
  it('cancels during model streaming with exactly one terminal event', async () => {
    const env = createDeterministicEnv([text('a long streaming answer', { chunkSize: 1 })]);
    const session = await Agent.open({ cwd: '/workspace', env }).newSession();
    const controller = new AbortController();
    const result = await session.turn('stream', {
      signal: controller.signal,
      onDelta: (delta) => {
        if (delta.type === 'text') controller.abort('test');
      },
    });
    const events = await collectEvents(session);
    expect(result.terminal.type).toBe('turn.cancelled');
    expect(events.filter((event) => event.type.startsWith('turn.') && ['turn.completed', 'turn.cancelled', 'turn.failed'].includes(event.type))).toHaveLength(1);
  });

  it('closes a tool intent with an aborted result before cancelling the turn', async () => {
    const env = createDeterministicEnv(
      [toolCall('bash-1', 'bash', { command: 'slow' })],
      {
        shell: { slow: { stdout: 'late', exitCode: 0, delaySteps: 20 } },
        approvals: [{ decision: 'allow', grantScope: 'once' }],
      },
    );
    const session = await Agent.open({ cwd: '/workspace', env }).newSession();
    const controller = new AbortController();
    const result = await session.turn('run slow command', {
      signal: controller.signal,
      onEvent: (event) => {
        if (event.type === 'tool.intent') controller.abort('test cancellation');
      },
    });
    const events = await collectEvents(session);
    expect(result.terminal.type).toBe('turn.cancelled');
    expect(events.find((event) => event.type === 'tool.result')).toMatchObject({
      callId: 'bash-1',
      ok: false,
      content: 'aborted',
    });
    expect(scanOrphanIntents(events)).toEqual([]);
  });

  it('detects an orphan intent in a deliberately truncated log', async () => {
    const env = createDeterministicEnv([toolCall('read-1', 'read', { path: 'a.ts' }), text('done')], {
      files: { 'a.ts': 'x' },
    });
    const session = await Agent.open({ cwd: '/workspace', env }).newSession();
    await session.turn('read');
    const events = await collectEvents(session);
    const truncated = events.filter((event) => event.type !== 'tool.result');
    expect(scanOrphanIntents(truncated)).toEqual([
      { callId: 'read-1', intentSeq: 6, tool: 'read', args: { path: 'a.ts' } },
    ]);
  });
});
