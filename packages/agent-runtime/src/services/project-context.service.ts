import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, extname, isAbsolute, join, relative, resolve } from 'node:path'

export interface ProjectContextSource {
  kind: 'rule' | 'skill' | 'agent'
  name: string
  path: string
  estimatedTokens?: number
  included?: boolean
  reason?: string
  truncated?: boolean
}

export interface ProjectContext {
  rules: string[]
  systemPrompt?: string
  skillSystemPrompt?: string
  sources: ProjectContextSource[]
  budget?: ProjectContextBudget
}

export interface ProjectContextBudget {
  mode: ContextMode
  budgetTokens: number
  usedTokens: number
  truncated: boolean
}

export type ContextMode = 'minimal' | 'project-smart' | 'deep-research' | 'review' | 'manual'

export interface ProjectContextOptions {
  mode?: ContextMode
  budgetTokens?: number
  /** File paths (posix-relative to root) to always include, overriding budget exclusion */
  pinnedPaths?: Set<string>
  /** File paths (posix-relative to root) to exclude even if they would be discovered */
  excludedPaths?: Set<string>
}

export interface ProjectSkillSummary {
  id: string
  name: string
  description: string
  relativePath: string
}

interface MarkdownDoc {
  name: string
  description: string
  body: string
  estimatedTokens: number
  truncated: boolean
}

const MAX_FILE_CHARS = 20_000
const MAX_PROMPT_CHARS = 80_000
const MIN_PARTIAL_DOC_TOKENS = 200
const MAX_SKILL_DESCRIPTION_CHARS = 220
const DEFAULT_BUDGET_BY_MODE: Record<ContextMode, number> = {
  minimal: 2_000,
  'project-smart': 30_000,
  review: 40_000,
  'deep-research': 80_000,
  manual: 30_000,
}
const RULE_FILE_PATHS = [
  'AGENTS.md',
  'CLAUDE.md',
  'GEMINI.md',
  '.cursorrules',
  '.windsurfrules',
  '.clinerules',
  '.rules',
  '.github/copilot-instructions.md',
  '.claude/AGENTS.md',
  '.claude/CLAUDE.md',
  '.codex/AGENTS.md',
  '.agents/AGENTS.md',
]
const RULE_DIR_PATHS = [
  '.rules',
  '.claude/rules',
  '.codex/rules',
  '.agents/rules',
  '.cursor/rules',
  '.windsurf/rules',
]
const SKILL_DIR_PATHS = [
  '.claude/skills',
  '.codex/skills',
  '.agents/skills',
  'skills',
]
const AGENT_DIR_PATHS = [
  '.claude/agents',
  '.codex/agents',
  '.agents/agents',
]
const TEXT_EXTENSIONS = new Set(['', '.md', '.mdc', '.txt', '.rule', '.rules'])

