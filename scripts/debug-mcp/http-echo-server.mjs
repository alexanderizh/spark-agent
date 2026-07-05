#!/usr/bin/env node
/**
 * 调试用最小 MCP Streamable HTTP server —— 零依赖，手写 JSON-RPC 2.0。
 *
 * 单端点 POST，直接返回 application/json（不走 SSE 分支），用于验证
 * StreamableHttpTransport + buildMcpServersForSDK 的 http 路径本身能否打通，
 * 与 openrouter/apimart 是否可达、协议是否兼容无关。
 *
 * 用法：node http-echo-server.mjs [port]，默认端口 8934。
 * 注册到平台：{"transport":"http","url":"http://127.0.0.1:<port>/mcp"}
 */
import { createServer } from 'node:http'

const port = Number(process.argv[2] ?? 8934)

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk) => { data += chunk })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

const server = createServer(async (req, res) => {
  if (req.method !== 'POST') {
    res.writeHead(405).end('Method Not Allowed')
    return
  }

  const body = await readBody(req)
  let rpc
  try {
    rpc = JSON.parse(body)
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' }).end(
      JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }),
    )
    return
  }

  const { id, method, params } = rpc
  const isNotification = id === undefined

  const respond = (result) => {
    if (isNotification) {
      res.writeHead(202).end()
      return
    }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Mcp-Session-Id': 'debug-session-1' }).end(
      JSON.stringify({ jsonrpc: '2.0', id, result }),
    )
  }
  const respondError = (code, message) => {
    if (isNotification) {
      res.writeHead(202).end()
      return
    }
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(
      JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }),
    )
  }

  if (method === 'initialize') {
    respond({
      protocolVersion: '2024-11-05',
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'spark-debug-http', version: '0.0.1' },
    })
    return
  }
  if (method === 'notifications/initialized') {
    respond(null)
    return
  }
  if (method === 'tools/list') {
    respond({
      tools: [
        {
          name: 'debug_echo_http',
          description: '调试用回显工具（HTTP 传输）：原样返回输入并附加服务端时间戳，用于验证 Streamable HTTP MCP 注入链路。',
          inputSchema: {
            type: 'object',
            properties: { message: { type: 'string', description: '任意文本' } },
            required: ['message'],
          },
        },
      ],
    })
    return
  }
  if (method === 'tools/call') {
    const toolName = params?.name
    const args = params?.arguments ?? {}
    if (toolName === 'debug_echo_http') {
      respond({
        content: [
          {
            type: 'text',
            text: `[spark-debug-http] echo: ${JSON.stringify(args.message ?? '')} at ${new Date().toISOString()}`,
          },
        ],
        isError: false,
      })
      return
    }
    respondError(-32601, `Unknown tool: ${String(toolName)}`)
    return
  }

  respondError(-32601, `Unknown method: ${String(method)}`)
})

server.listen(port, '127.0.0.1', () => {
  console.error(`[spark-debug-http] listening on http://127.0.0.1:${port}/mcp`)
})
