import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const PNG_PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

describe('spark_media MCP server', () => {
  let tmpDir: string
  let server: Server
  let baseUrl = ''
  let postedBody: Record<string, unknown> | null = null
  let child: ChildProcessWithoutNullStreams | null = null

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `spark-media-mcp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
    mkdirSync(tmpDir, { recursive: true })
    server = createServer((req, res) => {
      if (req.method === 'POST' && req.url === '/images') {
        const chunks: Buffer[] = []
        req.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
        req.on('end', () => {
          postedBody = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ data: [{ url: `${baseUrl}/asset.png` }] }))
        })
        return
      }
      if (req.method === 'GET' && req.url === '/asset.png') {
        res.writeHead(200, { 'content-type': 'image/png' })
        res.end(Buffer.from(PNG_PIXEL, 'base64'))
        return
      }
      res.writeHead(404)
      res.end()
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Failed to bind test server')
    baseUrl = `http://127.0.0.1:${address.port}`
  })

  afterEach(async () => {
    if (child && !child.killed) child.kill()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('renders manifest templates, applies aliases, and materializes image output', async () => {
    const manifest = {
      id: 'test:image-template',
      providerKind: 'test-provider',
      modelId: 'image-model',
      displayName: 'Image Template',
      domains: ['image'],
      capabilities: [
        {
          id: 'image.generate',
          label: '文生图',
          input: { required: ['prompt'] },
          output: { types: ['image'], mimeTypes: ['image/png'] },
          paramSchema: {},
          defaults: { n: 1 },
          aliases: { aspectRatio: 'aspect_ratio' },
        },
      ],
      invocation: {
        mode: 'sync',
        endpoint: '/images',
        method: 'POST',
        contentType: 'json',
        requestTemplate: { model: '{{modelId}}', prompt: '{{prompt}}' },
        response: { kind: 'url', jsonPaths: ['data[].url'], download: true },
      },
      docs: { sourceUrls: [] },
    }
    child = spawn(process.execPath, [path.resolve('src/tools/media-generation-mcp-server.mjs')], {
      cwd: path.resolve('..', 'agent-runtime'),
      env: {
        ...process.env,
        SPARK_MEDIA_API_KEY: 'sk-test',
        SPARK_MEDIA_PROVIDER: 'custom',
        SPARK_MEDIA_MODEL: 'image-model',
        SPARK_MEDIA_BASE_URL: baseUrl,
        SPARK_MEDIA_OUTPUT_DIR: tmpDir,
        SPARK_MEDIA_MANIFESTS_JSON: JSON.stringify([manifest]),
      },
    })

    const response = await callMcp(child, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'generate_image',
        arguments: {
          model: 'test:image-template',
          prompt: 'a test image',
          aspectRatio: '16:9',
          filename: 'mcp-image',
        },
      },
    })

    expect(response.error).toBeUndefined()
    expect(postedBody).toMatchObject({
      model: 'image-model',
      prompt: 'a test image',
      n: 1,
      aspect_ratio: '16:9',
    })
    const file = response.result.structuredContent.files[0] as string
    expect(file).toContain('mcp-image')
    expect(existsSync(file)).toBe(true)
  })

  it('drops unsupported output_format for strict models before reaching provider', async () => {
    const manifest = {
      id: 'test:strict-image',
      providerKind: 'test-provider',
      modelId: 'image-model',
      displayName: 'Strict Image',
      domains: ['image'],
      capabilities: [
        {
          id: 'image.generate',
          label: '文生图',
          input: { required: ['prompt'] },
          output: { types: ['image'], mimeTypes: ['image/png'] },
          // schema 中只有 response_format（canonical），没有 output_format。
          paramSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              aspectRatio: { type: 'string', enum: ['1:1', '16:9'] },
              responseFormat: { type: 'string', enum: ['url', 'b64_json'] },
              n: { type: 'integer', minimum: 1, default: 1 },
            },
          },
          aliases: { aspectRatio: 'aspect_ratio', responseFormat: 'response_format' },
          paramPolicy: { strict: true, passthrough: { enabled: false } },
        },
      ],
      invocation: {
        mode: 'sync',
        endpoint: '/images',
        method: 'POST',
        contentType: 'json',
        requestTemplate: { model: '{{modelId}}', prompt: '{{prompt}}' },
        response: { kind: 'url', jsonPaths: ['data[].url'], download: true },
      },
      docs: { sourceUrls: [] },
    }
    child = spawn(process.execPath, [path.resolve('src/tools/media-generation-mcp-server.mjs')], {
      cwd: path.resolve('..', 'agent-runtime'),
      env: {
        ...process.env,
        SPARK_MEDIA_API_KEY: 'sk-test',
        SPARK_MEDIA_PROVIDER: 'custom',
        SPARK_MEDIA_MODEL: 'image-model',
        SPARK_MEDIA_BASE_URL: baseUrl,
        SPARK_MEDIA_OUTPUT_DIR: tmpDir,
        SPARK_MEDIA_MANIFESTS_JSON: JSON.stringify([manifest]),
      },
    })

    const response = await callMcp(child, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'generate_image',
        arguments: {
          model: 'test:strict-image',
          prompt: 'a strict test image',
          aspectRatio: '16:9',
          output_format: 'png',
          extraJson: { custom_unsupported_field: 'should-be-dropped' },
        },
      },
    })

    expect(response.error).toBeUndefined()
    expect(postedBody).not.toHaveProperty('output_format')
    expect(postedBody).not.toHaveProperty('outputFormat')
    expect(postedBody).not.toHaveProperty('custom_unsupported_field')
    expect(postedBody).toMatchObject({
      model: 'image-model',
      prompt: 'a strict test image',
      aspect_ratio: '16:9',
    })
    const structured = response.result.structuredContent
    const droppedNames = structured.droppedParams.map((entry: { name: string }) => entry.name)
    // output_format 在归一化时被转成 canonical 的 outputFormat；二者都不应进入 provider 请求。
    expect(droppedNames).toContain('outputFormat')
    expect(droppedNames).toContain('custom_unsupported_field')
  })

  it('drops unknown extraJson fields under strict + passthrough disabled', async () => {
    const manifest = {
      id: 'test:strict-no-passthrough',
      providerKind: 'test-provider',
      modelId: 'image-model',
      displayName: 'Strict No Passthrough',
      domains: ['image'],
      capabilities: [
        {
          id: 'image.generate',
          label: '文生图',
          input: { required: ['prompt'] },
          output: { types: ['image'], mimeTypes: ['image/png'] },
          paramSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              aspectRatio: { type: 'string', enum: ['1:1', '16:9'] },
              n: { type: 'integer', minimum: 1, default: 1 },
            },
          },
          aliases: { aspectRatio: 'aspect_ratio' },
          paramPolicy: {
            strict: true,
            passthrough: { enabled: false },
            forbidden: [{ name: 'watermark', reason: 'watermark not supported by this provider' }],
          },
        },
      ],
      invocation: {
        mode: 'sync',
        endpoint: '/images',
        method: 'POST',
        contentType: 'json',
        requestTemplate: { model: '{{modelId}}', prompt: '{{prompt}}' },
        response: { kind: 'url', jsonPaths: ['data[].url'], download: true },
      },
      docs: { sourceUrls: [] },
    }
    child = spawn(process.execPath, [path.resolve('src/tools/media-generation-mcp-server.mjs')], {
      cwd: path.resolve('..', 'agent-runtime'),
      env: {
        ...process.env,
        SPARK_MEDIA_API_KEY: 'sk-test',
        SPARK_MEDIA_PROVIDER: 'custom',
        SPARK_MEDIA_MODEL: 'image-model',
        SPARK_MEDIA_BASE_URL: baseUrl,
        SPARK_MEDIA_OUTPUT_DIR: tmpDir,
        SPARK_MEDIA_MANIFESTS_JSON: JSON.stringify([manifest]),
      },
    })

    const response = await callMcp(child, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'generate_image',
        arguments: {
          model: 'test:strict-no-passthrough',
          prompt: 'a strict no-passthrough test',
          aspectRatio: '1:1',
          extraJson: {
            watermark: true,
            unknown_field: 'unknown_value',
          },
        },
      },
    })

    expect(response.error).toBeUndefined()
    // strict + passthrough disabled：未知字段与 forbidden 字段都应被丢弃，不进入 provider 请求体。
    expect(postedBody).not.toHaveProperty('watermark')
    expect(postedBody).not.toHaveProperty('unknown_field')
    expect(postedBody).toMatchObject({
      model: 'image-model',
      prompt: 'a strict no-passthrough test',
      aspect_ratio: '1:1',
    })
    const structured = response.result.structuredContent
    const droppedNames = structured.droppedParams.map((entry: { name: string }) => entry.name)
    expect(droppedNames).toContain('watermark')
    expect(droppedNames).toContain('unknown_field')
    // forbidden 命中应额外报一条 validationIssues，方便 agent 区分"未声明"与"显式禁止"。
    const issueCodes = structured.validationIssues?.map((issue: { code: string }) => issue.code) ?? []
    expect(issueCodes).toContain('forbidden_param')
  })

  it('exposes paramPolicySummary and errorContract via describe_model', async () => {
    const manifest = {
      id: 'test:describe-policy',
      providerKind: 'test-provider',
      modelId: 'image-model',
      displayName: 'Describe Policy',
      domains: ['image'],
      capabilities: [
        {
          id: 'image.generate',
          label: '文生图',
          input: { required: ['prompt'] },
          output: { types: ['image'], mimeTypes: ['image/png'] },
          paramSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              aspectRatio: { type: 'string', enum: ['1:1', '16:9'] },
              n: { type: 'integer', minimum: 1, default: 1 },
            },
          },
          aliases: { aspectRatio: 'aspect_ratio' },
          paramPolicy: {
            strict: true,
            passthrough: { enabled: false, allow: ['watermark'] },
            forbidden: [{ name: 'size', reason: 'not supported' }],
            transforms: [{ kind: 'ratio_size_to_aspect', from: 'size', to: 'aspectRatio' }],
          },
        },
      ],
      invocation: {
        mode: 'sync',
        endpoint: '/images',
        method: 'POST',
        contentType: 'json',
        requestTemplate: { model: '{{modelId}}', prompt: '{{prompt}}' },
        response: { kind: 'url', jsonPaths: ['data[].url'], download: true },
      },
      docs: { sourceUrls: [] },
      error: {
        codePaths: ['error.code'],
        messagePaths: ['error.message'],
        mappings: { invalid_request_error: 'invalid_parameter_value' },
        retryableCodes: ['rate_limit_exceeded'],
      },
    }
    child = spawn(process.execPath, [path.resolve('src/tools/media-generation-mcp-server.mjs')], {
      cwd: path.resolve('..', 'agent-runtime'),
      env: {
        ...process.env,
        SPARK_MEDIA_API_KEY: 'sk-test',
        SPARK_MEDIA_PROVIDER: 'custom',
        SPARK_MEDIA_MODEL: 'image-model',
        SPARK_MEDIA_BASE_URL: baseUrl,
        SPARK_MEDIA_OUTPUT_DIR: tmpDir,
        SPARK_MEDIA_MANIFESTS_JSON: JSON.stringify([manifest]),
      },
    })

    const response = await callMcp(child, {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'describe_model',
        arguments: { model: 'test:describe-policy' },
      },
    })

    expect(response.error).toBeUndefined()
    const model = response.result.structuredContent.model
    const cap = model.capabilities[0]
    expect(cap.paramPolicySummary).toMatchObject({
      strict: true,
      passthrough: { enabled: false, allow: ['watermark'] },
      forbidden: [{ name: 'size', reason: 'not supported' }],
      transforms: [{ kind: 'ratio_size_to_aspect', from: 'size', to: 'aspectRatio' }],
    })
    expect(response.result.structuredContent.errorContract).toMatchObject({
      codePaths: ['error.code'],
      messagePaths: ['error.message'],
      mappings: { invalid_request_error: 'invalid_parameter_value' },
      retryableCodes: ['rate_limit_exceeded'],
    })
  })

  it('exposes rolePolicy (frame roles + multimodal reference roles) via describe_model', async () => {
    const manifest = {
      id: 'test:describe-role-policy',
      providerKind: 'test-provider',
      modelId: 'video-model',
      displayName: 'Describe Role Policy',
      domains: ['video'],
      capabilities: [
        {
          id: 'video.image_to_video',
          label: '图生视频（首帧/首尾帧）',
          input: { required: ['prompt', 'image'], maxImages: 2 },
          output: { types: ['video'], mimeTypes: ['video/mp4'] },
          paramSchema: {},
        },
        {
          id: 'video.generate',
          label: '文生视频 / 多模态参考',
          input: { required: ['prompt'], maxImages: 9 },
          output: { types: ['video'], mimeTypes: ['video/mp4'] },
          paramSchema: {},
        },
      ],
      invocation: {
        mode: 'async_polling',
        endpoint: '/videos',
        method: 'POST',
        contentType: 'json',
        requestTemplate: {},
        response: { kind: 'task_poll', taskIdPaths: ['id'] },
      },
      docs: { sourceUrls: [] },
    }
    child = spawn(process.execPath, [path.resolve('src/tools/media-generation-mcp-server.mjs')], {
      cwd: path.resolve('..', 'agent-runtime'),
      env: {
        ...process.env,
        SPARK_MEDIA_API_KEY: 'sk-test',
        SPARK_MEDIA_PROVIDER: 'custom',
        SPARK_MEDIA_MODEL: 'video-model',
        SPARK_MEDIA_BASE_URL: baseUrl,
        SPARK_MEDIA_OUTPUT_DIR: tmpDir,
        SPARK_MEDIA_MANIFESTS_JSON: JSON.stringify([manifest]),
      },
    })

    const response = await callMcp(child, {
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: {
        name: 'describe_model',
        arguments: { model: 'test:describe-role-policy' },
      },
    })

    expect(response.error).toBeUndefined()
    const caps = response.result.structuredContent.model.capabilities
    const i2v = caps.find((c: { id: string }) => c.id === 'video.image_to_video')
    // 帧角色路径：maxImages>=2 → 首帧+尾帧
    expect(i2v.rolePolicy).toMatchObject({
      imageRoles: ['first_frame', 'last_frame'],
      defaultRoleAssignment: 'first_then_last_then_reference',
    })
    const gen = caps.find((c: { id: string }) => c.id === 'video.generate')
    // 纯参考图路径：多模态参考（图/视频/音频）
    expect(gen.rolePolicy).toMatchObject({
      imageRoles: ['reference_image'],
      videoRoles: ['reference_video'],
      audioRoles: ['reference_audio'],
      defaultRoleAssignment: 'all_reference',
    })
  })

  it('lists media generation tools with loose model-parameter schemas that point agents to describe_model', async () => {
    child = spawn(process.execPath, [path.resolve('src/tools/media-generation-mcp-server.mjs')], {
      cwd: path.resolve('..', 'agent-runtime'),
      env: {
        ...process.env,
        SPARK_MEDIA_API_KEY: 'sk-test',
        SPARK_MEDIA_PROVIDER: 'custom',
        SPARK_MEDIA_MODEL: 'image-model',
        SPARK_MEDIA_BASE_URL: baseUrl,
        SPARK_MEDIA_OUTPUT_DIR: tmpDir,
      },
    })

    const response = await callMcp(child, {
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/list',
      params: {},
    })

    expect(response.error).toBeUndefined()
    const tools = response.result.tools as Array<{
      name: string
      inputSchema: { properties: Record<string, { enum?: string[]; description?: string }> }
    }>
    const image = tools.find((tool) => tool.name === 'generate_image')
    const video = tools.find((tool) => tool.name === 'generate_video')
    expect(image).toBeDefined()
    expect(video).toBeDefined()
    const imageProps = image!.inputSchema.properties
    const videoProps = video!.inputSchema.properties
    expect(imageProps.resolution).toBeDefined()
    expect(imageProps.aspectRatio).toBeDefined()
    expect(imageProps.output_format).toBeDefined()
    expect(videoProps.resolution).toBeDefined()
    expect(videoProps.aspectRatio).toBeDefined()
    expect(videoProps.mode).toBeDefined()
    expect(videoProps.capability).toBeDefined()
    expect(imageProps.resolution!.enum).toBeUndefined()
    expect(imageProps.aspectRatio!.enum).toBeUndefined()
    expect(imageProps.output_format!.enum).toBeUndefined()
    expect(videoProps.resolution!.enum).toBeUndefined()
    expect(videoProps.aspectRatio!.enum).toBeUndefined()
    expect(videoProps.mode!.enum).toBeUndefined()
    expect(videoProps.capability!.enum).toBeUndefined()
    expect(videoProps.resolution!.description).toContain('describe_model')
  })
})

function callMcp(child: ChildProcessWithoutNullStreams, request: Record<string, unknown>): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('MCP call timed out')), 5_000)
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
