/**
 * MCP 端到端联通性测试 —— 使用 scripts/debug-mcp/ 下的调试服务器。
 *
 * 背景：openrouter/apimart 这类远程 MCP 配置过一段时间不可用，需要一种
 * 不依赖第三方网络服务、完全可控的方式验证「注册 → McpClient 真连接 →
 * tools/list → tools/call」整条链路本身没问题。这里不 mock transport，
 * 而是真的 spawn 调试 stdio 进程 / 起本地 http server，通过真实的
 * StdioTransport / StreamableHttpTransport 走一遍完整协议。
 *
 * 覆盖两条传输：
 *  - stdio（scripts/debug-mcp/stdio-echo-server.mjs）
 *  - http Streamable HTTP（scripts/debug-mcp/http-echo-server.mjs）—— 与
 *    openrouter/apimart 配置里 transport:"http" 走的是同一段代码
 *    （resolveMcpConfig → StreamableHttpTransport）。
 */
import { describe, it, expect, afterEach } from 'vitest'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { McpClient } from '../../mcp/mcp-client.js'
import { resolveMcpConfig } from '../../mcp/config-normalize.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '../../../../../')
const STDIO_SCRIPT = path.join(REPO_ROOT, 'scripts/debug-mcp/stdio-echo-server.mjs')
const HTTP_SCRIPT = path.join(REPO_ROOT, 'scripts/debug-mcp/http-echo-server.mjs')

describe('MCP debug servers — real transport, no mocks', () => {
  const clients: McpClient[] = []
  afterEach(async () => {
    await Promise.all(clients.splice(0).map((c) => c.disconnect()))
  })

  it('stdio: connect → tools/list → tools/call round-trips through a real subprocess', async () => {
    const resolved = resolveMcpConfig({ transport: 'stdio', command: process.execPath, args: [STDIO_SCRIPT] })
    expect(resolved).not.toBeNull()

    const client = new McpClient('dbg-stdio', 'spark-debug-stdio', resolved!)
    clients.push(client)

    await client.connect()
    expect(client.isConnected()).toBe(true)

    const tools = client.listTools()
    expect(tools.map((t) => t.name)).toContain('debug_echo')

    const result = await client.callTool('debug_echo', { message: 'e2e-stdio' })
    expect(result.isError).not.toBe(true)
    expect(result.content[0]?.text).toContain('e2e-stdio')
  }, 15_000)

  it('http (Streamable HTTP): connect → tools/list → tools/call round-trips through a real local server', async () => {
    // 用固定但不常用的端口，避免与开发环境其它服务冲突
    const port = 18934
    const { spawn } = await import('node:child_process')
    const server = spawn(process.execPath, [HTTP_SCRIPT, String(port)], { stdio: 'ignore' })
    try {
      await new Promise((resolve) => setTimeout(resolve, 300))

      // 与 openrouter/apimart 完全一样的写法：transport:"http" + url
      const resolved = resolveMcpConfig({ transport: 'http', url: `http://127.0.0.1:${port}/mcp` })
      expect(resolved).not.toBeNull()
      expect(resolved).toEqual({ type: 'http', url: `http://127.0.0.1:${port}/mcp` })

      const client = new McpClient('dbg-http', 'spark-debug-http', resolved!)
      clients.push(client)

      await client.connect()
      expect(client.isConnected()).toBe(true)

      const tools = client.listTools()
      expect(tools.map((t) => t.name)).toContain('debug_echo_http')

      const result = await client.callTool('debug_echo_http', { message: 'e2e-http' })
      expect(result.isError).not.toBe(true)
      expect(result.content[0]?.text).toContain('e2e-http')
    } finally {
      server.kill('SIGTERM')
    }
  }, 15_000)
})
