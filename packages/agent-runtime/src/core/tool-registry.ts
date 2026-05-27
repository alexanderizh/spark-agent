import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import type { ToolDefinition } from '../adapters/types.js'
import type { ToolCallEvent, ToolResultEvent } from '@spark/protocol'
import { bashTool, isReadonlyCommand } from './tools/bash.js'
import { grepTool } from './tools/grep.js'
import { gitTool, isGitReadonly } from './tools/git.js'
import { todoWriteTool } from './tools/todo.js'
import { webFetchTool, webSearchTool } from './tools/web.js'
import { multiEditTool } from './tools/multi-edit.js'
import { monitorTool } from './tools/background-tasks.js'
import { exitPlanModeTool } from './tools/exit-plan-mode.js'

const execAsync = promisify(exec)
const MAX_TEXT_BYTES = 1_000_000
const MAX_TOOL_OUTPUT = 20_000

export interface ToolContext {
  workspaceRootPath: string
  /** 当前 session id（部分工具如 todo_write 需要按 session 区分状态） */
  sessionId?: string
}

export interface ToolResult {
  status: 'success' | 'error' | 'denied'
  output?: unknown
  error?: string
  durationMs: number
}

export interface RegisteredTool {
  definition: ToolDefinition
  execute(ctx: ToolContext, input: Record<string, unknown>): Promise<ToolResult>
}

function resolveSafe(root: string, filePath: string): string | null {
  const resolved = path.resolve(root, filePath)
  return resolved.startsWith(path.resolve(root)) ? resolved : null
}

export class ToolRegistry {
  private tools = new Map<string, RegisteredTool>()

