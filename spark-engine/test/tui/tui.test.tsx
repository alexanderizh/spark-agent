import { readFile } from 'node:fs/promises';

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
    const expected = await readFile(new URL('../golden-ui/basic-turn.txt', import.meta.url), 'utf8');
    expect(`${actual}\n`).toBe(expected);
    app.unmount();
  });

  it('swallows IME composition confirmation keys', () => {
    expect(shouldSwallowImeKeypress({ name: 'return', code: 229 })).toBe(true);
    expect(shouldSwallowImeKeypress({ name: 'return', isComposing: true })).toBe(true);
    expect(shouldSwallowImeKeypress({ name: 'return', code: 13 })).toBe(false);
  });
});

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
