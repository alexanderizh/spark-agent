import { createHash } from 'node:crypto'
import { mkdir, open, readFile, readdir, realpath, rename, stat, unlink } from 'node:fs/promises'
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path'
import type {
  ConnectorRuntimeDescriptor,
  RuntimeConnectRequest,
  RuntimeToolDefinition,
} from '@spark/protocol'
import { RuntimeError } from '../runtime-errors.js'
import type {
  ConnectorRuntimeAdapter,
  RuntimeConnectContext,
  RuntimeContext,
  RuntimeConnectResult,
} from '../runtime-types.js'

const MAX_NOTE_BYTES = 2 * 1024 * 1024

export class ObsidianRuntimeAdapter implements ConnectorRuntimeAdapter {
  readonly descriptor: ConnectorRuntimeDescriptor = {
    id: 'obsidian',
    pluginId: 'spark.obsidian',
    provider: 'obsidian',
    displayName: 'Obsidian Vault',
    description: '在用户选择的本地 Vault 内安全读取、搜索和整理 Markdown 笔记。',
    icon: 'obsidian',
    toolNamespace: 'obsidian',
    accountMode: 'multiple',
    execution: { type: 'builtin', adapter: 'obsidian' },
    authMethods: ['none'],
    capabilities: [
      {
        id: 'vault_read',
        label: '读取笔记',
        description: '读取 Markdown、标签和链接。',
        enabledByDefault: true,
      },
      {
        id: 'vault_write',
        label: '编辑笔记',
        description: '创建、更新、移动和归档笔记。',
        enabledByDefault: false,
      },
    ],
  }

  async connect(
    _ctx: RuntimeConnectContext,
    request: RuntimeConnectRequest,
  ): Promise<RuntimeConnectResult> {
    const vaultPath =
      typeof request.config?.vaultPath === 'string' ? request.config.vaultPath.trim() : ''
    if (!vaultPath) throw new RuntimeError('AUTH_REQUIRED', 'Obsidian Vault path is required')
    const root = await realVaultRoot(vaultPath)
    const externalAccountId = createHash('sha256').update(root).digest('hex').slice(0, 32)
    return {
      externalAccountId: `vault:${externalAccountId}`,
      displayName: root.split(/[\\/]/).pop() || 'Obsidian Vault',
      config: { ...(request.config ?? {}), vaultPath: root },
      resourceScope: { vaultPath: [root] },
    }
  }

  async healthCheck(ctx: RuntimeContext) {
    const startedAt = performance.now()
    await realVaultRoot(String(ctx.account.config.vaultPath ?? ''))
    return {
      status: 'healthy' as const,
      checkedAt: new Date().toISOString(),
      latencyMs: Math.round(performance.now() - startedAt),
    }
  }

  async listTools(_ctx: RuntimeContext): Promise<RuntimeToolDefinition[]> {
    return [
      obsidianTool(
        'list_vaults',
        '列出 Vault',
        '列出当前已授权的 Vault 账号。',
        ['vault_read'],
        'read',
        'read',
        'safe',
      ),
      obsidianTool(
        'search_notes',
        '搜索 Vault',
        '在 Markdown 正文、标签和链接中搜索。',
        ['vault_read'],
        'read',
        'read',
        'safe',
      ),
      obsidianTool(
        'get_backlinks',
        '读取反向链接',
        '查找引用指定笔记的 Markdown 笔记。',
        ['vault_read'],
        'read',
        'read',
        'safe',
      ),
      obsidianTool(
        'get_note',
        '读取笔记',
        '读取指定 Markdown 笔记，并返回内容摘要。',
        ['vault_read'],
        'read',
        'read',
        'safe',
      ),
      obsidianTool(
        'create_note',
        '创建笔记',
        '在 Vault 中创建 Markdown 笔记，需要动作确认。',
        ['vault_write'],
        'high-write',
        'create',
        'keyed',
      ),
      obsidianTool(
        'update_note',
        '更新笔记',
        '按 expectedHash 更新 Markdown 笔记，避免覆盖并发修改。',
        ['vault_write'],
        'high-write',
        'update',
        'keyed',
      ),
      obsidianTool(
        'move_note',
        '移动笔记',
        '移动 Markdown 笔记，需要动作确认。',
        ['vault_write'],
        'high-write',
        'update',
        'keyed',
      ),
      obsidianTool(
        'trash_note',
        '归档笔记',
        '把笔记移动到 Vault 的 .trash 目录，不做永久删除。',
        ['vault_write'],
        'destructive',
        'delete',
        'unsafe',
      ),
    ]
  }

