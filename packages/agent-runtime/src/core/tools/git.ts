import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import type { RegisteredTool, ToolContext, ToolResult } from '../tool-registry.js'

const execAsync = promisify(exec)
const MAX_OUTPUT_BYTES = 50_000
const TRUNCATION_NOTICE = '\n...<output truncated>'

/**
 * Git operations that are read-only (no side effects, auto-approved).
 */
const READONLY_OPERATIONS = new Set([
  'status',
  'log',
  'diff',
  'branch',
  'show',
  'remote',
  'tag',
  'stash_list',
  'blame',
])

/**
 * Git operations that modify state (require user approval).
 */
const WRITE_OPERATIONS = new Set([
  'checkout',
  'add',
  'commit',
  'stash',
  'branch_create',
  'branch_delete',
  'merge',
  'rebase',
  'reset',
])

/**
 * Git operations that are ALWAYS denied (too dangerous for AI to run).
 */
const DENIED_OPERATIONS = new Set([
  'push',
  'push_force',
  'reset_hard',
  'clean',
  'cherry_pick',
])

function truncateOutput(value: string): string {
  return value.length > MAX_OUTPUT_BYTES ? value.slice(0, MAX_OUTPUT_BYTES) + TRUNCATION_NOTICE : value
}

/**
 * Build the git command string from an operation and args.
 * Returns null if the operation is denied.
 */
function buildGitCommand(
  operation: string,
  args: string | undefined,
): { command: string; isReadonly: boolean } | null {
  const extraArgs = args?.trim() ?? ''

  // Handle nested operations (e.g., branch_create, branch_delete, stash_list)
  switch (operation) {
    // --- Read-only operations ---
    case 'status':
      return { command: `git status ${extraArgs}`.trim(), isReadonly: true }
    case 'log':
      return { command: `git log --oneline -50 ${extraArgs}`.trim(), isReadonly: true }
    case 'diff':
      return { command: `git diff ${extraArgs}`.trim(), isReadonly: true }
    case 'branch':
      return { command: `git branch ${extraArgs}`.trim(), isReadonly: true }
    case 'show':
      return { command: `git show ${extraArgs}`.trim(), isReadonly: true }
    case 'remote':
      return { command: `git remote -v ${extraArgs}`.trim(), isReadonly: true }
    case 'tag':
      return { command: `git tag ${extraArgs}`.trim(), isReadonly: true }
    case 'stash_list':
      return { command: `git stash list ${extraArgs}`.trim(), isReadonly: true }
    case 'blame':
      return { command: `git blame ${extraArgs}`.trim(), isReadonly: true }

    // --- Write operations (require approval) ---
    case 'checkout':
      return { command: `git checkout ${extraArgs}`.trim(), isReadonly: false }
    case 'add':
      return { command: `git add ${extraArgs}`.trim(), isReadonly: false }
    case 'commit':
      return { command: `git commit ${extraArgs}`.trim(), isReadonly: false }
    case 'stash':
      return { command: `git stash ${extraArgs}`.trim(), isReadonly: false }
    case 'branch_create':
      return { command: `git branch ${extraArgs}`.trim(), isReadonly: false }
    case 'branch_delete':
      // Extra safety: require -D or -d flag
      if (!extraArgs.includes('-d') && !extraArgs.includes('-D')) {
        return null // Will be treated as denied
      }
      return { command: `git branch ${extraArgs}`.trim(), isReadonly: false }

    // --- Denied operations ---
    case 'push':
    case 'push_force':
    case 'reset_hard':
    case 'clean':
    case 'cherry_pick':
      return null

    default:
      // Unknown operation — check if user is trying denied ops via args
      return null
  }
}

/**
 * Extra safety: check if any args contain dangerous patterns.
 */
function containsDangerousArgs(args: string): boolean {
  const dangerous = [
    /\bgit\s+push\b/,
    /\bgit\s+push\s+.*--force\b/,
    /\bgit\s+reset\s+--hard\b/,
    /\bgit\s+clean\s+/,
    /\bgit\s+rm\s+.*-r.*--no-ignore-unmatch/,
  ]
  return dangerous.some((p) => p.test(args))
}

