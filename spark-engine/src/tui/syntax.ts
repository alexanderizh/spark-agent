/**
 * Dependency-free, character-preserving syntax highlighting for the TUI's code
 * surfaces. Tokenizing never rewrites the source: concatenating every token's
 * text reproduces the input line exactly, so highlighting can only change
 * color — never width, wrapping, indentation or content. That invariant is what
 * keeps it safe to run inside the scroll viewport and inside golden frames.
 */
export type CodeTokenKind = 'plain' | 'keyword' | 'string' | 'number' | 'comment' | 'type'

export interface CodeToken {
  readonly kind: CodeTokenKind
  readonly text: string
}

export type CodeLanguage =
  | 'typescript'
  | 'python'
  | 'shell'
  | 'json'
  | 'rust'
  | 'go'
  | 'yaml'
  | 'toml'
  | 'sql'

interface LanguageSpec {
  readonly lineComments: readonly string[]
  readonly blockComments: readonly (readonly [string, string])[]
  /** Quote delimiters, longest first so `"""` wins over `"`. */
  readonly quotes: readonly string[]
  readonly keywords: ReadonlySet<string>
  readonly caseInsensitive: boolean
  /** Shell-like languages: the first word of a command reads as a builtin. */
  readonly commandWords: boolean
}

function words(source: string): ReadonlySet<string> {
  return new Set(source.split(' ').filter((word) => word !== ''))
}

const TYPESCRIPT_KEYWORDS = words(
  'as async await break case catch class const continue declare default delete do else enum export extends false finally for from function if implements import in instanceof interface keyof let new null of readonly return satisfies static super switch this throw true try type typeof undefined var void while yield',
)
const PYTHON_KEYWORDS = words(
  'and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield self',
)
const SHELL_KEYWORDS = words(
  'if then else elif fi for in do done while until case esac function return local export readonly source alias unset shift trap exit set declare cd echo printf read test eval exec command',
)
const RUST_KEYWORDS = words(
  'as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while',
)
const GO_KEYWORDS = words(
  'break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var nil true false',
)
const SQL_KEYWORDS = words(
  'select from where group by order having limit offset insert into values update set delete create table alter drop index join left right inner outer on as and or not null is in like between distinct union all case when then else end primary key foreign references default',
)

const SPECS: Readonly<Record<CodeLanguage, LanguageSpec>> = {
  typescript: {
    lineComments: ['//'],
    blockComments: [['/*', '*/']],
    quotes: ['"', "'", '`'],
    keywords: TYPESCRIPT_KEYWORDS,
    caseInsensitive: false,
    commandWords: false,
  },
  python: {
    lineComments: ['#'],
    blockComments: [],
    quotes: ['"""', "'''", '"', "'"],
    keywords: PYTHON_KEYWORDS,
    caseInsensitive: false,
    commandWords: false,
  },
  shell: {
    lineComments: ['#'],
    blockComments: [],
    quotes: ['"', "'"],
    keywords: SHELL_KEYWORDS,
    caseInsensitive: false,
    commandWords: true,
  },
  json: {
    lineComments: [],
    blockComments: [],
    quotes: ['"'],
    keywords: words('true false null'),
    caseInsensitive: false,
    commandWords: false,
  },
  rust: {
    lineComments: ['//'],
    blockComments: [['/*', '*/']],
    quotes: ['"', "'"],
    keywords: RUST_KEYWORDS,
    caseInsensitive: false,
    commandWords: false,
  },
  go: {
    lineComments: ['//'],
    blockComments: [['/*', '*/']],
    quotes: ['"', '`', "'"],
    keywords: GO_KEYWORDS,
    caseInsensitive: false,
    commandWords: false,
  },
  yaml: {
    lineComments: ['#'],
    blockComments: [],
    quotes: ['"', "'"],
    keywords: words('true false null yes no on off'),
    caseInsensitive: false,
    commandWords: false,
  },
  toml: {
    lineComments: ['#'],
    blockComments: [],
    quotes: ['"""', '"', "'"],
    keywords: words('true false'),
    caseInsensitive: false,
    commandWords: false,
  },
  sql: {
    lineComments: ['--'],
    blockComments: [['/*', '*/']],
    quotes: ["'", '"'],
    keywords: SQL_KEYWORDS,
    caseInsensitive: true,
    commandWords: false,
  },
}

const FENCE_ALIASES: Readonly<Record<string, CodeLanguage>> = {
  ts: 'typescript',
  tsx: 'typescript',
  typescript: 'typescript',
  js: 'typescript',
  jsx: 'typescript',
  javascript: 'typescript',
  mjs: 'typescript',
  cjs: 'typescript',
  py: 'python',
  py3: 'python',
  python: 'python',
  python3: 'python',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  fish: 'shell',
  shell: 'shell',
  console: 'shell',
  json: 'json',
  jsonc: 'json',
  rs: 'rust',
  rust: 'rust',
  go: 'go',
  golang: 'go',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'toml',
  sql: 'sql',
  postgres: 'sql',
  postgresql: 'sql',
  mysql: 'sql',
  sqlite: 'sql',
}