  async invokeTool(ctx: RuntimeContext, toolName: string, input: unknown): Promise<unknown> {
    const params = objectInput(input)
    const root = await realVaultRoot(String(ctx.account.config.vaultPath ?? ''))
    switch (toolName) {
      case 'list_vaults':
        return { vaults: [{ id: ctx.account.externalAccountId, name: basename(root) }] }
      case 'list_files':
        return { files: await listMarkdownFiles(root) }
      case 'search':
      case 'search_notes':
        return this.search(root, requiredString(params, 'query'))
      case 'get_backlinks':
        return this.backlinks(root, requiredString(params, 'path'))
      case 'read_note':
      case 'get_note':
        return this.readNote(root, requiredString(params, 'path'))
      case 'create_note':
        return this.createNote(
          root,
          requiredString(params, 'path'),
          optionalString(params, 'content') ?? '',
        )
      case 'update_note':
        return this.updateNote(
          root,
          requiredString(params, 'path'),
          requiredString(params, 'content'),
          optionalString(params, 'expectedHash'),
        )
      case 'move_note':
        return this.moveNote(
          root,
          requiredString(params, 'path'),
          requiredString(params, 'destination'),
        )
      case 'trash_note':
        return this.trashNote(root, requiredString(params, 'path'))
      default:
        throw new RuntimeError(
          'RUNTIME_UNAVAILABLE',
          `Unsupported Obsidian runtime tool: ${toolName}`,
        )
    }
  }

  private async search(
    root: string,
    query: string,
  ): Promise<Array<{ path: string; matches: string[] }>> {
    const normalized = query.toLowerCase()
    const results: Array<{ path: string; matches: string[] }> = []
    for (const path of await listMarkdownFiles(root)) {
      const absolute = safePath(root, path)
      const content = await readBounded(absolute)
      const lines = content.split(/\r?\n/).filter((line) => line.toLowerCase().includes(normalized))
      if (lines.length > 0) results.push({ path, matches: lines.slice(0, 10) })
      if (results.length >= 100) break
    }
    return results
  }