export class ProjectContextService {
  discover(rootPath: string | undefined, options: ProjectContextOptions = {}): ProjectContext {
    if (rootPath == null || rootPath.trim().length === 0) return emptyContext()
    const root = resolve(rootPath)
    if (!safeStat(root)?.isDirectory()) return emptyContext()

    let ruleDocs = discoverRuleDocs(root)
    let skillDocs = discoverSkillDocs(root)
    let agentDocs = discoverAgentDocs(root)

    // Apply file pin/exclude overrides
    const pinnedPaths = options.pinnedPaths ?? new Set<string>()
    const excludedPaths = options.excludedPaths ?? new Set<string>()

    // Exclude files matching excludedPaths
    if (excludedPaths.size > 0) {
      ruleDocs = ruleDocs.filter((doc) => !excludedPaths.has(doc.relativePath))
      skillDocs = skillDocs.filter((doc) => !excludedPaths.has(doc.relativePath))
      agentDocs = agentDocs.filter((doc) => !excludedPaths.has(doc.relativePath))
    }

    // Discover pinned files that were not auto-discovered
    const allDiscoveredPaths = new Set([
      ...ruleDocs.map((d) => d.relativePath),
      ...skillDocs.map((d) => d.relativePath),
      ...agentDocs.map((d) => d.relativePath),
    ])
    const pinnedExtraDocs: Array<MarkdownDoc & { relativePath: string; content: string }> = []
    for (const relPath of pinnedPaths) {
      if (allDiscoveredPaths.has(relPath)) continue
      if (excludedPaths.has(relPath)) continue
      const absPath = resolve(root, relPath)
      if (!isInsideRoot(root, absPath)) continue
      const doc = toProjectDoc(root, absPath, basename(relPath, extname(relPath)))
      if (doc != null) {
        pinnedExtraDocs.push({
          ...doc,
          content: `[${doc.relativePath}]\n${doc.body}`,
        })
      }
    }

    // Prepend pinned extras to ruleDocs so they have highest priority
    ruleDocs = [...pinnedExtraDocs, ...ruleDocs]

    const mode = options.mode ?? 'project-smart'
    const budgetTokens = options.budgetTokens ?? DEFAULT_BUDGET_BY_MODE[mode]
    const budgeted = applyContextBudget(ruleDocs, skillDocs, agentDocs, budgetTokens, pinnedPaths)

    const systemSections = [
      formatRulePrompt(budgeted.ruleDocs),
      formatAgentPrompt(budgeted.agentDocs),
    ].filter(isNonEmptyString)
    const skillSystemPrompt = formatSkillPrompt(budgeted.skillDocs)

    return {
      rules: budgeted.ruleDocs.map((doc) => doc.content),
      ...(systemSections.length > 0 ? { systemPrompt: clampPrompt(systemSections.join('\n\n')) } : {}),
      ...(skillSystemPrompt.length > 0 ? { skillSystemPrompt: clampPrompt(skillSystemPrompt) } : {}),
      sources: budgeted.sources,
      budget: {
        mode,
        budgetTokens,
        usedTokens: budgeted.usedTokens,
        truncated: budgeted.sources.some((source) => source.reason === 'excluded_by_context_budget' || source.truncated === true),
      },
    }
  }

  listSkillSummaries(rootPath: string | undefined): ProjectSkillSummary[] {
    if (rootPath == null || rootPath.trim().length === 0) return []
    const root = resolve(rootPath)
    if (!safeStat(root)?.isDirectory()) return []
    return discoverSkillDocs(root).map((doc) => toProjectSkillSummary(doc))
  }

  buildSkillSystemPrompt(rootPath: string | undefined, skillId: string): string | null {
    const relativePath = parseProjectSkillId(skillId)
    if (relativePath == null || rootPath == null || rootPath.trim().length === 0) return null
    const root = resolve(rootPath)
    const skillFilePath = resolve(root, relativePath)
    if (!isInsideRoot(root, skillFilePath) || basename(skillFilePath).toLowerCase() !== 'skill.md') return null
    const doc = toProjectDoc(root, skillFilePath, basename(resolve(skillFilePath, '..')))
    if (doc == null) return null
    return [
      `[Selected Project Skill: ${doc.name}]`,
      `Skill: ${toProjectSkillId(doc.relativePath)}`,
      `Source: ${doc.relativePath}`,
      'This project-local skill was explicitly selected for this turn; its full instructions are loaded below.',
      doc.body,
    ].join('\n\n')
  }
}

function emptyContext(): ProjectContext {
  return { rules: [], sources: [] }
}

