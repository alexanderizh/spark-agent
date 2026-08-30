import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { dirname } from 'node:path';

import fastGlob from 'fast-glob';
import ignore from 'ignore';

import { KernelError } from '../../kernel/errors.js';
import type { ToolCallContext, ToolExecutor } from '../../seams.js';
import type { ResolvedToolCall, ToolOutcome } from '../contract.js';
import { atomicWriteFile } from './atomic-write.js';
import { WorkspacePathGuard } from './path-guard.js';
import { runProcess, safeShellEnvironment } from './process.js';

const MAX_FILE_BYTES = 16 * 1024 * 1024;

export class WorkspaceToolExecutor implements ToolExecutor {
  readonly #guard: WorkspacePathGuard;

  constructor(readonly cwd: string) {
    this.#guard = new WorkspacePathGuard(cwd);
  }

  async execute(call: ResolvedToolCall, context: ToolCallContext): Promise<ToolOutcome> {
    context.signal.throwIfAborted();
    const args = call.args as Record<string, unknown>;
    switch (call.name) {
      case 'read':
        return this.#read(args, context.signal);
      case 'glob':
        return this.#glob(args, context.signal);
      case 'grep':
        return this.#grep(args, context.signal);
      case 'write':
        return this.#write(args, context.signal);
      case 'edit':
        return this.#edit(args, context.signal);
      case 'bash':
        return this.#bash(args, context.signal);
      default:
        return { ok: false, content: `Unknown workspace tool: ${call.name}` };
    }
  }

