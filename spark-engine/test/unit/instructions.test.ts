import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { FileInstructionLoader } from '../../src/memory/instructions.js';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'spark-instructions-'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('FileInstructionLoader', () => {
  it('loads the user file first and project files from root toward cwd', async () => {
    const home = join(root, 'home');
    const project = join(root, 'ws', 'nested');
    await mkdir(join(home, '.spark'), { recursive: true });
    await mkdir(project, { recursive: true });
    await writeFile(join(home, '.spark', 'SPARK.md'), 'user rules');
    await writeFile(join(root, 'ws', 'SPARK.md'), 'repo rules');
    await writeFile(join(project, 'AGENTS.md'), 'nested agents');

    const loader = new FileInstructionLoader({ cwd: project, home });
    const snapshot = await loader.snapshot();

    const sources = snapshot.sections.map((section) => `${section.scope}:${section.content}`);
    expect(sources.some((entry) => entry === 'user:user rules')).toBe(true);
    // The nearest project file wins its directory and lands last of the project chain.
    expect(sources[sources.length - 1]).toBe('project:nested agents');
    expect(snapshot.sections[snapshot.sections.length - 1]?.sourcePath).toBe(
      join(project, 'AGENTS.md'),
    );
    expect(snapshot.sections.some((section) => section.content === 'repo rules')).toBe(true);
  });

  it('prefers SPARK.md over AGENTS.md and CLAUDE.md within one directory', async () => {
    const home = join(root, 'home-empty');
    const project = join(root, 'proj');
    await mkdir(project, { recursive: true });
    await writeFile(join(project, 'SPARK.md'), 'spark');
    await writeFile(join(project, 'AGENTS.md'), 'agents');
    await writeFile(join(project, 'CLAUDE.md'), 'claude');

    const snapshot = await new FileInstructionLoader({ cwd: project, home }).snapshot();
    const projectSections = snapshot.sections.filter((section) => section.scope === 'project');

    expect(projectSections).toHaveLength(1);
    expect(projectSections[0]?.content).toBe('spark');
  });

  it('caches by TTL and re-reads modified files after it expires', async () => {
    const home = join(root, 'home-cache');
    const project = join(root, 'proj-cache');
    await mkdir(project, { recursive: true });
    const file = join(project, 'SPARK.md');
    await writeFile(file, 'version 1');

    let now = 1_000;
    const loader = new FileInstructionLoader({
      cwd: project,
      home,
      cacheTtlMs: 5_000,
      now: () => now,
    });

    expect((await loader.snapshot()).sections.at(-1)?.content).toBe('version 1');

    await writeFile(file, 'version 2');
    now = 4_000;
    expect((await loader.snapshot()).sections.at(-1)?.content).toBe('version 1');

    now = 7_000;
    expect((await loader.snapshot()).sections.at(-1)?.content).toBe('version 2');
  });

  it('truncates oversized files with a marker', async () => {
    const home = join(root, 'home-big');
    const project = join(root, 'proj-big');
    await mkdir(project, { recursive: true });
    await writeFile(join(project, 'SPARK.md'), 'x'.repeat(100));

    const snapshot = await new FileInstructionLoader({
      cwd: project,
      home,
      maxFileBytes: 10,
    }).snapshot();

    const content = snapshot.sections.at(-1)?.content ?? '';
    expect(content.startsWith('xxxxxxxxxx')).toBe(true);
    expect(content).toContain('[truncated');
  });

  it('ignores empty instruction files', async () => {
    const home = join(root, 'home-empty-file');
    const project = join(root, 'proj-empty-file');
    await mkdir(project, { recursive: true });
    await writeFile(join(project, 'SPARK.md'), '   \n  ');

    const snapshot = await new FileInstructionLoader({ cwd: project, home }).snapshot();

    expect(snapshot.sections.filter((section) => section.scope === 'project')).toHaveLength(0);
  });
});
