import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import type { AgentEvent } from '@spark/protocol'
import { parseSkillDocument, type SkillDocumentIssueCode } from '../skills/skill-document.js'

export interface CodexSkillIssue {
  path: string
  code: SkillDocumentIssueCode | 'unreadable_skill'
  message: string
}

export interface CodexSkillConfigEntry {
  path?: string
  name?: string
  enabled?: boolean
  bundled?: boolean
  include_instructions?: boolean
  max_context_tokens?: number
}

export interface CodexSkillIsolation {
  issues: CodexSkillIssue[]
  configEntries: CodexSkillConfigEntry[]
}

const skillInspectionCache = new Map<
  string,
  { mtimeMs: number; size: number; issue: CodexSkillIssue | null }
>()

/**
 * Find malformed native Codex skills and build a non-persistent config overlay
 * that disables only those files for the current runtime invocation.
 *
 * Existing `skills.config` entries are carried forward because a turn-level
 * array override replaces lower-precedence arrays in Codex config. Without the
 * merge, Spark would accidentally re-enable skills the user disabled globally.
 */
export function resolveCodexSkillIsolation(
  workspaceRootPath: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): CodexSkillIsolation {
  const issues = inspectNativeCodexSkills(workspaceRootPath)
  if (issues.length === 0) return { issues, configEntries: [] }

  const existingEntries = readExistingSkillConfigEntries(env)
  const bySelector = new Map<string, CodexSkillConfigEntry>()
  for (const entry of existingEntries) bySelector.set(configEntryKey(entry), entry)
  for (const issue of issues) {
    bySelector.set(`path:${resolve(issue.path)}`, { path: resolve(issue.path), enabled: false })
  }
  return { issues, configEntries: [...bySelector.values()] }
}

export function buildCodexSkillConfigOverride(
  isolation: CodexSkillIsolation,
): Record<string, unknown> {
  return isolation.configEntries.length > 0 ? { skills: { config: isolation.configEntries } } : {}
}

export function buildCodexSkillConfigTomlOverride(isolation: CodexSkillIsolation): string | null {
  if (isolation.configEntries.length === 0) return null
  const inlineTables = isolation.configEntries.map((entry) => {
    const values = Object.entries(entry).map(
      ([key, value]) => `${key}=${serializeTomlScalar(value)}`,
    )
    return `{${values.join(',')}}`
  })
  return `skills.config=[${inlineTables.join(',')}]`
}

export function createCodexSkillIsolationWarning(
  isolation: CodexSkillIsolation,
  base: {
    id: string
    sessionId: string
    turnId: string
    timestamp: string
    seq: number
  },
): Extract<AgentEvent, { type: 'runtime_signal' }> | null {
  if (isolation.issues.length === 0) return null
  return {
    ...base,
    type: 'runtime_signal',
    signal: 'notification',
    level: 'warning',
    title: '已隔离无效 Skill',
    message: `${isolation.issues.length} 个 SKILL.md 格式无效，已仅在本轮禁用；其他 Skill 和会话能力可继续使用。`,
    code: 'INVALID_SKILL_ISOLATED',
    retryable: false,
    actionHint: '修复列出的 YAML frontmatter 后重试，应用无需退出。',
    details: isolation.issues.map((issue) => ({ label: issue.path, value: issue.message })),
  }
}

function inspectNativeCodexSkills(workspaceRootPath: string | undefined): CodexSkillIssue[] {
  const issues: CodexSkillIssue[] = []
  for (const skillFilePath of discoverNativeCodexSkillFiles(workspaceRootPath)) {
    const stat = safeStat(skillFilePath)
    if (stat == null) continue
    const cached = skillInspectionCache.get(skillFilePath)
    if (cached?.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
      if (cached.issue != null) issues.push(cached.issue)
      continue
    }
    let raw: string
    try {
      raw = readFileSync(skillFilePath, 'utf-8')
    } catch (error) {
      const issue: CodexSkillIssue = {
        path: skillFilePath,
        code: 'unreadable_skill',
        message: `无法读取 SKILL.md：${error instanceof Error ? error.message : String(error)}`,
      }
      skillInspectionCache.set(skillFilePath, { mtimeMs: stat.mtimeMs, size: stat.size, issue })
      issues.push(issue)
      continue
    }
    const parsed = parseSkillDocument(raw)
    if (!parsed.valid) {
      const issue: CodexSkillIssue = {
        path: skillFilePath,
        code: parsed.issue.code,
        message: parsed.issue.message,
      }
      skillInspectionCache.set(skillFilePath, { mtimeMs: stat.mtimeMs, size: stat.size, issue })
      issues.push(issue)
    } else {
      skillInspectionCache.set(skillFilePath, {
        mtimeMs: stat.mtimeMs,
        size: stat.size,
        issue: null,
      })
    }
  }
  return issues
}

