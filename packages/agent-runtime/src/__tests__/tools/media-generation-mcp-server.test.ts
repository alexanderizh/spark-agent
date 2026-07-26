import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { BUILTIN_MEDIA_MODEL_MANIFESTS } from '@spark/protocol'

const PNG_PIXEL =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

function volcVideoManifest() {
  const rolePolicy = {
    imageRoles: ['first_frame', 'last_frame', 'reference_image'],
    videoRoles: ['reference_video'],
    audioRoles: ['reference_audio'],
    defaultRoleAssignment: 'first_then_last_then_reference',
  }
  const referenceRolePolicy = {
    imageRoles: ['reference_image'],
    videoRoles: ['reference_video'],
    audioRoles: ['reference_audio'],
    defaultRoleAssignment: 'all_reference',
  }
  return {
    id: 'volcengine:doubao-seedance-2-0-260128',
    providerKind: 'volcengine-ark',
    modelId: 'doubao-seedance-2-0-260128',
    displayName: 'Seedance 2.0',
    domains: ['video'],
    capabilities: [
      {
        id: 'video.image_to_video',
        label: '首帧/首尾帧/多模态参考',
        input: { required: ['image'], maxImages: 9, maxVideos: 3, maxAudios: 3 },
        rolePolicy,
        output: { types: ['video'], mimeTypes: ['video/mp4'] },
        paramSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            aspectRatio: { type: 'string', enum: ['智能比例', '16:9'] },
            durationSeconds: { type: 'integer', minimum: -1, maximum: 15 },
            searchEnabled: { type: 'boolean' },
          },
        },
        aliases: {
          aspectRatio: 'ratio',
          durationSeconds: 'duration',
          searchEnabled: 'enable_search',
        },
        paramPolicy: { strict: true, passthrough: { enabled: false } },
      },
      {
        id: 'video.reference_to_video',
        label: '多模态参考生视频',
        input: { required: [], maxImages: 9, maxVideos: 3, maxAudios: 3 },
        rolePolicy: referenceRolePolicy,
        output: { types: ['video'], mimeTypes: ['video/mp4'] },
        paramSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            aspectRatio: { type: 'string', enum: ['智能比例', '16:9'] },
            durationSeconds: { type: 'integer', minimum: -1, maximum: 15 },
            searchEnabled: { type: 'boolean' },
          },
        },
        aliases: {
          aspectRatio: 'ratio',
          durationSeconds: 'duration',
          searchEnabled: 'enable_search',
        },
        paramPolicy: { strict: true, passthrough: { enabled: false } },
      },
    ],
    invocation: {
      mode: 'async_polling',
      endpoint: '/contents/generations/tasks',
      method: 'POST',
      contentType: 'json',
      requestTemplate: { model: '{{modelId}}', content: '{{content}}' },
      response: {
        kind: 'task_poll',
        taskIdPaths: ['id'],
        statusEndpoint: '/contents/generations/tasks/{{taskId}}',
        resultPaths: ['content.video_url'],
      },
      polling: {
        intervalMs: 1,
        timeoutMs: 3000,
        statusMap: {
          queued: 'queued',
          running: 'running',
          succeeded: 'succeeded',
          failed: 'failed',
        },
      },
    },
    docs: { sourceUrls: [] },
  }
}

