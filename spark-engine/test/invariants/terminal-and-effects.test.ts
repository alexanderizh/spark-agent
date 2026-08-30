import { describe, expect, it } from 'vitest';

import { EffectTransaction } from '../../src/kernel/effect-transaction.js';
import { TurnGate } from '../../src/kernel/turn-gate.js';
import { MemoryTelemetry } from '../../src/telemetry.js';
import type { AgentEvent } from '../../src/events/schema.js';

const terminal = (seq: number): Extract<AgentEvent, { type: 'turn.completed' }> => ({
  schemaVersion: 1,
  sessionId: 's1',
  seq,
  ts: seq,
  type: 'turn.completed',
  turnId: 't1',
  reason: 'final',
  stats: {
    steps: 1,
    toolCalls: 0,
    usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
    wallMs: 1,
    costUsd: 0,
  },
});

describe('invariants: terminal uniqueness and reversible effects', () => {
  it('swallows every terminal event after the first under a race', async () => {
    const telemetry = new MemoryTelemetry();
    const gate = new TurnGate(telemetry);
    const [first, second] = await Promise.all([
      gate.finalize(async () => terminal(1)),
      gate.finalize(async () => terminal(2)),
    ]);
    expect([first, second].filter(Boolean)).toHaveLength(1);
    expect(telemetry.records.some((record) => record.name.includes('duplicate_terminal'))).toBe(true);
  });

  it('reopens the gate when terminal persistence fails so recovery can finalize', async () => {
    const telemetry = new MemoryTelemetry();
    const gate = new TurnGate(telemetry);
    await expect(
      gate.finalize(() => Promise.reject(new Error('disk full'))),
    ).rejects.toThrow('disk full');
    expect(gate.isClosed()).toBe(false);
    await expect(gate.finalize(() => Promise.resolve(terminal(2)))).resolves.toMatchObject({ seq: 2 });
  });

  it('rolls registered plugin effects back in reverse order after partial activation failure', async () => {
    const state: string[] = [];
    const transaction = new EffectTransaction();
    await transaction.register(() => {
      state.push('one');
      return () => {
        state.push('dispose-one');
      };
    });
    await expect(
      transaction.register(() => {
        state.push('two-failed');
        throw new Error('activation failed');
      }),
    ).rejects.toThrow('activation failed');
    expect(state).toEqual(['one', 'two-failed', 'dispose-one']);
  });
});