function discoverNativeCodexSkillFiles(workspaceRootPath: string | undefined): string[] {
  const roots = new Set<string>([join(homedir(), '.agents', 'skills')])
  if (process.platform !== 'win32') roots.add('/etc/codex/skills')
  for (const root of projectSkillRoots(workspaceRootPath)) roots.add(root)

  const files = new Set<string>()
  for (const root of roots) {
    if (!safeStat(root)?.isDirectory()) continue
    const direct = join(root, 'SKILL.md')
    if (existsSync(direct)) files.add(resolve(direct))
    for (const entry of safeReadDir(root)) {
      const skillDir = join(root, entry)
      if (!safeStat(skillDir)?.isDirectory()) continue
      const skillFile = join(skillDir, 'SKILL.md')
      if (existsSync(skillFile)) files.add(resolve(skillFile))
    }
  }
  return [...files].sort((left, right) => left.localeCompare(right))
}

function projectSkillRoots(workspaceRootPath: string | undefined): string[] {
  if (workspaceRootPath == null || workspaceRootPath.trim().length === 0) return []
  const workspace = resolve(workspaceRootPath)
  if (!safeStat(workspace)?.isDirectory()) return []

  const repositoryRoot = findRepositoryRoot(workspace)
  if (repositoryRoot == null) return [join(workspace, '.agents', 'skills')]

  const roots: string[] = []
  let current = workspace
  while (true) {
    roots.push(join(current, '.agents', 'skills'))
    if (current === repositoryRoot) break
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return roots
}

function findRepositoryRoot(start: string): string | null {
  let current = start
  while (true) {
    if (existsSync(join(current, '.git'))) return current
    const parent = dirname(current)
    if (parent === current) return null
    current = parent
  }
}

function readExistingSkillConfigEntries(env: NodeJS.ProcessEnv): CodexSkillConfigEntry[] {
  const codexHome = resolve(env.CODEX_HOME?.trim() || join(homedir(), '.codex'))
  // 只合并 Codex 在任何项目信任状态下都会加载的受信层级（系统级 + 用户级）。
  // 项目级 .codex/config.toml 仅在项目受 Codex 信任时才被加载；Spark 无法可靠
  // 复刻该信任判定，把它合入 turn 级覆盖会把不受信的项目配置提权为受信配置。
  const files = [
    ...(process.platform === 'win32' ? [] : ['/etc/codex/config.toml']),
    join(codexHome, 'config.toml'),
  ]
  const bySelector = new Map<string, CodexSkillConfigEntry>()
  for (const file of files) {
    for (const entry of readSkillConfigEntries(file)) {
      bySelector.set(configEntryKey(entry), entry)
    }
  }
  return [...bySelector.values()]
}

function readSkillConfigEntries(filePath: string): CodexSkillConfigEntry[] {
  let raw: string
  try {
    raw = readFileSync(filePath, 'utf-8')
  } catch {
    return []
  }

  const configDir = dirname(filePath)
  const entries: CodexSkillConfigEntry[] = []
  let current: Record<string, string | number | boolean> | null = null
  const commit = (): void => {
    if (current == null) return
    const entry = normalizeSkillConfigEntry(current, configDir)
    current = null
    if (entry != null) entries.push(entry)
  }

  for (const rawLine of raw.replace(/\r\n/g, '\n').split('\n')) {
    // 先按字符串边界剥掉行尾注释，再解析结构：`#` 在引号内是数据不是注释。
    const line = stripTomlComment(rawLine).trim()
    if (line === '[[skills.config]]') {
      commit()
      current = {}
      continue
    }
    if (line.startsWith('[')) {
      commit()
      current = null
      continue
    }
    if (line.length === 0) continue
    if (current == null) {
      // config.toml 的 inline 数组写法 `skills.config = [{...}, ...]` 与
      // `[[skills.config]]` 数组表语义等价，两种都要读：漏读任何一种都会让
      // 该形式下用户的禁用条目被 turn 级数组覆盖静默撤销。
      const inline = /^skills\.config\s*=\s*(\[.*\])$/.exec(line)
      if (inline == null) continue
      const arrayBody = (inline[1] ?? '').trim().replace(/^\[/, '').replace(/\]$/, '')
      for (const table of splitTopLevel(arrayBody, ',')) {
        const fields = parseInlineTableFields(table)
        if (fields == null) continue
        const entry = normalizeSkillConfigEntry(fields, configDir)
        if (entry != null) entries.push(entry)
      }
      continue
    }
    const assignment = /^([A-Za-z0-9_-]+)\s*=\s*(.+)$/.exec(line)
    if (assignment == null) continue
    const value = parseTomlScalar(assignment[2] ?? '')
    if (value != null) current[assignment[1] ?? ''] = value
  }
  commit()
  return entries
}

function normalizeSkillConfigEntry(
  fields: Record<string, string | number | boolean>,
  configDir: string,
): CodexSkillConfigEntry | null {
  const path = typeof fields.path === 'string' ? fields.path.trim() : ''
  const name = typeof fields.name === 'string' ? fields.name.trim() : ''
  if ((path.length === 0) === (name.length === 0)) return null
  return {
    ...(path.length > 0 ? { path: resolve(configDir, path) } : { name }),
    ...(typeof fields.enabled === 'boolean' ? { enabled: fields.enabled } : {}),
    ...(typeof fields.bundled === 'boolean' ? { bundled: fields.bundled } : {}),
    ...(typeof fields.include_instructions === 'boolean'
      ? { include_instructions: fields.include_instructions }
      : {}),
    ...(typeof fields.max_context_tokens === 'number'
      ? { max_context_tokens: fields.max_context_tokens }
      : {}),
  }
}

/** Strip a trailing TOML comment while respecting basic ("…") and literal ('…') strings. */
function stripTomlComment(line: string): string {
  let inBasicString = false
  let inLiteralString = false
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (inBasicString) {
      if (char === '\\') index += 1
      else if (char === '"') inBasicString = false
      continue
    }
    if (inLiteralString) {
      if (char === "'") inLiteralString = false
      continue
    }
    if (char === '"') inBasicString = true
    else if (char === "'") inLiteralString = true
    else if (char === '#') return line.slice(0, index)
  }
  return line
}

