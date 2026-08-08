import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { compileInvocationRequest, executeMediaUploads } from '../../../services/media/media-invocation-compiler.js'

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('media invocation compiler', () => {
  it('preserves whole-field number, boolean and array values in JSON bodies', async () => {
    const result = await compileInvocationRequest(
      {
        method: 'POST',
        endpoint: '/v1/images/generations',
        auth: { kind: 'bearer' },
        body: {
          kind: 'json',
          template: {
            prompt: '{{prompt}}',
            n: '{{params.n}}',
            enabled: '{{params.enabled}}',
            image_urls: '{{imageUrls}}',
          },
        },
      },
      {
        apiEndpoint: 'https://provider.example',
        apiKey: 'secret-token',
        variables: {
          prompt: 'castle',
          imageUrls: ['https://cdn.example/a.png'],
          params: { n: 2, enabled: true },
        },
      },
    )
    expect(result.method).toBe('POST')
    expect(result.url).toBe('https://provider.example/v1/images/generations')
    expect(result.headers.authorization).toBe('Bearer secret-token')
    expect(JSON.parse(String(result.body))).toEqual({
      prompt: 'castle',
      n: 2,
      enabled: true,
      image_urls: ['https://cdn.example/a.png'],
    })
  })

  it('encodes query auth and never emits the API key as a custom header', async () => {
    const result = await compileInvocationRequest(
      {
        method: 'GET',
        endpoint: '/tasks/{taskId}',
        query: { verbose: '{{params.verbose}}' },
        auth: { kind: 'api_key_query', name: 'token' },
        body: { kind: 'none' },
      },
      {
        apiEndpoint: 'https://provider.example',
        apiKey: 'secret-token',
        variables: { params: { verbose: true } },
      },
    )
    expect(result.url).toBe('https://provider.example/tasks/%7BtaskId%7D?verbose=true&token=secret-token')
    expect(result.headers.authorization).toBeUndefined()
    expect(result.headers['x-api-key']).toBeUndefined()
    expect(result.body).toBeUndefined()
  })

  it('rejects a GET request with a body before network execution', async () => {
    await expect(
      compileInvocationRequest(
        {
          method: 'GET',
          endpoint: '/tasks',
          body: { kind: 'json', template: { id: '{{taskId}}' } },
        },
        { apiEndpoint: 'https://provider.example', apiKey: 'x', variables: { taskId: '1' } },
      ),
    ).rejects.toThrow('GET invocation cannot contain a request body')
  })

  it('runs the declared upload stage and exposes extracted URLs', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'spark-media-compiler-'))
    tempDirs.push(directory)
    const filePath = path.join(directory, 'reference.png')
    await writeFile(filePath, Buffer.from('png-bytes'))
    const calls: Array<{ url: string; body: unknown }> = []
    const fetchImpl: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), body: init?.body })
      return new Response(JSON.stringify({ data: { url: 'https://files.example/reference.png' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    const result = await executeMediaUploads(
      [
        {
          name: 'referenceImages',
          input: { variable: 'referenceImages', mode: 'each' },
          constraints: { maxCount: 2, maxBytes: 100, allowedMimeTypes: ['image/png'] },
          request: {
            method: 'POST',
            endpoint: '/v1/uploads/images',
            body: {
              kind: 'multipart',
              parts: [{ name: 'file', kind: 'file', value: '{{upload.item}}' }],
            },
          },
          result: { urlPaths: ['data.url'], multiple: true },
        },
      ],
      [{ type: 'image', role: 'reference', path: filePath, mimeType: 'image/png' }],
      {
        apiEndpoint: 'https://provider.example',
        apiKey: 'secret-token',
        variables: { referenceImages: [] },
        fetchImpl,
      },
    )
    expect(result.referenceImages?.urls).toEqual(['https://files.example/reference.png'])
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('https://provider.example/v1/uploads/images')
    expect(calls[0]?.body).toBeInstanceOf(Uint8Array)
  })

  it('supports batch multipart uploads and best-effort cleanup', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'spark-media-compiler-batch-'))
    tempDirs.push(directory)
    const firstPath = path.join(directory, 'first.png')
    const secondPath = path.join(directory, 'second.png')
    await writeFile(firstPath, Buffer.from('first'))
    await writeFile(secondPath, Buffer.from('second'))
    const calls: Array<{ url: string; method: string; body: string }> = []
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input)
      const body = init?.body instanceof Uint8Array
        ? Buffer.from(init.body).toString('utf8')
        : String(init?.body ?? '')
      calls.push({ url, method: init?.method ?? 'GET', body })
      if (url.endsWith('/uploads/images')) {
        return new Response(JSON.stringify({ data: [{ url: 'https://files.example/1.png' }, { url: 'https://files.example/2.png' }] }), { status: 200 })
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }

    const result = await executeMediaUploads(
      [
        {
          name: 'images',
          input: { variable: 'images', mode: 'batch' },
          request: {
            method: 'POST',
            endpoint: '/uploads/images',
            body: {
              kind: 'multipart',
              parts: [{ name: 'file', kind: 'file', value: '{{upload.items}}' }],
            },
          },
          result: { urlPaths: ['data[].url'], multiple: true },
          cleanup: {
            enabled: true,
            request: {
              method: 'DELETE',
              endpoint: '/uploads/cleanup',
              body: { kind: 'json', template: { urls: '{{upload.urls}}' } },
            },
          },
        },
      ],
      [
        { type: 'image', path: firstPath, mimeType: 'image/png' },
        { type: 'image', path: secondPath, mimeType: 'image/png' },
      ],
      {
        apiEndpoint: 'https://provider.example',
        apiKey: 'secret-token',
        variables: {},
        fetchImpl,
      },
    )

    expect(result.images?.urls).toEqual(['https://files.example/1.png', 'https://files.example/2.png'])
    expect(calls).toHaveLength(2)
    expect(calls[0]?.method).toBe('POST')
    expect(calls[0]?.body).toContain('first')
    expect(calls[0]?.body).toContain('second')
    expect(calls[1]).toMatchObject({ url: 'https://provider.example/uploads/cleanup', method: 'DELETE' })
  })
})
