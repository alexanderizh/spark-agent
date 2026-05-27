import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import type { SkillCreateRequest } from '@spark/protocol'

export type LocalSkillSource = 'claude' | 'codex' | 'agents' | 'custom'

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
      const stat = safeStat(dir)
      if (!stat?.isDirectory()) continue
      const skillFile = join(dir, 'SKILL.md')
      if (!existsSync(skillFile)) continue
      candidates.push(toCandidate(dir, inferSource(root)))
    }
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
  return {
    id: `local:${source}:${hashPath(rootPath)}`,
    scope: 'user',
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
      requiredTools: parsed.requiredTools,
      parameters: [],
      importedFrom: source,
      skillFilePath,
    }),
    enabled: true,
  }
}

function toCandidate(rootPath: string, source: LocalSkillSource): LocalSkillCandidate {
  const resolved = resolve(rootPath)
  const skillFilePath = join(resolved, 'SKILL.md')
  const parsed = parseSkillFile(skillFilePath, basename(resolved))
  return {
    id: `local:${source}:${hashPath(resolved)}`,
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
