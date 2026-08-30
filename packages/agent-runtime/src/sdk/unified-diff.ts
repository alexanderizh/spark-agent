import { createTwoFilesPatch } from 'diff'

const MAX_DIFF_CHARS = 24_000
const MAX_DIFF_LINES = 500
const MAX_EDIT_LENGTH = 1_000
const DIFF_CONTEXT_LINES = 3
const TRUNCATION_MARKER = '\\ Diff truncated by Spark to protect the session timeline'

export function buildUnifiedDiff(
  filePath: string,
  oldLines: readonly string[],
  newLines: readonly string[],
): string | null {
  if (linesEqual(oldLines, newLines)) return null

  const safePath = sanitizeFilePath(filePath)
  const oldText = oldLines.join('\n')
  const newText = newLines.join('\n')
  const patch = createTwoFilesPatch(
    `a/${safePath}`,
    `b/${safePath}`,
    oldText,
    newText,
    undefined,
    undefined,
    { context: DIFF_CONTEXT_LINES, maxEditLength: MAX_EDIT_LENGTH },
  )

  if (patch == null) return boundedFallbackPatch(safePath, oldLines.length, newLines.length)
  return boundPatch(patch.trimEnd())
}

function linesEqual(oldLines: readonly string[], newLines: readonly string[]): boolean {
  if (oldLines.length !== newLines.length) return false
  return oldLines.every((line, index) => line === newLines[index])
}

function sanitizeFilePath(filePath: string): string {
  const sanitized = filePath.replace(/[\r\n]+/g, ' ').trim()
  return sanitized.length > 0 ? sanitized : 'unknown'
}

function boundedFallbackPatch(path: string, oldCount: number, newCount: number): string {
  return [
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -1,${oldCount} +1,${newCount} @@`,
    TRUNCATION_MARKER,
  ].join('\n')
}

function boundPatch(patch: string): string {
  const lines = patch.split('\n')
  if (lines.length <= MAX_DIFF_LINES && patch.length <= MAX_DIFF_CHARS) return patch

  const bounded: string[] = []
  let charCount = 0
  for (const line of lines) {
    const nextLength = line.length + (bounded.length > 0 ? 1 : 0)
    if (
      bounded.length >= MAX_DIFF_LINES - 1 ||
      charCount + nextLength > MAX_DIFF_CHARS - TRUNCATION_MARKER.length - 1
    ) {
      break
    }
    bounded.push(line)
    charCount += nextLength
  }
  bounded.push(TRUNCATION_MARKER)
  return bounded.join('\n')
}
