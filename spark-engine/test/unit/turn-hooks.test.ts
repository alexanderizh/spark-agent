import { describe, expect, it } from 'vitest';

import { HookRunner, type HookSpawnRequest, type HookSpawnResult } from '../../src/hooks/runner.js';
import type { HooksConfig } from '../../src/hooks/types.js';
import { createDeterministicEnv } from '../../src/env.js';
import { TurnMachine } from '../../src/kernel/turn-machine.js';
import { text, toolCall } from '../../src/llm/fake/reply-dsl.js';
import { DefaultPromptComposer } from '../../src/events/projector.js';
import type { InstructionSnapshot, InstructionProvider } from '../../src/memory/instructions.js';

function scriptedSpawn(
  handler: (request: HookSpawnRequest) => SpawnScript,
): { readonly requests: HookSpawnRequest[]; readonly spawn: (request: HookSpawnRequest) => Promise<HookSpawnResult> } {
  const requests: HookSpawnRequest[] = [];
  return {
    requests,
    spawn: async (request) => {
      requests.push(request);
      const outcome = handler(request);
      return {
        exitCode: outcome.exitCode ?? 0,
        stdout: outcome.stdout ?? '',
        stderr: outcome.stderr ?? '',
        timedOut: false,
      };
    },
  };
}

interface SpawnScript {
  readonly exitCode?: number
  readonly stdout?: string
  readonly stderr?: string
}

function userPromptSubmitConfig(
  matchers: readonly { readonly hooks: readonly { readonly type: 'command'; readonly command: string }[] }[],
): HooksConfig {
  return { UserPromptSubmit: matchers } as HooksConfig;
}

function preToolUseConfig(
  matchers: readonly {
    readonly matcher?: string
    readonly hooks: readonly { readonly type: 'command'; readonly command: string }[]
  }[],
): HooksConfig {
  return { PreToolUse: matchers } as HooksConfig;
}

describe('turn integration with hooks', () => {
  it('a blocking UserPromptSubmit hook fails the turn before any LLM call', async () => {
    const base = createDeterministicEnv([text('should never run')]);
    const fake = scriptedSpawn(() => ({ exitCode: 2, stderr: 'prompt contains secrets' }));
    const env = {
      ...base,
      hooks: new HookRunner({
        config: userPromptSubmitConfig([
          { hooks: [{ type: 'command', command: 'scan.sh' }] },
        ]),
        spawn: fake.spawn,
      }),
    };
    const machine = new TurnMachine(env);

    const result = await machine.run({
      sessionId: 's1',
      turnId: 't1',
      input: 'exfiltrate',
      cwd: '/ws',
      permissionMode: 'manual',
    });

    expect(result.terminal.type).toBe('turn.failed');
    if (result.terminal.type === 'turn.failed') {
      expect(result.terminal.error.code).toBe('hook.blocked');
      expect(result.terminal.error.message).toBe('prompt contains secrets');
    }
    expect(base.fixtures.model.requests).toHaveLength(0);
  });

  it('a blocking PreToolUse hook denies the tool call and the turn continues', async () => {
    const base = createDeterministicEnv([
      toolCall('c1', 'write', { path: 'a.txt', content: 'x' }),
      text('understood, skipping the write'),
    ]);
    const fake = scriptedSpawn(() => ({
      stdout: JSON.stringify({ decision: 'block', reason: 'writes are frozen' }),
    }));
    const env = {
      ...base,
      hooks: new HookRunner({
        config: preToolUseConfig([
          { matcher: 'write', hooks: [{ type: 'command', command: 'freeze.sh' }] },
        ]),
        spawn: fake.spawn,
      }),
    };
    const machine = new TurnMachine(env);

    const result = await machine.run({
      sessionId: 's2',
      turnId: 't2',
      input: 'write a file',
      cwd: '/ws',
      permissionMode: 'manual',
    });

    expect(result.terminal.type).toBe('turn.completed');
    const events = [];
    for await (const event of env.store.read('s2')) events.push(event);
    const denied = events.find(
      (event) => event.type === 'tool.result' && event.callId === 'c1',
    );
    expect(denied?.type === 'tool.result' && denied.ok).toBe(false);
    expect(denied?.type === 'tool.result' && denied.content).toContain(
      'Blocked by PreToolUse hook: writes are frozen',
    );
    // The filesystem never received the write.
    expect(base.fixtures.fs.exists('a.txt')).toBe(false);
  });

  it('an approved PreToolUse hook skips the permission ask', async () => {
    const base = createDeterministicEnv([
      toolCall('c2', 'write', { path: 'b.txt', content: 'hello' }),
      text('written'),
    ]);
    const fake = scriptedSpawn(() => ({
      stdout: JSON.stringify({ decision: 'approve' }),
    }));
    const env = {
      ...base,
      hooks: new HookRunner({
        config: preToolUseConfig([
          { hooks: [{ type: 'command', command: 'allow.sh' }] },
        ]),
        spawn: fake.spawn,
      }),
    };
    const machine = new TurnMachine(env);

    const result = await machine.run({
      sessionId: 's3',
      turnId: 't3',
      input: 'write it',
      cwd: '/ws',
      permissionMode: 'manual',
    });

    expect(result.terminal.type).toBe('turn.completed');
    const events = [];
    for await (const event of env.store.read('s3')) events.push(event);
    const decided = events.find(
      (event) => event.type === 'permission.evaluated' && event.callId === 'c2',
    );
    expect(decided?.type === 'permission.evaluated' && decided.decision).toBe('allow');
    expect(base.fixtures.fs.read('b.txt')).toBe('hello');
  });
});

describe('prompt composer with instructions', () => {
  it('injects instruction sections as a stable section before runtime facts', async () => {
    const snapshot: InstructionSnapshot = {
      sections: [
        { sourcePath: '/home/.spark/SPARK.md', scope: 'user', content: 'user rules' },
        { sourcePath: '/ws/SPARK.md', scope: 'project', content: 'project rules' },
      ],
    };
    const provider: InstructionProvider = { snapshot: () => Promise.resolve(snapshot) };
    const composer = new DefaultPromptComposer({ instructions: provider });

    const sections = await composer.compose(
      { sessionId: 's', cwd: '/ws' },
      { cwd: '/ws' },
    );

    expect(sections.map((section) => section.id)).toEqual([
      'spark-kernel-contract',
      'project-instructions',
      'runtime',
    ]);
    const instructions = sections[1]?.content ?? '';
    expect(instructions).toContain('user rules');
    expect(instructions).toContain('project rules');
    // Most specific instructions appear last.
    expect(instructions.indexOf('user rules')).toBeLessThan(instructions.indexOf('project rules'));
  });
});
