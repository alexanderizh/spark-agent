import { describe, expect, it } from 'vitest'
import {
  buildMcpMultipart,
  googleMcpVeoImage,
  openAiMcpUpload,
} from '../../tools/official-media-mcp-helpers.mjs'

const PNG_PIXEL =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

describe('official media MCP helpers', () => {
  it('builds an OpenAI multipart upload without embedding the data URL', async () => {
    const upload = await openAiMcpUpload(`data:image/png;base64,${PNG_PIXEL}`, 'reference')
    const form = buildMcpMultipart(
      { model: 'sora-2', prompt: 'animate this image' },
      [{ field: 'input_reference', ...upload }],
    )
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
})
