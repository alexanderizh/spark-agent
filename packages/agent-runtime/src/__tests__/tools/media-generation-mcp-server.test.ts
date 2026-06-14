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
