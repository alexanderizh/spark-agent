import type { SessionAttachment } from '@spark/protocol'
import {
  persistRemoteImage,
  readOutboundImage,
  readRemoteImageResponse,
} from './remoteImageMedia.js'

export type FeishuInboundImage = {
  messageId: string
  fileKey: string
  resourceType: 'image' | 'file'
}

export function extractFeishuInboundImage(message: {
  message_id?: string | undefined
  message_type?: string | undefined
  content?: string | undefined
}): FeishuInboundImage | null {
  if (message.message_type !== 'image' && message.message_type !== 'file') return null
  if (!message.message_id || !message.content) return null
  try {
    const content = JSON.parse(message.content) as Record<string, unknown>
    const key = message.message_type === 'image' ? content.image_key : content.file_key
    if (typeof key !== 'string' || key.length === 0) return null
    if (
      message.message_type === 'file' &&
      !(typeof content.file_name === 'string' && /\.(?:png|jpe?g|webp)$/iu.test(content.file_name))
    )
      return null
    return { messageId: message.message_id, fileKey: key, resourceType: message.message_type }
  } catch {
    return null
  }
}

export async function downloadFeishuImage(
  input: { token: string; image: FeishuInboundImage; attachmentRoot: string },
  fetchImpl: typeof fetch = fetch,
): Promise<SessionAttachment> {
  const { messageId, fileKey, resourceType } = input.image
  const response = await fetchImpl(
    `https://open.feishu.cn/open-apis/im/v1/messages/${encodeURIComponent(messageId)}/resources/${encodeURIComponent(fileKey)}?type=${resourceType}`,
    { headers: { Authorization: `Bearer ${input.token}` }, signal: AbortSignal.timeout(30_000) },
  )
  return persistRemoteImage(await readRemoteImageResponse(response), input.attachmentRoot)
}

export async function uploadFeishuImage(
  input: { token: string; source: string },
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const { bytes, fileName, mimeType } = await readOutboundImage(input.source)
  const form = new FormData()
  form.append('image_type', 'message')
  form.append('image', new Blob([bytes], { type: mimeType }), fileName)
  const response = await fetchImpl('https://open.feishu.cn/open-apis/im/v1/images', {
    method: 'POST',
    headers: { Authorization: `Bearer ${input.token}` },
    body: form,
    signal: AbortSignal.timeout(30_000),
  })
  const payload = (await response.json()) as {
    code?: number
    msg?: string
    data?: { image_key?: string }
  }
  if (!response.ok || payload.code !== 0 || !payload.data?.image_key) {
    throw new Error(`飞书图片上传失败：${payload.msg ?? response.status}`)
  }
  return payload.data.image_key
}
