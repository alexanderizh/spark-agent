import { spawn } from 'node:child_process'
import * as path from 'node:path'
import type { RegisteredTool, ToolContext, ToolResult } from '../tool-registry.js'

const DEFAULT_TIMEOUT_MS = 30_000
const MAX_TIMEOUT_MS = 120_000
const MAX_OUTPUT_BYTES = 50_000
const TRUNCATION_NOTICE = '\n...<output truncated, use more specific commands to narrow results>'

/** Commands that are inherently safe (read-only, no side effects) */
const READONLY_COMMANDS = new Set([
  'ls', 'cat', 'find', 'which', 'echo', 'pwd', 'env', 'whoami', 'date', 'uname',
  'head', 'tail', 'wc', 'sort', 'uniq', 'diff', 'file', 'stat', 'df', 'du',
  'tree', 'type', 'printenv', 'id', 'hostname', 'arch', 'uptime',
])

/** Patterns that are ALWAYS blocked regardless of permission mode */
const BLOCKED_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /rm\s+(-[a-zA-Z]*f[a-zA-Z]*\s+)?(--no-preserve-root\s+)?\/(\s|$)/, reason: 'Refusing to delete root filesystem' },
  { pattern: /mkfs\b/, reason: 'Refusing to format filesystem' },
  { pattern: /dd\s+.*of=\/dev\//, reason: 'Refusing to write to block devices' },
  { pattern: /:\(\)\{.*;\}\s*;/, reason: 'Refusing to execute fork bomb' },
  { pattern: />(\/dev\/sda|\/dev\/hda|\/dev\/nvme)/i, reason: 'Refusing to write to block devices' },
  { pattern: /chmod\s+(-R\s+)?000\s+\//, reason: 'Refusing to lock root filesystem' },
  { pattern: /curl\s+.*\|\s*(ba)?sh/, reason: 'Refusing to pipe remote content to shell' },
  { pattern: /wget\s+.*\|\s*(ba)?sh/, reason: 'Refusing to pipe remote content to shell' },
]

/**
 * Check if a command is blocked (always denied).
 * Returns the reason string if blocked, or null if allowed.
 */
export function checkBlocked(command: string): string | null {
  const trimmed = command.trim()
  for (const { pattern, reason } of BLOCKED_PATTERNS) {
    if (pattern.test(trimmed)) return reason
  }
  return null
}

/**
 * Get the base command name from a shell command string.
 * Handles quoted commands, pipes, and redirections.
 */
export function getBaseCommand(command: string): string {
  const trimmed = command.trim()
  // Remove leading env/sudo/time prefixes
  let cleaned = trimmed
  while (/^(env\s+|sudo\s+|time\s+)/.test(cleaned)) {
    cleaned = cleaned.replace(/^(env\s+|sudo\s+|time\s+)/, '')
  }
  // Skip env variable assignments (KEY=VALUE patterns)
  while (/^[A-Za-z_][A-Za-z0-9_]*=/.test(cleaned)) {
    cleaned = cleaned.replace(/^[A-Za-z_][A-Za-z0-9_]*=\S*\s*/, '')
  }
  // Handle pipes — check first command
  const firstSegment = cleaned.split('|')[0]?.trim() ?? cleaned
  // Handle redirections
  const withoutRedirect = firstSegment.split(/>\s*/)[0]?.trim() ?? firstSegment
  // Extract command name (first word, handling quoted paths)
  const match = withoutRedirect.match(/^"([^"]+)"|^'([^']+)'|^([^\s]+)/)
  if (!match) return ''
  const cmdPath = match[1] ?? match[2] ?? match[3] ?? ''
  return path.basename(cmdPath)
}

/**
 * Check if a command is read-only (safe for auto-approval).
 */
export function isReadonlyCommand(command: string): boolean {
  const baseCmd = getBaseCommand(command)
  return READONLY_COMMANDS.has(baseCmd)
}

/**
 * Truncate output to MAX_OUTPUT_BYTES.
 */
function truncateOutput(output: string): string {
  if (output.length <= MAX_OUTPUT_BYTES) return output
  return output.slice(0, MAX_OUTPUT_BYTES) + TRUNCATION_NOTICE
}

/**
 * Resolve and validate working directory within workspace.
 */
