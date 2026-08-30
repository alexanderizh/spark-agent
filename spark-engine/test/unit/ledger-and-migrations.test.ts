import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { JsonlSessionStore, SessionLedger, encodeProjectDir } from '../../src/events/ledger.js';
import { decodeLine } from '../../src/events/migrations.js';
import { SteppingClock } from '../../src/kernel/clock.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
});

describe('ledger durability and schema migration boundaries', () => {
  it('serializes concurrent appends into a contiguous JSONL sequence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'spark-ledger-'));
    temporaryDirectories.push(root);
    const store = new JsonlSessionStore({ dataRoot: root, projectDir: '/workspace', fsync: 'always' });
    const ledger = new SessionLedger('session1', store, new SteppingClock());
    await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        ledger.append({
          type: 'turn.queued',
          schemaVersion: 1,
          turnId: `turn${index}`,
        }),
      ),
    );
    const events = [];
    for await (const event of ledger.read()) events.push(event);
    expect(events.map((event) => event.seq)).toEqual(Array.from({ length: 20 }, (_, index) => index));
    const project = encodeProjectDir('/workspace');
    const disk = await readFile(join(root, 'projects', project, 'session1', 'events.jsonl'), 'utf8');
    expect(disk.trim().split('\n')).toHaveLength(20);
  });

  it('rejects future schemas loudly instead of misreading them', () => {
    expect(() => decodeLine('{"schemaVersion":2,"type":"turn.started"}')).toThrow(
      'requires a newer engine',
    );
  });

  it('uses a readable project key with a collision-resistant suffix', () => {
    expect(encodeProjectDir('/a/b')).not.toBe(encodeProjectDir('/a-b'));
    expect(encodeProjectDir('/a/b')).toMatch(/-[a-f0-9]{12}$/);
  });
});
