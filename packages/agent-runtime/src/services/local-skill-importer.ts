import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import type { SkillCreateRequest } from '@spark/protocol'

export type LocalSkillSource = 'claude' | 'codex' | 'agents' | 'bundled' | 'linked' | 'custom'

export interface LocalSkillCandidate {
  id: string
  name: string
  description: string
  source: LocalSkillSource
  rootPath: string
  skillFilePath: string
}

const SOURCE_LABELS: Record<LocalSkillSource, string> = {
  claude: 'Claude 本地',
  codex: 'Codex 本地',
  agents: 'Agents 本地',
  bundled: '应用内置',
  linked: '软链接',
  custom: '本地',
}

export function defaultLocalSkillRoots(): string[] {
  const home = homedir()
  return [
    join(home, '.claude', 'skills'),
    join(home, '.codex', 'skills'),
    join(home, '.agents', 'skills'),
  ]
}

export function detectLocalSkills(searchRoots: string[] = defaultLocalSkillRoots()): LocalSkillCandidate[] {
  const candidates: LocalSkillCandidate[] = []
  for (const root of searchRoots) {
    if (!existsSync(root)) continue
    const rootStat = safeStat(root)
    if (!rootStat?.isDirectory()) continue

    const directSkillFile = join(root, 'SKILL.md')
    if (existsSync(directSkillFile)) {
      candidates.push(toCandidate(root, inferSource(root)))
      continue
    }

    for (const entry of readdirSync(root)) {
      const dir = join(root, entry)
      // 支持软链接目录
      const stat = safeLstat(dir)
      if (!stat) continue
      // 跳过非目录（包括非目录类型的链接）
      if (stat.isSymbolicLink()) {
        const realStat = safeStat(dir)
        if (!realStat?.isDirectory()) continue
      } else if (!stat.isDirectory()) {
        continue
      }
      const skillFile = join(dir, 'SKILL.md')
      if (!existsSync(skillFile)) continue
      const source = isSymlink(dir) ? 'linked' : inferSource(root)
      candidates.push(toCandidate(dir, source))
    }
  }
  return candidates.sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * 从应用内置 skills 目录扫描所有技能
 *
 * @param bundledDir 内置 skills 目录（dev: resources/skills，prod: resourcesPath/skills）
 */
export function detectBundledSkills(bundledDir: string): LocalSkillCandidate[] {
  if (!existsSync(bundledDir)) return []
  const rootStat = safeStat(bundledDir)
  if (!rootStat?.isDirectory()) return []

  const candidates: LocalSkillCandidate[] = []
  for (const entry of readdirSync(bundledDir)) {
    const dir = join(bundledDir, entry)
    const stat = safeStat(dir)
    if (!stat?.isDirectory()) continue
    const skillFile = join(dir, 'SKILL.md')
    if (!existsSync(skillFile)) continue
    candidates.push(toCandidate(dir, 'bundled'))
  }
  return candidates.sort((a, b) => a.name.localeCompare(b.name))
}

export function importLocalSkillDirectory(directoryPath: string, source: LocalSkillSource = inferSource(directoryPath)): SkillCreateRequest {
  const rootPath = resolve(directoryPath)
  const skillFilePath = join(rootPath, 'SKILL.md')
  if (!existsSync(skillFilePath)) {
    throw new Error(`SKILL.md not found in ${rootPath}`)
  }

  const parsed = parseSkillFile(skillFilePath, basename(rootPath))
  const manifest = loadManifestJson(rootPath)

  return {
    id: manifest?.id ?? `local:${source}:${hashPath(rootPath)}`,
    scope: source === 'bundled' ? 'system' : 'user',
    name: parsed.name,
    version: parsed.version,
    rootPath,
    manifestJson: JSON.stringify({
      desc: parsed.description,
      description: parsed.description,
      source: SOURCE_LABELS[source],
      author: parsed.author,
      category: parsed.category,
      tags: parsed.tags,
      systemPrompt: parsed.body,
      requiredTools: manifest?.requiredTools ?? parsed.requiredTools,
      parameters: manifest?.parameters ?? [],
      importedFrom: source,
      skillFilePath,
    }),
    enabled: true,
  }
}

/**
 * 导入单个文件作为 Skill（SKILL.md 或 Markdown 文件）
 */
export function importLocalSkillFile(filePath: string): SkillCreateRequest {
  const resolvedPath = resolve(filePath)
  if (!existsSync(resolvedPath)) {
    throw new Error(`File not found: ${resolvedPath}`)
  }

  const stat = safeStat(resolvedPath)
  if (!stat?.isFile()) {
    throw new Error(`Path is not a file: ${resolvedPath}`)
  }

  // If the file is inside a directory that has the same name as a skill folder, use dirname as rootPath
  const dirPath = dirname(resolvedPath)
  const fileName = basename(resolvedPath)
  const fallbackName = basename(resolvedPath, '.md').replace(/\.SKILL$/i, '')

  const raw = readFileSync(resolvedPath, 'utf-8')
  const { frontmatter, body } = splitFrontmatter(raw)
  const name = stringField(frontmatter, 'name') || fallbackName
  const description = stringField(frontmatter, 'description') || firstBodyLine(body) || 'Imported Skill'

  return {
    id: `local:file:${hashPath(resolvedPath)}`,
    scope: 'user',
    name,
    version: stringField(frontmatter, 'version') || '0.0.0',
    rootPath: dirPath,
    manifestJson: JSON.stringify({
      desc: description,
      description,
      source: fileName.toUpperCase() === 'SKILL.MD' ? 'SKILL.md 文件导入' : '文件导入',
      author: stringField(frontmatter, 'author') || 'Local',
      category: stringField(frontmatter, 'category') || 'utility',
      tags: listField(frontmatter, 'tags'),
      systemPrompt: body.trim(),
      requiredTools: listField(frontmatter, 'requiredTools').concat(listField(frontmatter, 'tools')),
      parameters: [],
      importedFrom: 'file',
      skillFilePath: resolvedPath,
    }),
    enabled: true,
  }
}

// ─── Manifest.json 支持 ─────────────────────────────────────────────────

/**
 * skill 目录中可选的 manifest.json 结构
 * 用于存储 SKILL.md frontmatter 不便表达的元数据（requiredTools、parameters 等）
 */
export interface SkillManifest {
  /** 可覆盖自动生成的 skill ID，如 "builtin:browser-use" */
  id?: string
  category?: string
  requiredTools?: string[]
  parameters?: Array<{
    name: string
    type: string
    label: string
    description?: string
    defaultValue?: unknown
    options?: Array<{ label: string; value: string }>
    required?: boolean
  }>
}

/**
 * 读取 skill 目录下的 manifest.json（如果存在）
 */
export function loadManifestJson(skillDir: string): SkillManifest | null {
  const manifestPath = join(skillDir, 'manifest.json')
  if (!existsSync(manifestPath)) return null
  try {
    const raw = readFileSync(manifestPath, 'utf-8')
    return JSON.parse(raw) as SkillManifest
  } catch {
    return null
  }
}

// ─── Private ────────────────────────────────────────────────────────────

function toCandidate(rootPath: string, source: LocalSkillSource): LocalSkillCandidate {
  const resolved = resolve(rootPath)
  const skillFilePath = join(resolved, 'SKILL.md')
  const parsed = parseSkillFile(skillFilePath, basename(resolved))
  const manifest = loadManifestJson(resolved)
  return {
    id: manifest?.id ?? `local:${source}:${hashPath(resolved)}`,
    name: parsed.name,
    description: parsed.description,
    source,
    rootPath: resolved,
    skillFilePath,
  }
}

function parseSkillFile(filePath: string, fallbackName: string): {
  name: string
  description: string
  version: string
  author: string
  category: string
  tags: string[]
  requiredTools: string[]
  body: string
} {
  const raw = readFileSync(filePath, 'utf-8')
  const { frontmatter, body } = splitFrontmatter(raw)
  const name = stringField(frontmatter, 'name') || fallbackName
  const description = stringField(frontmatter, 'description') || firstBodyLine(body) || '本地 Skill'
  return {
    name,
    description,
    version: stringField(frontmatter, 'version') || '0.0.0',
    author: stringField(frontmatter, 'author') || 'Local',
    category: stringField(frontmatter, 'category') || 'utility',
    tags: listField(frontmatter, 'tags'),
    requiredTools: listField(frontmatter, 'requiredTools').concat(listField(frontmatter, 'tools')),
    body: body.trim(),
  }
}

function splitFrontmatter(raw: string): { frontmatter: Record<string, string>; body: string } {
  if (!raw.startsWith('---')) return { frontmatter: {}, body: raw }
  const end = raw.indexOf('\n---', 3)
  if (end === -1) return { frontmatter: {}, body: raw }
  const frontmatterText = raw.slice(3, end).trim()
  const body = raw.slice(end + 4)
  const frontmatter: Record<string, string> = {}
  for (const line of frontmatterText.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (!match) continue
    frontmatter[match[1]!] = match[2]!.trim().replace(/^['"]|['"]$/g, '')
  }
  return { frontmatter, body }
}

function stringField(frontmatter: Record<string, string>, key: string): string {
  return frontmatter[key]?.trim() ?? ''
}

function listField(frontmatter: Record<string, string>, key: string): string[] {
  const raw = stringField(frontmatter, key)
  if (!raw) return []
  return raw
    .replace(/^\[/, '')
    .replace(/\]$/, '')
    .split(',')
    .map((item) => item.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean)
}

function firstBodyLine(body: string): string {
  return body
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^#+\s*/, ''))
    .find((line) => line.length > 0) ?? ''
}

function inferSource(path: string): LocalSkillSource {
  if (path.includes('.claude')) return 'claude'
  if (path.includes('.codex')) return 'codex'
  if (path.includes('.agents')) return 'agents'
  return 'custom'
}

function hashPath(path: string): string {
  return createHash('sha1').update(resolve(path)).digest('hex').slice(0, 12)
}

function safeStat(path: string) {
  try {
    return statSync(path)
  } catch {
    return null
  }
}

function safeLstat(path: string) {
  try {
    return lstatSync(path)
  } catch {
    return null
  }
}

function isSymlink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink()
  } catch {
    return false
  }
}
