import { open, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

/**
 * Project instruction files, mirroring the layered-memory conventions of
 * Claude Code (CLAUDE.md) and Codex CLI (AGENTS.md): a user-global file
 * followed by every `SPARK.md` / `AGENTS.md` / `CLAUDE.md` found walking from
 * the filesystem root down to the working directory, so the most specific
 * instructions land last and can refine earlier ones.
 */
export const INSTRUCTION_FILE_NAMES = ['SPARK.md', 'AGENTS.md', 'CLAUDE.md'] as const

export type InstructionScope = 'user' | 'project'

export interface InstructionSection {
  readonly sourcePath: string
  readonly scope: InstructionScope
  readonly content: string
}

export interface InstructionSnapshot {
  readonly sections: readonly InstructionSection[]
}

/**
 * Provides the instruction snapshot consumed by the prompt composer. Called
 * once per LLM step; implementations are expected to cache internally so the
 * steady-state cost is a handful of `stat` calls.
 */
export interface InstructionProvider {
  snapshot(): Promise<InstructionSnapshot>
}

export interface FileInstructionLoaderOptions {
  readonly cwd: string
  /** User-global root; defaults to the OS home directory. */
  readonly home?: string
  readonly maxFileBytes?: number
  readonly cacheTtlMs?: number
  readonly now?: () => number
}

const DEFAULT_MAX_FILE_BYTES = 64 * 1024
const DEFAULT_CACHE_TTL_MS = 5_000

interface CachedFile {
  readonly mtimeMs: number
  readonly size: number
  readonly content: string
}

export class FileInstructionLoader implements InstructionProvider {
  readonly #cwd: string
  readonly #home: string
  readonly #maxFileBytes: number
  readonly #cacheTtlMs: number
  readonly #now: () => number
  readonly #files = new Map<string, CachedFile>()
  #snapshot: { at: number; value: InstructionSnapshot } | undefined

  constructor(options: FileInstructionLoaderOptions) {
    this.#cwd = resolve(options.cwd)
    this.#home = resolve(options.home ?? homedir())
    this.#maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES
    this.#cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS
    this.#now = options.now ?? Date.now
  }

  async snapshot(): Promise<InstructionSnapshot> {
    const now = this.#now()
    if (this.#snapshot && now - this.#snapshot.at < this.#cacheTtlMs) {
      return this.#snapshot.value
    }
    const value = await this.#collect()
    this.#snapshot = { at: now, value }
    return value
  }

  async #collect(): Promise<InstructionSnapshot> {
    const sections: InstructionSection[] = []
    const userSection = await this.#readSection(
      join(this.#home, '.spark', 'SPARK.md'),
      'user',
    )
    if (userSection) sections.push(userSection)
    for (const directory of ancestorDirectories(this.#cwd)) {
      for (const name of INSTRUCTION_FILE_NAMES) {
        const section = await this.#readSection(join(directory, name), 'project')
        if (section) {
          sections.push(section)
          break
        }
      }
    }
    return { sections }
  }

  async #readSection(
    path: string,
    scope: InstructionScope,
  ): Promise<InstructionSection | undefined> {
    let fileStat
    try {
      fileStat = await stat(path)
    } catch {
      return undefined
    }
    if (!fileStat.isFile()) return undefined
    const cached = this.#files.get(path)
    if (cached?.mtimeMs === fileStat.mtimeMs && cached?.size === fileStat.size) {
      return { sourcePath: path, scope, content: cached.content }
    }
    const content = await readTextHead(path, this.#maxFileBytes)
    if (!content.trim()) return undefined
    this.#files.set(path, { mtimeMs: fileStat.mtimeMs, size: fileStat.size, content })
    return { sourcePath: path, scope, content }
  }
}

/**
 * Directories from the filesystem root down to `cwd` (inclusive), so callers
 * iterate from least to most specific.
 */
export function ancestorDirectories(cwd: string): readonly string[] {
  const chain: string[] = []
  let current = resolve(cwd)
  while (true) {
    chain.push(current)
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return chain.reverse()
}

async function readTextHead(path: string, maxBytes: number): Promise<string> {
  const handle = await open(path, 'r')
  try {
    const { size } = await handle.stat()
    const buffer = Buffer.alloc(Math.min(size, maxBytes))
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    const text = buffer.subarray(0, bytesRead).toString('utf8')
    if (size <= maxBytes) return text
    return `${text}\n\n[truncated: file exceeds ${maxBytes} bytes]`
  } finally {
    await handle.close()
  }
}
