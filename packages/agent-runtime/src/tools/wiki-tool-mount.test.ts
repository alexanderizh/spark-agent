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
 *      低频工具仍可通过 wiki_admin 到达。
 */

import { describe, it, expect } from 'vitest'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { buildSparkEngineMcpRuntime } from '../services/session/spark-engine-runtime.js'
import { resolveSparkWikiMcpServerPath } from '../services/session-mcp-tooling-helpers.js'
import {
  WIKI_ADMIN_TOOL_NAME,
  WIKI_ALL_READ_TOOL_NAMES,
  WIKI_CORE_TOOL_NAMES,
  WIKI_DEFERRED_TOOL_NAMES,
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
        WIKI_WRITE_TOOL_NAMES.includes(d.name as never),
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
    const mounted: readonly string[] = [...WIKI_ALL_READ_TOOL_NAMES, ...WIKI_WRITE_TOOL_NAMES]
    expect([...core, ...deferred].sort()).toEqual([...mounted].sort())
  })
})