  async #read(args: Record<string, unknown>, signal: AbortSignal): Promise<ToolOutcome> {
    const input = stringArg(args.path, 'path');
    const path = await this.#guard.existing(input);
    const file = await readTextFile(path, signal);
    const lines = file.text.split('\n');
    const offset = args.offset === undefined ? 1 : Number(args.offset);
    const limit = args.limit === undefined ? lines.length : Number(args.limit);
    const selected = lines.slice(offset - 1, offset - 1 + limit);
    const width = String(offset + Math.max(0, selected.length - 1)).length;
    const body = selected
      .map((line, index) => `${String(offset + index).padStart(width)}│${line}`)
      .join('\n');
    return {
      ok: true,
      content: `path: ${this.#guard.relative(path)}\nsha256: ${file.sha256}\nbytes: ${file.bytes}\n---\n${body}`,
    };
  }

  async #write(args: Record<string, unknown>, signal: AbortSignal): Promise<ToolOutcome> {
    const input = stringArg(args.path, 'path');
    const content = stringArg(args.content, 'content');
    const expected = optionalStringArg(args.expected_sha256, 'expected_sha256');
    const location = await this.#guard.writable(input);
    const current = await readOptionalTextFile(location.target, signal);
    assertRevision(input, current?.sha256, expected);
    signal.throwIfAborted();
    await atomicWriteFile(location.target, content, async () => {
      signal.throwIfAborted();
      await this.#guard.existing(dirname(location.target));
      const latest = await readOptionalTextFile(location.target, signal);
      assertRevision(input, latest?.sha256, expected);
    });
    const sha256 = digest(Buffer.from(content));
    return { ok: true, content: `Wrote ${input}\nsha256: ${sha256}\nbytes: ${Buffer.byteLength(content)}` };
  }

  async #edit(args: Record<string, unknown>, signal: AbortSignal): Promise<ToolOutcome> {
    const input = stringArg(args.path, 'path');
    const oldText = stringArg(args.old, 'old');
    const newText = stringArg(args.new, 'new');
    const expected = stringArg(args.expected_sha256, 'expected_sha256');
    const location = await this.#guard.writable(input);
    const current = await readOptionalTextFile(location.target, signal);
    if (!current) throw new KernelError('tool.path_not_found', `Path does not exist: ${input}`);
    assertRevision(input, current.sha256, expected);
    const first = current.text.indexOf(oldText);
    if (first === -1) throw new KernelError('tool.edit_no_match', `Edit text was not found in ${input}`);
    if (current.text.slice(first + oldText.length).includes(oldText)) {
      throw new KernelError('tool.edit_ambiguous', `Edit text occurs more than once in ${input}`);
    }
    const content = `${current.text.slice(0, first)}${newText}${current.text.slice(first + oldText.length)}`;
    signal.throwIfAborted();
    await atomicWriteFile(location.target, content, async () => {
      signal.throwIfAborted();
      await this.#guard.existing(dirname(location.target));
      const latest = await readOptionalTextFile(location.target, signal);
      assertRevision(input, latest?.sha256, expected);
    });
    return { ok: true, content: `Edited ${input}\nsha256: ${digest(Buffer.from(content))}` };
  }

  async #glob(args: Record<string, unknown>, signal: AbortSignal): Promise<ToolOutcome> {
    const patterns = Array.isArray(args.pattern)
      ? args.pattern.map((item) => stringArg(item, 'pattern'))
      : [stringArg(args.pattern, 'pattern')];
    for (const pattern of patterns) assertSafeGlob(pattern);
    const maximum = args.max_results === undefined ? 2_000 : Number(args.max_results);
    const files = await this.#listFiles(patterns, maximum + 1, signal);
    const truncated = files.length > maximum;
    const visible = files.slice(0, maximum);
    return {
      ok: true,
      content: `${visible.join('\n')}${truncated ? `\n… results truncated at ${maximum}` : ''}`,
    };
  }

  async #grep(args: Record<string, unknown>, signal: AbortSignal): Promise<ToolOutcome> {
    const pattern = stringArg(args.pattern, 'pattern');
    const maximum = args.max_results === undefined ? 500 : Number(args.max_results);
    const searchPath = optionalStringArg(args.path, 'path') ?? '.';
    const actual = await this.#guard.existing(searchPath);
    const relativePath = this.#guard.relative(actual);
    const searchIsFile = (await stat(actual)).isFile();
    const command = [
      '--line-number',
      '--column',
      '--no-heading',
      '--color',
      'never',
      '--hidden',
      '--glob',
      '!.git/**',
      '--glob',
      '!node_modules/**',
      ...(args.case_sensitive === true ? ['--case-sensitive'] : ['--smart-case']),
      ...(args.glob === undefined ? [] : ['--glob', safeGlobArg(args.glob)]),
      '--',
      pattern,
      relativePath,
    ];
    try {
      const result = await runProcess('rg', command, { cwd: this.cwd, signal });
      if (result.exitCode > 1) {
        return { ok: false, content: result.stderr.trim() || `ripgrep exited ${result.exitCode}` };
      }
      return { ok: true, content: limitLines(result.stdout, maximum) };
    } catch (error) {
      if (!isMissingCommand(error)) throw error;
      return this.#fallbackGrep(pattern, args, maximum, relativePath, searchIsFile, signal);
    }
  }

  async #bash(args: Record<string, unknown>, signal: AbortSignal): Promise<ToolOutcome> {
    const shell = process.env.SHELL ?? (process.platform === 'win32' ? 'cmd.exe' : '/bin/sh');
    const command = stringArg(args.command, 'command');
    const shellArgs = process.platform === 'win32'
      ? ['/d', '/s', '/c', command]
      : ['-lc', command];
    const result = await runProcess(shell, shellArgs, {
      cwd: this.cwd,
      signal,
      env: safeShellEnvironment(),
    });
    const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    return {
      ok: result.exitCode === 0,
      content: `${output}${output ? '\n' : ''}exit ${result.exitCode}`,
    };
  }

  async #listFiles(patterns: readonly string[], limit: number, signal: AbortSignal): Promise<string[]> {
    const args = [
      '--files',
      '--hidden',
      '--glob',
      '!.git/**',
      '--glob',
      '!node_modules/**',
      ...patterns.flatMap((pattern) => ['--glob', pattern]),
    ];
    try {
      const result = await runProcess('rg', args, { cwd: this.cwd, signal });
      if (result.exitCode > 1) throw new Error(result.stderr || `ripgrep exited ${result.exitCode}`);
      return result.stdout.split('\n').filter(Boolean).sort().slice(0, limit);
    } catch (error) {
      if (!isMissingCommand(error)) throw error;
      signal.throwIfAborted();
      const entries = await fastGlob([...patterns], {
        cwd: this.cwd,
        dot: true,
        onlyFiles: true,
        unique: true,
        followSymbolicLinks: false,
        ignore: ['.git/**', 'node_modules/**'],
      });
      const matcher = ignore();
      const gitignore = await readFile(`${this.cwd}/.gitignore`, 'utf8').catch(() => '');
      if (gitignore) matcher.add(gitignore);
      return entries.filter((entry) => !matcher.ignores(entry)).sort().slice(0, limit);
    }
  }

  async #fallbackGrep(
    pattern: string,
    args: Record<string, unknown>,
    maximum: number,
    relativePath: string,
    searchIsFile: boolean,
    signal: AbortSignal,
  ): Promise<ToolOutcome> {
    let expression: RegExp;
    try {
      expression = new RegExp(pattern, args.case_sensitive === true ? 'u' : 'iu');
    } catch (error) {
      throw new KernelError('tool.invalid_regex', `Invalid search pattern: ${message(error)}`);
    }
    const glob = args.glob === undefined ? '**/*' : safeGlobArg(args.glob);
    const filePattern = searchIsFile
      ? relativePath
      : relativePath === '.'
        ? glob
        : `${relativePath.replace(/\/$/u, '')}/**/${glob}`;
    const files = await this.#listFiles([filePattern], 10_000, signal);
    const matches: string[] = [];
    for (const file of files) {
      signal.throwIfAborted();
      const value = await readOptionalTextFile(`${this.cwd}/${file}`, signal);
      if (!value) continue;
      for (const [index, line] of value.text.split('\n').entries()) {
        const match = expression.exec(line);
        if (match) matches.push(`${file}:${index + 1}:${(match.index ?? 0) + 1}:${line}`);
        if (matches.length >= maximum) break;
      }
      if (matches.length >= maximum) break;
    }
    return { ok: true, content: `${matches.join('\n')}\n[fallback: JavaScript regex engine]`.trim() };
  }
}

