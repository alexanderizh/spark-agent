import { realpathSync } from 'node:fs'
import { lstat, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'

import { KernelError } from '../../kernel/errors.js'

export class WorkspacePathGuard {
  /**
   * Best-effort canonical root available synchronously. Node's sync realpath
   * keeps Windows 8.3 short names (ADMINI~1) while the async realpath expands
   * them, so synchronous comparisons can only be trusted after the async
   * canonicalization below has run — which every async entry point does.
   */
  readonly #syncRoot: string
  readonly #rawRoot: string
  readonly #rootReady: Promise<string>
  #canonicalRoot: string | undefined

  constructor(root: string) {
    this.#rawRoot = resolve(root)
    this.#syncRoot = realpathSync(this.#rawRoot)
    this.#rootReady = realpath(this.#rawRoot).then(
      (canonical) => {
        this.#canonicalRoot = canonical
        return canonical
      },
      () => {
        this.#canonicalRoot = this.#rawRoot
        return this.#rawRoot
      },
    )
  }

  get root(): string {
    return this.#canonicalRoot ?? this.#syncRoot
  }

  async existing(input: string): Promise<string> {
    const root = await this.#rootReady
    const lexical = this.#lexical(root, input)
    let actual: string
    try {
      actual = await realpath(lexical)
    } catch (error) {
      throw new KernelError('tool.path_not_found', `Path does not exist: ${input}`, {
        cause: error,
      })
    }
    this.#assertInside(root, actual, input)
    return actual
  }

  async writable(input: string): Promise<{ readonly target: string; readonly parent: string }> {
    const root = await this.#rootReady
    const target = this.#lexical(root, input)
    const parent = await this.#existingAncestor(dirname(target))
    this.#assertInside(root, parent, input)
    try {
      const stats = await lstat(target)
      if (stats.isSymbolicLink()) {
        throw new KernelError(
          'tool.symlink_write_denied',
          `Refusing to write through symlink: ${input}`,
        )
      }
      const actual = await realpath(target)
      this.#assertInside(root, actual, input)
    } catch (error) {
      if (!isMissing(error)) throw error
    }
    return { target, parent }
  }

  relative(path: string): string {
    const root = this.root
    this.#assertInside(root, path, path)
    return relative(root, path) || '.'
  }

  #lexical(root: string, input: string): string {
    if (!input || input.includes('\0')) {
      throw new KernelError(
        'tool.invalid_path',
        'Path must be a non-empty string without NUL bytes',
      )
    }
    const path = resolve(root, input)
    this.#assertInside(root, path, input)
    return path
  }

  async #existingAncestor(start: string): Promise<string> {
    let current = start
    while (true) {
      try {
        return await realpath(current)
      } catch (error) {
        if (!isMissing(error)) throw error
        const next = dirname(current)
        if (next === current) throw error
        current = next
      }
    }
  }

  #assertInside(root: string, path: string, input: string): void {
    const candidate = relative(root, path)
    if (candidate === '' || (!candidate.startsWith('..') && !isAbsolute(candidate))) return
    throw new KernelError('tool.path_escape', `Path escapes workspace: ${input}`)
  }
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { readonly code?: unknown }).code === 'ENOENT'
  )
}
