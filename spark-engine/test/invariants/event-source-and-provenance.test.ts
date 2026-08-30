import { describe, expect, it } from 'vitest';

import { createDeterministicEnv } from '../../src/env.js';
import { text, toolCall } from '../../src/llm/fake/reply-dsl.js';
import { Agent } from '../../src/sdk/agent.js';
import { projectTranscript } from '../../src/tui/projection.js';
import { collectEvents } from '../helpers.js';

describe('invariants: event source and model provenance', () => {
  it('rebuilds model and TUI projections entirely from the event log', async () => {
    const env = createDeterministicEnv(
      [toolCall('read-1', 'read', { path: 'a.ts' }), text('The file contains x.')],
      { files: { 'a.ts': 'x' } },
    );
    const session = await Agent.open({ cwd: '/workspace', env }).newSession();
    await session.turn('Read a.ts');
    const events = await collectEvents(session);

    const first = env.projector.project(events, { cwd: '/workspace' });
    const second = env.projector.project(structuredClone(events), { cwd: '/workspace' });
    expect(second).toEqual(first);
    const knownSeqs = new Set(events.map((event) => event.seq));
    for (const message of first.messages) {
      expect(message.sourceSeqs.length).toBeGreaterThan(0);
      expect(message.sourceSeqs.every((seq) => knownSeqs.has(seq))).toBe(true);
    }
    expect(env.fixtures.model.requests[1]?.messages).toContainEqual(
      expect.objectContaining({
        role: 'assistant',
        toolCalls: [{ callId: 'read-1', name: 'read', args: { path: 'a.ts' } }],
      }),
    );

    const ui = projectTranscript(events, { color: 'mono', unicode: false, width: 80 });
    expect(ui.settled.length).toBeGreaterThan(0);
    expect(ui.activeTools).toEqual([]);
  });

  it('renders unknown future events through a fallback row', () => {
    const projection = projectTranscript(
      [{ type: 'future.event', seq: 42, schemaVersion: 99 }],
      { color: 'mono', unicode: false, width: 80 },
    );
    expect(projection.settled[0]?.text).toBe('[event:future.event #42]');
  });
});
