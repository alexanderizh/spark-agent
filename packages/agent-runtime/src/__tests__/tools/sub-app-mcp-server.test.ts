import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const SERVER = path.resolve('src/tools/sub-app-mcp-server.mjs')

describe('spark_app MCP server', () => {
  let server: Server
  let child: ChildProcessWithoutNullStreams | null = null
  let port = 0
  let lastRpc: { method: string; params: Record<string, unknown> } | null = null
  let rpcResponseData: unknown
  let workspaceRoot = ''

  beforeEach(async () => {
    workspaceRoot = mkdtempSync(path.join(tmpdir(), 'spark-subapp-mcp-'))
    rpcResponseData = { id: 'app-1', draft: { revision: 1 }, items: [], total: 0 }
    server = createServer((request, response) => {
      const chunks: Buffer[] = []
      request.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
      request.on('end', () => {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
          method: string
          params: Record<string, unknown>
        }
        lastRpc = body
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(
          JSON.stringify({
            ok: true,
            data: rpcResponseData,
          }),
        )
      })
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (address == null || typeof address === 'string') throw new Error('failed to bind bridge')
    port = address.port
    lastRpc = null
  })

  afterEach(async () => {
    child?.kill()
    child = null
    await new Promise<void>((resolve) => server.close(() => resolve()))
    rmSync(workspaceRoot, { recursive: true, force: true })
    workspaceRoot = ''
  })

  function start(): ChildProcessWithoutNullStreams {
    child = spawn(process.execPath, [SERVER], {
      cwd: path.resolve('..', 'agent-runtime'),
      env: {
        ...process.env,
        SPARK_PLATFORM_BRIDGE_PORT: String(port),
        SPARK_WORKSPACE_ROOT: workspaceRoot,
      },
    })
    return child
  }

  it('exposes the persistence contract to the agent', async () => {
    const response = await callMcp(start(), { jsonrpc: '2.0', id: 1, method: 'tools/list' })
    const result = response.result as {
      tools?: Array<{
        name: string
        description: string
        inputSchema?: { properties?: Record<string, { default?: unknown }> }
      }>
    }
    const tools = result.tools ?? []
    const create = tools.find((tool) => tool.name === 'spark_app_create')
    const update = tools.find((tool) => tool.name === 'spark_app_update_draft')
    const exportSource = tools.find((tool) => tool.name === 'spark_app_export_source')
    const dataSet = tools.find((tool) => tool.name === 'spark_app_data_set')
    expect(create?.description).toContain('sparkApp.data')
    expect(create?.description).toContain('localStorage')
    expect(create?.description).toContain('默认不要给应用根容器')
    // 防误用约束：未明确要求内置子应用时，默认外部项目开发，不得默认创建子应用
    expect(create?.description).toContain('何时不要调用')
    expect(create?.description).toContain('外部项目开发')
    expect(create?.inputSchema?.properties?.permissions?.default).toEqual(['data'])
    expect(create?.inputSchema?.properties).toHaveProperty('draftFilePath')
    expect(update?.inputSchema?.properties).toHaveProperty('draftFilePath')
    expect(exportSource?.description).toContain('.spark-agent/sub-app-sources/')
    expect(dataSet?.description).toContain('expectedRevision')
  })

  it('maps draftHtml to source and leaves omitted permissions for the durable default', async () => {
    const response = await callMcp(start(), {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'spark_app_create',
        arguments: { name: 'Todo', draftHtml: '<main>todo</main>' },
      },
    })
    expect(response.error).toBeUndefined()
    expect(lastRpc).toEqual({
      method: 'subapp.create',
      params: { name: 'Todo', source: '<main>todo</main>' },
    })
  })

  it('reads long draft source from a workspace file instead of the tool arguments', async () => {
    const sourcePath = path.join(workspaceRoot, 'todo.html')
    const source = `<main>${'todo'.repeat(5000)}</main>`
    writeFileSync(sourcePath, source)

    const response = await callMcp(start(), {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'spark_app_update_draft',
        arguments: { appId: 'app-1', expectedRevision: 1, draftFilePath: sourcePath },
      },
    })

    expect(response.error).toBeUndefined()
    expect(lastRpc).toEqual({
      method: 'subapp.update_draft',
      params: {
        appId: 'app-1',
        expectedDraftRevision: 1,
        patch: { source },
      },
    })
  })

  it('rejects draft file paths outside the current workspace', async () => {
    const outsideRoot = mkdtempSync(path.join(tmpdir(), 'spark-subapp-outside-'))
    const outsidePath = path.join(outsideRoot, 'outside.html')
    writeFileSync(outsidePath, '<main>outside</main>')
    try {
      const response = await callMcp(start(), {
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: {
          name: 'spark_app_update_draft',
          arguments: { appId: 'app-1', expectedRevision: 1, draftFilePath: outsidePath },
        },
      })
      expect(toolText(response)).toContain('必须位于当前工作区内')
      expect((response.result as { isError?: boolean }).isError).toBe(true)
      expect(lastRpc).toBeNull()
    } finally {
      rmSync(outsideRoot, { recursive: true, force: true })
    }
  })

  it('compacts both draft and published source in lifecycle tool results', async () => {
    const source = `<html>${'x'.repeat(40_000)}</html>`
    rpcResponseData = {
      id: 'app-1',
      publicationStatus: 'published',
      draft: { revision: 2, source },
      publishedRelease: { version: 1, source },
    }

    const response = await callMcp(start(), {
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: {
        name: 'spark_app_publish',
        arguments: { appId: 'app-1', expectedRevision: 2 },
      },
    })
    const text = toolText(response)
    expect(text.length).toBeLessThan(3000)
    expect(text).toContain('sourceInfo')
    expect(text).toContain('sha256')
    expect(text).not.toContain('xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx')
  })

  it('exports full source to a content-addressed workspace file and reuses it', async () => {
    const source = '<html><body>full source</body></html>'
    rpcResponseData = { id: 'app-1', draft: { revision: 7, source }, publishedRelease: null }

    const first = await callMcp(start(), {
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: { name: 'spark_app_export_source', arguments: { appId: 'app-1' } },
    })
    const firstResult = JSON.parse(toolText(first)) as {
      path: string
      reused: boolean
      sourceInfo: { sha256: string }
    }
    expect(firstResult.reused).toBe(false)
    expect(firstResult.path).toContain(path.join('.spark-agent', 'sub-app-sources', 'app-1'))
    expect(firstResult.path).toContain(firstResult.sourceInfo.sha256)
    expect(existsSync(firstResult.path)).toBe(true)
    expect(readFileSync(firstResult.path, 'utf8')).toBe(source)

    rpcResponseData = { id: 'app-1', draft: { revision: 8, source }, publishedRelease: null }
    child?.kill()
    child = null
    const secondChild = start()
    const second = await callMcp(secondChild, {
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: { name: 'spark_app_export_source', arguments: { appId: 'app-1' } },
    })
    const secondResult = JSON.parse(toolText(second)) as { path: string; reused: boolean }
    expect(secondResult.path).toBe(firstResult.path)
    expect(secondResult.reused).toBe(true)

    writeFileSync(secondResult.path, 'tampered')
    const tampered = await callMcp(secondChild, {
      jsonrpc: '2.0',
      id: 8,
      method: 'tools/call',
      params: { name: 'spark_app_export_source', arguments: { appId: 'app-1' } },
    })
    expect(toolText(tampered)).toContain('SHA-256 不一致')
    expect((tampered.result as { isError?: boolean }).isError).toBe(true)
  })

  it('rejects a symlinked export directory before creating anything outside the workspace', async () => {
    const outsideRoot = mkdtempSync(path.join(tmpdir(), 'spark-subapp-export-outside-'))
    mkdirSync(path.join(workspaceRoot, '.spark-agent'), { recursive: true })
    symlinkSync(
      outsideRoot,
      path.join(workspaceRoot, '.spark-agent', 'sub-app-sources'),
      process.platform === 'win32' ? 'junction' : 'dir',
    )
    rpcResponseData = {
      id: 'app-1',
      draft: { revision: 3, source: '<html>safe boundary</html>' },
    }

    try {
      const response = await callMcp(start(), {
        jsonrpc: '2.0',
        id: 9,
        method: 'tools/call',
        params: { name: 'spark_app_export_source', arguments: { appId: 'app-1' } },
      })
      expect((response.result as { isError?: boolean }).isError).toBe(true)
      expect(toolText(response)).toContain('不能是符号链接')
      expect(existsSync(path.join(outsideRoot, 'app-1'))).toBe(false)
    } finally {
      rmSync(outsideRoot, { recursive: true, force: true })
    }
  })
})

function callMcp(
  child: ChildProcessWithoutNullStreams,
  request: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let buffer = ''
    const onData = (chunk: Buffer): void => {
      buffer += chunk.toString('utf8')
      const newline = buffer.indexOf('\n')
      if (newline < 0) return
      const line = buffer.slice(0, newline)
      child.stdout.off('data', onData)
      try {
        resolve(JSON.parse(line) as Record<string, unknown>)
      } catch (error) {
        reject(error)
      }
    }
    child.stdout.on('data', onData)
    child.once('error', reject)
    child.stdin.write(`${JSON.stringify(request)}\n`)
  })
}

function toolText(response: Record<string, unknown>): string {
  const result = response.result as
    | { content?: Array<{ type?: string; text?: string }>; isError?: boolean }
    | undefined
  const text = result?.content?.find((item) => item.type === 'text')?.text
  if (text == null) throw new Error('missing MCP text result')
  return text
}
