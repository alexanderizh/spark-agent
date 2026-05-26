import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { ToolDefinition } from '../adapters/types.js'
import type { ToolCallEvent, ToolResultEvent } from '@spark/protocol'

export interface ToolContext {
  workspaceRootPath: string
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
  }

  register(tool: RegisteredTool): void {
    this.tools.set(tool.definition.name, tool)
  }

  get(name: string): RegisteredTool | undefined {
    return this.tools.get(name)
  }

  getDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map((t) => t.definition)
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
