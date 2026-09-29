/**
 * @module wiki-tool-mount.test
 *
 * S1 出口验收（工具面）：
 *   1. **择一挂载 / 免审批边界**：只读工具进白名单，写工具与二级入口**不进**
 *      （必须走 canUseTool 审批）；
 *   2. **两条形态同义**：stdio 瘦桥（codex / claude CLI 路径）暴露的工具名与
 *      描述必须与 wiki-tool-contract 的单一事实源逐字一致 —— 两处副本漂移会让
 *      两条路径的 agent 看到不同说法；
 *   3. **工具瘦身**：helpDisclosure 开启时首屏只剩核心工具 + 一个二级入口，
 *      低频工具仍可通过 wiki_admin 到达；
 *   4. **CLI 路径真打通**：wiki_restore 一路透传到 PlatformBridge 的 wiki.restore
 *      RPC（归档后无还原入口曾是真实缺陷：后端三件套齐全，唯独 MCP 桥整条缺失）。
 */

import { describe, it, expect } from 'vitest'
import { spawn } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import { existsSync } from 'node:fs'
import { buildSparkEngineMcpRuntime } from '../services/session/spark-engine-runtime.js'
import { resolveSparkWikiMcpServerPath } from '../services/session-mcp-tooling-helpers.js'
import {
  WIKI_ADMIN_TOOL_NAME,
  WIKI_ALL_READ_TOOL_NAMES,
  WIKI_CORE_TOOL_NAMES,
  WIKI_DEFERRED_TOOL_NAMES,
  WIKI_S3_TOOL_NAMES,
  WIKI_TOOL_DEFINITIONS,
  WIKI_WRITE_TOOL_NAMES,
} from './wiki-tool-contract.js'

interface WireTool {
  name: string
  description: string
  inputSchema: unknown
}

