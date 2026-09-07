import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';

import { createDeterministicEnv } from '../../src/env.js';
import { InteractiveApprover } from '../../src/permission/interactive.js';
import { RulePermissionPolicy } from '../../src/permission/policy.js';
import { text } from '../../src/llm/fake/reply-dsl.js';
import { Agent } from '../../src/sdk/agent.js';
import { SparkTuiApp } from '../../src/tui/app.js';
import { shouldSwallowImeKeypress } from '../../src/tui/ime-guard.js';
import type { AgentEvent } from '../../src/events/schema.js';

describe('TUI deterministic interaction', () => {
  it('renders a complete turn and matches the mono golden frame', async () => {
    const base = createDeterministicEnv([text('Hello from Spark.')]);
    const approver = new InteractiveApprover();
    const env = {
      ...base,
      permission: { policy: new RulePermissionPolicy(), approver },
    };
    const agent = Agent.open({ cwd: '/workspace', env });
    const session = await agent.newSession();
    const initial = await collect(session);
    const app = render(
      <SparkTuiApp
        initialSession={session}
        initialEvents={initial}
        approver={approver}
        createSession={async () => agent.newSession()}
        model="fake-m1"
        capabilities={{ color: 'mono', unicode: false, width: 80 }}
      />,
    );

    app.stdin.write('hello');
    await new Promise<void>((resolve) => setImmediate(resolve));
    app.stdin.write('\r');
    for (let index = 0; index < 20; index += 1) await new Promise<void>((resolve) => setImmediate(resolve));
    const actual = stripAnsi(app.lastFrame() ?? '');
    const goldenUrl = new URL('../golden-ui/basic-turn.txt', import.meta.url);
    if (process.env.UPDATE_GOLDEN === '1') {
      await writeFile(goldenUrl, `${actual}\n`);
      app.unmount();
      return;
    }
    const expected = await readFile(goldenUrl, 'utf8');
    expect(`${actual}\n`).toBe(expected);
    app.unmount();
  });

  it('swallows IME composition confirmation keys', () => {
    expect(shouldSwallowImeKeypress({ name: 'return', code: 229 })).toBe(true);
    expect(shouldSwallowImeKeypress({ name: 'return', isComposing: true })).toBe(true);
    expect(shouldSwallowImeKeypress({ name: 'return', code: 13 })).toBe(false);
  });

  it('shows the working directory in the status bar before the /help hint', async () => {
    const base = createDeterministicEnv([text('ok.')]);
    const approver = new InteractiveApprover();
    const env = {
      ...base,
      permission: { policy: new RulePermissionPolicy(), approver },
    };
    const agent = Agent.open({ cwd: '/workspace', env });
    const session = await agent.newSession();
    const initial = await collect(session);
    const app = render(
      <SparkTuiApp
        initialSession={session}
        initialEvents={initial}
        approver={approver}
        createSession={async () => agent.newSession()}
        model="fake-m1"
        cwd={join(homedir(), 'dev', 'demo')}
        capabilities={{ color: 'mono', unicode: false, width: 120 }}
      />,
    );
    const frame = app.lastFrame() ?? '';
    expect(frame).toContain('~/dev/demo'); // home prefix collapsed
    // Status bar is the last line: the path must sit before the trailing /help hint there.
    expect(frame.indexOf('~/dev/demo')).toBeLessThan(frame.lastIndexOf('/help'));
    app.unmount();
  });

  it('replays a resumed session transcript on open', async () => {
    const base = createDeterministicEnv([text('First reply.'), text('Second reply.')]);
    const approver = new InteractiveApprover();
    const env = {
      ...base,
      permission: { policy: new RulePermissionPolicy(), approver },
    };
    const agent = Agent.open({ cwd: '/workspace', env });
    const first = await agent.newSession();
    await first.turn('first question');
    const resumed = await agent.openSession(first.sessionId);
    const resumedEvents = await collect(resumed);

    const app = render(
      <SparkTuiApp
        initialSession={resumed}
        initialEvents={resumedEvents}
        approver={approver}
        createSession={async () => agent.newSession()}
        model="fake-m1"
        capabilities={{ color: 'mono', unicode: false, width: 120 }}
      />,
    );
    const frame = stripAnsi(app.lastFrame() ?? '');
    expect(frame).toContain('first question');
    expect(frame).toContain('First reply.');
    app.unmount();
  });

  it('shows generation throughput and ttft of the latest model call in the status bar', async () => {
    const base = createDeterministicEnv([
      text('快速回答。', { timing: { llmMs: 2_500, ttftMs: 1_200 }, usage: { outputTokens: 61 } }),
    ]);
    const approver = new InteractiveApprover();
    const env = {
      ...base,
      permission: { policy: new RulePermissionPolicy(), approver },
    };
    const agent = Agent.open({ cwd: '/workspace', env });
    const session = await agent.newSession();
    await session.turn('question');
    const initial = await collect(session);

    const app = render(
      <SparkTuiApp
        initialSession={session}
        initialEvents={initial}
        approver={approver}
        createSession={async () => agent.newSession()}
        model="fake-m1"
        capabilities={{ color: 'mono', unicode: false, width: 120 }}
      />,
    );
    const frame = stripAnsi(app.lastFrame() ?? '');
    // 61 output tokens over 2.5s of model time → 24.4 tok/s; ttft 1.2s.
    expect(frame).toContain('24.4 tok/s');
    expect(frame).toContain('ttft 1.2s');
    app.unmount();
  });

  it('omits the perf segment when the model call carries no timing', async () => {
    const base = createDeterministicEnv([text('无计时。')]);
    const approver = new InteractiveApprover();
    const env = {
      ...base,
      permission: { policy: new RulePermissionPolicy(), approver },
    };
    const agent = Agent.open({ cwd: '/workspace', env });
    const session = await agent.newSession();
    await session.turn('question');
    const initial = await collect(session);

    const app = render(
      <SparkTuiApp
        initialSession={session}
        initialEvents={initial}
        approver={approver}
        createSession={async () => agent.newSession()}
        model="fake-m1"
        capabilities={{ color: 'mono', unicode: false, width: 120 }}
      />,
    );
    expect(stripAnsi(app.lastFrame() ?? '')).not.toContain('tok/s');
    app.unmount();
  });

  it('lists and switches sessions through /sessions', async () => {
    const base = createDeterministicEnv([text('Alpha reply.'), text('Beta reply.')]);
    const approver = new InteractiveApprover();
    const env = {
      ...base,
      permission: { policy: new RulePermissionPolicy(), approver },
    };
    const agent = Agent.open({ cwd: '/workspace', env });
    const alpha = await agent.newSession();
    await alpha.turn('alpha question');
    const beta = await agent.newSession();
    await beta.turn('beta question');
    const alphaEvents = await collect(alpha);

    const app = render(
      <SparkTuiApp
        initialSession={alpha}
        initialEvents={alphaEvents}
        approver={approver}
        createSession={async () => agent.newSession()}
        openSession={(sessionId) => agent.openSession(sessionId)}
        listSessions={() => agent.listSessions()}
        model="fake-m1"
        capabilities={{ color: 'mono', unicode: false, width: 120 }}
      />,
    );
    app.stdin.write('/sessions');
    await settle();
    app.stdin.write('\r'); // submit the command; picker opens with both previews
    await settle();
    let frame = stripAnsi(app.lastFrame() ?? '');
    expect(frame).toContain('选择会话');
    expect(frame).toContain('alpha question');
    expect(frame).toContain('beta question');
    expect(frame).toContain('✓当前'); // current session marked

    app.stdin.write('1'); // beta is the most recently updated row
    await settle();
    frame = stripAnsi(app.lastFrame() ?? '');
    expect(frame).toContain('已切换到会话');
    expect(frame).toContain('beta question');
    expect(frame).toContain('Beta reply.');
    app.unmount();
  });

  it('opens the session picker at startup for bare --resume', async () => {
    const base = createDeterministicEnv([text('ok.')]);
    const approver = new InteractiveApprover();
    const env = {
      ...base,
      permission: { policy: new RulePermissionPolicy(), approver },
    };
    const agent = Agent.open({ cwd: '/workspace', env });
    const session = await agent.newSession();
    const initial = await collect(session);
    const app = render(
      <SparkTuiApp
        initialSession={session}
        initialEvents={initial}
        approver={approver}
        createSession={async () => agent.newSession()}
        openSession={(sessionId) => agent.openSession(sessionId)}
        listSessions={() => agent.listSessions()}
        resumePicker
        model="fake-m1"
        capabilities={{ color: 'mono', unicode: false, width: 120 }}
      />,
    );
    const frame = stripAnsi(app.lastFrame() ?? '');
    expect(frame).toContain('选择会话');
    app.unmount();
  });

  it('explains when session switching is unavailable', async () => {
    const base = createDeterministicEnv([text('ok.')]);
    const approver = new InteractiveApprover();
    const env = {
      ...base,
      permission: { policy: new RulePermissionPolicy(), approver },
    };
    const agent = Agent.open({ cwd: '/workspace', env });
    const session = await agent.newSession();
    const initial = await collect(session);
    const app = render(
      <SparkTuiApp
        initialSession={session}
        initialEvents={initial}
        approver={approver}
        createSession={async () => agent.newSession()}
        model="fake-m1"
        capabilities={{ color: 'mono', unicode: false, width: 120 }}
      />,
    );
    app.stdin.write('/sessions');
    await settle();
    app.stdin.write('\r');
    await settle();
    expect(stripAnsi(app.lastFrame() ?? '')).toContain('当前环境未启用会话切换');
    app.unmount();
  });
});

async function settle(): Promise<void> {
  for (let index = 0; index < 8; index += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

async function collect(session: Awaited<ReturnType<Agent['newSession']>>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  for await (const event of session.events()) events.push(event);
  return events;
}

function stripAnsi(value: string): string {
  let output = '';
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) === 27 && value[index + 1] === '[') {
      index += 2;
      while (index < value.length) {
        const code = value.charCodeAt(index);
        if (code >= 0x40 && code <= 0x7e) break;
        index += 1;
      }
    } else {
      output += value[index] ?? '';
    }
  }
  return output;
}
