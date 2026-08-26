import { realpathSync } from 'node:fs';
import { lstat, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

import { KernelError } from '../../kernel/errors.js';

export class WorkspacePathGuard {
  readonly root: string;

  constructor(root: string) {
    this.root = realpathSync(resolve(root));
  }

  async existing(input: string): Promise<string> {
    const lexical = this.#lexical(input);
    let actual: string;
    try {
      actual = await realpath(lexical);
    } catch (error) {
      throw new KernelError('tool.path_not_found', `Path does not exist: ${input}`, {
        cause: error,
      });
    }
    this.#assertInside(actual, input);
    return actual;
  }

  async writable(input: string): Promise<{ readonly target: string; readonly parent: string }> {
    const target = this.#lexical(input);
    const parent = await this.#existingAncestor(dirname(target));
    this.#assertInside(parent, input);
    try {
      const stats = await lstat(target);
      if (stats.isSymbolicLink()) {
        throw new KernelError('tool.symlink_write_denied', `Refusing to write through symlink: ${input}`);
      }
      const actual = await realpath(target);
      this.#assertInside(actual, input);
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
    return { target, parent };
  }

  relative(path: string): string {
    this.#assertInside(path, path);
    return relative(this.root, path) || '.';
  }

  #lexical(input: string): string {
    if (!input || input.includes('\0')) {
      throw new KernelError('tool.invalid_path', 'Path must be a non-empty string without NUL bytes');
    }
    const path = resolve(this.root, input);
    this.#assertInside(path, input);
    return path;
  }

  async #existingAncestor(start: string): Promise<string> {
    let current = start;
    while (true) {
      try {
        return await realpath(current);
      } catch (error) {
        if (!isMissing(error)) throw error;
        const next = dirname(current);
        if (next === current) throw error;
        current = next;
      }
    }
  }

  #assertInside(path: string, input: string): void {
    const candidate = relative(this.root, path);
    if (candidate === '' || (!candidate.startsWith('..') && !isAbsolute(candidate))) return;
    throw new KernelError('tool.path_escape', `Path escapes workspace: ${input}`);
  }
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { readonly code?: unknown }).code === 'ENOENT'
  );
}
