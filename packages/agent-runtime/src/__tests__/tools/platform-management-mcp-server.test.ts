import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const SERVER = path.resolve('src/tools/platform-management-mcp-server.mjs')
const SESSION_SERVICE = path.resolve('src/services/session.service.ts')

describe('spark_platform MCP server', () => {
  let child: ChildProcessWithoutNullStreams | null = null
  let bridge: Server | null = null

  afterEach(async () => {
    if (child && !child.killed) child.kill()
    if (bridge) {
      await new Promise<void>((resolve) => bridge?.close(() => resolve()))
      bridge = null
    }
  })

  function start(env: Record<string, string> = {}): ChildProcessWithoutNullStreams {
    const node = existsSync(process.execPath) ? process.execPath : 'node'
    return spawn(node, [SERVER], {
      cwd: path.resolve('..', 'agent-runtime'),
      env: { ...process.env, SPARK_PLATFORM_BRIDGE_PORT: '0', ...env },
    })
  }

  it('keeps MCP tool definitions in sync with the SDK allow-list', async () => {
    child = start()
    const res = await callMcp(child, { jsonrpc: '2.0', id: 1, method: 'tools/list' })
    const toolNames = (res.result.tools as Array<{ name: string }>).map((t) => t.name)
    const allowedNames = readPlatformAllowedToolNames()

    expect(toolNames).toHaveLength(allowedNames.length)
    expect(allowedNames.length).toBeGreaterThan(0)
    expect([...allowedNames].sort()).toEqual(
      toolNames.map((name) => `mcp__spark_platform__${name}`).sort(),
    )
    expect(toolNames).toEqual(expect.arrayContaining([
      'skills_load',
      'skills_search_github',
      'skills_install_github',
      'artifacts_list',
      'artifacts_resolve',
      'teams_list',
      'teams_get',
      'teams_create',
      'teams_update',
      'teams_delete',
    ]))
  })

  it('responds to optional MCP resource and prompt list methods without hanging', async () => {
    child = start()

    await expect(callMcp(child, {
      jsonrpc: '2.0',
      id: 10,
      method: 'resources/list',
    })).resolves.toEqual({
      jsonrpc: '2.0',
      id: 10,
      result: { resources: [] },
    })
    await expect(callMcp(child, {
      jsonrpc: '2.0',
      id: 11,
      method: 'resources/templates/list',
    })).resolves.toEqual({
      jsonrpc: '2.0',
      id: 11,
      result: { resourceTemplates: [] },
    })
    await expect(callMcp(child, {
      jsonrpc: '2.0',
      id: 12,
      method: 'prompts/list',
    })).resolves.toEqual({
      jsonrpc: '2.0',
      id: 12,
      result: { prompts: [] },
    })
  })

  it('routes team tool calls to the platform bridge', async () => {
    let lastRpc: { method?: string; params?: unknown } | null = null
    bridge = createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
      req.on('end', () => {
        lastRpc = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({
          ok: true,
          data: {
            team: {
              id: 'team-1',
              name: '研发协作团队',
              hostAgentId: 'platform-manager-agent',
              memberAgentIds: ['fullstack-coding-agent'],
            },
          },
        }))
      })
    })
    const port = await new Promise<number>((resolve) => {
      bridge?.listen(0, '127.0.0.1', () => {
        const address = bridge?.address()
        if (!address || typeof address === 'string') throw new Error('Failed to bind bridge')
        resolve(address.port)
      })
    })

    child = start({ SPARK_PLATFORM_BRIDGE_PORT: String(port) })
    const res = await callMcp(child, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'teams_create',
        arguments: {
          name: '研发协作团队',
          hostAgentId: 'platform-manager-agent',
          memberAgentIds: ['fullstack-coding-agent'],
        },
      },
    })

    expect(res.error).toBeUndefined()
    expect(lastRpc).toMatchObject({
      method: 'teams.create',
      params: {
        name: '研发协作团队',
        hostAgentId: 'platform-manager-agent',
        memberAgentIds: ['fullstack-coding-agent'],
      },
    })
  })

  it('routes artifact lookup tool calls to the platform bridge', async () => {
    let lastRpc: { method?: string; params?: unknown } | null = null
    bridge = createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
      req.on('end', () => {
        lastRpc = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({
          ok: true,
          data: {
            artifact: {
              id: 'runtime.python-3.11.9.win32-x64',
              type: 'runtime',
              url: 'https://minio.yiqibyte.com/spark-desktop/artifact-repository/v1/runtimes/python/python-3.11.9-amd64.exe',
            },
          },
        }))
      })
    })
    const port = await new Promise<number>((resolve) => {
      bridge?.listen(0, '127.0.0.1', () => {
        const address = bridge?.address()
        if (!address || typeof address === 'string') throw new Error('Failed to bind bridge')
        resolve(address.port)
      })
    })

    child = start({ SPARK_PLATFORM_BRIDGE_PORT: String(port) })
    const res = await callMcp(child, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'artifacts_resolve',
        arguments: {
          artifactId: 'runtime.python-3.11.9.win32-x64',
        },
      },
    })

    expect(res.error).toBeUndefined()
    expect(lastRpc).toMatchObject({
      method: 'artifacts.resolve',
      params: {
        artifactId: 'runtime.python-3.11.9.win32-x64',
      },
    })
  })
})

function readPlatformAllowedToolNames(): string[] {
  const source = readFileSync(SESSION_SERVICE, 'utf8')
  const match = source.match(/const PLATFORM_TOOL_NAMES:[\s\S]*?= \[([\s\S]*?)\]/)
  if (!match) throw new Error('PLATFORM_TOOL_NAMES not found')
  return [...match[1]!.matchAll(/'([^']+)'/g)].map((m) => m[1]!)
}

function callMcp(
  child: ChildProcessWithoutNullStreams,
  request: Record<string, unknown>,
): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('MCP call timed out')), 8_000)
    let buffer = ''
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString('utf8')
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.trim()) continue
        const message = JSON.parse(line)
        if (message.id === request.id) {
          clearTimeout(timer)
          child.stdout.off('data', onData)
          resolve(message)
        }
      }
    }
    child.stdout.on('data', onData)
    child.once('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    child.stdin.write(`${JSON.stringify(request)}\n`)
  })
}