function discoverRuleDocs(root: string): Array<MarkdownDoc & { relativePath: string; content: string }> {
  const files = uniqueFiles([
    ...RULE_FILE_PATHS.map((path) => join(root, path)),
    ...RULE_DIR_PATHS.flatMap((path) => listTextFiles(join(root, path))),
  ])

  return files
    .map((filePath) => {
      const raw = safeRead(filePath)
      if (!raw.trim()) return null
      const relativePath = toPosix(relative(root, filePath))
      return {
        name: relativePath,
        description: '',
        body: raw.trim(),
        content: `[${relativePath}]\n${raw.trim()}`,
        relativePath,
        estimatedTokens: estimateTokens(raw),
        truncated: raw.length >= MAX_FILE_CHARS,
      }
    })
    .filter((doc): doc is MarkdownDoc & { relativePath: string; content: string } => doc != null)
}

function discoverSkillDocs(root: string): Array<MarkdownDoc & { relativePath: string }> {
  return SKILL_DIR_PATHS
    .flatMap((path) => discoverSkillFiles(join(root, path)))
    .map((filePath) => toProjectSkillDoc(root, filePath, basename(resolve(filePath, '..'))))
    .filter((doc): doc is MarkdownDoc & { relativePath: string } => doc != null)
}

function discoverAgentDocs(root: string): Array<MarkdownDoc & { relativePath: string }> {
  return AGENT_DIR_PATHS
    .flatMap((path) => listTextFiles(join(root, path)))
    .filter((filePath) => basename(filePath).toLowerCase() !== 'skill.md')
    .map((filePath) => toProjectDoc(root, filePath, basename(filePath, extname(filePath))))
    .filter((doc): doc is MarkdownDoc & { relativePath: string } => doc != null)
}

function discoverSkillFiles(root: string): string[] {
  if (!safeStat(root)?.isDirectory()) return []
  const direct = join(root, 'SKILL.md')
  const files: string[] = existsSync(direct) ? [direct] : []
  for (const entry of safeReadDir(root)) {
    const dir = join(root, entry)
    if (!safeStat(dir)?.isDirectory()) continue
    const skillFile = join(dir, 'SKILL.md')
    if (existsSync(skillFile)) files.push(skillFile)
  }
  return uniqueFiles(files)
}

function listTextFiles(root: string): string[] {
  if (!safeStat(root)?.isDirectory()) return []
  const files: string[] = []
  for (const entry of safeReadDir(root)) {
    const filePath = join(root, entry)
    const stat = safeStat(filePath)
    if (!stat?.isFile()) continue
    if (!TEXT_EXTENSIONS.has(extname(entry).toLowerCase())) continue
    files.push(filePath)
  }
  return files
}

function toProjectDoc(root: string, filePath: string, fallbackName: string): (MarkdownDoc & { relativePath: string }) | null {
  const raw = safeRead(filePath)
  if (!raw.trim()) return null
  const parsed = parseMarkdownDoc(raw, fallbackName)
  return {
    ...parsed,
    relativePath: toPosix(relative(root, filePath)),
    estimatedTokens: estimateTokens(parsed.body),
    truncated: raw.length >= MAX_FILE_CHARS,
  }
}

function toProjectSkillDoc(root: string, filePath: string, fallbackName: string): (MarkdownDoc & { relativePath: string }) | null {
  const doc = toProjectDoc(root, filePath, fallbackName)
  if (doc == null) return null
  const summary = `${doc.name}\n${doc.description}`
  return {
    ...doc,
    estimatedTokens: estimateTokens(summary),
  }
}

function parseMarkdownDoc(raw: string, fallbackName: string): MarkdownDoc {
  const { frontmatter, body } = splitFrontmatter(raw)
  const trimmedBody = body.trim()
  return {
    name: stringField(frontmatter, 'name') || fallbackName,
    description: stringField(frontmatter, 'description') || firstBodyLine(trimmedBody),
    body: trimmedBody,
    estimatedTokens: estimateTokens(trimmedBody),
    truncated: false,
  }
}

type RuleDoc = MarkdownDoc & { relativePath: string; content: string }
type ProjectDoc = MarkdownDoc & { relativePath: string }
type BudgetedDoc<T extends ProjectDoc> = T & { included: boolean; reason?: string }

