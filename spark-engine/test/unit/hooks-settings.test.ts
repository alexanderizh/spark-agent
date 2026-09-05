import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { discoverHookSettings, hookSettingsFiles, loadHookRunner } from '../../src/hooks/settings.js';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'spark-hooks-settings-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('hookSettingsFiles', () => {
  it('orders scopes from user to local', () => {
    const files = hookSettingsFiles('/ws', '/home/.spark');
    expect(files.map((file) => file.scope)).toEqual(['user', 'project', 'local']);
    expect(files[0]?.path).toBe('/home/.spark/settings.json');
    expect(files[1]?.path).toBe('/ws/.spark/settings.json');
    expect(files[2]?.path).toBe('/ws/.spark/settings.local.json');
  });
});

describe('discoverHookSettings', () => {
  it('merges entries across scopes in precedence order', () => {
    const read = (path: string): string => {
      if (path === '/home/.spark/settings.json') {
        return JSON.stringify({ Stop: [{ hooks: [{ type: 'command', command: 'user-hook' }] }] });
      }
      if (path === '/ws/.spark/settings.json') {
        return JSON.stringify({
          PreToolUse: [
            { matcher: 'bash', hooks: [{ type: 'command', command: 'project-hook' }] },
          ],
        });
      }
      if (path === '/ws/.spark/settings.local.json') {
        return JSON.stringify({
          PreToolUse: [
            { matcher: 'bash', hooks: [{ type: 'command', command: 'local-hook' }] },
          ],
        });
      }
      throw new Error('missing');
    };

    const discovered = discoverHookSettings('/ws', '/home/.spark', read);

    expect(discovered.issues).toHaveLength(0);
    expect(discovered.files).toHaveLength(3);
    expect(discovered.config.Stop?.[0]?.hooks[0]?.command).toBe('user-hook');
    expect(discovered.config.PreToolUse?.map((entry) => entry.hooks[0]?.command)).toEqual([
      'project-hook',
      'local-hook',
    ]);
  });

  it('skips unreadable files and records broken ones as issues', () => {
    const read = (path: string): string => {
      if (path === '/ws/.spark/settings.json') return '{not json';
      throw new Error('missing');
    };

    const discovered = discoverHookSettings('/ws', '/home/.spark', read);

    expect(discovered.files).toHaveLength(0);
    expect(discovered.issues).toHaveLength(1);
    expect(discovered.issues[0]?.path).toBe('/ws/.spark/settings.json');
    expect(discovered.config).toEqual({});
  });

  it('rejects malformed hook entries with a schema issue', () => {
    const read = (path: string): string => {
      if (path === '/ws/.spark/settings.json') {
        return JSON.stringify({
          PreToolUse: [{ hooks: [{ type: 'command' }] }],
        });
      }
      throw new Error('missing');
    };

    const discovered = discoverHookSettings('/ws', '/home/.spark', read);

    expect(discovered.files).toHaveLength(0);
    expect(discovered.issues[0]?.message).toMatch(/command/u);
  });
});

describe('loadHookRunner', () => {
  it('returns undefined when no settings file exists', async () => {
    const cwd = join(root, 'ws');
    const userDir = join(root, 'user');
    await mkdir(cwd, { recursive: true });

    expect(loadHookRunner({ cwd, userSettingsDir: userDir })).toBeUndefined();
  });

  it('builds a runner from the project settings file', async () => {
    const cwd = join(root, 'ws');
    const userDir = join(root, 'user');
    await mkdir(join(cwd, '.spark'), { recursive: true });
    await writeFile(
      join(cwd, '.spark', 'settings.json'),
      JSON.stringify({
        Stop: [{ hooks: [{ type: 'command', command: 'echo done' }] }],
      }),
    );

    const runner = loadHookRunner({ cwd, userSettingsDir: userDir });

    expect(runner).toBeDefined();
  });
});
