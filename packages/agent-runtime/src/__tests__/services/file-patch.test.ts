/**
 * File hunk reverse-apply logic tests
 *
 * Tests the core diff reverse-apply algorithm used by FilePatchService
 * for file-level hunk accept/reject.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

/**
 * Core reverse-apply logic extracted from FilePatchService for testing.
 * In production this runs in the main process via FilePatchService.ts.
 */

interface PatchResult {
  applied: boolean
  error?: string
}

function applyHunkPatch(params: {
  filePath: string
  hunkDiff: string
  direction: 'forward' | 'reverse'
}): PatchResult {
  const { filePath, hunkDiff, direction } = params

  const headerMatch = hunkDiff.match(/^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/)
  if (headerMatch == null) {
    return { applied: false, error: 'Invalid hunk header' }
  }

  const oldStart = parseInt(headerMatch[1]!, 10)
  const oldCount = parseInt(headerMatch[2] ?? '1', 10)
  const newCount = parseInt(headerMatch[4] ?? '1', 10)

  const hunkLines = hunkDiff.split('\n').slice(1)
  const removedLines: string[] = []
  const addedLines: string[] = []

  for (const line of hunkLines) {
    if (line.startsWith('-')) {
      removedLines.push(line.slice(1))
    } else if (line.startsWith('+')) {
      addedLines.push(line.slice(1))
    } else if (line.startsWith(' ')) {
      removedLines.push(line.slice(1))
      addedLines.push(line.slice(1))
    }
  }

  const content = readFileSync(filePath, 'utf-8')
  const lines = content.split('\n')

  if (direction === 'reverse') {
    return reverseApplyHunk(lines, oldStart, newCount, addedLines, removedLines, filePath)
  } else {
    return reverseApplyHunk(lines, parseInt(headerMatch[3]!, 10), oldCount, removedLines, addedLines, filePath)
  }
}

function reverseApplyHunk(
  fileLines: string[],
  startLine: number,
  expectedCount: number,
  sourceLines: string[],
  targetLines: string[],
  absPath: string,
): PatchResult {
  const startIdx = startLine - 1

  if (startIdx < 0 || startIdx >= fileLines.length) {
    return { applied: false, error: `Start line ${startLine} out of range` }
  }

  const searchWindow = 5
  let bestMatchIdx = -1
  let bestMatchScore = 0

  for (let offset = -searchWindow; offset <= searchWindow; offset++) {
    const idx = startIdx + offset
    if (idx < 0 || idx + sourceLines.length > fileLines.length) continue

    let matchScore = 0
    for (let j = 0; j < sourceLines.length; j++) {
      if (fileLines[idx + j] === sourceLines[j]) {
        matchScore++
      }
    }

    if (matchScore > bestMatchScore) {
      bestMatchScore = matchScore
      bestMatchIdx = idx
    }
  }

  if (bestMatchIdx === -1 || bestMatchScore < sourceLines.length * 0.5) {
    return { applied: false, error: `Could not find matching lines at position ${startLine}` }
  }

  const newLines = [
    ...fileLines.slice(0, bestMatchIdx),
    ...targetLines,
    ...fileLines.slice(bestMatchIdx + sourceLines.length),
  ]

  writeFileSync(absPath, newLines.join('\n'), 'utf-8')
  return { applied: true }
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('File hunk reverse-apply', () => {
  let testDir: string
  let testFile: string

  beforeEach(() => {
    testDir = join(tmpdir(), `spark-patch-test-${Date.now()}`)
    mkdirSync(testDir, { recursive: true })
    testFile = join(testDir, 'test.txt')
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  it('should reverse a single-line change', () => {
    writeFileSync(testFile, 'line1\nline2-old\nline3\n', 'utf-8')

    // Forward: replace line2-old with line2-new
    const hunk = '@@ -1,3 +1,3 @@\n line1\n-line2-old\n+line2-new\n line3'

    const fwd = applyHunkPatch({ filePath: testFile, hunkDiff: hunk, direction: 'forward' })
    expect(fwd.applied).toBe(true)
    expect(readFileSync(testFile, 'utf-8')).toContain('line2-new')

    // Reverse: put line2-old back
    const rev = applyHunkPatch({ filePath: testFile, hunkDiff: hunk, direction: 'reverse' })
    expect(rev.applied).toBe(true)
    expect(readFileSync(testFile, 'utf-8')).toContain('line2-old')
  })

  it('should reverse multi-line changes', () => {
    writeFileSync(testFile, 'aaa\nbbb\nccc\nddd\neee\n', 'utf-8')

    const hunk = '@@ -2,3 +2,3 @@\n-bbb\n-ccc\n-ddd\n+BBB\n+CCC\n+DDD'

    const fwd = applyHunkPatch({ filePath: testFile, hunkDiff: hunk, direction: 'forward' })
    expect(fwd.applied).toBe(true)
    expect(readFileSync(testFile, 'utf-8')).toBe('aaa\nBBB\nCCC\nDDD\neee\n')

    const rev = applyHunkPatch({ filePath: testFile, hunkDiff: hunk, direction: 'reverse' })
    expect(rev.applied).toBe(true)
    expect(readFileSync(testFile, 'utf-8')).toBe('aaa\nbbb\nccc\nddd\neee\n')
  })

  it('should return error for invalid hunk header', () => {
    writeFileSync(testFile, 'content\n', 'utf-8')
    const result = applyHunkPatch({ filePath: testFile, hunkDiff: 'not a hunk', direction: 'reverse' })
    expect(result.applied).toBe(false)
    expect(result.error).toContain('Invalid hunk header')
  })

  it('should return error when lines cannot be matched', () => {
    writeFileSync(testFile, 'completely\ndifferent\ncontent\n', 'utf-8')
    const result = applyHunkPatch({
      filePath: testFile,
      hunkDiff: '@@ -1,2 +1,2 @@\n-expected-old\n-expected-old2\n+new1\n+new2',
      direction: 'reverse',
    })
    expect(result.applied).toBe(false)
    expect(result.error).toContain('Could not find matching lines')
  })

  it('should handle context-only hunks (no actual changes)', () => {
    writeFileSync(testFile, 'aaa\nbbb\nccc\n', 'utf-8')

    const hunk = '@@ -1,3 +1,3 @@\n aaa\n bbb\n ccc'
    const result = applyHunkPatch({ filePath: testFile, hunkDiff: hunk, direction: 'reverse' })
    expect(result.applied).toBe(true)
    // File content unchanged since context lines match both sides
    expect(readFileSync(testFile, 'utf-8')).toBe('aaa\nbbb\nccc\n')
  })

  it('should round-trip forward then reverse preserving original', () => {
    const original = 'foo\nbar\nbaz\nqux\nquux\n'
    writeFileSync(testFile, original, 'utf-8')

    const hunk = '@@ -2,2 +2,2 @@\n-bar\n-baz\n+BAR\n+BAZ'

    // Forward
    applyHunkPatch({ filePath: testFile, hunkDiff: hunk, direction: 'forward' })
    expect(readFileSync(testFile, 'utf-8')).toContain('BAR')

    // Reverse
    applyHunkPatch({ filePath: testFile, hunkDiff: hunk, direction: 'reverse' })
    expect(readFileSync(testFile, 'utf-8')).toBe(original)
  })
})