function applyContextBudget(
  ruleDocs: RuleDoc[],
  skillDocs: ProjectDoc[],
  agentDocs: ProjectDoc[],
  budgetTokens: number,
  pinnedPaths: Set<string> = new Set(),
): {
  ruleDocs: RuleDoc[]
  skillDocs: ProjectDoc[]
  agentDocs: ProjectDoc[]
  sources: ProjectContextSource[]
  usedTokens: number
} {
  let remaining = Math.max(0, budgetTokens)
  let usedTokens = 0
  const selectedRules: RuleDoc[] = []
  const selectedSkills: ProjectDoc[] = []
  const selectedAgents: ProjectDoc[] = []
  const sources: ProjectContextSource[] = []
  const seenRuleBodies = new Map<string, string>()

  const consume = <T extends ProjectDoc>(kind: ProjectContextSource['kind'], doc: T): BudgetedDoc<T> => {
    const sourceBase = {
      kind,
      name: doc.name,
      path: doc.relativePath,
      estimatedTokens: doc.estimatedTokens,
    }
    // Pinned files are always included regardless of budget
    const isPinned = pinnedPaths.has(doc.relativePath)
    if (isPinned) {
      usedTokens += doc.estimatedTokens
      // Do not deduct from remaining for pinned files — they bypass budget
      sources.push({ ...sourceBase, included: true, reason: 'pinned', ...(doc.truncated ? { truncated: true } : {}) })
      return { ...doc, included: true, reason: 'pinned' }
    }
    if (doc.estimatedTokens <= remaining) {
      remaining -= doc.estimatedTokens
      usedTokens += doc.estimatedTokens
      sources.push({ ...sourceBase, included: true, ...(doc.truncated ? { truncated: true } : {}) })
      return { ...doc, included: true }
    }
    if (remaining >= MIN_PARTIAL_DOC_TOKENS) {
      const partial = truncateDocToTokens(doc, remaining)
      usedTokens += partial.estimatedTokens
      remaining = 0
      sources.push({ ...sourceBase, estimatedTokens: partial.estimatedTokens, included: true, truncated: true, reason: 'trimmed_to_context_budget' })
      return { ...partial, included: true, reason: 'trimmed_to_context_budget' }
    }
    sources.push({ ...sourceBase, included: false, reason: 'excluded_by_context_budget' })
    return { ...doc, included: false, reason: 'excluded_by_context_budget' }
  }

  for (const doc of ruleDocs) {
    const bodyKey = normalizeInstructionBody(doc.body)
    const duplicateOf = seenRuleBodies.get(bodyKey)
    if (duplicateOf != null) {
      sources.push({
        kind: 'rule',
        name: doc.name,
        path: doc.relativePath,
        estimatedTokens: doc.estimatedTokens,
        included: false,
        reason: `duplicate_of:${duplicateOf}`,
        ...(doc.truncated ? { truncated: true } : {}),
      })
      continue
    }
    seenRuleBodies.set(bodyKey, doc.relativePath)
    const selected = consume('rule', doc)
    if (selected.included) selectedRules.push(selected)
  }
  for (const doc of agentDocs) {
    const selected = consume('agent', doc)
    if (selected.included) selectedAgents.push(selected)
  }
  for (const doc of skillDocs) {
    const selected = consume('skill', doc)
    if (selected.included) selectedSkills.push(selected)
  }

  return { ruleDocs: selectedRules, skillDocs: selectedSkills, agentDocs: selectedAgents, sources, usedTokens }
}

