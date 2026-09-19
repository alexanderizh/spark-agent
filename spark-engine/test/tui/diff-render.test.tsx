import { render } from 'ink-testing-library'
import { describe, expect, it } from 'vitest'

import { MarkdownText } from '../../src/tui/components/markdown.js'
import { Transcript } from '../../src/tui/components/rows.js'
import {
  buildEditDiff,
  diffLineKind,
  editDiffFromArgs,
  isDiffFence,
  looksLikeUnifiedDiff,
} from '../../src/tui/diff.js'
import { defaultTheme } from '../../src/tui/theme.js'

const capabilities = { color: 'mono', unicode: false, width: 72 } as const

function frameOf(text: string): string {
  const app = render(
    <MarkdownText text={text} theme={defaultTheme} capabilities={{ ...capabilities }} />,
  )
  const frame = app.lastFrame() ?? ''
  app.unmount()
  return frame
}

describe('unified diff classification', () => {
  it('classifies file headers, hunks, additions, removals and context', () => {
    expect(diffLineKind('diff --git a/a.ts b/a.ts')).toBe('meta')
    expect(diffLineKind('--- a/a.ts')).toBe('meta')
    expect(diffLineKind('+++ b/a.ts')).toBe('meta')
    expect(diffLineKind('@@ -1,2 +1,3 @@')).toBe('hunk')
    expect(diffLineKind('+const added = 1')).toBe('add')
    expect(diffLineKind('-const removed = 1')).toBe('remove')
    expect(diffLineKind(' const kept = 1')).toBe('context')
  })

  it('only detects a diff when a hunk or file header is present', () => {
    expect(looksLikeUnifiedDiff(['@@ -1 +1 @@', '-a', '+b'])).toBe(true)
    expect(looksLikeUnifiedDiff(['diff --git a/a b/a', '--- a/a', '+++ b/a', '-a', '+b'])).toBe(
      true,
    )
    // Bullet lists, prose and markdown rules must never be recolored.
    expect(looksLikeUnifiedDiff(['- 第一项', '+ 第二项', '- 第三项'])).toBe(false)
    expect(looksLikeUnifiedDiff(['---', '- 第一项', '+ 第二项'])).toBe(false)
    expect(looksLikeUnifiedDiff(['done', 'no changes'])).toBe(false)
    expect(isDiffFence('diff')).toBe(true)
    expect(isDiffFence('patch')).toBe(true)
    expect(isDiffFence('typescript')).toBe(false)
  })
})

describe('edit patch preview', () => {
  it('counts every changed line and keeps shared context', () => {
    const diff = buildEditDiff('one\ntwo\nthree', 'one\nTWO\nthree')
    expect(diff?.summary).toBe('+1 -1')
    expect(diff?.truncated).toBe(false)
    expect(diff?.lines).toEqual([
      { kind: 'context', text: ' one' },
      { kind: 'remove', text: '-two' },
      { kind: 'add', text: '+TWO' },
      { kind: 'context', text: ' three' },
    ])
  })

  it('reads old/new from the edit arguments and ignores other tools', () => {
    expect(editDiffFromArgs({ old: 'a', new: 'b' })?.summary).toBe('+1 -1')
    expect(editDiffFromArgs({ path: 'a.ts' })).toBe(undefined)
    expect(editDiffFromArgs('not an object')).toBe(undefined)
    expect(buildEditDiff('same', 'same')).toBe(undefined)
  })

  it('bounds long edits and reports whole-edit counters while truncated', () => {
    const before = Array.from({ length: 60 }, (_, index) => `line ${index}`).join('\n')
    const after = Array.from({ length: 60 }, (_, index) => `changed ${index}`).join('\n')
    const diff = buildEditDiff(before, after, 8)
    expect(diff?.lines).toHaveLength(8)
    expect(diff?.lines.at(-1)?.kind).toBe('hunk')
    expect(diff?.lines.at(-1)?.text).toContain('未展开')
    expect(diff?.summary).toBe('+60 -60')
    expect(diff?.truncated).toBe(true)
  })
})

describe('diff rendering in the transcript', () => {
  it('colors a fenced diff without dropping or rewriting characters', () => {
    const fence = ['```diff', '@@ -1,2 +1,2 @@', '-old line', '+new line', '```'].join('\n')
    const frame = frameOf(fence)
    expect(frame).toContain('@@ -1,2 +1,2 @@')
    expect(frame).toContain('-old line')
    expect(frame).toContain('+new line')
    expect(frame).not.toContain('```')
  })

  it('keeps unlabeled code fences verbatim', () => {
    const frame = frameOf(['```', 'plain code', '```'].join('\n'))
    expect(frame).toContain('plain code')
  })

  it('renders the edit patch and its counters under the tool line', () => {
    const diff = buildEditDiff('const a = 1', 'const a = 2')
    const app = render(
      <Transcript
        staticOutput={false}
        theme={defaultTheme}
        capabilities={{ ...capabilities }}
        rows={[
          {
            key: 'edit-1',
            text: '',
            tone: 'dim',
            toolLine: {
              tool: 'edit',
              title: 'Edit · src/app.ts',
              ok: true,
              durationMs: '12ms',
              resultLines: [],
              isTask: false,
              ...(diff === undefined ? {} : { diff }),
            },
          },
        ]}
      />,
    )
    try {
      const frame = app.lastFrame() ?? ''
      expect(frame).toContain('+1 -1')
      expect(frame).toContain('-const a = 1')
      expect(frame).toContain('+const a = 2')
    } finally {
      app.unmount()
    }
  })

  it('leaves ordinary tool output, including bullet lists, uncolored', () => {
    const app = render(
      <Transcript
        staticOutput={false}
        theme={defaultTheme}
        capabilities={{ ...capabilities }}
        rows={[
          {
            key: 'failed-1',
            text: '',
            tone: 'error',
            toolLine: {
              tool: 'bash',
              title: 'Bash · npm test',
              ok: false,
              durationMs: '900ms',
              resultLines: ['- 第一项', '+ 第二项'],
              isTask: false,
            },
          },
        ]}
      />,
    )
    try {
      const frame = app.lastFrame() ?? ''
      expect(frame).toContain('- 第一项')
      expect(frame).toContain('+ 第二项')
    } finally {
      app.unmount()
    }
  })
})
