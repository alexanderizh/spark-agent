import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { ResolvedToolCall } from '../../src/tools/contract.js';
import { workspaceToolDefinitions } from '../../src/tools/workspace/definitions.js';
import { WorkspaceToolExecutor } from '../../src/tools/workspace/executor.js';
import { runProcess } from '../../src/tools/workspace/process.js';

const roots: string[] = [];

afterEach(async () => {
  delete process.env.SPARK_TEST_SECRET_TOKEN;
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe('workspace tools', () => {
  it('blocks lexical and symlink path escapes for reads and writes', async () => {
    const root = await createRoot();
    const outside = await createRoot();
    await writeFile(join(outside, 'secret.txt'), 'outside');
    await symlink(join(outside, 'secret.txt'), join(root, 'link.txt'));
    const executor = new WorkspaceToolExecutor(root);

    await expect(execute(executor, 'read', { path: '../escape.txt' })).rejects.toMatchObject({
      code: 'tool.path_escape',
    });
    await expect(execute(executor, 'read', { path: 'link.txt' })).rejects.toMatchObject({
      code: 'tool.path_escape',
    });
    await expect(
      execute(executor, 'write', { path: 'link.txt', content: 'replace' }),
    ).rejects.toMatchObject({ code: 'tool.symlink_write_denied' });
  });

  it('uses read revisions to reject stale overwrites and writes atomically', async () => {
    const root = await createRoot();
    const path = join(root, 'src', 'a.ts');
    await mkdir(join(root, 'src'));
    await writeFile(path, 'const value = 1;\n');
    const executor = new WorkspaceToolExecutor(root);
    const revision = sha256('const value = 1;\n');

    await expect(
      execute(executor, 'write', { path: 'src/a.ts', content: 'unsafe' }),
    ).rejects.toMatchObject({ code: 'tool.write_conflict' });
    await writeFile(path, 'const value = 2;\n');
    await expect(
      execute(executor, 'write', {
        path: 'src/a.ts',
        content: 'const value = 3;\n',
        expected_sha256: revision,
      }),
    ).rejects.toMatchObject({ code: 'tool.write_conflict' });

    const current = sha256('const value = 2;\n');
    await execute(executor, 'write', {
      path: 'src/a.ts',
      content: 'const value = 3;\n',
      expected_sha256: current,
    });
    expect(await readFile(path, 'utf8')).toBe('const value = 3;\n');
    expect((await readdir(join(root, 'src'))).filter((name) => name.startsWith('.spark-write-'))).toEqual([]);
  });

  it('requires an unambiguous exact edit and returns searchable results', async () => {
    const root = await createRoot();
    await writeFile(join(root, 'a.ts'), 'const a = 1;\nconst a = 1;\n');
    await writeFile(join(root, 'b.ts'), 'export const b = 2;\n');
    const executor = new WorkspaceToolExecutor(root);
    const revision = sha256('const a = 1;\nconst a = 1;\n');

    await expect(
      execute(executor, 'edit', {
        path: 'a.ts',
        old: 'const a = 1;',
        new: 'const a = 2;',
        expected_sha256: revision,
      }),
    ).rejects.toMatchObject({ code: 'tool.edit_ambiguous' });
    const glob = await execute(executor, 'glob', { pattern: '*.ts' });
    expect(glob.content).toContain('a.ts');
    expect(glob.content).toContain('b.ts');
    const grep = await execute(executor, 'grep', { pattern: 'export const', glob: '*.ts' });
    expect(grep.content).toContain('b.ts:1:1:export const b = 2;');
  });

  it('rejects parent traversal in glob patterns', async () => {
    const root = await createRoot();
    const executor = new WorkspaceToolExecutor(root);

    await expect(execute(executor, 'glob', { pattern: '../**/*' })).rejects.toMatchObject({
      code: 'tool.path_escape',
    });
    await expect(
      execute(executor, 'grep', { pattern: 'secret', glob: '../**/*' }),
    ).rejects.toMatchObject({ code: 'tool.path_escape' });
  });

  it('removes credential-like environment variables from shell commands', async () => {
    const root = await createRoot();
    process.env.SPARK_TEST_SECRET_TOKEN = 'sensitive-value';
    const executor = new WorkspaceToolExecutor(root);
    const result = await execute(executor, 'bash', {
      command:
        "node -e \"process.stdout.write(process.env.SPARK_TEST_SECRET_TOKEN ?? 'missing')\"",
    });
    expect(result.ok).toBe(true);
    expect(result.content).toContain('missing');
    expect(result.content).not.toContain('sensitive-value');
  });

  it('cancels the complete shell process group', async () => {
    const root = await createRoot();
    const executor = new WorkspaceToolExecutor(root);
    const controller = new AbortController();
    const running = execute(
      executor,
      'bash',
      { command: "node -e \"setInterval(() => {}, 1000)\"" },
      controller.signal,
    );
    setTimeout(() => {
      controller.abort();
    }, 50).unref();
    await expect(running).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('allows a normal process to run longer than the termination grace period', async () => {
    const root = await createRoot();
    const result = await runProcess(
      process.execPath,
      ['-e', 'setTimeout(() => process.stdout.write("complete"), 1700)'],
      { cwd: root, signal: new AbortController().signal },
    );

    expect(result).toEqual({ exitCode: 0, stdout: 'complete', stderr: '' });
  });

  it('reports the dedicated error when process output exceeds its limit', async () => {
    const root = await createRoot();
    const running = runProcess(
      process.execPath,
      ['-e', 'process.stdout.write("x".repeat(4096)); setInterval(() => {}, 1000)'],
      { cwd: root, signal: new AbortController().signal, maxOutputBytes: 32 },
    );

    await expect(running).rejects.toMatchObject({ code: 'tool.process_output_limit' });
  });
});

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'spark-workspace-'));
  roots.push(root);
  return root;
}

async function execute(
  executor: WorkspaceToolExecutor,
  name: string,
  args: unknown,
  signal = new AbortController().signal,
) {
  const definition = workspaceToolDefinitions.find((candidate) => candidate.name === name);
  if (!definition) throw new Error(`Missing tool definition ${name}`);
  const call: ResolvedToolCall = { callId: 'call-1', name, args, definition };
  return executor.execute(call, { signal, timeoutMs: definition.timeoutMs });
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
