import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import { isSameDirectory } from '../fs/real-path.js'
import { NULL_RUNTIME_LOGGER, type RuntimeLogger } from '../observability/logger.js'

export const MEMORY_SCOPES = ['user', 'project', 'agent'] as const
export type MemoryScope = (typeof MEMORY_SCOPES)[number]
export const MEMORY_TYPES = ['user', 'feedback', 'project', 'reference'] as const
export type MemoryType = (typeof MEMORY_TYPES)[number]

export interface MemoryEntry {
  readonly id: string
  readonly scope: MemoryScope
  readonly scopeRef: string | null
  readonly type: MemoryType
  readonly name: string
  readonly description: string
  readonly filePath: string
  readonly confidence: number
  readonly createdAt: number
  readonly updatedAt: number
  readonly hitCount: number
  readonly lastHitAt: number | null
  readonly sourceSessionId: string | null
  readonly links: readonly string[]
  readonly archived: boolean
  readonly body: string
}

export interface MemoryStoreOptions {
  /** Defaults to ~/.spark-agent to match the desktop Markdown store. */
  readonly homeDir?: string
  readonly cwd: string
  readonly agentId?: string
  readonly maxInjectTokens?: number
  readonly enabled?: boolean
  readonly logger?: RuntimeLogger
}

export interface MemorySearchOptions {
  readonly scope?: MemoryScope
  readonly limit?: number
  readonly agentId?: string
}

export interface MemoryInjection {
  readonly block: string
  readonly injectedIds: readonly string[]
  readonly droppedCount: number
}

export interface MemoryProvider {
  injection(): Promise<MemoryInjection>
}

interface MemoryLocation {
  readonly scope: MemoryScope
  readonly scopeRef: string | null
  readonly directory: string
}

const MEMORY_INDEX_FILENAME = 'MEMORY.md'
const DEFAULT_MAX_INJECT_TOKENS = 4_000
const DEFAULT_AGENT_ID = 'default'
const MAX_MEMORY_FILE_BYTES = 2 * 1024 * 1024
const MAX_MEMORY_FILES_PER_SCOPE = 5_000
const ID_PATTERN = /^(?:usr|prj|agt)_[A-Za-z0-9_-]+$/u

/**
 * Human-readable Markdown memory store used by standalone CLI sessions.
 *
 * It deliberately has no database dependency. A desktop session can later
 * replace this seam with its SQLite-backed implementation while preserving
 * the same Markdown files and prompt/tool contract.
 */
export class FileMemoryStore implements MemoryProvider {
  readonly #homeDir: string
  readonly #cwd: string
  readonly #agentId: string
  readonly #maxInjectTokens: number
  readonly #enabled: boolean
  readonly #logger: RuntimeLogger