/**
 * Fence info string (`ts`, `bash`, `ts title="a.ts"`) → language. Unknown
 * languages return undefined so callers fall back to plain rendering rather
 * than guessing wrong colors.
 */
export function codeLanguageFromFence(info: string): CodeLanguage | undefined {
  const name =
    info
      .trim()
      .split(/[\s:{]/u)[0]
      ?.toLowerCase() ?? ''
  return FENCE_ALIASES[name]
}

export function tokenizeCode(
  text: string,
  language: CodeLanguage,
): readonly (readonly CodeToken[])[] {
  return text.split('\n').map((line) => tokenizeLine(line, language))
}

/** Splits one line into colored runs; `join(token.text)` reproduces the line. */
export function tokenizeLine(line: string, language: CodeLanguage): readonly CodeToken[] {
  const spec = SPECS[language]
  const tokens: CodeToken[] = []
  let plain = ''
  let index = 0
  const flushPlain = (): void => {
    if (plain !== '') {
      push(tokens, 'plain', plain)
      plain = ''
    }
  }
  while (index < line.length) {
    const rest = line.slice(index)
    const lineComment = spec.lineComments.find((marker) => rest.startsWith(marker))
    if (lineComment !== undefined) {
      flushPlain()
      push(tokens, 'comment', rest)
      break
    }
    const blockComment = spec.blockComments.find(([open]) => rest.startsWith(open))
    if (blockComment !== undefined) {
      const [open, close] = blockComment
      const end = rest.indexOf(close, open.length)
      const text = end === -1 ? rest : rest.slice(0, end + close.length)
      flushPlain()
      push(tokens, 'comment', text)
      index += text.length
      continue
    }
    const quote = spec.quotes.find((delimiter) => rest.startsWith(delimiter))
    if (quote !== undefined) {
      const text = readQuoted(rest, quote)
      flushPlain()
      push(tokens, 'string', text)
      index += text.length
      continue
    }
    const character = line[index] ?? ''
    if (/[0-9]/u.test(character)) {
      const text = /^[0-9][0-9A-Za-z_.]*/u.exec(rest)?.[0] ?? character
      flushPlain()
      push(tokens, 'number', text)
      index += text.length
      continue
    }
    if (/[A-Za-z_$]/u.test(character)) {
      const text = /^[A-Za-z0-9_$]+/u.exec(rest)?.[0] ?? character
      const kind = classifyWord(
        text,
        line.slice(index + text.length),
        spec,
        atCommandPosition(line, index),
      )
      flushPlain()
      push(tokens, kind, text)
      index += text.length
      continue
    }
    plain += character
    index += 1
  }
  flushPlain()
  return tokens
}

/**
 * Word classification, cheapest signal first: language keywords, then
 * conventions that hold across languages (CamelCase values and called names
 * read as types/functions), then shell command position.
 */
function classifyWord(
  word: string,
  following: string,
  spec: LanguageSpec,
  commandPosition: boolean,
): CodeTokenKind {
  const probe = spec.caseInsensitive ? word.toLowerCase() : word
  if (spec.keywords.has(probe)) return 'keyword'
  if (!spec.caseInsensitive && /^[A-Z][A-Za-z0-9_$]*$/u.test(word)) return 'type'
  if (/^\s*\(/u.test(following)) return 'type'
  if (spec.commandWords && commandPosition) return 'type'
  return 'plain'
}

/** True when `index` opens a shell word that sits in command position. */
function atCommandPosition(line: string, index: number): boolean {
  let cursor = index - 1
  while (cursor >= 0 && (line[cursor] === ' ' || line[cursor] === '\t')) cursor -= 1
  if (cursor < 0) return true
  const previous = line[cursor] ?? ''
  return '|&;('.includes(previous)
}

/** Reads a quoted run, honoring backslash escapes and unterminated strings. */
function readQuoted(rest: string, quote: string): string {
  let index = quote.length
  while (index < rest.length) {
    if (rest[index] === '\\') {
      index += 2
      continue
    }
    if (rest.startsWith(quote, index)) return rest.slice(0, index + quote.length)
    index += 1
  }
  // Unterminated on this line: treat the remainder as string content so no
  // character is dropped and the next line starts a fresh scan.
  return rest
}

function push(tokens: CodeToken[], kind: CodeTokenKind, text: string): void {
  const previous = tokens.at(-1)
  if (previous?.kind === kind) {
    tokens[tokens.length - 1] = { kind, text: previous.text + text }
    return
  }
  tokens.push({ kind, text })
}
