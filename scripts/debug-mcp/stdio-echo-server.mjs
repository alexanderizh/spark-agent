#!/usr/bin/env node
/**
 * 调试用最小 MCP stdio server —— 零依赖，手写 JSON-RPC 2.0。
 *
 * 用途：验证「注册 MCP → agent 会话里能看到并调用 mcp__<name>__debug_echo」
 * 这条链路本身是否工作，与远程服务器（openrouter/apimart）是否可达无关。
 *
 * 只实现 initialize / notifications/initialized / tools/list / tools/call。
 */
import { createInterface } from 'node:readline'

const rl = createInterface({ input: process.stdin, terminal: false })

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n')
}

rl.on('line', (line) => {
  const trimmed = line.trim()
  if (trimmed.length === 0) return
  let req
  try {
    req = JSON.parse(trimmed)
  } catch {
    return
  }

  const { id, method, params } = req

  if (method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'spark-debug-stdio', version: '0.0.1' },
      },
    })
    return
  }

  if (method === 'notifications/initialized') {
    // 通知无需响应
    return
  }

  if (method === 'tools/list') {
    send({
      jsonrpc: '2.0',
      id,
      result: {
        tools: [
          {
            name: 'debug_echo',
            description: '调试用回显工具：原样返回输入并附加服务端时间戳，用于验证 MCP 注入链路是否打通。',
            inputSchema: {
              type: 'object',
              properties: { message: { type: 'string', description: '任意文本' } },
              required: ['message'],
            },
          },
        ],
      },
    })
    return
  }

  if (method === 'tools/call') {
    const toolName = params?.name
    const args = params?.arguments ?? {}
    if (toolName === 'debug_echo') {
      send({
        jsonrpc: '2.0',
        id,
        result: {
          content: [
            {
              type: 'text',
              text: `[spark-debug-stdio] echo: ${JSON.stringify(args.message ?? '')} at ${new Date().toISOString()}`,
            },
          ],
          isError: false,
        },
      })
      return
    }
    send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Unknown tool: ${String(toolName)}` } })
    return
  }

  // 未知方法：MCP 允许静默忽略非关键请求，但 tools/call 等核心方法应显式报错
  if (id !== undefined) {
    send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Unknown method: ${String(method)}` } })
  }
})