  constructor(options: MemoryStoreOptions) {
    this.#homeDir = resolve(
      options.homeDir ?? process.env.SPARK_AGENT_HOME ?? join(homedir(), '.spark-agent'),
    )
    this.#cwd = resolve(options.cwd)
    this.#agentId = normalizeAgentId(options.agentId ?? DEFAULT_AGENT_ID)
    this.#maxInjectTokens = normalizeBudget(options.maxInjectTokens)
    this.#enabled = options.enabled ?? true
    this.#logger = options.logger ?? NULL_RUNTIME_LOGGER
  }

  get homeDir(): string {
    return this.#homeDir
  }

  get agentId(): string {
    return this.#agentId
  }

  /** Lists readable, non-archived entries from one or all applicable scopes. */
  async list(options: MemorySearchOptions = {}): Promise<readonly MemoryEntry[]> {
    const locations = this.#locations(options.scope, options.agentId ?? this.#agentId)
    const entries: MemoryEntry[] = []
    for (const location of locations) {
      entries.push(...(await this.#readLocation(location)))
    }
    const visible = entries.filter((entry) => !entry.archived)
    visible.sort(compareForInjection)
    return options.limit === undefined ? visible : visible.slice(0, normalizeLimit(options.limit))
  }

  /** Keyword/CJK search with deterministic local ranking. */
  async search(query: string, options: MemorySearchOptions = {}): Promise<readonly MemoryEntry[]> {
    const terms = tokenize(query)
    if (terms.length === 0) return []
    const entries = await this.list({
      ...(options.scope === undefined ? {} : { scope: options.scope }),
      ...(options.agentId === undefined ? {} : { agentId: options.agentId }),
    })
    const ranked = entries
      .map((entry) => ({ entry, score: scoreEntry(entry, terms) }))
      .filter((item) => item.score > 0)
      .sort(
        (left, right) => right.score - left.score || compareForInjection(left.entry, right.entry),
      )
      .map((item) => item.entry)
    return options.limit === undefined ? ranked : ranked.slice(0, normalizeLimit(options.limit))
  }

  async recall(id: string): Promise<{ readonly entry?: MemoryEntry; readonly error?: string }> {
    const normalized = id.trim()
    if (!ID_PATTERN.test(normalized)) return { error: `Invalid memory id: ${id}` }
    const entries = await this.list()
    const entry = entries.find((candidate) => candidate.id === normalized)
    if (entry === undefined) return { error: `Memory not found: ${normalized}` }
    const updated: MemoryEntry = {
      ...entry,
      hitCount: entry.hitCount + 1,
      lastHitAt: Date.now(),
    }
    await this.#writeEntry(updated)
    this.#logger.debug(`memory recall hit id=${entry.id} scope=${entry.scope}`)
    return { entry: updated }
  }

  /** Adds a new entry, or updates an existing same-name entry in the target scope. */
  async save(input: {
    readonly scope: MemoryScope
    readonly name: string
    readonly description: string
    readonly body: string
    readonly type?: MemoryType
    readonly confidence?: number
    readonly sourceSessionId?: string
    readonly agentId?: string
  }): Promise<MemoryEntry> {
    const name = requiredSingleLine(input.name, 'name')
    const description = requiredSingleLine(input.description, 'description')
    const body = input.body.trim()
    if (body.length === 0) throw new Error('Memory body must not be empty')
    const location = this.#locations(input.scope, input.agentId ?? this.#agentId)[0]
    if (location === undefined) throw new Error(`Unable to resolve ${input.scope} memory location`)
    const existing = (await this.#readLocation(location)).find((entry) => entry.name === name)
    const now = Date.now()
    const id = existing?.id ?? createMemoryId(input.scope)
    const entry: MemoryEntry = {
      id,
      scope: input.scope,
      scopeRef:
        input.scope === 'project'
          ? location.scopeRef
          : scopeReference(input.scope, input.agentId ?? this.#agentId),
      type: input.type ?? defaultTypeForScope(input.scope),
      name,
      description,
      filePath: existing?.filePath ?? join(location.directory, `${id}.md`),
      confidence: normalizeConfidence(input.confidence ?? existing?.confidence ?? 1),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      hitCount: existing?.hitCount ?? 0,
      lastHitAt: existing?.lastHitAt ?? null,
      sourceSessionId: input.sourceSessionId ?? existing?.sourceSessionId ?? null,
      links: existing?.links ?? [],
      archived: false,
      body,
    }
    await this.#writeEntry(entry)
    this.#logger.info(`memory saved id=${entry.id} scope=${entry.scope} name=${entry.name}`)
    return entry
  }

  /** Loads the compact three-scope summary used by PromptComposer. */
  async injection(): Promise<MemoryInjection> {
    if (!this.#enabled) {
      this.#logger.debug('memory injection skipped: disabled')
      return { block: '', injectedIds: [], droppedCount: 0 }
    }
    try {
      const entries = await this.list()
      const selected: MemoryEntry[] = []
      let used = 0
      for (const entry of entries) {
        const cost = estimateTokens(`${entry.name}: ${entry.description}`) + 20
        if (used + cost > this.#maxInjectTokens) break
        selected.push(entry)
        used += cost
      }
      const block = renderMemoryBlock(selected, this.#cwd)
      this.#logger.debug(
        `memory injection entries=${selected.length} dropped=${entries.length - selected.length}`,
      )
      return {
        block,
        injectedIds: selected.map((entry) => entry.id),
        droppedCount: entries.length - selected.length,
      }
    } catch (error) {
      this.#logger.warn(`memory injection degraded: ${errorMessage(error)}`)
      return { block: '', injectedIds: [], droppedCount: 0 }
    }
  }

  async #writeEntry(entry: MemoryEntry): Promise<void> {
    const directory = dirname(entry.filePath)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const temporary = `${entry.filePath}.${process.pid}.tmp`
    await writeFile(temporary, renderMemoryFile(entry), { encoding: 'utf8', mode: 0o600 })
    await rename(temporary, entry.filePath)
    await this.#updateIndex(entry.scope, entry.scopeRef, directory)
  }

  async #updateIndex(
    scope: MemoryScope,
    scopeRef: string | null,
    directory: string,
  ): Promise<void> {
    const entries = await this.#readLocation({ scope, scopeRef, directory })
    const lines = entries
      .filter((entry) => !entry.archived)
      .sort(compareForInjection)
      .map((entry) => `- [${entry.name}](${entry.id}.md) — ${entry.description}`)
    const indexPath = join(directory, MEMORY_INDEX_FILENAME)
    const temporary = `${indexPath}.${process.pid}.tmp`
    await writeFile(temporary, `# Memory Index\n\n${lines.join('\n')}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    })
    await rename(temporary, indexPath)
  }

  #locations(scope: MemoryScope | undefined, agentId: string): MemoryLocation[] {
    const locations: MemoryLocation[] = []
    const projectDirectory = findProjectMemoryDirectory(this.#cwd, this.#homeDir)
    if (scope === undefined || scope === 'user') {
      locations.push({
        scope: 'user',
        scopeRef: null,
        directory: join(this.#homeDir, 'memory', 'user'),
      })
    }
    if (scope === undefined || scope === 'project') {
      locations.push({ scope: 'project', scopeRef: this.#cwd, directory: projectDirectory })
    }
    if (scope === undefined || scope === 'agent') {
      locations.push({
        scope: 'agent',
        scopeRef: agentId,
        directory: join(this.#homeDir, 'memory', 'agent', agentId),
      })
    }
    return locations
  }

  async #readLocation(location: MemoryLocation): Promise<MemoryEntry[]> {
    let names: string[]
    try {
      names = await readdir(location.directory)
    } catch (error) {
      if (isMissing(error)) return []
      this.#logger.warn(`memory list failed scope=${location.scope}: ${errorMessage(error)}`)
      return []
    }
    const entries: MemoryEntry[] = []
    const memoryFileNames = names.filter(
      (candidate) => candidate.endsWith('.md') && candidate !== MEMORY_INDEX_FILENAME,
    )
    const memoryFiles = memoryFileNames.sort().slice(0, MAX_MEMORY_FILES_PER_SCOPE)
    if (memoryFileNames.length > MAX_MEMORY_FILES_PER_SCOPE) {
      this.#logger.warn(
        `memory scope=${location.scope} has more than ${MAX_MEMORY_FILES_PER_SCOPE} files; remaining files were skipped`,
      )
    }
    for (const name of memoryFiles) {
      const filePath = join(location.directory, name)
      try {
        const fileStat = await stat(filePath)
        if (!fileStat.isFile() || fileStat.size > MAX_MEMORY_FILE_BYTES) continue
        const source = await readFile(filePath, 'utf8')
        const parsed = parseMemoryFile(source, filePath, location)
        if (parsed !== undefined) entries.push(parsed)
      } catch (error) {
        this.#logger.warn(`memory file skipped path=${filePath}: ${errorMessage(error)}`)
      }
    }
    return entries
  }
}

function findProjectMemoryDirectory(cwd: string, homeDir: string): string {
  let current = resolve(cwd)
  const globalMemoryDirectory = resolve(homeDir, 'memory')
  // The default install's global store must never become a project scope
  // either — even when this store is configured with a different home
  // (SPARK_AGENT_HOME, embedding hosts). Otherwise the ancestor walk on a
  // machine with the desktop installed would read and pollute the real user
  // memory directory.
  const defaultGlobalMemoryDirectory = resolve(homedir(), '.spark-agent', 'memory')
  while (true) {
    const candidate = join(current, '.spark-agent', 'memory')
    // Prefer the nearest existing workspace memory directory. If none exists,
    // the current directory remains the safe and unsurprising write target.
    // Do not mistake a user's global ~/.spark-agent/memory directory for a
    // project scope when the cwd happens to be below a home directory.
    if (
      existsSync(candidate) &&
      !isSameDirectory(candidate, globalMemoryDirectory) &&
      !isSameDirectory(candidate, defaultGlobalMemoryDirectory)
    ) {
      return candidate
    }
    const parent = dirname(current)
    if (parent === current) return join(resolve(cwd), '.spark-agent', 'memory')
    current = parent
  }
}

function parseMemoryFile(
  source: string,
  filePath: string,
  location: MemoryLocation,
): MemoryEntry | undefined {
  const parsed = parseFrontmatter(source)
  const fileName = filePath
    .slice(Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\')) + 1)
    .replace(/\.md$/u, '')
  const id = stringField(parsed.fields.id) ?? fileName
  if (!ID_PATTERN.test(id)) return undefined
  const name = stringField(parsed.fields.name) ?? id
  const description =
    stringField(parsed.fields.description) ?? firstMeaningfulLine(parsed.body) ?? name
  return {
    id,
    scope: location.scope,
    scopeRef: stringField(parsed.fields.scope_ref) ?? location.scopeRef,
    type: memoryType(parsed.fields.type, location.scope),
    name,
    description,
    filePath,
    confidence: normalizeConfidence(numberField(parsed.fields.confidence) ?? 1),
    createdAt: dateField(parsed.fields.created_at) ?? 0,
    updatedAt: dateField(parsed.fields.updated_at) ?? 0,
    hitCount: Math.max(0, Math.floor(numberField(parsed.fields.hit_count) ?? 0)),
    lastHitAt: dateField(parsed.fields.last_hit_at),
    sourceSessionId: nullableString(parsed.fields.source_session_id),
    links: parseLinks(parsed.fields.links),
    archived: booleanField(parsed.fields.archived) ?? false,
    body: parsed.body.trim(),
  }
}

function parseFrontmatter(source: string): {
  readonly fields: Record<string, string>
  readonly body: string
} {
  const normalized = source.replace(/^\uFEFF/u, '').replace(/\r\n?/gu, '\n')
  if (!normalized.startsWith('---\n')) return { fields: {}, body: normalized }
  const end = normalized.indexOf('\n---', 4)
  if (end < 0) return { fields: {}, body: normalized }
  const fields: Record<string, string> = {}
  for (const line of normalized.slice(4, end).split('\n')) {
    const separator = line.indexOf(':')
    if (separator <= 0) continue
    fields[line.slice(0, separator).trim()] = unquote(line.slice(separator + 1).trim())
  }
  return { fields, body: normalized.slice(end + 4).replace(/^\n/u, '') }
}

function renderMemoryFile(entry: MemoryEntry): string {
  return [
    '---',
    `id: ${entry.id}`,
    `scope: ${entry.scope}`,
    `scope_ref: ${entry.scopeRef ?? 'null'}`,
    `type: ${entry.type}`,
    `name: ${entry.name}`,
    `description: ${entry.description}`,
    `confidence: ${entry.confidence}`,
    `created_at: ${new Date(entry.createdAt).toISOString()}`,
    `updated_at: ${new Date(entry.updatedAt).toISOString()}`,
    `hit_count: ${entry.hitCount}`,
    `last_hit_at: ${entry.lastHitAt === null ? 'null' : new Date(entry.lastHitAt).toISOString()}`,
    `source_session_id: ${entry.sourceSessionId ?? 'null'}`,
    `links: [${entry.links.join(', ')}]`,
    `archived: ${entry.archived}`,
    '---',
    '',
    entry.body,
    '',
  ].join('\n')
}

function renderMemoryBlock(entries: readonly MemoryEntry[], cwd: string): string {
  if (entries.length === 0) return ''
  const groups = new Map<MemoryScope, MemoryEntry[]>([
    ['user', []],
    ['project', []],
    ['agent', []],
  ])
  for (const entry of entries) groups.get(entry.scope)?.push(entry)
  const lines = ['# Long-term Memory', '']
  const user = groups.get('user') ?? []
  const project = groups.get('project') ?? []
  const agent = groups.get('agent') ?? []
  if (user.length > 0) {
    lines.push('<user-memory>', ...user.map(renderSummary), '</user-memory>')
  }
  if (project.length > 0) {
    lines.push(
      `<project-memory workspace="${sanitizeInline(cwd)}">`,
      ...project.map(renderSummary),
      '</project-memory>',
    )
  }
  if (agent.length > 0) lines.push('<agent-memory>', ...agent.map(renderSummary), '</agent-memory>')
  lines.push(
    '',
    '摘要只展示按优先级和预算选出的记忆；需要详情时使用 `search_memory` 与 `recall_memory`。',
  )
  return lines.join('\n')
}

function renderSummary(entry: MemoryEntry): string {
  return `- [${entry.id}] ${sanitizeInline(entry.name)} (${entry.type}): ${sanitizeInline(entry.description)}`
}

function compareForInjection(left: MemoryEntry, right: MemoryEntry): number {
  const priority: Readonly<Record<MemoryType, number>> = {
    feedback: 0,
    user: 1,
    project: 2,
    reference: 3,
  }
  return (
    priority[left.type] - priority[right.type] ||
    right.updatedAt - left.updatedAt ||
    left.id.localeCompare(right.id)
  )
}

function scoreEntry(entry: MemoryEntry, terms: readonly string[]): number {
  const name = tokenize(entry.name)
  const description = tokenize(entry.description)
  const body = tokenize(entry.body)
  let score = 0
  for (const term of terms) {
    const nameHits = name.filter((candidate) => candidate.includes(term)).length
    const descriptionHits = description.filter((candidate) => candidate.includes(term)).length
    const bodyHits = body.filter((candidate) => candidate.includes(term)).length
    if (nameHits === 0 && descriptionHits === 0 && bodyHits === 0) return 0
    score += nameHits * 8 + descriptionHits * 4 + Math.min(bodyHits, 5)
  }
  return score * (0.5 + normalizeConfidence(entry.confidence) / 2)
}

function tokenize(value: string): string[] {
  const normalized = value.toLocaleLowerCase().normalize('NFKC')
  const tokens: string[] = []
  for (const segment of normalized.match(
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Letter}\p{Number}]+/gu,
  ) ?? []) {
    if (/^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+$/u.test(segment)) {
      for (const character of segment) tokens.push(character)
    } else {
      tokens.push(segment)
    }
  }
  return [...new Set(tokens)]
}

function estimateTokens(value: string): number {
  return Math.max(1, Math.ceil(value.length / 2))
}

function scopeReference(scope: MemoryScope, agentId: string): string | null {
  return scope === 'user' ? null : scope === 'agent' ? normalizeAgentId(agentId) : null
}

function defaultTypeForScope(scope: MemoryScope): MemoryType {
  return scope === 'project' ? 'project' : 'user'
}

function createMemoryId(scope: MemoryScope): string {
  const prefix = scope === 'user' ? 'usr' : scope === 'project' ? 'prj' : 'agt'
  return `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 16)}`
}

function normalizeAgentId(value: string): string {
  const normalized = value.trim().replace(/[^A-Za-z0-9._-]/gu, '-')
  if (normalized.length === 0) return DEFAULT_AGENT_ID
  return normalized.slice(0, 96)
}

function normalizeBudget(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return DEFAULT_MAX_INJECT_TOKENS
  return Math.min(Math.floor(value), 100_000)
}

function normalizeLimit(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new Error('Memory search limit must be a positive integer')
  return Math.min(value, 100)
}

function normalizeConfidence(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1
}

function requiredSingleLine(value: string, field: string): string {
  const normalized = value.trim().replace(/[\r\n]+/gu, ' ')
  if (normalized.length === 0) throw new Error(`Memory ${field} must not be empty`)
  return normalized
}

function memoryType(value: string | undefined, scope: MemoryScope): MemoryType {
  return value === 'feedback' || value === 'user' || value === 'project' || value === 'reference'
    ? value
    : defaultTypeForScope(scope)
}

function stringField(value: string | undefined): string | undefined {
  if (value === undefined || value === '' || value === 'null') return undefined
  return value
}

function nullableString(value: string | undefined): string | null {
  return value === undefined || value === '' || value === 'null' ? null : value
}

function numberField(value: string | undefined): number | undefined {
  if (value === undefined || value === '' || value === 'null') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function dateField(value: string | undefined): number | null {
  if (value === undefined || value === '' || value === 'null') return null
  const numeric = Number(value)
  if (Number.isFinite(numeric)) return numeric
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

function booleanField(value: string | undefined): boolean | undefined {
  if (value === 'true' || value === '1') return true
  if (value === 'false' || value === '0' || value === 'null') return false
  return undefined
}

function parseLinks(value: string | undefined): readonly string[] {
  if (value === undefined || value === '[]') return []
  return value
    .replace(/^\[/u, '')
    .replace(/\]$/u, '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function firstMeaningfulLine(value: string): string | undefined {
  return value
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0)
}

function sanitizeInline(value: string): string {
  return value
    .replace(/[<>]/gu, (character) => (character === '<' ? '‹' : '›'))
    .replace(/[\r\n]+/gu, ' ')
}

function unquote(value: string): string {
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    return value.slice(1, -1)
  }
  return value
}

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