/** Split on top-level separators, ignoring separators inside strings or nested brackets. */
function splitTopLevel(input: string, separator: string): string[] {
  const parts: string[] = []
  let start = 0
  let depth = 0
  let inBasicString = false
  let inLiteralString = false
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]
    if (inBasicString) {
      if (char === '\\') index += 1
      else if (char === '"') inBasicString = false
      continue
    }
    if (inLiteralString) {
      if (char === "'") inLiteralString = false
      continue
    }
    if (char === '"') inBasicString = true
    else if (char === "'") inLiteralString = true
    else if (char === '[' || char === '{') depth += 1
    else if (char === ']' || char === '}') depth -= 1
    else if (char === separator && depth === 0) {
      parts.push(input.slice(start, index))
      start = index + 1
    }
  }
  parts.push(input.slice(start))
  return parts.map((part) => part.trim()).filter((part) => part.length > 0)
}

function parseInlineTableFields(raw: string): Record<string, string | number | boolean> | null {
  const trimmed = raw.trim()
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null
  const fields: Record<string, string | number | boolean> = {}
  for (const pair of splitTopLevel(trimmed.slice(1, -1), ',')) {
    const assignment = /^([A-Za-z0-9_-]+)\s*=\s*(.+)$/.exec(pair)
    if (assignment == null) continue
    const value = parseTomlScalar(assignment[2] ?? '')
    if (value != null) fields[assignment[1] ?? ''] = value
  }
  return Object.keys(fields).length > 0 ? fields : null
}

function parseTomlScalar(raw: string): string | number | boolean | null {
  const value = raw.trim()
  if (value === 'true') return true
  if (value === 'false') return false
  if (/^-?\d+$/.test(value)) return Number(value)
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      const parsed = JSON.parse(value)
      return typeof parsed === 'string' ? parsed : null
    } catch {
      return null
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1)
  return null
}

function configEntryKey(entry: CodexSkillConfigEntry): string {
  return entry.path != null ? `path:${resolve(entry.path)}` : `name:${entry.name ?? ''}`
}

function serializeTomlScalar(value: string | number | boolean): string {
  if (typeof value === 'string') return JSON.stringify(value)
  return String(value)
}

function safeReadDir(path: string): string[] {
  try {
    return readdirSync(path).sort((left, right) => left.localeCompare(right))
  } catch {
    return []
  }
}

function safeStat(path: string) {
  try {
    return statSync(path)
  } catch {
    return null
  }
}
