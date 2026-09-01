import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PLATFORM_TOOL_NAMES } from '../../services/session-mcp-tooling-helpers.js'

const SERVER = path.resolve('src/tools/platform-management-mcp-server.mjs')

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
    expect(toolNames).toEqual(
      expect.arrayContaining([
        'skills_load',
        'skills_search_github',
        'skills_install_github',
        'artifacts_list',
        'artifacts_resolve',
        'codex_runtime_diagnostics',
        'codex_runtime_restart_idle',
        'teams_list',
        'teams_get',
        'teams_create',
        'teams_update',
        'teams_delete',
        'providers_media_guide',
        'providers_media_validate',
        'providers_media_configure',
        'providers_media_discover_models',
        'providers_media_diagnose',
        'custom_tools_guide',
        'custom_tools_list',
        'custom_tools_get',
        'custom_tools_validate',
        'custom_tools_create_draft',
        'custom_tools_save_draft',
        'custom_tools_test',
        'custom_tools_publish',
        'custom_tools_set_enabled',
        'custom_tools_rollback',
        'custom_tools_delete',
        'tool_packages_guide',
        'tool_packages_list',
        'tool_packages_get',
        'tool_packages_inspect',
        'tool_packages_create_project',
        'tool_packages_list_project_files',
        'tool_packages_read_project_file',
        'tool_packages_write_project_file',
        'tool_packages_install_directory',
        'tool_packages_environment_status',
        'tool_packages_configure_environment',
        'tool_packages_request_secret',
        'tool_packages_set_permission',
        'tool_packages_set_enabled',
        'tool_packages_test',
      ]),
    )
    expect(toolNames).toEqual(
      expect.arrayContaining([
        'session_schedule_list',
        'session_schedule_get',
        'session_schedule_create',
        'session_schedule_update',
        'session_schedule_delete',
      ]),
    )
    const tools = res.result.tools as Array<{
      name: string
      description: string
      inputSchema: { properties?: Record<string, unknown> }
    }>
    const validateTool = tools.find((tool) => tool.name === 'providers_media_validate')
    const configureTool = tools.find((tool) => tool.name === 'providers_media_configure')
    const customToolList = tools.find((tool) => tool.name === 'custom_tools_list')
    expect(validateTool?.inputSchema.properties).not.toHaveProperty('apiKey')
    expect(configureTool?.inputSchema.properties).toHaveProperty('apiKey')
    expect(validateTool?.description).toContain('resolvedModels')
    expect(configureTool?.description).toContain('自动生成、修复或保留渠道唯一 Manifest ID')
    expect(customToolList?.inputSchema.properties).toHaveProperty('limit')
    // input 必须显式声明 type: 'object'：无类型属性会让模型侧把嵌套对象
    // 序列化成字符串，平台校验层报 "expected object, received string"。
    const testTool = tools.find((tool) => tool.name === 'tool_packages_test')
    expect(testTool?.inputSchema.properties?.input).toMatchObject({
      type: 'object',
      additionalProperties: true,
    })
  })

  it('responds to optional MCP resource and prompt list methods without hanging', async () => {
    child = start()

    await expect(
      callMcp(child, {
        jsonrpc: '2.0',
        id: 10,
        method: 'resources/list',
      }),
    ).resolves.toEqual({
      jsonrpc: '2.0',
      id: 10,
      result: { resources: [] },
    })
    await expect(
      callMcp(child, {
        jsonrpc: '2.0',
        id: 11,
        method: 'resources/templates/list',
      }),
    ).resolves.toEqual({
      jsonrpc: '2.0',
      id: 11,
      result: { resourceTemplates: [] },
    })
    await expect(
      callMcp(child, {
        jsonrpc: '2.0',
        id: 12,
        method: 'prompts/list',
      }),
    ).resolves.toEqual({
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
        res.end(
          JSON.stringify({
            ok: true,
            data: {
              team: {
                id: 'team-1',
                name: '研发协作团队',
                hostAgentId: 'platform-manager-agent',
                memberAgentIds: ['fullstack-coding-agent'],
              },
            },
          }),
        )
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

  it('routes custom tool draft creation to the production bridge method', async () => {
    let lastRpc: { method?: string; params?: unknown } | null = null
    bridge = createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
      req.on('end', () => {
        lastRpc = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: true, data: { workspace: { tool: { enabled: false } } } }))
      })
    })
    const port = await new Promise<number>((resolve) => {
      bridge?.listen(0, '127.0.0.1', () => {
        const address = bridge?.address()
        if (!address || typeof address === 'string') throw new Error('Failed to bind bridge')
        resolve(address.port)
      })
    })
    const spec = {
      id: 'weather_lookup',
      title: '天气查询',
      description: '根据城市名称查询当前天气，仅在用户询问实时天气时调用。',
      type: 'http',
      inputSchema: {
        type: 'object',
        properties: { city: { type: 'string' } },
        required: ['city'],
      },
      spec: {
        request: {
          method: 'GET',
          urlTemplate: 'https://api.example.com/weather?city={{city}}',
        },
        response: { format: 'text' },
      },
      risk: 'read',
      effect: 'read',
      idempotency: 'safe',
      timeoutMs: 30_000,
    }

    child = start({ SPARK_PLATFORM_BRIDGE_PORT: String(port) })
    const res = await callMcp(child, {
      jsonrpc: '2.0',
      id: 20,
      method: 'tools/call',
      params: {
        name: 'custom_tools_create_draft',
        arguments: { spec },
      },
    })

    expect(res.error).toBeUndefined()
    expect(lastRpc).toEqual({ method: 'custom_tools.create_draft', params: { spec } })
  })

  it('routes artifact lookup tool calls to the platform bridge', async () => {
    let lastRpc: { method?: string; params?: unknown } | null = null
    bridge = createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
      req.on('end', () => {
        lastRpc = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(
          JSON.stringify({
            ok: true,
            data: {
              artifact: {
                id: 'runtime.python-3.11.9.win32-x64',
                type: 'runtime',
                url: 'https://minio.yiqibyte.com/spark-desktop/artifact-repository/v1/runtimes/python/python-3.11.9-amd64.exe',
              },
            },
          }),
        )
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

  it('routes custom media provider configuration to the production bridge method', async () => {
    let lastRpc: { method?: string; params?: unknown } | null = null
    bridge = createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
      req.on('end', () => {
        lastRpc = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(
          JSON.stringify({
            ok: true,
            data: { created: true, provider: { id: 'provider-custom', hasApiKey: true } },
          }),
        )
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
      id: 30,
      method: 'tools/call',
      params: {
        name: 'providers_media_configure',
        arguments: {
          name: '自定义图片渠道',
          apiEndpoint: 'https://media.example/v1',
          defaultModel: 'image-model',
          models: [{ modelId: 'image-model', manifest: { id: 'manifest-placeholder' } }],
          apiKey: 'secret-forwarded-only-to-bridge',
        },
      },
    })

    expect(res.error).toBeUndefined()
    expect(lastRpc).toMatchObject({
      method: 'providers.media_configure',
      params: {
        name: '自定义图片渠道',
        apiEndpoint: 'https://media.example/v1',
        defaultModel: 'image-model',
        apiKey: 'secret-forwarded-only-to-bridge',
      },
    })
    expect(JSON.stringify(res)).not.toContain('secret-forwarded-only-to-bridge')
  })

  it('routes schedule calls with the trusted current session id', async () => {
    let lastRpc: { method?: string; params?: unknown } | null = null
    bridge = createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
      req.on('end', () => {
        lastRpc = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ ok: true, data: { task: { id: 'schedule-1' } } }))
      })
    })
    const port = await new Promise<number>((resolve) => {
      bridge?.listen(0, '127.0.0.1', () => {
        const address = bridge?.address()
        if (!address || typeof address === 'string') throw new Error('Failed to bind bridge')
        resolve(address.port)
      })
    })

    child = start({
      SPARK_PLATFORM_BRIDGE_PORT: String(port),
      SPARK_SESSION_ID: 'trusted-session',
    })
    const res = await callMcp(child, {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'session_schedule_create',
        arguments: {
          sessionId: 'model-supplied-session',
          name: 'Check third-party job',
          triggerType: 'interval',
          intervalSeconds: 60,
          promptTemplate: 'Check the job and delete this schedule when complete.',
        },
      },
    })

    expect(res.error).toBeUndefined()
    expect(lastRpc).toMatchObject({
      method: 'session_schedule.create',
      params: {
        sessionId: 'trusted-session',
        name: 'Check third-party job',
        triggerType: 'interval',
      },
    })
  })
})

function readPlatformAllowedToolNames(): string[] {
  return [...PLATFORM_TOOL_NAMES]
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
