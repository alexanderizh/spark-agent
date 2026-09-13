import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  downloadFeishuImage,
  extractFeishuInboundImage,
  uploadFeishuImage,
} from './feishuImageMedia.js'
import { downloadQqImage, extractQqInboundImages, uploadQqImage } from './qqImageMedia.js'
import { detectRemoteImage, readRemoteImageResponse } from './remoteImageMedia.js'
import { parseQqDispatchEvent } from './qqProtocol.js'

const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0])
const roots: string[] = []
async function tempRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'spark-remote-image-test-'))
  roots.push(root)
  return root
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

describe('remote image media', () => {
  it('accepts image signatures and rejects oversized downloads', async () => {
    expect(detectRemoteImage(png)?.mimeType).toBe('image/png')
    expect(detectRemoteImage(Buffer.from('not image'))).toBeNull()
    await expect(
      readRemoteImageResponse(
        new Response('x', {
          headers: { 'content-length': String(21 * 1024 * 1024) },
        }),
      ),
    ).rejects.toThrow('20 MB')
  })

  it('extracts and downloads a Feishu image via the message resource endpoint', async () => {
    const image = extractFeishuInboundImage({
      message_id: 'om_1',
      message_type: 'image',
      content: '{"image_key":"img_1"}',
    })
    expect(image).toEqual({ messageId: 'om_1', fileKey: 'img_1', resourceType: 'image' })
    if (image == null) throw new Error('Feishu image was not extracted')
    expect(
      extractFeishuInboundImage({
        message_id: 'om_1',
        message_type: 'file',
        content: '{"file_key":"f","file_name":"notes.txt"}',
      }),
    ).toBeNull()
    const fetchImpl = vi.fn(async () => new Response(png)) as unknown as typeof fetch
    const attachment = await downloadFeishuImage(
      { token: 'token', image, attachmentRoot: await tempRoot() },
      fetchImpl,
    )
    expect(attachment.type).toBe('image')
    expect(await fs.readFile(attachment.path)).toEqual(png)
    expect(vi.mocked(fetchImpl).mock.calls[0]?.[0]).toBe(
      'https://open.feishu.cn/open-apis/im/v1/messages/om_1/resources/img_1?type=image',
    )
  })

  it('uploads a Feishu image as multipart and returns image_key', async () => {
    const root = await tempRoot()
    const file = path.join(root, 'photo.png')
    await fs.writeFile(file, png)
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ code: 0, data: { image_key: 'img_out' } })),
    ) as unknown as typeof fetch
    expect(await uploadFeishuImage({ token: 'token', source: file }, fetchImpl)).toBe('img_out')
    const [, init] = vi.mocked(fetchImpl).mock.calls[0] ?? []
    expect(init?.body).toBeInstanceOf(FormData)
    expect((init?.body as FormData).get('image_type')).toBe('message')
  })

  it('accepts image-only QQ events and downloads only Tencent CDN images', async () => {
    const event = parseQqDispatchEvent('C2C_MESSAGE_CREATE', {
      id: 'm1',
      user_openid: 'u1',
      content: '',
      attachments: [
        { url: 'https://gchat.qpic.cn/test.jpg', filename: 'test.jpg', content_type: 'image/jpeg' },
      ],
    })
    expect(event?.images).toHaveLength(1)
    expect(event?.text).toContain('图片')
    const image = event?.images?.[0]
    if (image == null) throw new Error('QQ image was not extracted')
    expect(
      extractQqInboundImages({
        attachments: [{ url: 'https://evil.test/x.png', filename: 'x.png' }],
      }),
    ).toHaveLength(1)
    const fetchImage = vi.fn(
      async () => new Response(png),
    ) as unknown as typeof import('./remoteImageMedia.js').fetchPublicImage
    const attachment = await downloadQqImage(
      { image, attachmentRoot: await tempRoot() },
      fetchImage,
    )
    expect(await fs.readFile(attachment.path)).toEqual(png)
    await expect(
      downloadQqImage(
        { image: { url: 'https://evil.test/x.png' }, attachmentRoot: await tempRoot() },
        fetchImage,
      ),
    ).rejects.toThrow('腾讯')
  })

  it('uploads QQ image data without auto-sending and returns file_info', async () => {
    const root = await tempRoot()
    const file = path.join(root, 'photo.png')
    await fs.writeFile(file, png)
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ file_info: 'qq_file_info' })),
    ) as unknown as typeof fetch
    expect(
      await uploadQqImage(
        { token: 'token', endpointBase: 'https://api.sgroup.qq.com/v2/users/u1', source: file },
        fetchImpl,
      ),
    ).toBe('qq_file_info')
    const [url, init] = vi.mocked(fetchImpl).mock.calls[0] ?? []
    expect(url).toBe('https://api.sgroup.qq.com/v2/users/u1/files')
    expect(JSON.parse(init?.body as string)).toEqual({
      file_type: 1,
      file_data: png.toString('base64'),
      srv_send_msg: false,
    })
  })

  it('falls back to a temporary URL when QQ rejects base64 upload', async () => {
    const root = await tempRoot()
    const file = path.join(root, 'photo.png')
    await fs.writeFile(file, png)
    const fetchImpl = vi.fn(async (_url: unknown, init?: RequestInit) =>
      'file_data' in JSON.parse(String(init?.body))
        ? new Response('{"message":"too large"}', { status: 413 })
        : new Response('{"file_info":"url_info"}'),
    ) as unknown as typeof fetch
    const uploadTemporaryFile = vi.fn(async () => 'https://public.example/photo.png')
    expect(
      await uploadQqImage(
        {
          token: 'token',
          endpointBase: 'https://api.sgroup.qq.com/v2/users/u1',
          source: file,
          uploadTemporaryFile,
        },
        fetchImpl,
      ),
    ).toBe('url_info')
    expect(uploadTemporaryFile).toHaveBeenCalledOnce()
    expect(JSON.parse(String(vi.mocked(fetchImpl).mock.calls[1]?.[1]?.body)).url).toBe(
      'https://public.example/photo.png',
    )
  })
})
