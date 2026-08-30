import { createRequire } from 'node:module'

interface JsYamlModule {
  load(source: string): unknown
}

const { load: loadYaml } = createRequire(import.meta.url)('js-yaml') as JsYamlModule

export type SkillDocumentIssueCode =
  | 'missing_frontmatter'
  | 'unterminated_frontmatter'
  | 'invalid_frontmatter_yaml'
  | 'invalid_frontmatter_shape'
  | 'missing_name'
  | 'missing_description'

export interface SkillDocumentIssue {
  code: SkillDocumentIssueCode
  message: string
}

export type SkillDocumentParseResult =
  | {
      valid: true
      metadata: Record<string, unknown>
      name: string
      description: string
      body: string
    }
  | {
      valid: false
      issue: SkillDocumentIssue
    }

/**
 * Parse a Codex-compatible SKILL.md document.
 *
 * Codex requires YAML frontmatter with non-empty string `name` and `description`
 * fields. Keeping this validation in Spark's discovery boundary prevents a file
 * from appearing usable in Spark while the native runtime rejects it later.
 */
export function parseSkillDocument(raw: string): SkillDocumentParseResult {
  const normalized = raw.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
  if (!normalized.startsWith('---\n')) {
    return invalid('missing_frontmatter', '缺少以 `---` 开始的 YAML frontmatter')
  }

  const closingMatch = /^---[ \t]*$/m.exec(normalized.slice(4))
  if (closingMatch == null) {
    return invalid('unterminated_frontmatter', 'YAML frontmatter 缺少结束分隔线 `---`')
  }

  const frontmatterEnd = 4 + closingMatch.index
  const frontmatterSource = normalized.slice(4, frontmatterEnd)
  const bodyStart = frontmatterEnd + closingMatch[0].length
  const body = normalized.slice(bodyStart).replace(/^\n/, '').trim()

  let parsed: unknown
  try {
    parsed = loadYaml(frontmatterSource)
  } catch (error) {
    return invalid(
      'invalid_frontmatter_yaml',
      `YAML frontmatter 无法解析：${error instanceof Error ? error.message : String(error)}`,
    )
  }
  if (!isRecord(parsed)) {
    return invalid('invalid_frontmatter_shape', 'YAML frontmatter 必须是键值对象')
  }

  const name = readRequiredString(parsed, 'name')
  if (name == null) return invalid('missing_name', 'YAML frontmatter 缺少非空字符串 `name`')
  const description = readRequiredString(parsed, 'description')
  if (description == null) {
    return invalid('missing_description', 'YAML frontmatter 缺少非空字符串 `description`')
  }

  return { valid: true, metadata: parsed, name, description, body }
}

function invalid(code: SkillDocumentIssueCode, message: string): SkillDocumentParseResult {
  return { valid: false, issue: { code, message } }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function readRequiredString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key]
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}
