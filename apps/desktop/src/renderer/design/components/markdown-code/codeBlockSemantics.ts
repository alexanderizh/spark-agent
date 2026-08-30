export type CodeBlockMode = 'source' | 'diff' | 'terminal' | 'log'
export type SemanticCodeBlockMode = Exclude<CodeBlockMode, 'source'>

export type DiffCodeLineKind =
  | 'file'
  | 'file-old'
  | 'file-new'
  | 'meta'
  | 'hunk'
  | 'add'
  | 'del'
  | 'context'
  | 'notice'

export type DiffCodeLine = {
  kind: DiffCodeLineKind
  marker: string
  text: string
}

export type SemanticLineTone = 'neutral' | 'error' | 'warning' | 'info' | 'success' | 'debug'

export type TerminalCodeLine = {
  kind: 'command' | 'output'
  tone: SemanticLineTone
  prompt: string
  text: string
}

export type LogCodeLine = {
  tone: SemanticLineTone
  text: string
}

const DIFF_LANGUAGES = new Set(['diff', 'patch', 'udiff', 'unified-diff', 'git-diff'])
const TERMINAL_LANGUAGES = new Set([
  'terminal',
  'console',
  'shell-session',
  'shellsession',
  'powershell-session',
  'cmd-session',
])
const LOG_LANGUAGES = new Set(['log', 'logs', 'syslog', 'text-log'])
const PLAIN_LANGUAGES = new Set(['', 'text', 'plain', 'plaintext'])

const DIFF_META_PATTERN = /^(?:index |new file mode |deleted file mode |old mode |new mode |similarity index |dissimilarity index |rename from |rename to |copy from |copy to |Binary files |GIT binary patch)/
const HUNK_PATTERN = /^@@@?\s+.*@@@?(?:\s.*)?$/
const ISO_TIMESTAMP_PATTERN = /^(?:\[\s*)?\d{4}[-/]\d{2}[-/]\d{2}(?:[T\s]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?(?:\s*\])?\s*/
const TIME_TIMESTAMP_PATTERN = /^\[?\d{2}:\d{2}:\d{2}(?:[.,]\d+)?\]?\s*/
const LEVEL_PATTERN = /^\[?(fatal|error|err|panic|failed|failure|fail|warn|warning|info|notice|success|ok|passed|pass|done|debug|trace)\]?(?=$|\s|:|-)/i

export function classifyCodeBlock(language: string, code: string): CodeBlockMode {
  const normalizedLanguage = language.trim().toLowerCase()

  if (DIFF_LANGUAGES.has(normalizedLanguage)) return 'diff'
  if (TERMINAL_LANGUAGES.has(normalizedLanguage)) return 'terminal'
  if (LOG_LANGUAGES.has(normalizedLanguage)) return 'log'
  if (PLAIN_LANGUAGES.has(normalizedLanguage) && looksLikeUnifiedDiff(code)) return 'diff'

  return 'source'
}

export function isSemanticCodeBlockMode(mode: CodeBlockMode): mode is SemanticCodeBlockMode {
  return mode !== 'source'
}

export function parseDiffCodeLines(code: string): DiffCodeLine[] {
  return splitCodeLines(code).map((line) => {
    if (line.startsWith('diff --git ')) {
      return { kind: 'file', marker: '', text: line }
    }
    if (line.startsWith('--- ')) {
      return { kind: 'file-old', marker: '', text: line }
    }
    if (line.startsWith('+++ ')) {
      return { kind: 'file-new', marker: '', text: line }
    }
    if (line.startsWith('\\ No newline at end of file')) {
      return { kind: 'notice', marker: '', text: line }
    }
    if (HUNK_PATTERN.test(line)) {
      return { kind: 'hunk', marker: '', text: line }
    }
    if (DIFF_META_PATTERN.test(line)) {
      return { kind: 'meta', marker: '', text: line }
    }
    if (line.startsWith('+')) {
      return { kind: 'add', marker: '+', text: line.slice(1) }
    }
    if (line.startsWith('-')) {
      return { kind: 'del', marker: '−', text: line.slice(1) }
    }
    if (line.startsWith(' ')) {
      return { kind: 'context', marker: ' ', text: line.slice(1) }
    }
    return { kind: 'context', marker: '', text: line }
  })
}

export function parseTerminalCodeLines(code: string): TerminalCodeLine[] {
  return splitCodeLines(code).map((line) => {
    const command = matchTerminalPrompt(line)
    if (command != null) {
      return {
        kind: 'command',
        tone: 'neutral',
        prompt: command.prompt,
        text: command.text,
      }
    }

    return {
      kind: 'output',
      tone: detectSemanticLineTone(line),
      prompt: '',
      text: line,
    }
  })
}

export function parseLogCodeLines(code: string): LogCodeLine[] {
  return splitCodeLines(code).map((line) => ({
    tone: detectSemanticLineTone(line),
    text: line,
  }))
}

export function detectSemanticLineTone(line: string): SemanticLineTone {
  const candidate = stripTimestampPrefix(line.trimStart())

  if (/^(?:✘|×|❌)\s*/u.test(candidate) || /^(?:npm\s+)?ERR!?(?:\s|$)/i.test(candidate)) {
    return 'error'
  }
  if (/^(?:⚠|⚠️)\s*/u.test(candidate)) return 'warning'
  if (/^(?:✔|✓|✅)\s*/u.test(candidate)) return 'success'
  if (/^(?:ℹ|ℹ️)\s*/u.test(candidate)) return 'info'

  const directLevel = readLevel(candidate)
  if (directLevel != null) return directLevel

  const namespaced = candidate.match(/^\[[^\]]+]\s*/)
  if (namespaced != null) {
    return readLevel(candidate.slice(namespaced[0].length)) ?? 'neutral'
  }

  return 'neutral'
}

