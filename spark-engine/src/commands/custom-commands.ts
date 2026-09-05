import { open, readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, relative, resolve } from 'node:path'

/**
 * Prompt-based custom slash commands, mirroring Claude Code's
 * `.claude/commands/*.md`: each Markdown file becomes `/name`, project files
 * override user files with the same name, and the body supports
 * `$ARGUMENTS` / `$1`..`$9` substitution.
 */
export interface CustomCommand {
  readonly name: string
  readonly description: string
  readonly scope: 'user' | 'project'
  readonly filePath: string
  readonly template: string
}

export interface LoadCustomCommandsOptions {
  readonly cwd: string
  /** Directory holding the user-scope `commands/` folder; defaults to the OS home's `.spark`. */
  readonly userDir?: string
  readonly maxFileBytes?: number
  /** Full builtin names (`/help`) whose meaning custom files must not shadow. */
  readonly reservedNames?: readonly string[]
}

const DEFAULT_MAX_FILE_BYTES = 64 * 1024
const MAX_COMMANDS = 256
const NAME_PATTERN = /^[a-z0-9][a-z0-9/-]*$/i

export async function loadCustomCommands(
  options: LoadCustomCommandsOptions,
): Promise<readonly CustomCommand[]> {
  const userDir = resolve(options.userDir ?? resolve(homedir(), '.spark'))
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES
  const reserved = new Set(options.reservedNames ?? [])
  const roots: readonly { dir: string; scope: 'user' | 'project' }[] = [
    { dir: join(userDir, 'commands'), scope: 'user' },
    { dir: join(resolve(options.cwd), '.spark', 'commands'), scope: 'project' },
  ]
  const byName = new Map<string, CustomCommand>()
  for (const root of roots) {
    for (const file of await listMarkdownFiles(root.dir)) {
      if (byName.size >= MAX_COMMANDS) break
      const name = toCommandName(root.dir, file)
      if (!NAME_PATTERN.test(name) || reserved.has(`/${name}`)) continue
      let template: string
      try {
        template = await readHead(file, maxFileBytes)
      } catch {
        continue
      }
      if (!template.trim()) continue
      const parsed = parseCommandFile(template)
      byName.set(name, {
        name,
        description: parsed.description,
        scope: root.scope,
        filePath: file,
        template: parsed.template,
      })
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/** Splits `/name rest...` and resolves the name against the loaded commands. */
export function matchCustomCommand(
  input: string,
  commands: readonly CustomCommand[],
): { readonly command: CustomCommand; readonly args: string } | undefined {
  const trimmed = input.trim()
  if (!trimmed.startsWith('/')) return undefined
  const withoutSlash = trimmed.slice(1)
  const boundary = withoutSlash.search(/\s/)
  const name = boundary < 0 ? withoutSlash : withoutSlash.slice(0, boundary)
  const args = boundary < 0 ? '' : withoutSlash.slice(boundary + 1).trim()
  const command = commands.find((candidate) => candidate.name === name)
  if (command === undefined) return undefined
  return { command, args }
}

/**
 * Substitutes `$ARGUMENTS` with the whole argument string and `$1`..`$9` with
 * whitespace-split positional words in a single pass (so expanded values are
 * never re-substituted). When the template declares no placeholder and
 * arguments exist, they are appended after the template.
 */
export function expandCustomCommand(command: CustomCommand, argsString: string): string {
  const trimmed = argsString.trim()
  const positional = trimmed === '' ? [] : trimmed.split(/\s+/)
  let used = false
  const expanded = command.template.replace(
    /\$ARGUMENTS|\$([1-9])/g,
    (match: string, digit: string | undefined) => {
      used = true
      if (digit !== undefined) return positional[Number(digit) - 1] ?? ''
      return trimmed
    },
  )
  if (used || trimmed === '') return expanded
  return `${expanded.trimEnd()}\n\n${trimmed}`
}

async function listMarkdownFiles(dir: string): Promise<readonly string[]> {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true, recursive: true })
  } catch {
    return []
  }
  const files: string[] = []
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue
    files.push(join(entry.parentPath, entry.name))
  }
  return files
}

function toCommandName(rootDir: string, filePath: string): string {
  return relative(rootDir, filePath)
    .replaceAll('\\', '/')
    .replace(/\.md$/i, '')
    .toLowerCase()
}

interface ParsedCommandFile {
  readonly description: string
  readonly template: string
}

/** Recognizes a leading `---` frontmatter block; only `description` is read. */
function parseCommandFile(content: string): ParsedCommandFile {
  const normalized = content.replaceAll('\r\n', '\n')
  if (!normalized.startsWith('---\n')) return { description: '', template: normalized }
  const end = normalized.indexOf('\n---', 4)
  if (end < 0) return { description: '', template: normalized }
  const header = normalized.slice(4, end)
  const template = normalized.slice(end + 4).replace(/^\n/, '')
  let description = ''
  for (const line of header.split('\n')) {
    const match = /^description:\s*(.*)$/.exec(line.trim())
    const value = match?.[1]
    if (value !== undefined) description = stripQuotes(value.trim())
  }
  return { description, template }
}

function stripQuotes(value: string): string {
  if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
    return value.slice(1, -1)
  }
  return value
}

async function readHead(path: string, maxBytes: number): Promise<string> {
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
