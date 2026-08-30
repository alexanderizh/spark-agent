import { describe, expect, it } from 'vitest';

import { createDeterministicEnv } from '../../src/env.js';
import { text, toolCall } from '../../src/llm/fake/reply-dsl.js';
import { Agent } from '../../src/sdk/agent.js';
import type { PermissionPolicy } from '../../src/seams.js';
import { collectEvents } from '../helpers.js';

describe('invariant: permission and tool boundaries fail closed', () => {
  it('feeds an unknown tool error back and allows the model to recover', async () => {
    const env = createDeterministicEnv([
      toolCall('bad-1', 'not_registered', { value: true }),
      text('Recovered from the unavailable tool.'),
    ]);
    const session = await Agent.open({ cwd: '/workspace', env }).newSession();
    const result = await session.turn('Use a missing tool');
    const events = await collectEvents(session);
    const toolResult = events.find((event) => event.type === 'tool.result');
    expect(result.terminal.type).toBe('turn.completed');
    expect(toolResult).toMatchObject({ ok: false, content: 'Unknown tool: not_registered' });
    expect(env.fixtures.model.requests[1]?.messages.at(-1)).toMatchObject({
      role: 'tool_result',
      ok: false,
    });
  });

  it('does not execute schema-invalid arguments', async () => {
    const env = createDeterministicEnv([
      toolCall('read-1', 'read', { path: 42 }),
      text('The read arguments were invalid.'),
    ]);
    const session = await Agent.open({ cwd: '/workspace', env }).newSession();
    await session.turn('Read using invalid args');
    const events = await collectEvents(session);
    expect(events.find((event) => event.type === 'tool.result')).toMatchObject({
      ok: false,
      content: expect.stringContaining('Invalid tool arguments'),
    });
  });

  it('denies when policy evaluation throws', async () => {
    const base = createDeterministicEnv([toolCall('read-1', 'read', { path: 'a.ts' }), text('Denied.')], {
      files: { 'a.ts': 'secret' },
    });
    const throwingPolicy: PermissionPolicy = {
      async check() {
        throw new Error('policy crashed');
      },
    };
    const env = { ...base, permission: { ...base.permission, policy: throwingPolicy } };
    const session = await Agent.open({ cwd: '/workspace', env }).newSession();
    await session.turn('Read a.ts');
    const events = await collectEvents(session);
    expect(events.find((event) => event.type === 'tool.result')).toMatchObject({
      ok: false,
      content: expect.stringContaining('Permission policy failed closed'),
    });
  });

  it('denies when no approval decision is available', async () => {
    const env = createDeterministicEnv([toolCall('write-1', 'write', { path: 'a.ts', content: 'x' }), text('Denied.')]);
    const session = await Agent.open({ cwd: '/workspace', env }).newSession();
    await session.turn('Write a.ts');
    expect(env.fixtures.fs.exists('a.ts')).toBe(false);
    const events = await collectEvents(session);
    expect(events.find((event) => event.type === 'permission.decided')).toMatchObject({ decision: 'deny' });
  });

  it('rejects a session grant returned for an always-approval tool', async () => {
    const env = createDeterministicEnv(
      [toolCall('bash-1', 'bash', { command: 'dangerous' }), text('Denied.')],
      {
        shell: { dangerous: { stdout: 'must not run', exitCode: 0 } },
        approvals: [{ decision: 'allow', grantScope: 'session' }],
      },
    );
    const session = await Agent.open({ cwd: '/workspace', env }).newSession();

    await session.turn('Run the command');

    expect(env.fixtures.shell.calls).toEqual([]);
    const events = await collectEvents(session);
    expect(events.find((event) => event.type === 'permission.decided')).toMatchObject({
      decision: 'deny',
      reason: expect.stringContaining('disallowed grant scope'),
    });
  });

  it('hides side-effect tools in plan mode and denies hallucinated calls', async () => {
    const env = createDeterministicEnv([
      toolCall('write-1', 'write', { path: 'a.ts', content: 'must not write' }),
      text('I can only provide a plan.'),
    ]);
    const session = await Agent.open({ cwd: '/workspace', env }).newSession({
      permissionMode: 'plan',
    });

    await session.turn('Plan the change');

    expect(env.fixtures.model.requests[0]?.tools.map((tool) => tool.name)).toEqual(['read']);
    expect(env.fixtures.fs.exists('a.ts')).toBe(false);
    const events = await collectEvents(session);
    expect(events.find((event) => event.type === 'tool.result')).toMatchObject({
      ok: false,
      content: expect.stringContaining('Plan mode blocks'),
    });
  });
});