describe('spark_media MCP server', () => {
  let tmpDir: string
  let server: Server
  let baseUrl = ''
  let postedBody: Record<string, unknown> | null = null
  let postedRawBody = ''
  let postedHeaders: Record<string, string | string[] | undefined> = {}
  let postedPath = ''
  let fileUploadCount = 0
  let fileUploadBody = ''
  let omniFilePollCount = 0
  let googleDownloadApiKey = ''
  let imageResponseDelayMs = 0
  let child: ChildProcessWithoutNullStreams | null = null

  beforeEach(async () => {
    tmpDir = path.join(
      os.tmpdir(),
      `spark-media-mcp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    )
    mkdirSync(tmpDir, { recursive: true })
    fileUploadCount = 0
    fileUploadBody = ''
    omniFilePollCount = 0
    googleDownloadApiKey = ''
    imageResponseDelayMs = 0
    postedHeaders = {}
    postedPath = ''
    postedRawBody = ''
    server = createServer((req, res) => {
      if (
        req.method === 'POST' &&
        (req.url === '/images' ||
          req.url === '/images/generations' ||
          req.url === '/provider-a/images' ||
          req.url === '/provider-b/images')
      ) {
        const chunks: Buffer[] = []
        req.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
        req.on('end', () => {
          postedPath = req.url ?? ''
          postedHeaders = req.headers
          postedBody = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
          const respond = () => {
            res.writeHead(200, { 'content-type': 'application/json' })
            res.end(JSON.stringify({ data: [{ url: `${baseUrl}/asset.png` }] }))
          }
          if (imageResponseDelayMs > 0) setTimeout(respond, imageResponseDelayMs)
          else respond()
        })
        return
      }
      if (req.method === 'POST' && req.url === '/interactions') {
        const chunks: Buffer[] = []
        req.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
        req.on('end', () => {
          postedHeaders = req.headers
          postedBody = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(
            JSON.stringify({
              id: 'interaction-omni',
              status: 'completed',
              steps: [
                {
                  type: 'model_output',
                  content: [
                    {
                      type: 'video',
                      mime_type: 'video/mp4',
                      uri: `${baseUrl}/files/omni-file:download?alt=media`,
                    },
                  ],
                },
              ],
            }),
          )
        })
        return
      }
      if (req.method === 'POST' && req.url === '/videos') {
        const chunks: Buffer[] = []
        req.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
        req.on('end', () => {
          postedHeaders = req.headers
          postedRawBody = Buffer.concat(chunks).toString('latin1')
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ id: 'sora-request', status: 'queued' }))
        })
        return
      }
      if (
        req.method === 'POST' &&
        req.url?.startsWith('/models/veo-3.1-generate-preview:predictLongRunning')
      ) {
        const chunks: Buffer[] = []
        req.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
        req.on('end', () => {
          postedBody = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ name: 'operations/veo-task' }))
        })
        return
      }
      if (
        req.method === 'POST' &&
        (req.url === '/videos/generations' ||
          req.url === '/provider-b/videos/generations' ||
          req.url === '/videos/extensions')
      ) {
        const chunks: Buffer[] = []
        req.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
        req.on('end', () => {
          postedBody = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ request_id: 'request-1' }))
        })
        return
      }
      if (req.method === 'POST' && req.url === '/contents/generations/tasks') {
        const chunks: Buffer[] = []
        req.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
        req.on('end', () => {
          postedBody = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ id: 'volc-task' }))
        })
        return
      }
      if (
        req.method === 'POST' &&
        req.url === '/api/v1/services/aigc/video-generation/video-synthesis'
      ) {
        const chunks: Buffer[] = []
        req.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
        req.on('end', () => {
          postedHeaders = req.headers
          postedBody = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(
            JSON.stringify({ request_id: 'submit-request', output: { task_id: 'bailian-task' } }),
          )
        })
        return
      }
      if (req.method === 'POST' && req.url === '/files') {
        fileUploadCount += 1
        const chunks: Buffer[] = []
        req.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
        req.on('end', () => {
          fileUploadBody = Buffer.concat(chunks).toString('utf8')
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(
            JSON.stringify({
              id: 'file-input',
              filename: 'frame.png',
              bytes: 5,
              created_at: 1,
              object: 'file',
              purpose: 'user_data',
            }),
          )
        })
        return
      }
      if (
        req.method === 'GET' &&
        (req.url === '/videos/request-1' || req.url === '/provider-b/videos/request-1')
      ) {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(
          JSON.stringify({
            status: 'done',
            video: { file_output: { file_id: 'file-video', public_url: `${baseUrl}/asset.mp4` } },
          }),
        )
        return
      }
      if (req.method === 'GET' && req.url === '/videos/sora-request') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ id: 'sora-request', status: 'completed' }))
        return
      }
      if (req.method === 'GET' && req.url === '/videos/sora-request/content') {
        res.writeHead(200, { 'content-type': 'video/mp4' })
        res.end(Buffer.from('sora-video'))
        return
      }
      if (req.method === 'GET' && req.url === '/operations/veo-task') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(
          JSON.stringify({
            done: true,
            response: {
              generateVideoResponse: {
                generatedSamples: [{ video: { uri: `${baseUrl}/asset.mp4` } }],
              },
            },
          }),
        )
        return
      }
      if (req.method === 'GET' && req.url === '/contents/generations/tasks/volc-task') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(
          JSON.stringify({ status: 'succeeded', content: { video_url: `${baseUrl}/asset.mp4` } }),
        )
        return
      }
      if (req.method === 'GET' && req.url === '/api/v1/tasks/bailian-task') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(
          JSON.stringify({
            request_id: 'poll-request',
            output: {
              task_id: 'bailian-task',
              task_status: 'SUCCEEDED',
              video_url: `${baseUrl}/asset.mp4`,
            },
          }),
        )
        return
      }
      if (req.method === 'GET' && req.url === '/files/file-input') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(
          JSON.stringify({
            id: 'file-input',
            object: 'file',
            status: 'active',
            purpose: 'user_data',
          }),
        )
        return
      }
      if (req.method === 'GET' && req.url === '/files/omni-file') {
        omniFilePollCount += 1
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ state: omniFilePollCount === 1 ? 'PROCESSING' : 'ACTIVE' }))
        return
      }
      if (req.method === 'GET' && req.url === '/files/omni-file:download?alt=media') {
        googleDownloadApiKey = String(req.headers['x-goog-api-key'] ?? '')
        res.writeHead(200, { 'content-type': 'video/mp4' })
        res.end(Buffer.from('omni-video'))
        return
      }
      if (req.method === 'GET' && req.url?.startsWith('/files?')) {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(
          JSON.stringify({
            object: 'list',
            data: [{ id: 'file-input', status: 'active' }],
            has_more: false,
          }),
        )
        return
      }
      if (req.method === 'DELETE' && req.url === '/files/file-input') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ id: 'file-input', object: 'file', deleted: true }))
        return
      }
      if (req.method === 'POST' && req.url === '/tts') {
        const chunks: Buffer[] = []
        req.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
        req.on('end', () => {
          postedBody = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
          res.writeHead(200, { 'content-type': 'audio/mpeg' })
          res.end(Buffer.from('audio'))
        })
        return
      }
      if (req.method === 'GET' && req.url === '/asset.png') {
        res.writeHead(200, { 'content-type': 'image/png' })
        res.end(Buffer.from(PNG_PIXEL, 'base64'))
        return
      }
      if (req.method === 'GET' && req.url === '/asset.mp4') {
        res.writeHead(200, { 'content-type': 'video/mp4' })
        res.end(Buffer.from('video'))
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

  it('loads oversized provider and manifest configuration from a runtime file', async () => {
    const manifest = {
      id: 'custom:large-image-model',
      providerKind: 'custom',
      modelId: 'large-image-model',
      displayName: 'Large Image Model',
      description: 'x'.repeat(40_000),
      domains: ['image'],
      capabilities: [
        {
          id: 'image.generate',
          label: '文生图',
          input: { required: ['prompt'] },
          output: { types: ['image'] },
          paramSchema: {},
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
    const configPath = path.join(tmpDir, 'runtime-config.json')
    writeFileSync(
      configPath,
      JSON.stringify({
        outputDir: tmpDir,
        providers: [
          {
            id: 'large-provider',
            name: 'Large Provider',
            apiKeyEnv: 'SPARK_MEDIA_API_KEY_0',
            provider: 'custom',
            model: 'large-image-model',
            mode: 'sync',
            baseUrl,
            mediaDefaults: {},
            manifests: [manifest],
          },
        ],
      }),
    )

    child = spawn(process.execPath, [path.resolve('src/tools/media-generation-mcp-server.mjs')], {
      cwd: path.resolve('..', 'agent-runtime'),
      env: {
        ...process.env,
        SPARK_MEDIA_API_KEY_0: 'sk-test',
        SPARK_MEDIA_CONFIG_FILE: configPath,
      },
    })

    const listed = await callMcp(child, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'list_models', arguments: {} },
    })

    expect(listed.error).toBeUndefined()
    expect(listed.result.structuredContent.models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          modelId: 'large-image-model',
          providerProfileId: 'large-provider',
        }),
      ]),
    )

    const generated = await callMcp(child, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'generate_image',
        arguments: { model: 'custom:large-image-model', prompt: 'large config test' },
      },
    })
    expect(generated.error).toBeUndefined()
    expect(postedHeaders.authorization).toBe('Bearer sk-test')
  })

  it('routes a platform alias through the adapter declared by its manifest', async () => {
    const manifest = {
      id: 'platform:spark-xai:test',
      providerKind: 'xai',
      modelId: 'spark-xai',
      adapterModelId: 'grok-imagine-image',
      displayName: 'Spark xAI Image',
      domains: ['image'],
      capabilities: [{
        id: 'image.generate',
        label: '文生图',
        input: { required: ['prompt'] },
        output: { types: ['image'] },
        paramSchema: {},
      }],
      invocation: {
        mode: 'sync',
        endpoint: '/images/generations',
        method: 'POST',
        contentType: 'json',
        requestTemplate: { model: '{{modelId}}', prompt: '{{prompt}}' },
        response: { kind: 'url', jsonPaths: ['data[].url'], download: true },
      },
      docs: { sourceUrls: [] },
    }
    const configPath = path.join(tmpDir, 'platform-runtime-config.json')
    writeFileSync(configPath, JSON.stringify({
      outputDir: tmpDir,
      providers: [{
        id: 'spark-platform-newapi',
        name: 'Spark Platform',
        apiKeyEnv: 'SPARK_MEDIA_API_KEY_0',
        provider: 'openai-compatible',
        adapterFromManifest: true,
        model: 'spark-xai',
        mode: 'sync',
        baseUrl,
        mediaDefaults: {},
        manifests: [manifest],
      }],
    }))

    child = spawn(process.execPath, [path.resolve('src/tools/media-generation-mcp-server.mjs')], {
      cwd: path.resolve('..', 'agent-runtime'),
      env: {
        ...process.env,
        SPARK_MEDIA_API_KEY_0: 'sk-platform',
        SPARK_MEDIA_CONFIG_FILE: configPath,
      },
    })
    const generated = await callMcp(child, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'generate_image',
        arguments: { model: 'spark-xai', prompt: 'platform adapter routing' },
      },
    })

    expect(generated.error).toBeUndefined()
    expect(postedPath).toBe('/images/generations')
    expect(postedHeaders.authorization).toBe('Bearer sk-platform')
    expect(postedBody).toMatchObject({
      model: 'spark-xai',
      prompt: 'platform adapter routing',
      storage_options: expect.any(Object),
    })
  })

  it('uses the provider interface timeout for synchronous manifest requests', async () => {
    imageResponseDelayMs = 50
    const manifest = {
      id: 'test:slow-image',
      providerKind: 'custom',
      modelId: 'slow-image',
      displayName: 'Slow Image',
      domains: ['image'],
      capabilities: [
        {
          id: 'image.generate',
          label: '文生图',
          input: { required: ['prompt'] },
          output: { types: ['image'], mimeTypes: ['image/png'] },
          paramSchema: {},
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
        SPARK_MEDIA_MODEL: 'slow-image',
        SPARK_MEDIA_BASE_URL: baseUrl,
        SPARK_MEDIA_OUTPUT_DIR: tmpDir,
        SPARK_MEDIA_DEFAULTS_JSON: JSON.stringify({ timeoutMs: 20 }),
        SPARK_MEDIA_MANIFESTS_JSON: JSON.stringify([manifest]),
      },
    })

    const response = await callMcp(child, {
      jsonrpc: '2.0',
      id: 99,
      method: 'tools/call',
      params: {
        name: 'generate_image',
        arguments: { model: 'test:slow-image', prompt: 'slow image' },
      },
    })

    expect(response.error?.message).toContain('timed out after 20ms')
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

  it('routes an explicitly selected model through its owning provider endpoint and credential', async () => {
    const buildManifest = (id: string, modelId: string) => ({
      id,
      providerKind: 'custom',
      modelId,
      displayName: 'Shared Image Model',
      domains: ['image'],
      capabilities: [
        {
          id: 'image.generate',
          label: '文生图',
          input: { required: ['prompt'] },
          output: { types: ['image'], mimeTypes: ['image/png'] },
          paramSchema: {},
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
    })
    const providerA = buildManifest('custom:model-a', 'model-a')
    const providerB = buildManifest('custom:model-b', 'model-b')
    const providerBVideo = {
      ...buildManifest('custom:video-model', 'video-model'),
      displayName: 'Provider B Video Model',
      domains: ['video'],
      capabilities: [
        {
          id: 'video.generate',
          label: '文生视频',
          input: { required: ['prompt'] },
          output: { types: ['video'], mimeTypes: ['video/mp4'] },
          paramSchema: {},
        },
      ],
      invocation: {
        mode: 'async_polling',
        endpoint: '/videos/generations',
        method: 'POST',
        contentType: 'json',
        requestTemplate: { model: '{{modelId}}', prompt: '{{prompt}}' },
        response: {
          kind: 'task_poll',
          taskIdPaths: ['request_id'],
          statusEndpoint: '/videos/{{taskId}}',
          resultPaths: ['video.file_output.public_url'],
        },
        polling: {
          intervalMs: 1,
          timeoutMs: 3000,
          statusMap: { done: 'succeeded', failed: 'failed' },
        },
      },
    }
    child = spawn(process.execPath, [path.resolve('src/tools/media-generation-mcp-server.mjs')], {
      cwd: path.resolve('..', 'agent-runtime'),
      env: {
        ...process.env,
        SPARK_MEDIA_OUTPUT_DIR: tmpDir,
        SPARK_MEDIA_PROVIDERS_JSON: JSON.stringify([
          {
            id: 'provider-a',
            name: 'Provider A',
            apiKey: 'key-a',
            provider: 'custom',
            model: 'model-a',
            mode: 'sync',
            baseUrl: `${baseUrl}/provider-a`,
            manifests: [providerA],
          },
          {
            id: 'provider-b',
            name: 'Provider B',
            apiKey: 'key-b',
            provider: 'custom',
            model: 'model-b',
            mode: 'sync',
            baseUrl: `${baseUrl}/provider-b`,
            manifests: [providerB, providerBVideo],
          },
        ]),
      },
    })

    const listed = await callMcp(child, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'list_models', arguments: { capability: 'image.generate' } },
    })
    expect(listed.error).toBeUndefined()
    expect(listed.result.structuredContent.models).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          modelId: 'model-a',
          providerProfileId: 'provider-a',
          selectionKey: 'provider-a/custom:model-a',
        }),
        expect.objectContaining({
          modelId: 'model-b',
          providerProfileId: 'provider-b',
          selectionKey: 'provider-b/custom:model-b',
        }),
      ]),
    )

    const generated = await callMcp(child, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'generate_image',
        arguments: {
          model: 'provider-b/custom:model-b',
          prompt: 'route me to provider b',
        },
      },
    })

    expect(generated.error).toBeUndefined()
    expect(postedPath).toBe('/provider-b/images')
    expect(postedHeaders.authorization).toBe('Bearer key-b')
    expect(postedBody).toMatchObject({ model: 'model-b', prompt: 'route me to provider b' })

    const ambiguous = await callMcp(child, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'generate_image',
        arguments: { model: 'Shared Image Model', prompt: 'do not guess the provider' },
      },
    })
    expect(ambiguous.error?.message).toContain('Ambiguous media model')
    expect(ambiguous.error?.message).toContain('provider-a/custom:model-a')
    expect(ambiguous.error?.message).toContain('provider-b/custom:model-b')

    const unsupported = await callMcp(child, {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'generate_video',
        arguments: { model: 'provider-b/custom:model-b', prompt: 'do not change models' },
      },
    })
    expect(unsupported.error?.message).toContain('does not support video.generate')

    const generatedVideo = await callMcp(child, {
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: {
        name: 'generate_video',
        arguments: { prompt: 'choose the capable model from provider b' },
      },
    })
    expect(generatedVideo.error).toBeUndefined()
    expect(postedBody).toMatchObject({
      model: 'video-model',
      prompt: 'choose the capable model from provider b',
    })
  })

  it('polls Google Omni URI files and downloads them with the owning credential', async () => {
    const manifest = BUILTIN_MEDIA_MODEL_MANIFESTS.find(
      (entry) => entry.id === 'google-generative-ai:gemini-omni-flash-preview',
    )
    expect(manifest).toBeDefined()
    child = spawn(process.execPath, [path.resolve('src/tools/media-generation-mcp-server.mjs')], {
      cwd: path.resolve('..', 'agent-runtime'),
      env: {
        ...process.env,
        SPARK_MEDIA_API_KEY: 'google-test-key',
        SPARK_MEDIA_PROVIDER: 'google-generative-ai',
        SPARK_MEDIA_MODEL: 'gemini-omni-flash-preview',
        SPARK_MEDIA_BASE_URL: baseUrl,
        SPARK_MEDIA_OUTPUT_DIR: tmpDir,
        SPARK_MEDIA_DEFAULTS_JSON: JSON.stringify({ polling: { intervalMs: 1, timeoutMs: 3000 } }),
        SPARK_MEDIA_MANIFESTS_JSON: JSON.stringify([manifest]),
      },
    })

    const response = await callMcp(child, {
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: {
        name: 'generate_video',
        arguments: {
          prompt: 'a copper robot walking through rain',
          delivery: 'uri',
        },
      },
    })

    expect(response.error).toBeUndefined()
    expect(omniFilePollCount).toBe(2)
    expect(googleDownloadApiKey).toBe('google-test-key')
    expect(existsSync(response.result.structuredContent.files[0])).toBe(true)
  })

  it('submits Sora image-to-video as multipart from the Skill path', async () => {
    const manifest = BUILTIN_MEDIA_MODEL_MANIFESTS.find(
      (entry) => entry.id === 'openai-images:sora-2',
    )
    expect(manifest).toBeDefined()
    child = spawn(process.execPath, [path.resolve('src/tools/media-generation-mcp-server.mjs')], {
      cwd: path.resolve('..', 'agent-runtime'),
      env: {
        ...process.env,
        SPARK_MEDIA_API_KEY: 'openai-test-key',
        SPARK_MEDIA_PROVIDER: 'openai-images',
        SPARK_MEDIA_MODEL: 'sora-2',
        SPARK_MEDIA_BASE_URL: baseUrl,
        SPARK_MEDIA_OUTPUT_DIR: tmpDir,
        SPARK_MEDIA_DEFAULTS_JSON: JSON.stringify({ polling: { intervalMs: 1, timeoutMs: 3000 } }),
        SPARK_MEDIA_MANIFESTS_JSON: JSON.stringify([manifest]),
      },
    })

    const response = await callMcp(child, {
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: {
        name: 'generate_video',
        arguments: {
          model: manifest?.id,
          capability: 'video.image_to_video',
          prompt: 'animate the reference image',
          firstFrame: `data:image/png;base64,${PNG_PIXEL}`,
        },
      },
    })

    expect(response.error).toBeUndefined()
    expect(String(postedHeaders['content-type'])).toContain('multipart/form-data; boundary=')
    expect(postedRawBody).toContain('name="input_reference"')
    expect(postedRawBody).not.toContain('data:image/png;base64')
    expect(existsSync(response.result.structuredContent.files[0])).toBe(true)
  })

  it('keeps Veo Skill reference images out of the first-frame field', async () => {
    const manifest = BUILTIN_MEDIA_MODEL_MANIFESTS.find(
      (entry) => entry.id === 'google-generative-ai:veo-3.1-generate-preview',
    )
    expect(manifest).toBeDefined()
    child = spawn(process.execPath, [path.resolve('src/tools/media-generation-mcp-server.mjs')], {
      cwd: path.resolve('..', 'agent-runtime'),
      env: {
        ...process.env,
        SPARK_MEDIA_API_KEY: 'google-test-key',
        SPARK_MEDIA_PROVIDER: 'google-generative-ai',
        SPARK_MEDIA_MODEL: 'veo-3.1-generate-preview',
        SPARK_MEDIA_BASE_URL: baseUrl,
        SPARK_MEDIA_OUTPUT_DIR: tmpDir,
        SPARK_MEDIA_DEFAULTS_JSON: JSON.stringify({ polling: { intervalMs: 1, timeoutMs: 3000 } }),
        SPARK_MEDIA_MANIFESTS_JSON: JSON.stringify([manifest]),
      },
    })

    const response = await callMcp(child, {
      jsonrpc: '2.0',
      id: 8,
      method: 'tools/call',
      params: {
        name: 'generate_video',
        arguments: {
          model: manifest?.id,
          capability: 'video.reference_to_video',
          prompt: 'keep the two references consistent',
          referenceImages: [
            `data:image/png;base64,${PNG_PIXEL}`,
            `data:image/png;base64,${PNG_PIXEL}`,
          ],
        },
      },
    })

    expect(response.error).toBeUndefined()
    const instance = (postedBody?.instances as Array<Record<string, unknown>>)[0]
    if (!instance) throw new Error('Expected a Veo request instance')
    expect(instance).not.toHaveProperty('image')
    expect(instance.referenceImages).toHaveLength(2)
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
    const issueCodes =
      structured.validationIssues?.map((issue: { code: string }) => issue.code) ?? []
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

  it('uses explicit rolePolicy and sends Volcengine Seedance nested multimodal content', async () => {
    const manifest = volcVideoManifest()
    child = spawn(process.execPath, [path.resolve('src/tools/media-generation-mcp-server.mjs')], {
      cwd: path.resolve('..', 'agent-runtime'),
      env: {
        ...process.env,
        SPARK_MEDIA_API_KEY: 'ark-test',
        SPARK_MEDIA_PROVIDER: 'volcengine-ark',
        SPARK_MEDIA_MODEL: manifest.modelId,
        SPARK_MEDIA_BASE_URL: baseUrl,
        SPARK_MEDIA_OUTPUT_DIR: tmpDir,
        SPARK_MEDIA_DEFAULTS_JSON: JSON.stringify({ polling: { intervalMs: 1, timeoutMs: 3000 } }),
        SPARK_MEDIA_MANIFESTS_JSON: JSON.stringify([manifest]),
      },
    })

    const described = await callMcp(child, {
      jsonrpc: '2.0',
      id: 50,
      method: 'tools/call',
      params: { name: 'describe_model', arguments: { model: manifest.id } },
    })
    const referenceCapability = described.result.structuredContent.model.capabilities.find(
      (capability: { id: string }) => capability.id === 'video.reference_to_video',
    )
    expect(referenceCapability.input).toMatchObject({ maxImages: 9, maxVideos: 3, maxAudios: 3 })
    expect(referenceCapability.rolePolicy).toEqual({
      imageRoles: ['reference_image'],
      videoRoles: ['reference_video'],
      audioRoles: ['reference_audio'],
      defaultRoleAssignment: 'all_reference',
    })

    const generated = await callMcp(child, {
      jsonrpc: '2.0',
      id: 51,
      method: 'tools/call',
      params: {
        name: 'generate_video',
        arguments: {
          model: manifest.id,
          capability: 'video.reference_to_video',
          prompt: '保持角色、动作和环境声音一致',
          referenceImages: ['https://cdn/ref.png'],
          referenceVideos: ['https://cdn/ref.mp4'],
          referenceAudios: ['https://cdn/ref.mp3'],
          aspectRatio: '智能比例',
          durationSeconds: -1,
        },
      },
    })

    expect(generated.error).toBeUndefined()
    expect(postedBody).toMatchObject({
      model: manifest.modelId,
      ratio: 'adaptive',
      duration: -1,
    })
    expect(postedBody?.content).toEqual([
      { type: 'text', text: '保持角色、动作和环境声音一致' },
      { type: 'image_url', image_url: { url: 'https://cdn/ref.png' }, role: 'reference_image' },
      { type: 'video_url', video_url: { url: 'https://cdn/ref.mp4' }, role: 'reference_video' },
      { type: 'audio_url', audio_url: { url: 'https://cdn/ref.mp3' }, role: 'reference_audio' },
    ])
    expect(generated.result.structuredContent.files[0]).toMatch(/\.mp4$/)
  })

  it('submits Bailian manifest video with async header, media roles, native params, and API-v1 polling', async () => {
    const manifest = BUILTIN_MEDIA_MODEL_MANIFESTS.find(
      (entry) => entry.id === 'bailian:wan2.7-i2v-2026-04-25',
    )!
    child = spawn(process.execPath, [path.resolve('src/tools/media-generation-mcp-server.mjs')], {
      cwd: path.resolve('..', 'agent-runtime'),
      env: {
        ...process.env,
        SPARK_MEDIA_API_KEY: 'bailian-test',
        SPARK_MEDIA_PROVIDER: 'bailian',
        SPARK_MEDIA_MODEL: manifest.modelId,
        SPARK_MEDIA_BASE_URL: `${baseUrl}/api/v1`,
        SPARK_MEDIA_OUTPUT_DIR: tmpDir,
        SPARK_MEDIA_DEFAULTS_JSON: JSON.stringify({ polling: { intervalMs: 1, timeoutMs: 3000 } }),
        SPARK_MEDIA_MANIFESTS_JSON: JSON.stringify([manifest]),
      },
    })

    const generated = await callMcp(child, {
      jsonrpc: '2.0',
      id: 52,
      method: 'tools/call',
      params: {
        name: 'generate_video',
        arguments: {
          model: manifest.id,
          capability: 'video.image_to_video',
          prompt: '从首帧平滑过渡到尾帧',
          firstFrame: 'https://cdn/first.png',
          lastFrame: 'https://cdn/last.png',
          referenceAudios: ['https://cdn/drive.mp3'],
          resolution: '720P',
          durationSeconds: 8,
        },
      },
    })

    expect(generated.error).toBeUndefined()
    expect(postedHeaders['x-dashscope-async']).toBe('enable')
    expect(postedBody).toMatchObject({
      model: manifest.modelId,
      input: {
        prompt: '从首帧平滑过渡到尾帧',
        media: [
          { type: 'first_frame', url: 'https://cdn/first.png' },
          { type: 'last_frame', url: 'https://cdn/last.png' },
          { type: 'driving_audio', url: 'https://cdn/drive.mp3' },
        ],
      },
      parameters: { resolution: '720P', duration: 8 },
    })
    expect(postedBody).not.toHaveProperty('durationSeconds')
    expect(generated.result.structuredContent.requestId).toBe('bailian-task')
    expect(generated.result.structuredContent.files[0]).toMatch(/\.mp4$/)
  })

  it('manages Volcengine Files upload/get/list/delete lifecycle', async () => {
    child = spawn(process.execPath, [path.resolve('src/tools/media-generation-mcp-server.mjs')], {
      cwd: path.resolve('..', 'agent-runtime'),
      env: {
        ...process.env,
        SPARK_MEDIA_API_KEY: 'ark-test',
        SPARK_MEDIA_PROVIDER: 'volcengine-ark',
        SPARK_MEDIA_MODEL: 'doubao-seed-1-8',
        SPARK_MEDIA_BASE_URL: baseUrl,
        SPARK_MEDIA_OUTPUT_DIR: tmpDir,
      },
    })

    const listedTools = await callMcp(child, {
      jsonrpc: '2.0',
      id: 59,
      method: 'tools/list',
      params: {},
    })
    expect(listedTools.result.tools.map((tool: { name: string }) => tool.name)).toEqual(
      expect.arrayContaining(['upload_file', 'get_file', 'list_files', 'delete_file']),
    )

    const uploaded = await callMcp(child, {
      jsonrpc: '2.0',
      id: 60,
      method: 'tools/call',
      params: {
        name: 'upload_file',
        arguments: {
          url: 'tos://source/input.mp4',
          tos: { bucket: 'target-bucket', prefix: 'arkfiles/' },
          waitUntilActive: true,
          preprocessVideo: { fps: 0.3, max_video_tokens: 81920 },
        },
      },
    })
    expect(uploaded.error).toBeUndefined()
    expect(uploaded.result.structuredContent.file).toMatchObject({
      id: 'file-input',
      status: 'active',
    })
    expect(fileUploadBody).toContain('name="purpose"')
    expect(fileUploadBody).toContain('user_data')
    expect(fileUploadBody).toContain('name="tos[bucket]"')
    expect(fileUploadBody).toContain('target-bucket')
    expect(fileUploadBody).toContain('name="tos[prefix]"')
    expect(fileUploadBody).toContain('arkfiles/')
    expect(fileUploadBody).toContain('name="preprocess_configs[video][fps]"')
    expect(fileUploadBody).toContain('0.3')
    expect(fileUploadBody).toContain('name="preprocess_configs[video][max_video_tokens]"')
    expect(fileUploadBody).toContain('81920')

    const got = await callMcp(child, {
      jsonrpc: '2.0',
      id: 61,
      method: 'tools/call',
      params: { name: 'get_file', arguments: { fileId: 'file-input' } },
    })
    expect(got.result.structuredContent.file.status).toBe('active')

    const listed = await callMcp(child, {
      jsonrpc: '2.0',
      id: 62,
      method: 'tools/call',
      params: { name: 'list_files', arguments: { limit: 20, order: 'desc' } },
    })
    expect(listed.result.structuredContent.data).toEqual([{ id: 'file-input', status: 'active' }])

    const deleted = await callMcp(child, {
      jsonrpc: '2.0',
      id: 63,
      method: 'tools/call',
      params: { name: 'delete_file', arguments: { fileId: 'file-input' } },
    })
    expect(deleted.result.structuredContent.deleted).toMatchObject({
      id: 'file-input',
      deleted: true,
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
        SPARK_MEDIA_DEFAULTS_JSON: JSON.stringify({ polling: { intervalMs: 1, timeoutMs: 3000 } }),
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
    expect(tools.find((tool) => tool.name === 'upload_file')).toBeUndefined()
    const imageProps = image!.inputSchema.properties
    const videoProps = video!.inputSchema.properties
    expect(imageProps.resolution).toBeDefined()
    expect(imageProps.aspectRatio).toBeDefined()
    expect(imageProps.output_format).toBeDefined()
    expect(videoProps.resolution).toBeDefined()
    expect(videoProps.aspectRatio).toBeDefined()
    expect(videoProps.mode).toBeDefined()
    expect(videoProps.capability).toBeDefined()
    expect(videoProps.referenceVideos).toBeDefined()
    expect(videoProps.referenceAudios).toBeDefined()
    expect(imageProps.resolution!.enum).toBeUndefined()
    expect(imageProps.aspectRatio!.enum).toBeUndefined()
    expect(imageProps.output_format!.enum).toBeUndefined()
    expect(videoProps.resolution!.enum).toBeUndefined()
    expect(videoProps.aspectRatio!.enum).toBeUndefined()
    expect(videoProps.mode!.enum).toBeUndefined()
    expect(videoProps.capability!.enum).toBeUndefined()
    expect(videoProps.resolution!.description).toContain('describe_model')
  })

  it('uses the same official xAI video and TTS contracts as the desktop adapter', async () => {
    child = spawn(process.execPath, [path.resolve('src/tools/media-generation-mcp-server.mjs')], {
      cwd: path.resolve('..', 'agent-runtime'),
      env: {
        ...process.env,
        SPARK_MEDIA_API_KEY: 'sk-test',
        SPARK_MEDIA_PROVIDER: 'xai',
        SPARK_MEDIA_MODEL: 'grok-imagine-video',
        SPARK_MEDIA_BASE_URL: baseUrl,
        SPARK_MEDIA_OUTPUT_DIR: tmpDir,
        SPARK_MEDIA_DEFAULTS_JSON: JSON.stringify({
          video: { durationSeconds: 8 },
          polling: { intervalMs: 1, timeoutMs: 1000 },
        }),
      },
    })

    const references = Array.from(
      { length: 7 },
      (_, index) => `${baseUrl}/reference-${index + 1}.png`,
    )
    const videoResponse = await callMcp(child, {
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: {
        name: 'generate_video',
        arguments: {
          prompt: 'Use all references',
          capability: 'video.reference_to_video',
          referenceImages: references,
          durationSeconds: 10,
          aspectRatio: '16:9',
          resolution: '720p',
          seed: 42,
          extraJson: { mode: 'reference-to-video', quality: 'hd' },
          filename: 'skill-video.mp4',
        },
      },
    })

    expect(videoResponse.error).toBeUndefined()
    expect(postedBody).toEqual({
      model: 'grok-imagine-video',
      prompt: 'Use all references',
      reference_images: references.map((url) => ({ url })),
      duration: 10,
      aspect_ratio: '16:9',
      resolution: '720p',
      storage_options: { filename: 'skill-video.mp4', public_url: true },
    })

    const framePath = path.join(tmpDir, 'frame.png')
    writeFileSync(framePath, Buffer.from('frame'))
    const inputResponse = await callMcp(child, {
      jsonrpc: '2.0',
      id: 9,
      method: 'tools/call',
      params: {
        name: 'generate_video',
        arguments: {
          prompt: 'Animate local frame',
          capability: 'video.image_to_video',
          firstFrame: framePath,
          filename: 'local-frame.mp4',
        },
      },
    })
    expect(inputResponse.error).toBeUndefined()
    expect(fileUploadCount).toBe(1)
    expect(postedBody).toMatchObject({ image: { file_id: 'file-input' } })

    const extensionResponse = await callMcp(child, {
      jsonrpc: '2.0',
      id: 11,
      method: 'tools/call',
      params: {
        name: 'generate_video',
        arguments: {
          prompt: 'Continue the video',
          capability: 'video.extend',
          videoUrl: `${baseUrl}/asset.mp4`,
          filename: 'extended.mp4',
        },
      },
    })
    expect(extensionResponse.error).toBeUndefined()
    expect(postedBody).toMatchObject({
      video: { url: `${baseUrl}/asset.mp4` },
      duration: 6,
    })

    const audioResponse = await callMcp(child, {
      jsonrpc: '2.0',
      id: 10,
      method: 'tools/call',
      params: {
        name: 'generate_audio',
        arguments: {
          text: '你好',
          voice: 'eve',
          language: 'zh-CN',
          format: 'mp3',
          speed: 1.1,
        },
      },
    })
    expect(audioResponse.error).toBeUndefined()
    expect(postedBody).toEqual({
      text: '你好',
      voice_id: 'eve',
      language: 'zh-CN',
      output_format: { codec: 'mp3' },
      speed: 1.1,
    })
  })
})

function callMcp(
  child: ChildProcessWithoutNullStreams,
  request: Record<string, unknown>,
): Promise<any> {
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
