/**
 * @module FilePatchService
 *
 * Applies or reverse-applies unified diff hunks to workspace files.
 *
 * Used by the HunkDiff accept/reject UI to revert individual hunks.
 * When the user rejects a hunk, this service reverse-applies the diff
 * to restore the original file content for that hunk's range.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, isAbsolute } from 'node:path'
import { createLogger } from '@spark/shared'

const log = createLogger('file-patch-service')

export interface ApplyHunkPatchParams {
  workspaceRootPath: string
  filePath: string
  hunkDiff: string
  direction: 'forward' | 'reverse'
}

export interface ApplyHunkPatchResult {
  applied: boolean
  error?: string
}

/**
 * Apply or reverse-apply a single unified diff hunk to a file.
 *
 * Strategy:
 * 1. Parse the hunk header (`@@ -oldStart,oldCount +newStart,newCount @@`)
 * 2. Read the target file
 * 3. Split into lines
 * 4. Find the matching lines at the expected position
 * 5. Replace the relevant lines
 * 6. Write the file back
 */
export function applyHunkPatch(params: ApplyHunkPatchParams): ApplyHunkPatchResult {
  const { workspaceRootPath, filePath, hunkDiff, direction } = params

  const absPath = isAbsolute(filePath) ? filePath : join(workspaceRootPath, filePath)

  if (!existsSync(absPath)) {
    return { applied: false, error: `File not found: ${absPath}` }
  }

  try {
    const headerMatch = hunkDiff.match(/^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/)
    if (headerMatch == null) {
      return { applied: false, error: 'Invalid hunk header' }
    }

    const oldStart = parseInt(headerMatch[1]!, 10)
    const oldCount = parseInt(headerMatch[2] ?? '1', 10)
    const newCount = parseInt(headerMatch[4] ?? '1', 10)

    // Parse hunk lines after the header
    const hunkLines = hunkDiff.split('\n').slice(1)
    const removedLines: string[] = []
    const addedLines: string[] = []

    for (const line of hunkLines) {
      if (line.startsWith('-')) {
        removedLines.push(line.slice(1))
      } else if (line.startsWith('+')) {
        addedLines.push(line.slice(1))
      } else if (line.startsWith(' ')) {
        // Context line — belongs to both sides
        removedLines.push(line.slice(1))
        addedLines.push(line.slice(1))
      }
      // Skip other lines (e.g. empty trailing lines)
    }

    // Read the current file
    const content = readFileSync(absPath, 'utf-8')
    const lines = content.split('\n')

    if (direction === 'reverse') {
      // Reverse: the file currently has the "new" content.
      // We need to replace the "new" lines with the "old" lines.
      // For reverse, we swap: the "added" lines are what's in the file,
      // and we replace them with the "removed" lines.
      return reverseApplyHunk(lines, oldStart, newCount, addedLines, removedLines, absPath)
    } else {
      // Forward: the file has the "old" content.
      // Replace old lines with new lines.
      return reverseApplyHunk(lines, parseInt(headerMatch[3]!, 10), oldCount, removedLines, addedLines, absPath)
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.error(`Failed to apply hunk patch to ${absPath}: ${message}`)
    return { applied: false, error: message }
  }
}

/**
 * Reverse-apply: find the `sourceLines` in the file at the expected position
 * and replace them with `targetLines`.
 */
function reverseApplyHunk(
  fileLines: string[],
  startLine: number,
  expectedCount: number,
  sourceLines: string[],
  targetLines: string[],
  absPath: string,
): ApplyHunkPatchResult {
  // Line numbers in unified diff are 1-based
  const startIdx = startLine - 1

  if (startIdx < 0 || startIdx >= fileLines.length) {
    return { applied: false, error: `Start line ${startLine} out of range (file has ${fileLines.length} lines)` }
  }

  // Try to find the source lines at the expected position
  // Allow some fuzziness — search in a window around the expected position
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
    return {
      applied: false,
      error: `Could not find matching lines at position ${startLine} (best match: ${bestMatchScore}/${sourceLines.length})`,
    }
  }

  // Replace the matched lines with target lines
  const newLines = [
    ...fileLines.slice(0, bestMatchIdx),
    ...targetLines,
    ...fileLines.slice(bestMatchIdx + sourceLines.length),
  ]

  writeFileSync(absPath, newLines.join('\n'), 'utf-8')
  log.info(`Applied hunk patch to ${absPath}: replaced ${sourceLines.length} lines with ${targetLines.length} lines at position ${bestMatchIdx + 1}`)

  return { applied: true }
}
