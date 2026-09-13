import type { SessionAttachment } from '@spark/protocol'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import {
  fetchPublicImage,
  persistRemoteImage,
  readOutboundImage,
  readRemoteImageResponse,
  REMOTE_IMAGE_LIMIT_BYTES,
} from './remoteImageMedia.js'

export type QqInboundImage = { url: string; filename?: string; contentType?: string; size?: number }

export function extractQqInboundImages(message: Record<string, unknown>): QqInboundImage[] {
  if (!Array.isArray(message.attachments)) return []
  return message.attachments.slice(0, 10).flatMap((raw): QqInboundImage[] => {
    if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return []
    const item = raw as Record<string, unknown>
    const url = typeof item.url === 'string' ? item.url : ''
    const filename = typeof item.filename === 'string' ? item.filename : undefined
    const contentType = typeof item.content_type === 'string' ? item.content_type : undefined
    const size = typeof item.size === 'number' ? item.size : undefined
    if (
      !url ||
      !(contentType?.startsWith('image/') || /\.(png|jpe?g|webp)$/iu.test(filename ?? ''))
    )
      return []
    return [
      {
        url,
        ...(filename ? { filename } : {}),
        ...(contentType ? { contentType } : {}),
        ...(size ? { size } : {}),
      },
    ]
  })
}

export async function downloadQqImage(
  input: { image: QqInboundImage; attachmentRoot: string },
  fetchImage: typeof fetchPublicImage = fetchPublicImage,
): Promise<SessionAttachment> {
  const url = new URL(input.image.url)
  // QQ 事件中的附件 URL 属于外部输入，只接受腾讯图片 CDN。
  if (
    url.protocol !== 'https:' ||
    !/(?:^|\.)(?:qpic\.cn|qq\.com|qq\.com\.cn)$/iu.test(url.hostname)
  ) {
    throw new Error('QQ 图片地址不是可信的腾讯图片域名')
  }
  if (input.image.size != null && input.image.size > REMOTE_IMAGE_LIMIT_BYTES)
    throw new Error('图片超过 20 MB 限制')
  const response = await fetchImage(url.toString())
  return persistRemoteImage(await readRemoteImageResponse(response), input.attachmentRoot)
}

export async function uploadQqImage(
  input: {
    token: string
    endpointBase: string
    source: string
    uploadTemporaryFile?: (input: {
      filePath: string
      fileName: string
      mimeType: string
    }) => Promise<string>
  },
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const outbound = await readOutboundImage(input.source)
  const bytes =
    outbound.mimeType === 'image/webp'
      ? await sharp(outbound.bytes).jpeg().toBuffer()
      : outbound.bytes
  const upload = async (data: { file_data?: string; url?: string }): Promise<string> => {
    const response = await fetchImpl(`${input.endpointBase}/files`, {
      method: 'POST',
      headers: { Authorization: `QQBot ${input.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_type: 1, ...data, srv_send_msg: false }),
      signal: AbortSignal.timeout(30_000),
    })
    const payload = (await response.json()) as { file_info?: string; message?: string }
    if (!response.ok || !payload.file_info)
      throw new Error(`QQ 图片上传失败：${payload.message ?? response.status}`)
    return payload.file_info
  }
  try {
    if (
      bytes.length > 5 * 1024 * 1024 &&
      input.uploadTemporaryFile != null &&
      outbound.mimeType !== 'image/webp'
    )
      throw new Error('使用临时文件 URL 上传大图')
    return await upload({ file_data: bytes.toString('base64') })
  } catch (primaryError) {
    const localPath = input.source.startsWith('file://')
      ? fileURLToPath(input.source)
      : input.source
    const url =
      outbound.mimeType !== 'image/webp' &&
      path.isAbsolute(localPath) &&
      input.uploadTemporaryFile != null
        ? await input.uploadTemporaryFile({
            filePath: localPath,
            fileName: outbound.fileName,
            mimeType: outbound.mimeType,
          })
        : /^https:\/\//iu.test(input.source)
          ? input.source
          : null
    if (url == null) throw primaryError
    return upload({ url })
  }
}
