import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'

describe('spark_image MCP server', () => {
  let tmpDir: string
  let server: Server
  let baseUrl = ''
  let postedBody: Record<string, unknown> | null = null
  let child: ChildProcessWithoutNullStreams | null = null

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `spark-image-mcp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
    server = createServer((req, res) => {
      if (req.method === 'POST' && req.url === '/images/generations') {
        const chunks: Buffer[] = []
        req.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
        req.on('end', () => {
          postedBody = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ data: [{ url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' }] }))
        })
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
  })

  it('xAI never sends size; ratio-type size maps to aspect_ratio', async () => {
    child = spawn(process.execPath, [path.resolve('src/tools/image-generation-mcp-server.mjs')], {
      cwd: path.resolve('..', 'agent-runtime'),
      env: {
        ...process.env,
        SPARK_IMAGE_PROVIDER: 'xai',
        SPARK_IMAGE_API_KEY: 'sk-test',
        SPARK_IMAGE_MODEL: 'grok-imagine-image',
        SPARK_IMAGE_BASE_URL: baseUrl,
        SPARK_IMAGE_OUTPUT_DIR: tmpDir,
      },
    })

    const response = await callMcp(child, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'generate_image', arguments: { prompt: 'a cat avatar', size: '1:1' } },
    })

    expect(response.error).toBeUndefined()
    expect(postedBody).not.toBeNull()
    expect(postedBody).not.toHaveProperty('size')
    expect(postedBody).toMatchObject({ model: 'grok-imagine-image', prompt: 'a cat avatar', aspect_ratio: '1:1', n: 1 })
  })

  it('xAI with no size still omits size and aspect_ratio', async () => {
    child = spawn(process.execPath, [path.resolve('src/tools/image-generation-mcp-server.mjs')], {
      cwd: path.resolve('..', 'agent-runtime'),
      env: {
        ...process.env,
        SPARK_IMAGE_PROVIDER: 'xai',
        SPARK_IMAGE_API_KEY: 'sk-test',
        SPARK_IMAGE_MODEL: 'grok-imagine-image',
        SPARK_IMAGE_BASE_URL: baseUrl,
        SPARK_IMAGE_OUTPUT_DIR: tmpDir,
      },
    })

    const response = await callMcp(child, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'generate_image', arguments: { prompt: 'a cat avatar' } },
    })

    expect(response.error).toBeUndefined()
    expect(postedBody).not.toBeNull()
    expect(postedBody).not.toHaveProperty('size')
    expect(postedBody).not.toHaveProperty('aspect_ratio')
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