/**
 * Check if a git operation is read-only.
 * Used by the permission system to auto-approve read-only operations.
 */
export function isGitReadonly(operation: string): boolean {
  return READONLY_OPERATIONS.has(operation)
}

/**
 * Check if a git operation is denied.
 */
export function isGitDenied(operation: string): boolean {
  return DENIED_OPERATIONS.has(operation)
}

/**
 * git tool — Execute git operations in the workspace.
 *
 * Safety features:
 * - Three-tier permission: readonly (auto-approve), write (ask), denied (always block)
 * - Denied operations: push, push --force, reset --hard, clean, cherry-pick
 * - Write operations: checkout, add, commit, stash, branch create/delete
 * - Read operations: status, log, diff, branch list, show, remote, tag, stash list, blame
 * - Dangerous arg pattern detection
 */
export const gitTool: RegisteredTool = {
  definition: {
    name: 'git',
    description:
      'Execute git operations in the workspace. ' +
      'Read operations (status, log, diff, branch list, show, remote, tag, stash list, blame) are auto-approved. ' +
      'Write operations (checkout, add, commit, stash, branch create/delete) require approval. ' +
      'Dangerous operations (push, reset --hard, clean, cherry-pick) are always blocked. ' +
      'Use the "operation" parameter to specify the git action.',
    inputSchema: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: [
            'status', 'log', 'diff', 'branch', 'show', 'remote', 'tag', 'stash_list', 'blame',
            'checkout', 'add', 'commit', 'stash', 'branch_create', 'branch_delete',
          ],
          description:
            'Git operation to perform. ' +
            'Read: status, log, diff, branch, show, remote, tag, stash_list, blame. ' +
            'Write: checkout, add, commit, stash, branch_create, branch_delete.',
        },
        args: {
          type: 'string',
          description:
            'Additional arguments for the git command. ' +
            'Examples: for log "--oneline -20", for add "src/", for commit "-m \'message\'"',
        },
      },
      required: ['operation'],
    },
  },

  async execute(ctx: ToolContext, input: Record<string, unknown>): Promise<ToolResult> {
    const start = Date.now()
    const operation = String(input['operation'] ?? '').trim()
    const args = input['args'] ? String(input['args']) : undefined

    if (!operation) {
      return { status: 'error', error: 'No git operation specified', durationMs: Date.now() - start }
    }

    // Check if operation is denied
    if (isGitDenied(operation)) {
      return {
        status: 'denied',
        error: `Git operation "${operation}" is blocked for safety. This operation is too destructive for AI to execute.`,
        durationMs: Date.now() - start,
      }
    }

    // Check for dangerous args
    if (args && containsDangerousArgs(args)) {
      return {
        status: 'denied',
        error: 'Arguments contain a dangerous git operation that is blocked for safety.',
        durationMs: Date.now() - start,
      }
    }

    // Build the git command
    const cmdInfo = buildGitCommand(operation, args)
    if (!cmdInfo) {
      return {
        status: 'denied',
        error: `Git operation "${operation}" is not supported or is blocked for safety.`,
        durationMs: Date.now() - start,
      }
    }

    try {
      const { stdout, stderr } = await execAsync(cmdInfo.command, {
        cwd: ctx.workspaceRootPath,
        timeout: 30_000,
        maxBuffer: 2 * MAX_OUTPUT_BYTES,
      })

      const output = [stdout, stderr].filter(Boolean).join('\n')
      return {
        status: 'success',
        output: truncateOutput(output) || '(no output)',
        durationMs: Date.now() - start,
      }
    } catch (err) {
      const error = err as { stdout?: string; stderr?: string; message?: string }
      const output = [error.message, error.stdout, error.stderr].filter(Boolean).join('\n')
      return {
        status: 'error',
        error: truncateOutput(output),
        durationMs: Date.now() - start,
      }
    }
  },
}
