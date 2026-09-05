import { describe, expect, it } from 'vitest';

import { HookRunner, type HookSpawnRequest, type HookSpawnResult } from '../../src/hooks/runner.js';
import type {
  HookEventName,
  HookInvocation,
  HookRunContext,
  HooksConfig,
} from '../../src/hooks/types.js';

const CONTEXT: HookRunContext = {
  sessionId: 'session-1',
  cwd: '/ws',
  permissionMode: 'manual',
};

interface SpawnScript {
  readonly exitCode?: number | null
  readonly stdout?: string
  readonly stderr?: string
  readonly timedOut?: boolean
  readonly spawnError?: string
}

function fakeSpawn(
  script: (request: HookSpawnRequest) => SpawnScript | Promise<SpawnScript>,
): { readonly requests: HookSpawnRequest[]; readonly spawn: (request: HookSpawnRequest) => Promise<HookSpawnResult> } {
  const requests: HookSpawnRequest[] = [];
  return {
    requests,
    spawn: async (request) => {
      requests.push(request);
      const outcome = await script(request);
      return {
        exitCode: outcome.exitCode ?? 0,
        stdout: outcome.stdout ?? '',
        stderr: outcome.stderr ?? '',
        timedOut: outcome.timedOut ?? false,
        ...(outcome.spawnError === undefined ? {} : { spawnError: outcome.spawnError }),
      };
    },
  };
}

function configFor(
  event: HookEventName,
  matchers: HooksConfig[HookEventName],
): HooksConfig {
  return { [event]: matchers };
}

function invocation(partial: HookInvocation = {}): HookInvocation {
  return partial;
}