  constructor() {
    this.register({
      definition: {
        name: 'read_file',
        description: 'Read file contents',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            offset: { type: 'number' },
            limit: { type: 'number' },
          },
          required: ['path'],
        },
      },
      async execute(ctx, input) {
        const start = Date.now()
        const safePath = resolveSafe(ctx.workspaceRootPath, String(input['path']))
        if (!safePath) return { status: 'error', error: 'Path outside workspace', durationMs: Date.now() - start }
        try {
          const content = await fs.readFile(safePath, 'utf-8')
          const lines = content.split('\n')
          const offset = typeof input['offset'] === 'number' ? input['offset'] : 0
          const limit = typeof input['limit'] === 'number' ? input['limit'] : lines.length
          return { status: 'success', output: lines.slice(offset, offset + limit).join('\n'), durationMs: Date.now() - start }
        } catch (err) {
          return { status: 'error', error: err instanceof Error ? err.message : String(err), durationMs: Date.now() - start }
        }
      },
    })

    this.register({
      definition: {
        name: 'write_file',
        description: 'Write or create a file',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            content: { type: 'string' },
          },
          required: ['path', 'content'],
        },
      },
      async execute(ctx, input) {
        const start = Date.now()
        const safePath = resolveSafe(ctx.workspaceRootPath, String(input['path']))
        if (!safePath) return { status: 'error', error: 'Path outside workspace', durationMs: Date.now() - start }
        try {
          await fs.mkdir(path.dirname(safePath), { recursive: true })
          await fs.writeFile(safePath, String(input['content']), 'utf-8')
          return { status: 'success', output: `Written to ${input['path']}`, durationMs: Date.now() - start }
        } catch (err) {
          return { status: 'error', error: err instanceof Error ? err.message : String(err), durationMs: Date.now() - start }
        }
      },
    })

    this.register({
      definition: {
        name: 'list_directory',
        description: 'List directory contents',
        inputSchema: {
          type: 'object',
          properties: { path: { type: 'string' } },
          required: ['path'],
        },
      },
      async execute(ctx, input) {
        const start = Date.now()
        const safePath = resolveSafe(ctx.workspaceRootPath, String(input['path']))
        if (!safePath) return { status: 'error', error: 'Path outside workspace', durationMs: Date.now() - start }
        try {
          const entries = await fs.readdir(safePath, { withFileTypes: true })
          return {
            status: 'success',
            output: entries.map((e) => ({ name: e.name, type: e.isDirectory() ? 'directory' : 'file' })),
            durationMs: Date.now() - start,
          }
        } catch (err) {
          return { status: 'error', error: err instanceof Error ? err.message : String(err), durationMs: Date.now() - start }
        }
      },
    })

    this.register({
      definition: {
        name: 'search_files',
        description: 'Search files by glob pattern',
        inputSchema: {
          type: 'object',
          properties: {
            pattern: { type: 'string' },
            path: { type: 'string' },
          },
          required: ['pattern'],
        },
      },
      async execute(ctx, input) {
        const start = Date.now()
        const searchRoot = input['path']
          ? resolveSafe(ctx.workspaceRootPath, String(input['path']))
          : ctx.workspaceRootPath
        if (!searchRoot) return { status: 'error', error: 'Path outside workspace', durationMs: Date.now() - start }
        try {
          const matches: string[] = []
          for await (const f of fs.glob(String(input['pattern']), { cwd: searchRoot })) {
            matches.push(f)
          }
          return { status: 'success', output: matches, durationMs: Date.now() - start }
        } catch (err) {
          return { status: 'error', error: err instanceof Error ? err.message : String(err), durationMs: Date.now() - start }
        }
      },
    })

    this.register({
      definition: {
        name: 'grep_files',
        description: 'Search text content in files under the workspace',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string' },
            path: { type: 'string' },
            caseSensitive: { type: 'boolean' },
            maxResults: { type: 'number' },
          },
          required: ['query'],
        },
      },
      async execute(ctx, input) {
        const start = Date.now()
        const searchRoot = input['path']
          ? resolveSafe(ctx.workspaceRootPath, String(input['path']))
          : ctx.workspaceRootPath
        if (!searchRoot) return { status: 'error', error: 'Path outside workspace', durationMs: Date.now() - start }
        const query = String(input['query'] ?? '')
        const caseSensitive = input['caseSensitive'] === true
        const maxResults = typeof input['maxResults'] === 'number' ? input['maxResults'] : 100
        try {
          const matches: Array<{ path: string; line: number; text: string }> = []
          const needle = caseSensitive ? query : query.toLowerCase()
          for await (const filePath of walkFiles(searchRoot)) {
            if (matches.length >= maxResults) break
            const stat = await fs.stat(filePath)
            if (stat.size > MAX_TEXT_BYTES) continue
            const content = await fs.readFile(filePath, 'utf-8').catch(() => null)
            if (content == null || content.includes('\u0000')) continue
            const lines = content.split(/\r?\n/)
            for (let index = 0; index < lines.length && matches.length < maxResults; index += 1) {
              const haystack = caseSensitive ? lines[index] : lines[index]?.toLowerCase()
              if (haystack?.includes(needle)) {
                matches.push({
                  path: path.relative(ctx.workspaceRootPath, filePath),
                  line: index + 1,
                  text: lines[index] ?? '',
                })
              }
            }
          }
          return { status: 'success', output: matches, durationMs: Date.now() - start }
        } catch (err) {
          return { status: 'error', error: err instanceof Error ? err.message : String(err), durationMs: Date.now() - start }
        }
      },
    })

    this.register({
      definition: {
        name: 'edit_file',
        description: 'Replace an exact string in a file',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            oldText: { type: 'string' },
            newText: { type: 'string' },
            replaceAll: { type: 'boolean' },
          },
          required: ['path', 'oldText', 'newText'],
        },
      },
      async execute(ctx, input) {
        const start = Date.now()
        const safePath = resolveSafe(ctx.workspaceRootPath, String(input['path']))
        if (!safePath) return { status: 'error', error: 'Path outside workspace', durationMs: Date.now() - start }
        const oldText = String(input['oldText'] ?? '')
        const newText = String(input['newText'] ?? '')
        if (oldText.length === 0) return { status: 'error', error: 'oldText is required', durationMs: Date.now() - start }
        try {
          const content = await fs.readFile(safePath, 'utf-8')
          if (!content.includes(oldText)) return { status: 'error', error: 'oldText not found', durationMs: Date.now() - start }
          const next = input['replaceAll'] === true ? content.split(oldText).join(newText) : content.replace(oldText, newText)
          await fs.writeFile(safePath, next, 'utf-8')
          return { status: 'success', output: `Edited ${input['path']}`, durationMs: Date.now() - start }
        } catch (err) {
          return { status: 'error', error: err instanceof Error ? err.message : String(err), durationMs: Date.now() - start }
        }
      },
    })

    this.register({
      definition: {
        name: 'run_command',
        description: 'Run a shell command in the workspace',
        inputSchema: {
          type: 'object',
          properties: {
            command: { type: 'string' },
            cwd: { type: 'string' },
            timeoutMs: { type: 'number' },
          },
          required: ['command'],
        },
      },
      async execute(ctx, input) {
        const start = Date.now()
        const cwd = input['cwd'] ? resolveSafe(ctx.workspaceRootPath, String(input['cwd'])) : ctx.workspaceRootPath
        if (!cwd) return { status: 'error', error: 'cwd outside workspace', durationMs: Date.now() - start }
        try {
          const { stdout, stderr } = await execAsync(String(input['command']), {
            cwd,
            timeout: typeof input['timeoutMs'] === 'number' ? input['timeoutMs'] : 120_000,
            maxBuffer: 2 * MAX_TOOL_OUTPUT,
          })
          return {
            status: 'success',
            output: truncateOutput([stdout, stderr].filter(Boolean).join('\n')),
            durationMs: Date.now() - start,
          }
        } catch (err) {
          const error = err as { stdout?: string; stderr?: string; message?: string }
          return {
            status: 'error',
            error: truncateOutput([error.message, error.stdout, error.stderr].filter(Boolean).join('\n')),
            durationMs: Date.now() - start,
          }
        }
      },
    })

    this.register({
      definition: {
        name: 'apply_patch',
        description: 'Apply a unified diff patch with git apply',
        inputSchema: {
          type: 'object',
          properties: {
            patch: { type: 'string' },
          },
          required: ['patch'],
        },
      },
      async execute(ctx, input) {
        const start = Date.now()
        const patch = String(input['patch'] ?? '')
        if (!patch.trim()) return { status: 'error', error: 'patch is required', durationMs: Date.now() - start }
        const patchFile = path.join(ctx.workspaceRootPath, `.spark-agent-patch-${Date.now()}.patch`)
        try {
          await fs.writeFile(patchFile, patch, 'utf-8')
          const { stdout, stderr } = await execAsync(`git apply --whitespace=nowarn ${JSON.stringify(path.basename(patchFile))}`, {
            cwd: ctx.workspaceRootPath,
            timeout: 120_000,
            maxBuffer: 2 * MAX_TOOL_OUTPUT,
          })
          await fs.unlink(patchFile).catch(() => undefined)
          return { status: 'success', output: truncateOutput([stdout, stderr].filter(Boolean).join('\n') || 'Patch applied'), durationMs: Date.now() - start }
        } catch (err) {
          await fs.unlink(patchFile).catch(() => undefined)
          const error = err as { stdout?: string; stderr?: string; message?: string }
          return {
            status: 'error',
            error: truncateOutput([error.message, error.stdout, error.stderr].filter(Boolean).join('\n')),
            durationMs: Date.now() - start,
          }
        }
      },
    })

    // --- Shell Tools (bash/grep/git) ---

    this.register(bashTool)

    this.register(grepTool)

    this.register(gitTool)

    // --- Productivity Tools ---

    this.register(todoWriteTool)

    // --- Atomic multi-edit ---

    this.register(multiEditTool)

    // --- Network Tools ---

    this.register(webFetchTool)
    this.register(webSearchTool)

    // --- Background Task Monitoring ---

    this.register(monitorTool)

    // --- Plan-mode-only Tools ---
    // exit_plan_mode is filtered IN/OUT by getDefinitions(permissionMode).
    this.register(exitPlanModeTool)
  }

  register(tool: RegisteredTool): void {
    this.tools.set(tool.definition.name, tool)
  }

  get(name: string): RegisteredTool | undefined {
    return this.tools.get(name)
  }

  /**
   * Return tool definitions to expose to the model.
   *
   * Some tools are gated to specific permission modes:
   * - `exit_plan_mode` is ONLY surfaced when permissionMode === 'claude-plan'.
   *   Otherwise the model shouldn't see it (avoids confusion / spurious calls).
   */
  getDefinitions(permissionMode?: string): ToolDefinition[] {
    const PLAN_ONLY = new Set(['exit_plan_mode'])
    return Array.from(this.tools.values())
      .filter((t) => {
        if (PLAN_ONLY.has(t.definition.name)) return permissionMode === 'claude-plan'
        return true
      })
      .map((t) => t.definition)
  }

  async execute(
    ctx: ToolContext,
    toolCall: ToolCallEvent,
    baseFields: { id: string; sessionId: string; turnId: string; timestamp: string; seq: number },
  ): Promise<ToolResultEvent> {
    const tool = this.tools.get(toolCall.toolName)
    const start = Date.now()

    if (!tool) {
      return {
        ...baseFields,
        type: 'tool_result',
        toolCallId: toolCall.toolCallId,
        toolName: toolCall.toolName,
        status: 'error',
        error: `Unknown tool: ${toolCall.toolName}`,
        durationMs: Date.now() - start,
      }
    }

    try {
      const result = await tool.execute(ctx, toolCall.toolInput)
      return { ...baseFields, type: 'tool_result', toolCallId: toolCall.toolCallId, toolName: toolCall.toolName, ...result }
    } catch (err) {
      return {
        ...baseFields,
        type: 'tool_result',
        toolCallId: toolCall.toolCallId,
        toolName: toolCall.toolName,
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - start,
      }
    }
  }
}

async function* walkFiles(root: string): AsyncGenerator<string> {
  const entries = await fs.readdir(root, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue
    const fullPath = path.join(root, entry.name)
    if (entry.isDirectory()) {
      yield* walkFiles(fullPath)
    } else if (entry.isFile()) {
      yield fullPath
    }
  }
}

function truncateOutput(value: string): string {
  return value.length > MAX_TOOL_OUTPUT ? `${value.slice(0, MAX_TOOL_OUTPUT)}\n...<truncated>` : value
}
