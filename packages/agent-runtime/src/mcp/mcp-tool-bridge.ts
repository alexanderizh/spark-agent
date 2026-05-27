/**
 * MCP Tool Bridge
 *
 * 将 MCP 服务器提供的工具桥接到 Agent 的 ToolRegistry。
 * 这样 Agent 能像使用内置工具一样使用 MCP 工具。
 *
 * 职责：
 * - 将 MCP 工具定义转换为 ToolRegistry 的 RegisteredTool 格式
 * - 创建执行函数，通过 McpClient 调用远程工具
 * - 处理结果格式转换
 */

import type { McpClient, McpToolDefinition, McpToolResult } from './mcp-client.js'
import type { RegisteredTool, ToolContext, ToolResult } from '../core/tool-registry.js'
import type { ToolDefinition } from '../adapters/types.js'
import { createLogger } from '@spark/shared'

const log = createLogger('mcp:bridge')

export class McpToolBridge {
  /**
   * 将 MCP 工具定义转换为 ToolRegistry 的 ToolDefinition 格式
   */
  static toToolDefinition(mcpTool: McpToolDefinition): ToolDefinition {
    return {
      name: mcpTool.name,
      description: mcpTool.description,
      inputSchema: mcpTool.inputSchema,
    }
  }

  /**
   * 创建 RegisteredTool（包含定义和执行函数）
   *
   * @param client - MCP 客户端
   * @param mcpTool - MCP 工具定义
   * @returns RegisteredTool 可注册到 ToolRegistry
   */
  static createRegisteredTool(client: McpClient, mcpTool: McpToolDefinition): RegisteredTool {
    return {
      definition: McpToolBridge.toToolDefinition(mcpTool),
      async execute(_ctx: ToolContext, input: Record<string, unknown>): Promise<ToolResult> {
        const start = Date.now()
        try {
          const result: McpToolResult = await client.callTool(mcpTool.name, input)

          if (result.isError) {
            return {
              status: 'error',
              error: formatMcpToolResult(result),
              durationMs: Date.now() - start,
            }
          }

          return {
            status: 'success',
            output: formatMcpToolResult(result),
            durationMs: Date.now() - start,
          }
        } catch (err) {
          log.warn(`MCP tool ${mcpTool.name} execution failed: ${err instanceof Error ? err.message : String(err)}`)
          return {
            status: 'error',
            error: err instanceof Error ? err.message : String(err),
            durationMs: Date.now() - start,
          }
        }
      },
    }
  }

  /**
   * 将 MCP 服务器的所有工具批量注册到 ToolRegistry
   *
   * @param client - 已连接的 MCP 客户端
   * @param registerFn - ToolRegistry 的 register 方法
   * @returns 注册的工具数量
   */
  static registerAllTools(
    client: McpClient,
    registerFn: (tool: RegisteredTool) => void,
  ): number {
    const tools = client.listTools()
    let registered = 0

    for (const mcpTool of tools) {
      try {
        const registeredTool = McpToolBridge.createRegisteredTool(client, mcpTool)
        registerFn(registeredTool)
        registered++
        log.info(`Registered MCP tool: ${mcpTool.name} from ${client.getServerName()}`)
      } catch (err) {
        log.warn(`Failed to register MCP tool ${mcpTool.name}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    return registered
  }
}

/**
 * 格式化 MCP 工具结果为可读字符串
 */
function formatMcpToolResult(result: McpToolResult): string {
  const parts: string[] = []

  for (const content of result.content) {
    if (content.type === 'text' && content.text != null) {
      parts.push(content.text)
    } else if (content.type === 'image' && content.data != null) {
      parts.push(`[Image: ${content.mimeType ?? 'unknown'}, ${content.data.length} bytes base64]`)
    } else if (content.type === 'resource') {
      parts.push(`[Resource: ${content.text ?? 'unknown'}]`)
    }
  }

  return parts.join('\n') || '(empty result)'
}