describe('HookRunner', () => {
  it('pipes a JSON payload with session context on stdin', async () => {
    const fake = fakeSpawn(() => ({}));
    const runner = new HookRunner({
      config: configFor('UserPromptSubmit', [
        { hooks: [{ type: 'command', command: 'check.sh' }] },
      ]),
      spawn: fake.spawn,
    });

    await runner.run(
      'UserPromptSubmit',
      invocation({ turnId: 'turn-1', prompt: 'hello' }),
      CONTEXT,
      new AbortController().signal,
    );

    expect(fake.requests).toHaveLength(1);
    const payload = JSON.parse(fake.requests[0]?.input ?? '{}') as Record<string, unknown>;
    expect(payload.session_id).toBe('session-1');
    expect(payload.cwd).toBe('/ws');
    expect(payload.permission_mode).toBe('manual');
    expect(payload.hook_event_name).toBe('UserPromptSubmit');
    expect(payload.turn_id).toBe('turn-1');
    expect(payload.prompt).toBe('hello');
  });

  it('blocks on exit code 2 using stderr as the reason', async () => {
    const fake = fakeSpawn(() => ({ exitCode: 2, stderr: 'no git push\n' }));
    const runner = new HookRunner({
      config: configFor('PreToolUse', [
        { hooks: [{ type: 'command', command: 'guard.sh' }] },
      ]),
      spawn: fake.spawn,
    });

    const outcome = await runner.run(
      'PreToolUse',
      invocation({ toolName: 'bash', toolInput: { command: 'git push' } }),
      CONTEXT,
      new AbortController().signal,
    );

    expect(outcome.blocked).toBe(true);
    expect(outcome.approved).toBe(false);
    expect(outcome.reason).toBe('no git push');
  });

  it('blocks on a stdout block decision and approves on approve', async () => {
    const blocking = fakeSpawn(() => ({
      stdout: JSON.stringify({ decision: 'block', reason: 'protected file' }),
    }));
    const blocker = new HookRunner({
      config: configFor('PreToolUse', [
        { hooks: [{ type: 'command', command: 'block.sh' }] },
      ]),
      spawn: blocking.spawn,
    });
    const blocked = await blocker.run(
      'PreToolUse',
      invocation({ toolName: 'write' }),
      CONTEXT,
      new AbortController().signal,
    );
    expect(blocked.blocked).toBe(true);
    expect(blocked.reason).toBe('protected file');

    const approving = fakeSpawn(() => ({
      stdout: JSON.stringify({ decision: 'approve' }),
    }));
    const approver = new HookRunner({
      config: configFor('PreToolUse', [
        { hooks: [{ type: 'command', command: 'allow.sh' }] },
      ]),
      spawn: approving.spawn,
    });
    const approved = await approver.run(
      'PreToolUse',
      invocation({ toolName: 'write' }),
      CONTEXT,
      new AbortController().signal,
    );
    expect(approved.blocked).toBe(false);
    expect(approved.approved).toBe(true);
  });

  it('treats non-blocking failures and timeouts as non-fatal', async () => {
    const failing = fakeSpawn(() => ({ exitCode: 1, stderr: 'boom' }));
    const failureRunner = new HookRunner({
      config: configFor('Stop', [{ hooks: [{ type: 'command', command: 'fail.sh' }] }]),
      spawn: failing.spawn,
    });
    const failure = await failureRunner.run(
      'Stop',
      invocation({ stopReason: 'final' }),
      CONTEXT,
      new AbortController().signal,
    );
    expect(failure.blocked).toBe(false);
    expect(failure.results[0]?.failed).toBe(true);

    const timingOut = fakeSpawn(() => ({ timedOut: true }));
    const timeoutRunner = new HookRunner({
      config: configFor('Stop', [{ hooks: [{ type: 'command', command: 'slow.sh' }] }]),
      spawn: timingOut.spawn,
    });
    const timedOut = await timeoutRunner.run(
      'Stop',
      invocation({ stopReason: 'final' }),
      CONTEXT,
      new AbortController().signal,
    );
    expect(timedOut.blocked).toBe(false);
    expect(timedOut.results[0]?.timedOut).toBe(true);
    expect(timedOut.results[0]?.failed).toBe(false);
  });

  it('applies tool-name glob matchers only to tool events', async () => {
    const fake = fakeSpawn(() => ({}));
    const runner = new HookRunner({
      config: configFor('PreToolUse', [
        { matcher: 'ba*', hooks: [{ type: 'command', command: 'only-bash.sh' }] },
      ]),
      spawn: fake.spawn,
    });

    await runner.run(
      'PreToolUse',
      invocation({ toolName: 'read' }),
      CONTEXT,
      new AbortController().signal,
    );
    expect(fake.requests).toHaveLength(0);

    await runner.run(
      'PreToolUse',
      invocation({ toolName: 'bash' }),
      CONTEXT,
      new AbortController().signal,
    );
    expect(fake.requests).toHaveLength(1);
  });

  it('stops at the first blocking hook and never runs later ones', async () => {
    const fake = fakeSpawn((request) => ({
      exitCode: request.command === 'first.sh' ? 2 : 0,
    }));
    const runner = new HookRunner({
      config: configFor('UserPromptSubmit', [
        { hooks: [{ type: 'command', command: 'first.sh' }, { type: 'command', command: 'second.sh' }] },
      ]),
      spawn: fake.spawn,
    });

    const outcome = await runner.run(
      'UserPromptSubmit',
      invocation({ prompt: 'hi' }),
      CONTEXT,
      new AbortController().signal,
    );

    expect(outcome.blocked).toBe(true);
    expect(fake.requests.map((request) => request.command)).toEqual(['first.sh']);
  });

  it('does nothing when the signal is already aborted', async () => {
    const fake = fakeSpawn(() => ({}));
    const runner = new HookRunner({
      config: configFor('Stop', [{ hooks: [{ type: 'command', command: 'x.sh' }] }]),
      spawn: fake.spawn,
    });
    const controller = new AbortController();
    controller.abort();

    const outcome = await runner.run('Stop', invocation(), CONTEXT, controller.signal);

    expect(outcome.results).toHaveLength(0);
    expect(fake.requests).toHaveLength(0);
  });
});
