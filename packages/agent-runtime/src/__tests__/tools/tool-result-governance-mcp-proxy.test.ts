import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ToolResultEnvelope } from '../../tools/tool-result-artifact-store.mjs'

const PROXY = path.resolve('src/tools/tool-result-governance-mcp-proxy.mjs')
const READER = path.resolve('src/tools/tool-result-reader-mcp-server.mjs')
const UPSTREAM = path.resolve('src/__tests__/tools/fixtures/fake-large-result-mcp-server.mjs')

describe('tool result governance MCP proxy', () => {
  let workspaceRoot = ''
  const children: ChildProcessWithoutNullStreams[] = []

  beforeEach(() => {
    workspaceRoot = mkdtempSync(path.join(tmpdir(), 'spark-tool-result-proxy-'))
  })

  afterEach(() => {
    for (const child of children) child.kill()
    children.length = 0
    rmSync(workspaceRoot, { recursive: true, force: true })
  })

  it('forwards tools and replaces large results with a readable content-addressed envelope', async () => {
    const upstreamConfig = Buffer.from(
      JSON.stringify({ type: 'stdio', command: process.execPath, args: [UPSTREAM] }),
      'utf8',
    ).toString('base64url')
    const proxyProcess = spawn(process.execPath, [PROXY], {
      cwd: path.resolve('..', 'agent-runtime'),
      env: {
        ...process.env,
        SPARK_WORKSPACE_ROOT: workspaceRoot,
        SPARK_TOOL_RESULT_SERVER_NAME: 'fixture',
        SPARK_TOOL_RESULT_UPSTREAM_CONFIG: upstreamConfig,
      },
    })
    children.push(proxyProcess)
    const proxy = new JsonRpcProcess(proxyProcess)
    await proxy.initialize()

    const listed = await proxy.request('tools/list', {})
    const listedTool = (
      listed as {
        tools: Array<{ name: string; outputSchema?: { type?: string; anyOf?: unknown[] } }>
      }
    ).tools[0]
    expect(listedTool?.name).toBe('large')
    expect(listedTool?.outputSchema).toMatchObject({ type: 'object' })
    expect(listedTool?.outputSchema?.anyOf).toEqual([
      expect.objectContaining({ required: ['text'] }),
      expect.objectContaining({
        required: ['kind', 'version', 'status', 'preview', 'artifact', 'continuation'],
      }),
    ])
    const called = (await proxy.request('tools/call', {
      name: 'large',
      arguments: { size: 50_000, emitCollidingServerRequest: true },
    })) as {
      content: Array<{ type: string; text?: string }>
      structuredContent: ToolResultEnvelope
    }
    const envelope = called.structuredContent
    expect(envelope.kind).toBe('spark.tool_result_envelope')
    expect(envelope.toolName).toBe('mcp__fixture__large')
    expect(envelope.preview.text.length).toBeLessThan(9_000)
    expect(called.content.at(-1)?.text?.length).toBeLessThan(10_000)
    expect(envelope.artifact.available).toBe(true)
    if (!envelope.artifact.available) throw new Error('expected archived tool result')
    expect(
      readFileSync(path.join(workspaceRoot, envelope.artifact.relativePath), 'utf8'),
    ).toContain('Error: fixture failed')

    const readerProcess = spawn(process.execPath, [READER], {
      cwd: path.resolve('..', 'agent-runtime'),
      env: { ...process.env, SPARK_WORKSPACE_ROOT: workspaceRoot },
    })
    children.push(readerProcess)
    const reader = new JsonRpcProcess(readerProcess)
    await reader.initialize()
    const listedArtifacts = (await reader.request('tools/call', {
      name: 'list',
      arguments: { limit: 10 },
    })) as { structuredContent: { artifacts: Array<{ artifactId: string }> } }
    expect(listedArtifacts.structuredContent.artifacts).toEqual([
      expect.objectContaining({ artifactId: envelope.artifact.artifactId }),
    ])
    const read = (await reader.request('tools/call', {
      name: 'read',
      arguments: { artifactId: envelope.artifact.artifactId, offset: 0, limit: 500 },
    })) as { structuredContent: { content: string; nextOffset: number | null } }
    expect(read.structuredContent.content).toContain('start')
    expect(read.structuredContent.nextOffset).not.toBeNull()

    const search = (await reader.request('tools/call', {
      name: 'search',
      arguments: { artifactId: envelope.artifact.artifactId, query: 'fixture failed' },
    })) as { structuredContent: { totalMatches: number; matches: Array<{ snippet: string }> } }
    expect(search.structuredContent.totalMatches).toBeGreaterThan(0)
    expect(search.structuredContent.matches[0]?.snippet).toContain('Error: fixture failed')
  })

  it('keeps governed structured output valid for the real MCP SDK client', async () => {
    const upstreamConfig = Buffer.from(
      JSON.stringify({ type: 'stdio', command: process.execPath, args: [UPSTREAM] }),
      'utf8',
    ).toString('base64url')
    const inheritedEnv = Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    )
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [PROXY],
      cwd: path.resolve('..', 'agent-runtime'),
      env: {
        ...inheritedEnv,
        SPARK_WORKSPACE_ROOT: workspaceRoot,
        SPARK_TOOL_RESULT_SERVER_NAME: 'fixture',
        SPARK_TOOL_RESULT_UPSTREAM_CONFIG: upstreamConfig,
      },
      stderr: 'pipe',
    })
    const client = new Client({ name: 'schema-validation-test', version: '1.0.0' })

    try {
      await client.connect(transport)
      const listed = await client.listTools()
      expect(listed.tools[0]?.outputSchema).toMatchObject({ type: 'object' })
      const called = await client.callTool({ name: 'large', arguments: { size: 50_000 } })
      expect(called.structuredContent).toMatchObject({
        kind: 'spark.tool_result_envelope',
        artifact: { available: true },
      })
    } finally {
      await client.close()
    }
  })
})

class JsonRpcProcess {
  private nextId = 1
  private buffer = ''
  private pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >()

  constructor(private readonly child: ChildProcessWithoutNullStreams) {
    child.stdout.on('data', (chunk: Buffer) => this.onData(chunk))
    child.on('exit', (code) => {
      if (code === 0 || this.pending.size === 0) return
      const stderr = child.stderr.read()?.toString('utf8') ?? ''
      for (const waiter of this.pending.values()) {
        waiter.reject(new Error(`MCP process exited with ${code}: ${stderr}`))
      }
      this.pending.clear()
    })
  }

  async initialize(): Promise<void> {
    await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'test-client', version: '1.0.0' },
    })
    this.notify('notifications/initialized', {})
  }

  request(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = this.nextId++
    const promise = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
    })
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
    return promise
  }

  notify(method: string, params: Record<string, unknown>): void {
    this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`)
  }

  private onData(chunk: Buffer): void {
    this.buffer += chunk.toString('utf8')
    while (true) {
      const newline = this.buffer.indexOf('\n')
      if (newline < 0) return
      const line = this.buffer.slice(0, newline)
      this.buffer = this.buffer.slice(newline + 1)
      if (!line) continue
      const message = JSON.parse(line) as {
        id?: number
        method?: string
        result?: unknown
        error?: { message?: string }
      }
      if (typeof message.method === 'string') continue
      if (message.id == null) continue
      const waiter = this.pending.get(message.id)
      if (waiter == null) continue
      this.pending.delete(message.id)
      if (message.error != null) waiter.reject(new Error(message.error.message ?? 'MCP error'))
      else waiter.resolve(message.result)
    }
  }
}
