import { describe, it, expect, vi } from 'vitest'
import { McpToolBridge } from '../../mcp/mcp-tool-bridge.js'
import type { McpToolDefinition, McpToolResult } from '../../mcp/mcp-client.js'
import type { McpClient } from '../../mcp/mcp-client.js'
import type { ToolContext } from '../../core/tool-registry.js'

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('McpToolBridge', () => {
  describe('toToolDefinition', () => {
    it('converts MCP tool definition to ToolRegistry format', () => {
      const mcpTool: McpToolDefinition = {
        name: 'search_files',
        description: 'Search for files matching a pattern',
        inputSchema: {
          type: 'object',
          properties: {
            pattern: { type: 'string', description: 'Glob pattern' },
            maxResults: { type: 'number', description: 'Max results' },
          },
          required: ['pattern'],
        },
      }

      const result = McpToolBridge.toToolDefinition(mcpTool)

      expect(result.name).toBe('search_files')
      expect(result.description).toBe('Search for files matching a pattern')
      expect(result.inputSchema).toEqual(mcpTool.inputSchema)
    })
  })

  describe('createRegisteredTool', () => {
    it('creates a RegisteredTool with working execute function', async () => {
      const mockResult: McpToolResult = {
        content: [{ type: 'text', text: 'Found 5 files' }],
      }

      const mockClient = {
        callTool: vi.fn().mockResolvedValue(mockResult),
      } as unknown as McpClient

      const mcpTool: McpToolDefinition = {
        name: 'search',
        description: 'Search files',
        inputSchema: {
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query'],
        },
      }

      const registeredTool = McpToolBridge.createRegisteredTool(mockClient, mcpTool)

      expect(registeredTool.definition.name).toBe('search')
      expect(registeredTool.definition.description).toBe('Search files')

      const ctx: ToolContext = { workspaceRootPath: '/test' }
      const result = await registeredTool.execute(ctx, { query: 'test' })

      expect(result.status).toBe('success')
      expect(result.output).toBe('Found 5 files')
      expect(result.durationMs).toBeGreaterThanOrEqual(0)
      expect(mockClient.callTool).toHaveBeenCalledWith('search', { query: 'test' })
    })

    it('handles MCP tool errors', async () => {
      const mockResult: McpToolResult = {
        content: [{ type: 'text', text: 'Server error: connection refused' }],
        isError: true,
      }

      const mockClient = {
        callTool: vi.fn().mockResolvedValue(mockResult),
      } as unknown as McpClient

      const mcpTool: McpToolDefinition = {
        name: 'broken_tool',
        description: 'A broken tool',
        inputSchema: { type: 'object', properties: {} },
      }

      const registeredTool = McpToolBridge.createRegisteredTool(mockClient, mcpTool)
      const ctx: ToolContext = { workspaceRootPath: '/test' }
      const result = await registeredTool.execute(ctx, {})

      expect(result.status).toBe('error')
      expect(result.error).toContain('Server error')
    })

    it('handles execution exceptions', async () => {
      const mockClient = {
        callTool: vi.fn().mockRejectedValue(new Error('Connection timeout')),
      } as unknown as McpClient

      const mcpTool: McpToolDefinition = {
        name: 'timeout_tool',
        description: 'Times out',
        inputSchema: { type: 'object', properties: {} },
      }

      const registeredTool = McpToolBridge.createRegisteredTool(mockClient, mcpTool)
      const ctx: ToolContext = { workspaceRootPath: '/test' }
      const result = await registeredTool.execute(ctx, {})

      expect(result.status).toBe('error')
      expect(result.error).toBe('Connection timeout')
    })
  })

  describe('registerAllTools', () => {
    it('registers all tools from a client', () => {
      const tools: McpToolDefinition[] = [
        {
          name: 'tool_a',
          description: 'Tool A',
          inputSchema: { type: 'object', properties: {} },
        },
        {
          name: 'tool_b',
          description: 'Tool B',
          inputSchema: { type: 'object', properties: { x: { type: 'string' } } },
        },
      ]

      const mockClient = {
        listTools: vi.fn().mockReturnValue(tools),
        callTool: vi.fn(),
        getServerName: vi.fn().mockReturnValue('test-server'),
      } as unknown as McpClient

      const registered: Array<{ definition: { name: string } }> = []
      const registerFn = vi.fn((tool) => registered.push(tool))

      const count = McpToolBridge.registerAllTools(mockClient, registerFn)

      expect(count).toBe(2)
      expect(registerFn).toHaveBeenCalledTimes(2)
      expect(registered[0]?.definition.name).toBe('tool_a')
      expect(registered[1]?.definition.name).toBe('tool_b')
    })

    it('returns 0 when client has no tools', () => {
      const mockClient = {
        listTools: vi.fn().mockReturnValue([]),
        callTool: vi.fn(),
        getServerName: vi.fn().mockReturnValue('empty-server'),
      } as unknown as McpClient

      const registerFn = vi.fn()
      const count = McpToolBridge.registerAllTools(mockClient, registerFn)

      expect(count).toBe(0)
      expect(registerFn).not.toHaveBeenCalled()
    })
  })
})