function truncateDocToTokens<T extends ProjectDoc>(doc: T, tokens: number): T {
  const maxChars = Math.max(0, tokens * 3)
  const body = `${doc.body.slice(0, maxChars)}\n\n[Project context source truncated by Context Governor]`
  const next = {
    ...doc,
    body,
    estimatedTokens: estimateTokens(body),
    truncated: true,
  }
  if ('content' in next) {
    return {
      ...next,
      content: `[${next.relativePath}]\n${body}`,
    }
  }
  return next
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

function formatRulePrompt(docs: Array<MarkdownDoc & { relativePath: string }>): string {
  if (docs.length === 0) return ''
  const sections = docs.map((doc) => [
    `### ${doc.relativePath}`,
    doc.body,
  ].join('\n'))
  return ['[Project Instruction Files]', ...sections].join('\n\n')
}

function formatSkillPrompt(docs: Array<MarkdownDoc & { relativePath: string }>): string {
  if (docs.length === 0) return ''
  const sections = docs.map((doc) => {
    const summary = toProjectSkillSummary(doc)
    return `- ${summary.id} — ${summary.name}: ${summary.description}`
  })
  return [
    '[Project Local Skills Catalog]',
    'Metadata only. Each entry contains only skill id, name, and description; full SKILL.md instructions are not loaded here.',
    'Use /skill run project:<relative SKILL.md path> to explicitly load one of these project-local skills.',
    sections.join('\n'),
  ].join('\n\n')
}

function formatAgentPrompt(docs: Array<MarkdownDoc & { relativePath: string }>): string {
  if (docs.length === 0) return ''
  const sections = docs.map((doc) => [
    `### ${doc.name}`,
    `Source: ${doc.relativePath}`,
    doc.description ? `Description: ${doc.description}` : '',
    doc.body,
  ].filter(isNonEmptyString).join('\n'))
  return [
    '[Project Agent Definitions]',
    'These agent definitions are configured by the current workspace. Treat them as project-specific role guidance and delegation context.',
    sections.join('\n\n'),
  ].join('\n\n')
}

function normalizeInstructionBody(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .trim()
}

function clampPrompt(text: string): string {
  if (text.length <= MAX_PROMPT_CHARS) return text
  return `${text.slice(0, MAX_PROMPT_CHARS)}\n\n[Project context truncated at ${MAX_PROMPT_CHARS} characters]`
}

function safeRead(filePath: string): string {
  try {
    return readFileSync(filePath, 'utf-8').slice(0, MAX_FILE_CHARS)
  } catch {
    return ''
  }
}

function safeReadDir(dirPath: string): string[] {
  try {
    return readdirSync(dirPath).sort((a, b) => a.localeCompare(b))
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

function stringField(frontmatter: Record<string, string>, key: string): string {
  return frontmatter[key]?.trim() ?? ''
}

function toProjectSkillSummary(doc: MarkdownDoc & { relativePath: string }): ProjectSkillSummary {
  const description = truncateInline(doc.description || 'Project-local skill', MAX_SKILL_DESCRIPTION_CHARS)
  return {
    id: toProjectSkillId(doc.relativePath),
    name: doc.name,
    description,
    relativePath: doc.relativePath,
  }
}

function toProjectSkillId(relativePath: string): string {
  return `project:${relativePath}`
}

function parseProjectSkillId(skillId: string): string | null {
  if (!skillId.startsWith('project:')) return null
  const relativePath = skillId.slice('project:'.length).trim()
  return relativePath.length > 0 ? relativePath : null
}

function isInsideRoot(root: string, target: string): boolean {
  const relativePath = relative(root, target)
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath))
}

function truncateInline(value: string, maxChars: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxChars) return normalized
  return `${normalized.slice(0, Math.max(0, maxChars - 3)).trimEnd()}...`
}

function firstBodyLine(body: string): string {
  return body
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^#+\s*/, ''))
    .find((line) => line.length > 0) ?? ''
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3)
}

function uniqueFiles(files: string[]): string[] {
  return Array.from(new Set(files.map((file) => resolve(file)))).sort((a, b) => a.localeCompare(b))
}

function toPosix(path: string): string {
  return path.replace(/\\/g, '/')
}

function isNonEmptyString(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0
}
