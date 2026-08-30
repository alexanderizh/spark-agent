import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  buildMcpMultipart,
  googleMcpVeoImage,
  openAiMcpUpload,
  resolveMcpInputBuffer,
} from '../../tools/official-media-mcp-helpers.mjs'

const PNG_PIXEL =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

describe('official media MCP helpers', () => {
  it('builds an OpenAI multipart upload without embedding the data URL', async () => {
    const upload = await openAiMcpUpload(`data:image/png;base64,${PNG_PIXEL}`, 'reference')
    const form = buildMcpMultipart({ model: 'sora-2', prompt: 'animate this image' }, [
      { field: 'input_reference', ...upload },
    ])
    const body = form.body.toString('latin1')

    expect(form.contentType).toContain('multipart/form-data; boundary=')
    expect(body).toContain('name="input_reference"')
    expect(body).toContain('filename="reference.png"')
    expect(body).not.toContain('data:image/png;base64')
  })

  it('keeps Veo inline images in the documented inlineData envelope', () => {
    expect(googleMcpVeoImage(`data:image/png;base64,${PNG_PIXEL}`)).toEqual({
      inlineData: { mimeType: 'image/png', data: PNG_PIXEL },
    })
  })

  describe('resolveMcpInputBuffer', () => {
    it('decodes data URLs with a mime-derived filename', async () => {
      const upload = await resolveMcpInputBuffer(`data:image/png;base64,${PNG_PIXEL}`, 'image-1')
      expect(upload.filename).toBe('image-1.png')
      expect(upload.contentType).toBe('image/png')
      expect(upload.content.length).toBeGreaterThan(0)
    })

    it('downloads remote inputs and keeps the URL basename when it has an extension', async () => {
      const originalFetch = globalThis.fetch
      globalThis.fetch = async () =>
        new globalThis.Response(globalThis.Buffer.from('remote-bytes'), {
          status: 200,
          headers: { 'content-type': 'image/jpeg' },
        })
      try {
        const upload = await resolveMcpInputBuffer('https://cdn.example/ref-a.jpg', 'image-1')
        expect(upload.filename).toBe('ref-a.jpg')
        expect(upload.contentType).toBe('image/jpeg')
        expect(upload.content.toString()).toBe('remote-bytes')
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    it('reports download failures with the HTTP status', async () => {
      const originalFetch = globalThis.fetch
      globalThis.fetch = async () => new globalThis.Response('missing', { status: 404 })
      try {
        await expect(
          resolveMcpInputBuffer('https://cdn.example/gone.png', 'image-1'),
        ).rejects.toThrow(/Failed to download input file .*HTTP 404/)
      } finally {
        globalThis.fetch = originalFetch
      }
    })

    it('reads local paths and infers mime from the extension', async () => {
      const dir = mkdtempSync(path.join(os.tmpdir(), 'spark-mcp-input-'))
      try {
        const file = path.join(dir, 'local-ref.png')
        writeFileSync(file, globalThis.Buffer.from('local-bytes'))
        const upload = await resolveMcpInputBuffer(file, 'image-1')
        expect(upload.filename).toBe('local-ref.png')
        expect(upload.contentType).toBe('image/png')
        expect(upload.content.toString()).toBe('local-bytes')
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })

    it('rejects non-string and empty inputs with a clear error', async () => {
      await expect(resolveMcpInputBuffer(123, 'image-1')).rejects.toThrow(
        /data URL, HTTP\(S\) URL, or local file path/,
      )
    })
  })
})
