import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { FileArtifactStore } from '../../src/events/artifact-store.js';

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe('content-addressed artifact integrity', () => {
  it('rejects a forged path-like hash before touching the filesystem', async () => {
    const root = await mkdtemp(join(tmpdir(), 'spark-artifact-'));
    roots.push(root);
    const store = new FileArtifactStore(root);
    await expect(
      store.get({
        sha256: '../../outside',
        bytes: 1,
        mediaType: 'text/plain',
        summary: '',
        readHint: '',
      }),
    ).rejects.toThrow();
  });

  it('detects content corruption on read', async () => {
    const root = await mkdtemp(join(tmpdir(), 'spark-artifact-'));
    roots.push(root);
    const store = new FileArtifactStore(root);
    const ref = await store.put('trusted', 'text/plain');
    await writeFile(resolve(root, 'artifacts', ref.sha256.slice(0, 2), ref.sha256), 'corrupt');
    await expect(store.get(ref)).rejects.toThrow('integrity check failed');
  });
});
