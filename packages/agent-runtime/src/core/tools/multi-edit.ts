import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { RegisteredTool, ToolContext, ToolResult } from '../tool-registry.js'

interface SingleEdit {
  oldText: string
  newText: string
  replaceAll?: boolean
}

const DESCRIPTION = `Apply multiple string replacements to a single file ATOMICALLY.

WHY THIS EXISTS:
- Avoids the read-then-edit-then-read-then-edit cycle that wastes tool turns and tokens.
- All edits are applied in-memory first; if ANY edit fails, the file is NOT written.

RULES:
- edits[i].oldText must occur in the file (after previous edits have been applied).
- If oldText appears multiple times, set replaceAll: true, otherwise the call fails.
- Edits are applied in order, so later edits see the result of earlier ones.
- For NEW files, prefer write_file instead.`

export const multiEditTool: RegisteredTool = {
  definition: {
    name: 'multi_edit',
    description: DESCRIPTION,
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        edits: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            properties: {
              oldText: { type: 'string' },
              newText: { type: 'string' },
              replaceAll: { type: 'boolean', description: 'Replace all occurrences (default false; non-unique oldText otherwise errors)' },
            },
            required: ['oldText', 'newText'],
          },
        },
      },
      required: ['path', 'edits'],
    },
  },
  async execute(ctx: ToolContext, input: Record<string, unknown>): Promise<ToolResult> {
    const start = Date.now()
    const relPath = String(input['path'] ?? '')
    if (relPath.length === 0) return { status: 'error', error: 'path is required', durationMs: Date.now() - start }

    const safePath = resolveSafe(ctx.workspaceRootPath, relPath)
    if (safePath == null) return { status: 'error', error: 'path outside workspace', durationMs: Date.now() - start }

    const rawEdits = input['edits']
    if (!Array.isArray(rawEdits) || rawEdits.length === 0) {
      return { status: 'error', error: 'edits must be a non-empty array', durationMs: Date.now() - start }
    }

    const edits: SingleEdit[] = []
    for (let i = 0; i < rawEdits.length; i += 1) {
      const e = rawEdits[i] as Record<string, unknown> | null
      if (e == null || typeof e !== 'object') {
        return { status: 'error', error: `edits[${i}] is not an object`, durationMs: Date.now() - start }
      }
      const oldText = e['oldText']
      const newText = e['newText']
      if (typeof oldText !== 'string' || oldText.length === 0) {
        return { status: 'error', error: `edits[${i}].oldText must be a non-empty string`, durationMs: Date.now() - start }
      }
      if (typeof newText !== 'string') {
        return { status: 'error', error: `edits[${i}].newText must be a string`, durationMs: Date.now() - start }
      }
      if (oldText === newText) {
        return { status: 'error', error: `edits[${i}]: oldText and newText are identical (no-op)`, durationMs: Date.now() - start }
      }
      edits.push({ oldText, newText, replaceAll: e['replaceAll'] === true })
    }

    let content: string
    try {
      content = await fs.readFile(safePath, 'utf-8')
    } catch (err) {
      return { status: 'error', error: `read failed: ${err instanceof Error ? err.message : String(err)}`, durationMs: Date.now() - start }
    }

    // Apply all edits in-memory; abort on first failure (atomic).
    let working = content
    const appliedCounts: number[] = []
    for (let i = 0; i < edits.length; i += 1) {
      const edit = edits[i]!
      const occurrences = countOccurrences(working, edit.oldText)
      if (occurrences === 0) {
        return {
          status: 'error',
          error: `edits[${i}]: oldText not found (file unchanged). First chars of oldText: ${JSON.stringify(edit.oldText.slice(0, 80))}`,
          durationMs: Date.now() - start,
        }
      }
      if (occurrences > 1 && edit.replaceAll !== true) {
        return {
          status: 'error',
          error: `edits[${i}]: oldText appears ${occurrences} times (file unchanged). Set replaceAll: true, or use a more specific oldText.`,
          durationMs: Date.now() - start,
        }
      }
      working = edit.replaceAll === true
        ? working.split(edit.oldText).join(edit.newText)
        : working.replace(edit.oldText, edit.newText)
      appliedCounts.push(edit.replaceAll === true ? occurrences : 1)
    }

    try {
      await fs.writeFile(safePath, working, 'utf-8')
    } catch (err) {
      return { status: 'error', error: `write failed: ${err instanceof Error ? err.message : String(err)}`, durationMs: Date.now() - start }
    }

    return {
      status: 'success',
      output: {
        path: relPath,
        editsApplied: edits.length,
        replacementsByEdit: appliedCounts,
        bytesBefore: Buffer.byteLength(content, 'utf-8'),
        bytesAfter: Buffer.byteLength(working, 'utf-8'),
      },
      durationMs: Date.now() - start,
    }
  },
}

function resolveSafe(root: string, filePath: string): string | null {
  const resolved = path.resolve(root, filePath)
  const normalizedRoot = path.resolve(root)
  return resolved.startsWith(normalizedRoot) ? resolved : null
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0
  let count = 0
  let from = 0
  while (true) {
    const idx = haystack.indexOf(needle, from)
    if (idx < 0) break
    count += 1
    from = idx + needle.length
  }
  return count
}