function resolveCwd(workspaceRoot: string, cwd?: string): string | null {
  if (!cwd) return workspaceRoot
  const resolved = path.resolve(workspaceRoot, cwd)
  const normalizedRoot = path.resolve(workspaceRoot)
  if (!resolved.startsWith(normalizedRoot)) return null
  return resolved
}

/**
 * bash tool — Execute a bash command in the workspace directory.
 *
 * Safety features:
 * - Spawn-based execution with proper timeout control
 * - Path traversal prevention (cwd must be within workspace)
 * - Dangerous command blocking (rm -rf /, mkfs, dd, etc.)
 * - Output truncation to prevent memory issues
 * - Read-only command detection for permission auto-approval
 */
export const bashTool: RegisteredTool = {
  definition: {
    name: 'bash',
    description:
      'Execute a bash command in the workspace directory. ' +
      'Use this tool for running shell commands, scripts, build tools, and any CLI operations. ' +
      'The command runs in the workspace root by default. ' +
      'Read-only commands (ls, cat, find, etc.) are auto-approved; ' +
      'write commands require user approval depending on permission mode.',
    inputSchema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The bash command to execute',
        },
        cwd: {
          type: 'string',
          description: 'Working directory relative to workspace root (default: workspace root)',
        },
        timeout: {
          type: 'number',
          description: 'Timeout in seconds (default: 30, max: 120)',
        },
      },
      required: ['command'],
    },
  },

  async execute(ctx: ToolContext, input: Record<string, unknown>): Promise<ToolResult> {
    const start = Date.now()
    const command = String(input['command'] ?? '').trim()

    if (!command) {
      return { status: 'error', error: 'No command provided', durationMs: Date.now() - start }
    }

    // Check blocked patterns
    const blockReason = checkBlocked(command)
    if (blockReason) {
      return { status: 'error', error: `Command blocked: ${blockReason}`, durationMs: Date.now() - start }
    }

    // Resolve cwd
    const cwd = resolveCwd(ctx.workspaceRootPath, input['cwd'] ? String(input['cwd']) : undefined)
    if (!cwd) {
      return { status: 'error', error: 'Working directory is outside workspace', durationMs: Date.now() - start }
    }

    // Parse timeout
    const timeoutSeconds = typeof input['timeout'] === 'number' ? input['timeout'] : 30
    const timeoutMs = Math.min(Math.max(timeoutSeconds * 1000, 1000), MAX_TIMEOUT_MS)

    return new Promise<ToolResult>((resolve) => {
      let stdout = ''
      let stderr = ''
      let killed = false

      const proc = spawn('bash', ['-c', command], {
        cwd,
        env: { ...process.env },
        stdio: ['pipe', 'pipe', 'pipe'],
        // Security: do not setuid/setgid
        uid: undefined,
        gid: undefined,
      })

      const timer = setTimeout(() => {
        killed = true
        proc.kill('SIGTERM')
        // Give process 3 seconds to clean up, then force kill
        setTimeout(() => {
          if (!proc.killed) proc.kill('SIGKILL')
        }, 3000)
      }, timeoutMs)

      proc.stdout.on('data', (data: Buffer) => {
        stdout += data.toString()
      })

      proc.stderr.on('data', (data: Buffer) => {
        stderr += data.toString()
      })

      proc.on('close', (code) => {
        clearTimeout(timer)
        const durationMs = Date.now() - start
        const combinedOutput = [stdout, stderr].filter(Boolean).join('\n')

        if (killed) {
          resolve({
            status: 'error',
            error: `Command timed out after ${timeoutMs / 1000}s\n${truncateOutput(combinedOutput)}`,
            durationMs,
          })
          return
        }

        if (code === 0) {
          resolve({
            status: 'success',
            output: truncateOutput(stdout || '(no output)'),
            durationMs,
          })
        } else {
          resolve({
            status: 'error',
            error: `Exit code ${code}\n${truncateOutput(combinedOutput)}`,
            durationMs,
          })
        }
      })

      proc.on('error', (err) => {
        clearTimeout(timer)
        resolve({
          status: 'error',
          error: `Failed to spawn process: ${err.message}`,
          durationMs: Date.now() - start,
        })
      })

      // Close stdin
      proc.stdin.end()
    })
  },
}