function looksLikeUnifiedDiff(code: string): boolean {
  const normalized = normalizeNewlines(code)
  const hasGitHeader = /^diff --git\s+/m.test(normalized)
  const hasHunk = /^@@@?\s+.*@@@?/m.test(normalized)
  const hasFilePair = /^---\s+.+\n\+\+\+\s+.+/m.test(normalized)
  const hasAdd = /^\+(?!\+\+)\s?.+/m.test(normalized)
  const hasDel = /^-(?!--)\s?.+/m.test(normalized)

  return (
    (hasGitHeader && (hasHunk || hasFilePair || (hasAdd && hasDel))) ||
    (hasHunk && hasAdd && hasDel) ||
    (hasFilePair && (hasAdd || hasDel))
  )
}

function matchTerminalPrompt(line: string): { prompt: string; text: string } | null {
  const patterns = [
    /^(\s*[\w.-]+@[\w.-]+(?::[^#$\r\n]*)?[$#]\s+)(.*)$/,
    /^(\s*PS\s+[^>\r\n]*>\s*)(.*)$/i,
    /^(\s*[A-Za-z]:\\[^>\r\n]*>\s*)(.*)$/,
    /^(\s*(?:[$%#❯➜])\s+)(.*)$/u,
  ]

  for (const pattern of patterns) {
    const match = line.match(pattern)
    if (match != null) {
      return { prompt: match[1] ?? '', text: match[2] ?? '' }
    }
  }

  return null
}

function stripTimestampPrefix(value: string): string {
  return value
    .replace(ISO_TIMESTAMP_PATTERN, '')
    .replace(TIME_TIMESTAMP_PATTERN, '')
}

function readLevel(value: string): SemanticLineTone | null {
  const match = value.match(LEVEL_PATTERN)
  const level = match?.[1]?.toLowerCase()

  switch (level) {
    case 'fatal':
    case 'error':
    case 'err':
    case 'panic':
    case 'failed':
    case 'failure':
    case 'fail':
      return 'error'
    case 'warn':
    case 'warning':
      return 'warning'
    case 'info':
    case 'notice':
      return 'info'
    case 'success':
    case 'ok':
    case 'passed':
    case 'pass':
    case 'done':
      return 'success'
    case 'debug':
    case 'trace':
      return 'debug'
    default:
      return null
  }
}

function splitCodeLines(code: string): string[] {
  return normalizeNewlines(code).split('\n')
}

function normalizeNewlines(value: string): string {
  return value.replace(/\r\n?/g, '\n')
}
