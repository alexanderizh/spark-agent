import { describe, expect, it } from 'vitest'
import {
  classifyCodeBlock,
  detectSemanticLineTone,
  parseDiffCodeLines,
  parseLogCodeLines,
  parseTerminalCodeLines,
} from './codeBlockSemantics'

describe('classifyCodeBlock', () => {
  it('treats explicit diff aliases as diff', () => {
    expect(classifyCodeBlock('diff', '')).toBe('diff')
    expect(classifyCodeBlock(' patch ', '')).toBe('diff')
    expect(classifyCodeBlock('git-diff', '')).toBe('diff')
  })

  it('treats terminal / console aliases as terminal', () => {
    expect(classifyCodeBlock('terminal', '')).toBe('terminal')
    expect(classifyCodeBlock('console', '')).toBe('terminal')
    expect(classifyCodeBlock('shell-session', '')).toBe('terminal')
  })

  it('treats log aliases as log', () => {
    expect(classifyCodeBlock('log', '')).toBe('log')
    expect(classifyCodeBlock('syslog', '')).toBe('log')
  })

  it('keeps bash/json/yaml/markdown as source even when a diff appears in the body', () => {
    const body = 'git status\ndiff --git a b\n+ x\n- y\n'
    expect(classifyCodeBlock('bash', body)).toBe('source')
    expect(classifyCodeBlock('json', body)).toBe('source')
    expect(classifyCodeBlock('yaml', body)).toBe('source')
  })

  it('auto-detects unified diff only when text/plain fences and the body is well-formed', () => {
    const diff = '--- a/file.ts\n+++ b/file.ts\n@@ -1,1 +1,1 @@\n-old\n+new\n'
    expect(classifyCodeBlock('', diff)).toBe('diff')
    expect(classifyCodeBlock('text', diff)).toBe('diff')

    const loose = 'the + and - operators\nare not enough'
    expect(classifyCodeBlock('', loose)).toBe('source')
  })
})

describe('parseDiffCodeLines', () => {
  it('keeps +++/--- as file headers instead of add/del', () => {
    const lines = parseDiffCodeLines('--- a/file.ts\n+++ b/file.ts\n@@ -1,1 +1,1 @@\n-old\n+new')
    expect(lines.map((l) => l.kind)).toEqual([
      'file-old',
      'file-new',
      'hunk',
      'del',
      'add',
    ])
  })

  it('classifies meta, hunk, add, del, context and notices', () => {
    const sample = [
      'diff --git a/x b/x',
      'index 1234..5678 100644',
      '--- a/x',
      '+++ b/x',
      '@@ -1,2 +1,2 @@',
      ' context',
      '-removed',
      '+added',
      '\\ No newline at end of file',
    ].join('\n')
    const lines = parseDiffCodeLines(sample)
    expect(lines.map((l) => l.kind)).toEqual([
      'file',
      'meta',
      'file-old',
      'file-new',
      'hunk',
      'context',
      'del',
      'add',
      'notice',
    ])
  })

  it('handles CRLF line endings and trailing empty lines', () => {
    const lines = parseDiffCodeLines('+ added\r\n- removed')
    expect(lines.map((l) => l.kind)).toEqual(['add', 'del'])
    expect(lines[0]?.marker).toBe('+')
  })
})

describe('parseTerminalCodeLines', () => {
  it('detects prompts in common shells', () => {
    const lines = parseTerminalCodeLines('user@host:~$ ls -la\nREADME.md\nPS C:\\Users\\demo> dir\n')
    expect(lines[0]?.kind).toBe('command')
    expect(lines[0]?.prompt).toContain('$')
    expect(lines[1]?.kind).toBe('output')
    expect(lines[2]?.prompt).toContain('>')
  })

  it('keeps error / success / warning tones for output lines', () => {
    const lines = parseTerminalCodeLines('npm ERR! something failed\n✔ success\n⚠ deprecated\nok done\n')
    expect(lines[0]?.tone).toBe('error')
    expect(lines[1]?.tone).toBe('success')
    expect(lines[2]?.tone).toBe('warning')
    expect(lines[3]?.tone).toBe('success')
  })
})

describe('parseLogCodeLines', () => {
  it('maps common levels to tones', () => {
    const lines = parseLogCodeLines(
      [
        '2025-01-02 03:04:05 INFO server listening on 3000',
        '[2025-01-02T03:04:06Z] WARN retrying connection',
        'ERROR boom',
        'DEBUG verbose detail',
        'plain text without a level',
      ].join('\n'),
    )
    expect(lines[0]?.tone).toBe('info')
    expect(lines[1]?.tone).toBe('warning')
    expect(lines[2]?.tone).toBe('error')
    expect(lines[3]?.tone).toBe('debug')
    expect(lines[4]?.tone).toBe('neutral')
  })

  it('does not mis-classify error-like words inside the body', () => {
    const lines = parseLogCodeLines('2025-01-02 INFO caused by error in user input')
    expect(lines[0]?.tone).toBe('info')
  })
})

describe('detectSemanticLineTone', () => {
  it('returns null tone for ordinary lines', () => {
    expect(detectSemanticLineTone('hello world')).toBe('neutral')
  })

  it('reads levels with bracketed prefixes', () => {
    expect(detectSemanticLineTone('[ERROR] oops')).toBe('error')
    expect(detectSemanticLineTone('[success] saved')).toBe('success')
  })
})
