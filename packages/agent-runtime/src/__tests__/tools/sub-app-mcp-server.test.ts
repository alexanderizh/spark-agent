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
  let rpcResponseFor:
    | ((request: { method: string; params: Record<string, unknown> }) => unknown)
    | null
  let workspaceRoot = ''

  beforeEach(async () => {
    workspaceRoot = mkdtempSync(path.join(tmpdir(), 'spark-subapp-mcp-'))
    rpcResponseData = { id: 'app-1', draft: { revision: 1 }, items: [], total: 0 }
    rpcResponseFor = null
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
            data: rpcResponseFor?.(body) ?? rpcResponseData,
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
    const guide = tools.find((tool) => tool.name === 'spark_app_developer_guide')
    const validate = tools.find((tool) => tool.name === 'spark_app_validate')
    const create = tools.find((tool) => tool.name === 'spark_app_create')
    const update = tools.find((tool) => tool.name === 'spark_app_update_draft')
    const exportSource = tools.find((tool) => tool.name === 'spark_app_export_source')
    const dataSet = tools.find((tool) => tool.name === 'spark_app_data_set')
    const scaffold = tools.find((tool) => tool.name === 'spark_app_scaffold')
    const projectPublish = tools.find((tool) => tool.name === 'spark_app_project_publish')
    const serviceStatus = tools.find((tool) => tool.name === 'spark_app_service_status')
    const jobsCreate = tools.find((tool) => tool.name === 'spark_app_jobs_create')
    const diagnose = tools.find((tool) => tool.name === 'spark_app_diagnose')
    expect(guide?.description).toContain('权威开发契约')
    expect(validate?.description).toContain('error、warning、suggestion')
    expect(create?.description).toContain('spark_app_developer_guide')
    expect(create?.description).toContain('spark_app_validate')
    expect(create?.description.length).toBeLessThan(1800)
    expect(update?.description.length).toBeLessThan(1200)
    // 防误用约束：未明确要求内置子应用时，默认外部项目开发，不得默认创建子应用
    expect(create?.description).toContain('何时不要调用')
    expect(create?.description).toContain('外部项目开发')
    expect(create?.inputSchema?.properties?.permissions?.default).toEqual(['data'])
    expect(create?.inputSchema?.properties).toHaveProperty('draftFilePath')
    expect(update?.inputSchema?.properties).toHaveProperty('draftFilePath')
    expect(exportSource?.description).toContain('.spark-agent/sub-app-sources/')
    expect(dataSet?.description).toContain('expectedRevision')
    expect(scaffold?.description).toContain('V2')
    expect(projectPublish?.description).toContain('候选 service 健康后才切换')
    expect(serviceStatus?.description).toContain('后台服务')
    expect(jobsCreate?.description).toContain('release')
    expect(diagnose?.description).toContain('联合诊断')
  })

  it('returns a compact guide index and exact SDK contract status without bridge RPC', async () => {
    const running = start()
    const indexResponse = await callMcp(running, {
      jsonrpc: '2.0',
      id: 20,
      method: 'tools/call',
      params: { name: 'spark_app_developer_guide', arguments: {} },
    })
    const index = JSON.parse(toolText(indexResponse)) as {
      navigation: Array<{ id: string }>
      versions: { digest: string }
    }
    expect(index.navigation.some((topic) => topic.id === 'backend')).toBe(true)
    expect(index.versions.digest).toMatch(/^[a-f0-9]{64}$/)
    expect(lastRpc).toBeNull()

    const symbolResponse = await callMcp(running, {
      jsonrpc: '2.0',
      id: 21,
      method: 'tools/call',
      params: {
        name: 'spark_app_developer_guide',
        arguments: { symbol: 'sparkApp.backend.invoke' },
      },
    })
    const symbolResult = JSON.parse(toolText(symbolResponse)) as {
      matches: Array<{ symbol: string; status: string }>
    }
    expect(symbolResult.matches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ symbol: 'sparkApp.backend.invoke', status: 'implemented' }),
      ]),
    )
    expect(lastRpc).toBeNull()

    const lifecycleResponse = await callMcp(running, {
      jsonrpc: '2.0',
      id: 25,
      method: 'tools/call',
      params: {
        name: 'spark_app_developer_guide',
        arguments: { query: '页面关闭后继续' },
      },
    })
    const lifecycle = JSON.parse(toolText(lifecycleResponse)) as {
      topics: Array<{ id: string }>
      totalMatches: number
    }
    expect(lifecycle.totalMatches).toBeGreaterThan(0)
    expect(lifecycle.topics).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'lifecycle' })]),
    )

    const broadResponse = await callMcp(running, {
      jsonrpc: '2.0',
      id: 27,
      method: 'tools/call',
      params: {
        name: 'spark_app_developer_guide',
        arguments: { query: 'sparkApp' },
      },
    })
    const broad = JSON.parse(toolText(broadResponse)) as {
      matches: unknown[]
      totalMatches: number
      returnedMatches: number
      truncated: boolean
    }
    expect(broad.totalMatches).toBeGreaterThan(20)
    expect(broad.matches).toHaveLength(20)
    expect(broad.returnedMatches).toBe(20)
    expect(broad.truncated).toBe(true)
  })

  it('exports a V2 managed project into the current workspace without overwriting', async () => {
    rpcResponseFor = (request) => {
      if (request.method === 'subapp.project_status') {
        return { revision: 3, files: [{ path: 'spark-app.json' }, { path: 'frontend/index.html' }] }
      }
      if (request.method === 'subapp.project_read_file') {
        const content =
          request.params.path === 'spark-app.json' ? '{"schemaVersion":2}' : '<main>ok</main>'
        return { content: Buffer.from(content).toString('base64') }
      }
      return rpcResponseData
    }
    const response = await callMcp(start(), {
      jsonrpc: '2.0',
      id: 29,
      method: 'tools/call',
      params: { name: 'spark_app_project_export', arguments: { appId: 'app-v2' } },
    })
    expect(toolText(response)).not.toContain('Error:')
    const target = path.join(workspaceRoot, '.spark-agent', 'sub-app-projects', 'app-v2', 'rev-3')
    expect(readFileSync(path.join(target, 'frontend/index.html'), 'utf8')).toBe('<main>ok</main>')

    const repeated = await callMcp(child!, {
      jsonrpc: '2.0',
      id: 30,
      method: 'tools/call',
      params: { name: 'spark_app_project_export', arguments: { appId: 'app-v2' } },
    })
    expect(repeated.result).toMatchObject({ isError: true })
  })

  it('validates deterministic runtime failures separately from legacy warnings', async () => {
    const source = `<!doctype html>
      <html><body>
        <iframe src="child.html"></iframe>
        <script>
          localStorage.setItem('value', '1')
          sparkApp.backend.invoke('work', {})
          sparkApp.missing.run()
          sparkApp.ipc.invoke('provider:get-api-key', { id: 'profile' })
        </script>
      </body></html>`
    const response = await callMcp(start(), {
      jsonrpc: '2.0',
      id: 22,
      method: 'tools/call',
      params: {
        name: 'spark_app_validate',
        arguments: { draftHtml: source },
      },
    })
    const validation = JSON.parse(toolText(response)) as {
      valid: boolean
      readyToPublish: boolean
      summary: { errors: number; warnings: number }
      diagnostics: Array<{ severity: string; code: string }>
    }
    expect(validation.valid).toBe(false)
    expect(validation.readyToPublish).toBe(false)
    expect(validation.summary.errors).toBeGreaterThanOrEqual(2)
    expect(validation.summary.warnings).toBeGreaterThanOrEqual(2)
    expect(validation.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ severity: 'error', code: 'CSP_UNSUPPORTED_ELEMENT' }),
        expect.objectContaining({ severity: 'error', code: 'UNKNOWN_SDK_CAPABILITY' }),
        expect.objectContaining({ severity: 'warning', code: 'LEGACY_RAW_IPC' }),
        expect.objectContaining({ severity: 'warning', code: 'LEGACY_PROVIDER_SECRET_ACCESS' }),
      ]),
    )
  })

  it('accepts a self-contained themed V1 app and reports its capabilities', async () => {
    const source = `<!doctype html><html><head><style>
      body { color: var(--spark-color-text); }
    </style></head><body><script>
      async function load() {
        const item = await sparkApp.data.get('app', 'value')
        await sparkApp.data.upsert('app', 'value', item?.value || {}, item?.revision)
      }
      load().catch(console.error)
    </script></body></html>`
    const response = await callMcp(start(), {
      jsonrpc: '2.0',
      id: 23,
      method: 'tools/call',
      params: { name: 'spark_app_validate', arguments: { draftHtml: source } },
    })
    const validation = JSON.parse(toolText(response)) as {
      valid: boolean
      readyToPublish: boolean
      detectedCapabilities: string[]
      summary: { errors: number }
    }
    expect(validation.valid).toBe(true)
    expect(validation.readyToPublish).toBe(true)
    expect(validation.detectedCapabilities).toContain('data')
    expect(validation.summary.errors).toBe(0)
    expect(lastRpc).toBeNull()
  })

  it('does not report SDK errors for examples inside HTML text, comments, or strings', async () => {
    const source = `<!doctype html><html><head><style>
      body { color: var(--spark-color-text); }
    </style></head><body>
      <p>Do not call sparkApp.missing.run() here.</p>
      <script>
        // sparkApp.unknown.call()
        const example = 'sparkApp.backend.invoke()'
        sparkApp.platform.ipc.invoke('app:list', {})
      </script>
    </body></html>`
    const response = await callMcp(start(), {
      jsonrpc: '2.0',
      id: 26,
      method: 'tools/call',
      params: { name: 'spark_app_validate', arguments: { draftHtml: source } },
    })
    const validation = JSON.parse(toolText(response)) as {
      summary: { errors: number; warnings: number }
      diagnostics: Array<{ code: string }>
    }
    expect(validation.summary.errors).toBe(0)
    expect(validation.diagnostics.some((item) => item.code === 'LEGACY_RAW_IPC')).toBe(true)
  })

  it('treats a JavaScript-managed form as a warning instead of a broken element', async () => {
    const source = `<!doctype html><html><head><style>
      body { color: var(--spark-color-text); }
    </style></head><body>
      <form onsubmit="event.preventDefault(); sparkApp.ui.toast('saved')">
        <button>Save</button>
      </form>
    </body></html>`
    const response = await callMcp(start(), {
      jsonrpc: '2.0',
      id: 28,
      method: 'tools/call',
      params: { name: 'spark_app_validate', arguments: { draftHtml: source } },
    })
    const validation = JSON.parse(toolText(response)) as {
      valid: boolean
      diagnostics: Array<{ severity: string; code: string }>
    }
    expect(validation.valid).toBe(true)
    expect(validation.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ severity: 'warning', code: 'CSP_FORM_SUBMISSION_BLOCKED' }),
      ]),
    )
  })

  it('loads an existing draft for validation and preserves its target identity', async () => {
    rpcResponseData = {
      id: 'app-1',
      surface: 'overlay',
      draft: {
        revision: 4,
        source: '<main style="background:var(--spark-color-bg-container)">ok</main>',
        manifest: { surface: 'overlay' },
      },
    }
    const response = await callMcp(start(), {
      jsonrpc: '2.0',
      id: 24,
      method: 'tools/call',
      params: { name: 'spark_app_validate', arguments: { appId: 'app-1' } },
    })
    const validation = JSON.parse(toolText(response)) as {
      target: { appId: string; kind: string }
      readyToPreview: boolean
    }
    expect(lastRpc).toEqual({
      method: 'subapp.get',
      params: { appId: 'app-1' },
    })
    expect(validation.target).toEqual({ appId: 'app-1', kind: 'draft' })
    expect(validation.readyToPreview).toBe(true)
  })

  it('maps draftHtml to source and leaves omitted permissions for the durable default', async () => {
    rpcResponseData = {
      id: 'app-1',
      draft: { revision: 1, source: '<main>todo</main>', manifest: { surface: 'content' } },
    }
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
    const resultText = toolText(response)
    expect(resultText).toContain('validation')
    expect(resultText).toContain('contractDigest')
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