  private async backlinks(
    root: string,
    path: string,
  ): Promise<Array<{ path: string; matches: string[] }>> {
    const target = normalizeLinkTarget(path)
    const results: Array<{ path: string; matches: string[] }> = []
    for (const candidate of await listMarkdownFiles(root)) {
      if (normalizeLinkTarget(candidate) === target) continue
      const absolute = await secureExistingPath(root, safePath(root, candidate))
      const content = await readBounded(absolute)
      const matches = content
        .split(/\r?\n/)
        .filter((line) =>
          Array.from(line.matchAll(/\[\[([^\]]+)\]\]/g)).some(
            (match) => normalizeLinkTarget(match[1] ?? '') === target,
          ),
        )
      if (matches.length > 0) results.push({ path: candidate, matches: matches.slice(0, 10) })
      if (results.length >= 100) break
    }
    return results
  }

  private async readNote(
    root: string,
    path: string,
  ): Promise<{ path: string; content: string; sha256: string }> {
    const absolute = await secureExistingPath(root, safePath(root, path))
    const content = await readBounded(absolute)
    return { path: relative(root, absolute), content, sha256: sha256(content) }
  }

  private async createNote(
    root: string,
    path: string,
    content: string,
  ): Promise<{ path: string; sha256: string }> {
    const absolute = safePath(root, path)
    await ensureMarkdown(absolute)
    await mkdir(dirname(absolute), { recursive: true })
    await secureParentPath(root, absolute)
    try {
      await stat(absolute)
      throw new RuntimeError('CONFLICT', 'Obsidian note already exists')
    } catch (error) {
      if (error instanceof RuntimeError) throw error
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    await atomicWrite(absolute, content)
    return { path: relative(root, absolute), sha256: sha256(content) }
  }

  private async updateNote(
    root: string,
    path: string,
    content: string,
    expectedHash?: string,
  ): Promise<{ path: string; sha256: string }> {
    const absolute = await secureExistingPath(root, safePath(root, path))
    const current = await readBounded(absolute)
    if (expectedHash != null && sha256(current) !== expectedHash)
      throw new RuntimeError('CONFLICT', 'Obsidian note changed since it was read')
    await atomicWrite(absolute, content)
    return { path: relative(root, absolute), sha256: sha256(content) }
  }

  private async moveNote(
    root: string,
    path: string,
    destination: string,
  ): Promise<{ path: string }> {
    const source = await secureExistingPath(root, safePath(root, path))
    const target = safePath(root, destination)
    await ensureMarkdown(target)
    await mkdir(dirname(target), { recursive: true })
    await secureParentPath(root, target)
    try {
      await stat(target)
      throw new RuntimeError('CONFLICT', 'Obsidian destination already exists')
    } catch (error) {
      if (error instanceof RuntimeError) throw error
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    await rename(source, target)
    return { path: relative(root, target) }
  }

  private async trashNote(root: string, path: string): Promise<{ path: string }> {
    const source = await secureExistingPath(root, safePath(root, path))
    const trashRoot = join(root, '.trash', 'Spark')
    await mkdir(trashRoot, { recursive: true })
    await secureParentPath(root, join(trashRoot, 'placeholder.md'))
    const target = join(trashRoot, `${Date.now()}-${source.split(/[\\/]/).pop() ?? 'note.md'}`)
    await rename(source, target)
    return { path: relative(root, target) }
  }
}

function obsidianTool(
  name: string,
  title: string,
  description: string,
  requiredCapabilities: string[],
  risk: RuntimeToolDefinition['risk'],
  effect: RuntimeToolDefinition['effect'],
  idempotency: RuntimeToolDefinition['idempotency'],
): RuntimeToolDefinition {
  return {
    name,
    title,
    description,
    inputSchema: { type: 'object', additionalProperties: true },
    requiredCapabilities,
    risk,
    effect,
    idempotency,
  }
}
async function realVaultRoot(value: string): Promise<string> {
  if (!value) throw new RuntimeError('RUNTIME_UNAVAILABLE', 'Obsidian Vault path is empty')
  const root = resolve(value)
  try {
    const canonicalRoot = await realpath(root)
    const info = await stat(canonicalRoot)
    if (!info.isDirectory())
      throw new RuntimeError('RUNTIME_UNAVAILABLE', 'Obsidian Vault path is not a directory')
    return canonicalRoot
  } catch (error) {
    if (error instanceof RuntimeError) throw error
    throw new RuntimeError('RUNTIME_UNAVAILABLE', 'Obsidian Vault is not accessible')
  }
}
function safePath(root: string, input: string): string {
  const normalized = input.replace(/\\/g, '/')
  if (
    !normalized ||
    normalized.includes('\0') ||
    normalized.startsWith('/') ||
    normalized.split('/').includes('..')
  )
    throw new RuntimeError('RESOURCE_OUT_OF_SCOPE', 'Vault path escapes the selected root')
  const absolute = resolve(root, normalized)
  if (absolute !== root && !absolute.startsWith(`${root}${sep}`))
    throw new RuntimeError('RESOURCE_OUT_OF_SCOPE', 'Vault path escapes the selected root')
  const parts = relative(root, absolute).split(sep)
  if (parts.some((part) => part === '.obsidian' || part === '.trash' || part.startsWith('.')))
    throw new RuntimeError(
      'RESOURCE_OUT_OF_SCOPE',
      'Hidden Obsidian metadata paths are not exposed',
    )
  return absolute
}
function normalizeLinkTarget(value: string): string {
  const [target = ''] = value.trim().replace(/\\/g, '/').split('|', 1)
  return target
    .replace(/^\.?\//, '')
    .replace(/\.md$/i, '')
    .toLowerCase()
}
async function secureExistingPath(root: string, path: string): Promise<string> {
  try {
    const canonical = await realpath(path)
    if (!isWithinRoot(root, canonical))
      throw new RuntimeError('RESOURCE_OUT_OF_SCOPE', 'Vault symlink escapes the selected root')
    return canonical
  } catch (error) {
    if (error instanceof RuntimeError) throw error
    throw new RuntimeError('RUNTIME_UNAVAILABLE', 'Obsidian note is not accessible')
  }
}
async function secureParentPath(root: string, path: string): Promise<void> {
  try {
    const canonicalParent = await realpath(dirname(path))
    if (!isWithinRoot(root, canonicalParent))
      throw new RuntimeError('RESOURCE_OUT_OF_SCOPE', 'Vault symlink escapes the selected root')
  } catch (error) {
    if (error instanceof RuntimeError) throw error
    throw new RuntimeError('RUNTIME_UNAVAILABLE', 'Obsidian note directory is not accessible')
  }
}
function isWithinRoot(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${sep}`)
}
async function listMarkdownFiles(root: string, current = root): Promise<string[]> {
  const entries = await readdir(current, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === '.obsidian' || entry.name === '.trash')
      continue
    const absolute = join(current, entry.name)
    if (entry.isDirectory()) files.push(...(await listMarkdownFiles(root, absolute)))
    else if (entry.isFile() && extname(entry.name).toLowerCase() === '.md')
      files.push(relative(root, absolute))
    if (files.length >= 5_000) break
  }
  return files.slice(0, 5_000)
}
async function readBounded(path: string): Promise<string> {
  const info = await stat(path)
  if (!info.isFile() || info.size > MAX_NOTE_BYTES)
    throw new RuntimeError('RUNTIME_UNAVAILABLE', 'Obsidian note exceeds the runtime size limit')
  return readFile(path, 'utf8')
}
async function ensureMarkdown(path: string): Promise<void> {
  if (extname(path).toLowerCase() !== '.md')
    throw new RuntimeError('INVALID_PROVIDER_RESPONSE', 'Only Markdown notes are supported')
}
async function atomicWrite(path: string, content: string): Promise<void> {
  if (Buffer.byteLength(content, 'utf8') > MAX_NOTE_BYTES)
    throw new RuntimeError('RUNTIME_UNAVAILABLE', 'Obsidian note exceeds the runtime size limit')
  await mkdir(dirname(path), { recursive: true })
  const temp = `${path}.spark-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.tmp`
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    handle = await open(temp, 'wx', 0o600)
    await handle.writeFile(content, 'utf8')
    await handle.sync()
    await handle.close()
    handle = undefined
    await rename(temp, path)
  } finally {
    await handle?.close().catch(() => undefined)
    await unlink(temp).catch(() => undefined)
  }
}
function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}
function objectInput(value: unknown): Record<string, unknown> {
  if (value == null || typeof value !== 'object' || Array.isArray(value))
    throw new RuntimeError('INVALID_PROVIDER_RESPONSE', 'Tool input must be an object')
  return value as Record<string, unknown>
}
function requiredString(value: Record<string, unknown>, key: string): string {
  const result = typeof value[key] === 'string' ? value[key].trim() : ''
  if (!result) throw new RuntimeError('INVALID_PROVIDER_RESPONSE', `Missing parameter: ${key}`)
  return result
}
function optionalString(value: Record<string, unknown>, key: string): string | undefined {
  return typeof value[key] === 'string' && value[key].trim().length > 0
    ? value[key].trim()
    : undefined
}
