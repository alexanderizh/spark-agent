import { describe, expect, it } from 'vitest';

import { createDeterministicEnv } from '../../src/env.js';
import { text, toolCalls } from '../../src/llm/fake/reply-dsl.js';
import { Agent } from '../../src/sdk/agent.js';
import type { ToolCallContext, ToolExecutor } from '../../src/seams.js';
import type { ResolvedToolCall, ToolConcurrency, ToolDefinition, ToolOutcome } from '../../src/tools/contract.js';
import { OrderedToolRegistry } from '../../src/tools/registry.js';
import { collectEvents } from '../helpers.js';

class TrackingExecutor implements ToolExecutor {
  active = 0;
  maximumActive = 0;

  async execute(call: ResolvedToolCall, _context: ToolCallContext): Promise<ToolOutcome> {
    void _context;
    this.active += 1;
    this.maximumActive = Math.max(this.maximumActive, this.active);
    const delay = call.name === 'first' ? 4 : 1;
    for (let index = 0; index < delay; index += 1) await Promise.resolve();
    this.active -= 1;
    return { ok: true, content: call.name };
  }
}

function definition(name: string, concurrency: ToolConcurrency): ToolDefinition {
  return {
    name,
    description: name,
    inputSchema: { type: 'object', additionalProperties: false },
    readonly: true,
    permissionClass: 'read',
    approval: 'never',
    concurrency,
    timeoutMs: 1_000,
    interruptible: true,
    costClass: 'io',
  };
}

describe('tool concurrency planner', () => {
  it('executes parallel calls concurrently but commits results in model order', async () => {
    const base = createDeterministicEnv([
      toolCalls([
        { callId: 'c1', name: 'first', args: {} },
        { callId: 'c2', name: 'second', args: {} },
      ]),
      text('done'),
    ]);
    const executor = new TrackingExecutor();
    const env = {
      ...base,
      tools: {
        registry: new OrderedToolRegistry([definition('first', 'parallel'), definition('second', 'parallel')]),
        executor,
      },
    };
    const session = await Agent.open({ cwd: '/workspace', env }).newSession();
    await session.turn('parallel');
    const events = await collectEvents(session);
    expect(executor.maximumActive).toBe(2);
    expect(events.filter((event) => event.type === 'tool.result').map((event) => event.callId)).toEqual(['c1', 'c2']);
  });

  it('serializes calls declared serial', async () => {
    const base = createDeterministicEnv([
      toolCalls([
        { callId: 'c1', name: 'first', args: {} },
        { callId: 'c2', name: 'second', args: {} },
      ]),
      text('done'),
    ]);
    const executor = new TrackingExecutor();
    const env = {
      ...base,
      tools: {
        registry: new OrderedToolRegistry([definition('first', 'serial'), definition('second', 'serial')]),
        executor,
      },
    };
    const session = await Agent.open({ cwd: '/workspace', env }).newSession();
    await session.turn('serial');
    expect(executor.maximumActive).toBe(1);
  });
});
