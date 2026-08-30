import { describe, expect, it } from 'vitest'
import { buildUnifiedDiff } from './unified-diff.js'

describe('buildUnifiedDiff', () => {
  it('emits focused line hunks and keeps unchanged context', () => {
    const oldLines = ['alpha', 'shared one', 'before', 'shared two', 'omega']
    const newLines = ['alpha', 'shared one', 'after', 'shared two', 'omega']

    const diff = buildUnifiedDiff('src/example.ts', oldLines, newLines)

    expect(diff).toContain('--- a/src/example.ts')
    expect(diff).toContain('+++ b/src/example.ts')
    expect(diff).toContain('-before')
    expect(diff).toContain('+after')
    expect(diff).toContain(' shared one')
    expect(diff).not.toContain('-alpha\n-shared one')
    expect(diff).not.toContain('+alpha\n+shared one')
  })

  it('returns null when inputs are identical', () => {
    expect(buildUnifiedDiff('src/example.ts', ['same'], ['same'])).toBeNull()
  })

  it('sanitizes file names against diff-header injection', () => {
    const diff = buildUnifiedDiff('safe.ts\n+++ forged.ts\r', ['old'], ['new'])

    expect(diff).not.toContain('\n+++ forged.ts')
    expect(diff).toContain('safe.ts +++ forged.ts')
  })

  it('bounds output for very large changes', () => {
    const oldLines = Array.from({ length: 20_000 }, (_, index) => `old-${index}`)
    const newLines = Array.from({ length: 20_000 }, (_, index) => `new-${index}`)

    const diff = buildUnifiedDiff('src/large.ts', oldLines, newLines)

    expect(diff).not.toBeNull()
    if (diff == null) throw new Error('Expected a bounded fallback diff')
    expect(diff.length).toBeLessThanOrEqual(24_000)
    expect(diff.split('\n').length).toBeLessThanOrEqual(500)
    expect(diff).toContain('Diff truncated')
  })
})