interface TextFile {
  readonly text: string;
  readonly sha256: string;
  readonly bytes: number;
}

async function readTextFile(path: string, signal: AbortSignal): Promise<TextFile> {
  signal.throwIfAborted();
  const size = (await stat(path)).size;
  if (size > MAX_FILE_BYTES) {
    throw new KernelError('tool.file_too_large', `File exceeds ${MAX_FILE_BYTES} bytes: ${path}`);
  }
  const bytes = await readFile(path);
  signal.throwIfAborted();
  if (bytes.byteLength > MAX_FILE_BYTES) {
    throw new KernelError('tool.file_too_large', `File exceeds ${MAX_FILE_BYTES} bytes: ${path}`);
  }
  if (bytes.includes(0)) throw new KernelError('tool.binary_file', `Refusing to decode binary file: ${path}`);
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    throw new KernelError('tool.invalid_utf8', `File is not valid UTF-8: ${path}`, { cause: error });
  }
  return { text, sha256: digest(bytes), bytes: bytes.byteLength };
}

async function readOptionalTextFile(path: string, signal: AbortSignal): Promise<TextFile | undefined> {
  try {
    return await readTextFile(path, signal);
  } catch (error) {
    if (isMissingFile(error)) return undefined;
    throw error;
  }
}

function assertRevision(path: string, actual: string | undefined, expected: string | undefined): void {
  if (actual === undefined && expected !== undefined) {
    throw new KernelError('tool.write_conflict', `File was removed after it was read: ${path}`);
  }
  if (actual !== undefined && expected === undefined) {
    throw new KernelError(
      'tool.write_conflict',
      `Refusing to overwrite ${path} without expected_sha256 from a prior read`,
    );
  }
  if (actual !== undefined && actual !== expected) {
    throw new KernelError('tool.write_conflict', `File changed after it was read: ${path}`);
  }
}

function digest(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function limitLines(value: string, maximum: number): string {
  const lines = value.split('\n').filter(Boolean);
  return `${lines.slice(0, maximum).join('\n')}${lines.length > maximum ? `\n… results truncated at ${maximum}` : ''}`;
}

function isMissingCommand(error: unknown): boolean {
  return asCode(error) === 'ENOENT';
}

function isMissingFile(error: unknown): boolean {
  return asCode(error) === 'ENOENT' || (error instanceof KernelError && error.code === 'tool.path_not_found');
}

function asCode(error: unknown): unknown {
  return typeof error === 'object' && error !== null && 'code' in error
    ? (error as { readonly code?: unknown }).code
    : undefined;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function stringArg(value: unknown, name: string): string {
  if (typeof value !== 'string') {
    throw new KernelError('tool.invalid_arguments', `Expected ${name} to be a string`);
  }
  return value;
}

function optionalStringArg(value: unknown, name: string): string | undefined {
  return value === undefined ? undefined : stringArg(value, name);
}

function safeGlobArg(value: unknown): string {
  const pattern = stringArg(value, 'glob');
  assertSafeGlob(pattern);
  return pattern;
}

function assertSafeGlob(pattern: string): void {
  if (pattern.includes('\0') || pattern.startsWith('/') || /^[A-Za-z]:[\\/]/u.test(pattern)) {
    throw new KernelError('tool.path_escape', `Glob must be relative to the workspace: ${pattern}`);
  }
  const literalSegments = pattern.replaceAll('\\', '/').split('/');
  if (literalSegments.includes('..')) {
    throw new KernelError('tool.path_escape', `Glob escapes workspace: ${pattern}`);
  }
}
