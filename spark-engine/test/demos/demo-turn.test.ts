import { describe, expect, it } from 'vitest';

import { createDeterministicEnv } from '../../src/env.js';
import { text, toolCall } from '../../src/llm/fake/reply-dsl.js';
import { Agent } from '../../src/sdk/agent.js';
import { collectEvents, eventTypes } from '../helpers.js';

describe('deterministic read-edit-answer demo', () => {
  it('runs the complete tool loop with WAL ordering', async () => {
    const env = createDeterministicEnv(
      [
        toolCall('read-1', 'read', { path: 'a.ts' }, { text: 'I will inspect the file.' }),
        toolCall('edit-1', 'edit', { path: 'a.ts', old: 'x = 1', new: 'x = 2' }),
        text('Updated a.ts and verified the deterministic edit.'),
      ],
      {
        files: { 'a.ts': 'export const x = 1;\n' },
        approvals: [{ decision: 'allow', grantScope: 'once' }],
      },
    );
    const session = await Agent.open({ cwd: '/workspace', env }).newSession({ mode: 'test' });

    const result = await session.turn('Change x from 1 to 2.');
    const events = await collectEvents(session);

    expect(result.terminal.type).toBe('turn.completed');
    expect(env.fixtures.fs.read('a.ts')).toBe('export const x = 2;\n');
    expect(eventTypes(events)).toEqual([
      'session.started',
      'turn.started',
      'step.started',
      'assistant.completed',
      'tool.call',
      'permission.evaluated',
      'tool.intent',
      'tool.result',
      'step.started',
      'assistant.completed',
      'tool.call',
      'permission.evaluated',
      'permission.requested',
      'permission.decided',
      'tool.intent',
      'tool.result',
      'step.started',
      'assistant.completed',
      'turn.completed',
    ]);
    expect(events.map((event) => event.seq)).toEqual(events.map((_, index) => index));
  });
});