/** 起一个 stdio spark_wiki 子进程，问一次 tools/list，然后收工。 */
function listToolsFromBridge(helpDisclosure: boolean): Promise<WireTool[]> {
  return new Promise((resolve, reject) => {
    const serverPath = resolveSparkWikiMcpServerPath()
    if (serverPath == null) {
      reject(new Error('spark-wiki-mcp-server.mjs not found'))
      return
    }
    const child = spawn(process.execPath, [serverPath], {
      env: {
        ...process.env,
        // 工具面不依赖 bridge 端口；这里给个占位值，避免子进程提前退出
        SPARK_PLATFORM_BRIDGE_PORT: '1',
        SPARK_WIKI_SID: 'test-session',
        SPARK_WIKI_HELP_DISCLOSURE: helpDisclosure ? '1' : '0',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let buffer = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('bridge tools/list timeout'))
    }, 10_000)
    child.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf-8')
      let index = buffer.indexOf('\n')
      while (index >= 0) {
        const line = buffer.slice(0, index).trim()
        buffer = buffer.slice(index + 1)
        index = buffer.indexOf('\n')
        if (line.length === 0) continue
        const message = JSON.parse(line) as { id?: number; result?: { tools?: WireTool[] } }
        if (message.id === 2 && message.result?.tools != null) {
          clearTimeout(timer)
          child.kill()
          resolve(message.result.tools)
          return
        }
      }
    })
    child.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' })}\n`)
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })}\n`)
  })
}

describe('Wiki 工具面（S1）', () => {
  it('免审批白名单：只读工具在，写工具与二级入口不在', () => {
    const runtime = buildSparkEngineMcpRuntime({
      customServers: {},
      wikiServer: { type: 'stdio', command: 'node', args: ['fake.mjs'] } as never,
    })
    const allowed = new Set(runtime.allowedTools)
    for (const name of WIKI_ALL_READ_TOOL_NAMES) {
      expect(allowed.has(`mcp__spark_wiki__${name}`)).toBe(true)
    }
    for (const name of [...WIKI_WRITE_TOOL_NAMES, WIKI_ADMIN_TOOL_NAME]) {
      // 写能力必须经过审批流：一旦进白名单就等于无条件放行
      expect(allowed.has(`mcp__spark_wiki__${name}`)).toBe(false)
    }
    // 择一挂载：wiki server 只有一份注册
    expect(Object.keys(runtime.servers).filter((k) => k === 'spark_wiki')).toHaveLength(1)
  })

  it('stdio 瘦桥存在，且其工具面与契约单一事实源逐字一致（默认全量）', async () => {
    const serverPath = resolveSparkWikiMcpServerPath()
    expect(serverPath).not.toBeNull()
    expect(existsSync(serverPath as string)).toBe(true)

    const tools = await listToolsFromBridge(false)
    const expected = WIKI_TOOL_DEFINITIONS.filter(
      (d) =>
        WIKI_ALL_READ_TOOL_NAMES.includes(d.name as never) ||
        WIKI_WRITE_TOOL_NAMES.includes(d.name as never) ||
        WIKI_S3_TOOL_NAMES.includes(d.name as never),
    )
    expect(tools.map((t) => t.name).sort()).toEqual(expected.map((d) => d.name).sort())
    for (const def of expected) {
      const wire = tools.find((t) => t.name === def.name)!
      expect(wire.description).toBe(def.description)
      expect(wire.inputSchema).toEqual(def.inputSchema)
    }
    expect(tools.some((t) => t.name === WIKI_ADMIN_TOOL_NAME)).toBe(false)
  })

  it('stdio 瘦桥：开启工具瘦身只留核心 + wiki_admin，且描述仍一致', async () => {
    const tools = await listToolsFromBridge(true)
    const names = tools.map((t) => t.name)
    expect(names).toEqual([...WIKI_CORE_TOOL_NAMES, WIKI_ADMIN_TOOL_NAME])
    for (const name of WIKI_DEFERRED_TOOL_NAMES) {
      expect(names).not.toContain(name)
    }
    // 二级入口必须把低频工具名暴露给模型，否则它们就彻底不可达了
    const admin = tools.find((t) => t.name === WIKI_ADMIN_TOOL_NAME)!
    const enumValues = (admin.inputSchema as { properties: { tool: { enum: string[] } } })
      .properties.tool.enum
    expect([...enumValues].sort()).toEqual([...WIKI_DEFERRED_TOOL_NAMES].sort())
    const contractAdmin = WIKI_TOOL_DEFINITIONS.find((d) => d.name === WIKI_ADMIN_TOOL_NAME)!
    expect(admin.description).toBe(contractAdmin.description)
  })

  it('契约自洽：核心 / 低频 / 二级入口三者不重叠且并集 = 挂载集', () => {
    const core: readonly string[] = WIKI_CORE_TOOL_NAMES
    const deferred: readonly string[] = WIKI_DEFERRED_TOOL_NAMES
    expect(core.filter((n) => deferred.includes(n))).toEqual([])
    const mounted: readonly string[] = [
      ...WIKI_ALL_READ_TOOL_NAMES,
      ...WIKI_WRITE_TOOL_NAMES,
      ...WIKI_S3_TOOL_NAMES,
    ]
    expect([...core, ...deferred].sort()).toEqual([...mounted].sort())
    // archive 必须与 restore 成对挂载：否则 Agent 归档后没有任何还原手段
    expect(mounted).toContain('wiki_archive')
    expect(mounted).toContain('wiki_restore')
  })

  // ─── CLI 路径打通（wiki.restore RPC 透传）───────────────────────────────

  interface BridgeRpc {
    method: string
    params: Record<string, unknown>
  }

  /** 起一个假 PlatformBridge：记录收到的 RPC，回一份成功的还原回执。 */
  function startFakeBridge(receipt: Record<string, unknown>) {
    const received: BridgeRpc[] = []
    const server: Server = createServer((req, res) => {
      let body = ''
      req.on('data', (chunk: Buffer) => {
        body += chunk.toString('utf-8')
      })
      req.on('end', () => {
        const parsed = JSON.parse(body) as { method: string; params: Record<string, unknown> }
        received.push(parsed)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ ok: true, data: receipt }))
      })
    })
    return new Promise<{ server: Server; received: BridgeRpc[]; port: number }>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const address = server.address()
        const port = typeof address === 'object' && address != null ? address.port : 0
        resolve({ server, received, port })
      })
    })
  }

  /** 起一个 stdio spark_wiki 子进程并发起一次 tools/call，返回文本回执。 */
  function callBridgeTool(
    port: number,
    name: string,
    args: Record<string, unknown>,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const serverPath = resolveSparkWikiMcpServerPath()
      if (serverPath == null) {
        reject(new Error('spark-wiki-mcp-server.mjs not found'))
        return
      }
      const child = spawn(process.execPath, [serverPath], {
        env: {
          ...process.env,
          SPARK_PLATFORM_BRIDGE_PORT: String(port),
          SPARK_WIKI_SID: 'test-session',
          SPARK_WIKI_HELP_DISCLOSURE: '0',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      let buffer = ''
      const timer = setTimeout(() => {
        child.kill()
        reject(new Error('bridge tools/call timeout'))
      }, 10_000)
      child.stdout.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf-8')
        let index = buffer.indexOf('\n')
        while (index >= 0) {
          const line = buffer.slice(0, index).trim()
          buffer = buffer.slice(index + 1)
          index = buffer.indexOf('\n')
          if (line.length === 0) continue
          const message = JSON.parse(line) as {
            id?: number
            result?: { content?: { text?: string }[] }
            error?: { message: string }
          }
          if (message.id === 3) {
            clearTimeout(timer)
            child.kill()
            if (message.error != null) {
              reject(new Error(message.error.message))
              return
            }
            resolve(message.result?.content?.[0]?.text ?? '')
            return
          }
        }
      })
      child.on('error', (err) => {
        clearTimeout(timer)
        reject(err)
      })
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' })}\n`)
      child.stdin.write(
        `${JSON.stringify({
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: { name, arguments: args },
        })}\n`,
      )
    })
  }

  it('wiki_restore 打通到 wiki.restore RPC（默认全量档位）', async () => {
    const { server, received, port } = await startFakeBridge({
      ok: true,
      id: 'wp_1',
      title: '归档页',
      version: 4,
      indexReady: true,
    })
    try {
      const text = await callBridgeTool(port, 'wiki_restore', { id: 'wp_1' })
      expect(text).toBe('已取消归档 [wp_1] 归档页（v4）')
      expect(received).toHaveLength(1)
      expect(received[0]!.method).toBe('wiki.restore')
      expect(received[0]!.params).toEqual({ sessionId: 'test-session', pageId: 'wp_1' })
    } finally {
      server.close()
    }
  })

  it('wiki_restore 经 wiki_admin 二级入口同样打通（工具瘦身档位）', async () => {
    const { server, received, port } = await startFakeBridge({
      ok: true,
      id: 'wp_2',
      title: '瘦身档归档页',
      version: 2,
      indexReady: false,
    })
    try {
      const text = await callBridgeTool(port, WIKI_ADMIN_TOOL_NAME, {
        tool: 'wiki_restore',
        args: { id: 'wp_2' },
      })
      // 索引未就绪必须如实告知，不能谎报检索可见
      expect(text).toBe('已取消归档 [wp_2] 瘦身档归档页（v2，检索索引未就绪）')
      expect(received).toHaveLength(1)
      expect(received[0]!.method).toBe('wiki.restore')
      expect(received[0]!.params).toEqual({ sessionId: 'test-session', pageId: 'wp_2' })
    } finally {
      server.close()
    }
  })

  it('wiki_restore 失败时回执带原因（不静默成功）', async () => {
    const { server, received, port } = await startFakeBridge({
      ok: false,
      error: '正文文件缺失，无法还原（归档期间文件被外部删除）',
    })
    try {
      const text = await callBridgeTool(port, 'wiki_restore', { id: 'wp_3' })
      expect(text).toContain('wiki_restore 失败')
      expect(text).toContain('正文文件缺失')
      expect(received).toHaveLength(1)
    } finally {
      server.close()
    }
  })
})
