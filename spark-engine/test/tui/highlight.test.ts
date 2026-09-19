import { describe, expect, it } from 'vitest'

import { codeColor, diffColor, diffSegments } from '../../src/tui/components/code-segments.js'
import { codeLanguageFromFence, tokenizeLine, type CodeLanguage } from '../../src/tui/syntax.js'
import { defaultTheme, type TuiTheme } from '../../src/tui/theme.js'

/** Lines that exercise every scanner branch, including the awkward ones. */
const CORPUS: Readonly<Record<CodeLanguage, readonly string[]>> = {
  typescript: [
    'export async function load(path: string): Promise<void> {',
    '  const text = await readFile(path, "utf8") // trailing comment',
    "  if (!text) throw new Error('empty')",
    '  return `total ${text.length} lines`',
    '/* block */ const ratio = 0.5e3',
    "  const broken = 'unterminated",
    '',
    '   ',
  ],
  python: [
    'def main(argv: list[str]) -> int:',
    '    count = 42  # 统计',
    '    text = """doc"""',
    "    raise ValueError('bad input')",
  ],
  shell: [
    '#!/usr/bin/env bash',
    '# deploy script',
    'set -euo pipefail',
    'spark config set model --global',
    'echo "done $USER" | tee /tmp/log',
    "echo 'single quotes keep $USER'",
  ],
  json: ['{', '  "name": "spark",', '  "count": 12,', '  "enabled": true', '}'],
  rust: ['fn main() {', '    let total: u32 = 7;', '    // 注释', '    println!("{total}");', '}'],
  go: ['func main() {', '\tcount := 3', '\tfmt.Println("hi", count)', '}'],
  yaml: ['name: spark', 'enabled: true', '# comment', 'items:', '  - one'],
  toml: ['[engine]', 'name = "spark"', '# comment', 'layers = 12'],
  sql: ['SELECT id, name FROM users', '-- pick active rows', "WHERE name = 'spark' AND id > 3"],
}

function textOf(line: string, language: CodeLanguage): string {
  return tokenizeLine(line, language)
    .map((token) => token.text)
    .join('')
}

function kindsOf(line: string, language: CodeLanguage): readonly string[] {
  return tokenizeLine(line, language).map((token) => `${token.kind}:${token.text}`)
}

/** Theme written before syntax highlighting existed. */
const legacyTheme: TuiTheme = {
  dim: '#111111',
  accent: '#222222',
  ok: '#333333',
  warn: '#444444',
  error: '#555555',
}

describe('terminal syntax highlighting', () => {
  it('never rewrites a character in any supported language', () => {
    for (const [language, lines] of Object.entries(CORPUS) as [CodeLanguage, readonly string[]][]) {
      for (const line of lines) {
        expect(textOf(line, language)).toBe(line)
      }
      expect(textOf(lines.join('\n'), language)).toBe(lines.join('\n'))
    }
  })

  it('classifies keywords, strings, numbers and comments per language', () => {
    const kinds = kindsOf('const total = 42', 'typescript')
    expect(kinds).toContain('keyword:const')
    expect(kinds).toContain('number:42')
    expect(kindsOf('const name = "spark"', 'typescript')).toContain('string:"spark"')
    expect(kindsOf('// 注释', 'typescript')).toEqual(['comment:// 注释'])
    expect(kindsOf('# deploy', 'shell')).toEqual(['comment:# deploy'])
    expect(kindsOf('-- pick', 'sql')).toEqual(['comment:-- pick'])
    expect(kindsOf('SELECT * FROM users', 'sql')).toContain('keyword:SELECT')
    expect(kindsOf('  "enabled": true', 'json')).toContain('keyword:true')
  })

  it('reads shell commands in command position as builtins', () => {
    expect(kindsOf('spark config set model', 'shell')).toContain('type:spark')
    expect(kindsOf('cat a.txt | grep spark', 'shell')).toContain('type:grep')
    expect(kindsOf('echo "spark"', 'shell')).toContain('keyword:echo')
  })

  it('resolves fence aliases and leaves unknown languages uncolored', () => {
    expect(codeLanguageFromFence('ts')).toBe('typescript')
    expect(codeLanguageFromFence('bash title="deploy.sh"')).toBe('shell')
    expect(codeLanguageFromFence('Python')).toBe('python')
    expect(codeLanguageFromFence('py')).toBe('python')
    expect(codeLanguageFromFence('brainfuck')).toBe(undefined)
    expect(codeLanguageFromFence('')).toBe(undefined)
  })

  it('maps tokens and diff kinds onto the theme palette', () => {
    expect(codeColor('keyword', defaultTheme)).toBe(defaultTheme.code?.keyword)
    expect(codeColor('string', defaultTheme)).toBe(defaultTheme.code?.string)
    expect(codeColor('number', defaultTheme)).toBe(defaultTheme.code?.number)
    expect(codeColor('comment', defaultTheme)).toBe(defaultTheme.code?.comment)
    expect(codeColor('type', defaultTheme)).toBe(defaultTheme.code?.type)
    expect(codeColor('plain', defaultTheme)).toBe(undefined)
    expect(diffColor('add', defaultTheme)).toBe(defaultTheme.code?.added)
    expect(diffColor('remove', defaultTheme)).toBe(defaultTheme.code?.removed)
    expect(diffColor('hunk', defaultTheme)).toBe(defaultTheme.code?.hunk)
    expect(diffColor('meta', defaultTheme)).toBe(defaultTheme.dim)
    expect(diffColor('context', defaultTheme)).toBe(undefined)
  })

  it('falls back to the base palette for themes that omit code colors', () => {
    expect(codeColor('keyword', legacyTheme)).toBe(defaultTheme.code?.keyword)
    expect(diffColor('add', legacyTheme)).toBe(defaultTheme.code?.added)
    expect(diffSegments({ kind: 'remove', text: '-x' }, legacyTheme)).toHaveLength(1)
  })
})
