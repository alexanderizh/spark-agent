import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import * as path from 'node:path'
import type { RegisteredTool, ToolContext, ToolResult } from '../tool-registry.js'

const execAsync = promisify(exec)
const MAX_OUTPUT_BYTES = 50_000
const DEFAULT_MAX_RESULTS = 100
const TRUNCATION_NOTICE = '\n...<results truncated, use more specific patterns or paths>'

/**
 * Check if ripgrep (rg) is available on the system.
 * Result is cached for the process lifetime.
 */
let rgAvailable: boolean | null = null
async function isRgAvailable(): Promise<boolean> {
  if (rgAvailable !== null) return rgAvailable
  try {
    await execAsync('rg --version', { timeout: 5000 })
    rgAvailable = true
  } catch {
    rgAvailable = false
  }
  return rgAvailable
}

/**
 * Search using ripgrep (rg).
 * Returns structured results with file path, line number, and matched text.
 */
async function searchWithRg(
  pattern: string,
  searchPath: string,
  includeGlob: string | undefined,
  maxResults: number,
  caseSensitive: boolean,
): Promise<string> {
  const args: string[] = ['rg']

  // Output format: JSON lines for structured parsing
  args.push('--json')

  // Max results
  args.push('-m', String(maxResults))

  // Case sensitivity
  if (!caseSensitive) args.push('-i')

  // File glob filter
  if (includeGlob) {
    args.push('--glob', includeGlob)
  }

  // No filename display (we get it from JSON)
  args.push('--no-heading')

  // The pattern and path
  args.push('--', pattern, searchPath)

  try {
    const { stdout } = await execAsync(args.join(' '), {
      timeout: 30_000,
      maxBuffer: 2 * MAX_OUTPUT_BYTES,
    })

    // Parse JSON lines output from rg
    const results: Array<{ path: string; line: number; text: string }> = []
    for (const line of stdout.split('\n')) {
      if (results.length >= maxResults) break
      if (!line.trim()) continue
      try {
        const entry = JSON.parse(line) as { type: string; data?: { path?: { text: string }; line_number?: number; lines?: { text: string } } }
        if (entry.type === 'match' && entry.data) {
          results.push({
            path: entry.data.path?.text ?? '',
            line: entry.data.line_number ?? 0,
            text: (entry.data.lines?.text ?? '').trimEnd(),
          })
        }
      } catch {
        // Skip non-JSON lines
      }
    }

    if (results.length === 0) return 'No matches found'
    return results.map((r) => `${r.path}:${r.line}: ${r.text}`).join('\n')
  } catch (err) {
    // rg exits with code 1 when no matches found — this is normal, not an error
    // Node.js exec wraps this as an Error with stdout/stderr properties
    // Exit code 2 means actual error (bad pattern, permission denied, etc.)
    const error = err as { code?: string | number; stdout?: string; stderr?: string; message?: string }
    const msg = error.message ?? ''
    // Code 1 = no matches, code 2 = error, other = unexpected
    if (
      error.code === 1 ||
      error.code === '1' ||
      msg.includes('code 1') ||
      (msg.includes('Command failed') && !msg.includes('code 2'))
    ) {
      return 'No matches found'
    }
    throw err
  }
}

/**
 * Fallback search using grep -rn.
 * Used when ripgrep is not available.
 */
async function searchWithGrep(
  pattern: string,
  searchPath: string,
  includeGlob: string | undefined,
  maxResults: number,
  caseSensitive: boolean,
): Promise<string> {
  const args: string[] = ['grep']

  args.push('-rn') // recursive, show line numbers

  // Case sensitivity
  if (!caseSensitive) args.push('-i')

  // File glob filter using --include
  if (includeGlob) {
    args.push('--include', includeGlob)
  }

  // Max results via head
  args.push('--', pattern, searchPath)

  const command = `${args.join(' ')} | head -n ${maxResults}`

  try {
    const { stdout } = await execAsync(command, {
      timeout: 30_000,
      maxBuffer: 2 * MAX_OUTPUT_BYTES,
    })
    if (!stdout.trim()) return 'No matches found'
    return stdout.trim()
  } catch (err) {
    const error = err as { stdout?: string; message?: string }
    // grep exits with code 1 when no matches
    if (error.stdout?.trim()) return error.stdout.trim()
    if (error.message?.includes('exit code 1')) return 'No matches found'
    throw err
  }
}

function truncateOutput(output: string): string {
  if (output.length <= MAX_OUTPUT_BYTES) return output
  return output.slice(0, MAX_OUTPUT_BYTES) + TRUNCATION_NOTICE
}

/**
 * Resolve and validate search path within workspace.
 */
function resolveSearchPath(workspaceRoot: string, inputPath?: string): string | null {
  if (!inputPath) return workspaceRoot
  const resolved = path.resolve(workspaceRoot, inputPath)
  const normalizedRoot = path.resolve(workspaceRoot)
  if (!resolved.startsWith(normalizedRoot)) return null
  return resolved
}

/**
 * grep tool — Search for patterns in files using ripgrep (or grep as fallback).
 *
 * Features:
 * - Uses ripgrep (rg) when available for fast, feature-rich search
 * - Falls back to grep -rn when rg is not installed
 * - Supports file glob filtering (e.g., "*.ts", "*.tsx")
 * - Case-sensitive/insensitive matching
 * - Result count limiting
 * - Auto-approved (read-only, no side effects)
 */
export const grepTool: RegisteredTool = {
  definition: {
    name: 'grep',
    description:
      'Search for text patterns in files using ripgrep (fast) or grep (fallback). ' +
      'Returns matching file paths, line numbers, and content. ' +
      'Supports regex patterns and file type filtering. ' +
      'This is a read-only tool and is auto-approved.',
    inputSchema: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'The regex pattern to search for',
        },
        path: {
          type: 'string',
          description: 'Directory or file to search in (relative to workspace root, default: workspace root)',
        },
        include: {
          type: 'string',
          description: 'File glob pattern to filter (e.g., "*.ts", "*.{tsx,jsx}")',
        },
        maxResults: {
          type: 'number',
          description: 'Maximum number of results to return (default: 100)',
        },
        caseSensitive: {
          type: 'boolean',
          description: 'Whether to perform case-sensitive search (default: false)',
        },
      },
      required: ['pattern'],
    },
  },

  async execute(ctx: ToolContext, input: Record<string, unknown>): Promise<ToolResult> {
    const start = Date.now()
    const pattern = String(input['pattern'] ?? '').trim()

    if (!pattern) {
      return { status: 'error', error: 'No search pattern provided', durationMs: Date.now() - start }
    }

    const searchPath = resolveSearchPath(ctx.workspaceRootPath, input['path'] ? String(input['path']) : undefined)
    if (!searchPath) {
      return { status: 'error', error: 'Search path is outside workspace', durationMs: Date.now() - start }
    }

    const includeGlob = input['include'] ? String(input['include']) : undefined
    const maxResults = typeof input['maxResults'] === 'number' ? input['maxResults'] : DEFAULT_MAX_RESULTS
    const caseSensitive = input['caseSensitive'] === true

    try {
      const useRg = await isRgAvailable()
      let output: string

      if (useRg) {
        output = await searchWithRg(pattern, searchPath, includeGlob, maxResults, caseSensitive)
      } else {
        output = await searchWithGrep(pattern, searchPath, includeGlob, maxResults, caseSensitive)
      }

      return {
        status: 'success',
        output: truncateOutput(output),
        durationMs: Date.now() - start,
      }
    } catch (err) {
      return {
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - start,
      }
    }
  },
}
