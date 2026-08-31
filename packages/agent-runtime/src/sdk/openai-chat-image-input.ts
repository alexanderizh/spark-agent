import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import type OpenAI from 'openai'
import type { SDKTurnAttachment } from './types.js'

type ChatContentPart = OpenAI.Chat.Completions.ChatCompletionContentPart
type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam
type ChatUserContent = OpenAI.Chat.Completions.ChatCompletionUserMessageParam['content']

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
}
const MAX_IMAGE_BYTES = 20 * 1024 * 1024
const MAX_TOTAL_IMAGE_BYTES = 50 * 1024 * 1024

interface PreparedImageAttachment {
  attachment: SDKTurnAttachment
  mime: string
}

export async function buildOpenAIChatUserContent(
  prompt: string,
  attachments: SDKTurnAttachment[] | undefined,
): Promise<ChatUserContent> {
  const imageAttachments = (attachments ?? []).filter((attachment) => attachment.type === 'image')
  if (imageAttachments.length === 0) return prompt

  const prepared = await preflightImageAttachments(imageAttachments)
  const imageParts: ChatContentPart[] = []
  let totalBytes = 0

  for (const item of prepared) {
    let data: Buffer
    try {
      data = await readFile(item.attachment.path)
    } catch {
      throw imageInputError(item.attachment, 'could not be read')
    }
    validateImageSize(item.attachment, data.byteLength)
    totalBytes += data.byteLength
    if (totalBytes > MAX_TOTAL_IMAGE_BYTES) {
      throw new Error('Image attachments exceed the 50MB combined size limit')
    }
    if (!matchesImageSignature(data, item.mime)) {
      throw imageInputError(item.attachment, 'does not match its supported image format')
    }
    imageParts.push({
      type: 'image_url',
      image_url: { url: `data:${item.mime};base64,${data.toString('base64')}` },
    })
  }

  return [{ type: 'text', text: prompt }, ...imageParts]
}

export function redactOpenAIChatImages(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((message): ChatMessage => {
    if (message.role !== 'user' || !Array.isArray(message.content)) return message
    const content: ChatContentPart[] = message.content.map((part) => {
      if (part.type !== 'image_url') return part
      const mime = /^data:([^;,]+);base64,/i.exec(part.image_url.url)?.[1]
      return {
        ...part,
        image_url: {
          ...part.image_url,
          url: mime != null ? `data:${mime};base64,[redacted]` : '[redacted image URL]',
        },
      }
    })
    return { ...message, content }
  })
}

async function preflightImageAttachments(
  attachments: SDKTurnAttachment[],
): Promise<PreparedImageAttachment[]> {
  const prepared: PreparedImageAttachment[] = []
  let totalBytes = 0

  for (const attachment of attachments) {
    if (!path.isAbsolute(attachment.path)) {
      throw imageInputError(attachment, 'must use an absolute local path')
    }
    const mime = MIME_BY_EXTENSION[path.extname(attachment.path).toLowerCase()]
    if (mime == null) {
      throw imageInputError(attachment, 'uses an unsupported format; use PNG, JPEG, WebP, or GIF')
    }
    let fileStats: Awaited<ReturnType<typeof stat>>
    try {
      fileStats = await stat(attachment.path)
    } catch {
      throw imageInputError(attachment, 'could not be read')
    }
    if (!fileStats.isFile()) {
      throw imageInputError(attachment, 'is not a file')
    }
    validateImageSize(attachment, fileStats.size)
    totalBytes += fileStats.size
    if (totalBytes > MAX_TOTAL_IMAGE_BYTES) {
      throw new Error('Image attachments exceed the 50MB combined size limit')
    }
    prepared.push({ attachment, mime })
  }

  return prepared
}

function validateImageSize(attachment: SDKTurnAttachment, bytes: number): void {
  if (bytes === 0 || bytes > MAX_IMAGE_BYTES) {
    throw imageInputError(attachment, 'must be between 1 byte and 20MB')
  }
}

function matchesImageSignature(data: Buffer, mime: string): boolean {
  if (mime === 'image/png') {
    return startsWith(data, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  }
  if (mime === 'image/jpeg') return startsWith(data, [0xff, 0xd8, 0xff])
  if (mime === 'image/gif') {
    const signature = data.subarray(0, 6).toString('ascii')
    return signature === 'GIF87a' || signature === 'GIF89a'
  }
  return (
    mime === 'image/webp' &&
    data.subarray(0, 4).toString('ascii') === 'RIFF' &&
    data.subarray(8, 12).toString('ascii') === 'WEBP'
  )
}

function startsWith(data: Buffer, signature: readonly number[]): boolean {
  return signature.every((byte, index) => data[index] === byte)
}

function imageInputError(attachment: SDKTurnAttachment, detail: string): Error {
  return new Error(`Image attachment ${JSON.stringify(attachment.name)} ${detail}`)
}
