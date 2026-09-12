import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { SessionAttachment } from '@spark/protocol'

export const TELEGRAM_INBOUND_IMAGE_LIMIT_BYTES = 20 * 1024 * 1024

export type TelegramInboundImageDescriptor = {
  fileId: string
  fileUniqueId?: string
  fileName?: string
  fileSize?: number
  mimeType?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined
}

function readPositiveNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

function optionalString(key: string, value: unknown): Record<string, string> {
  const parsed = readString(value)
  return parsed != null ? { [key]: parsed } : {}
}

function optionalNumber(key: string, value: unknown): Record<string, number> {
  const parsed = readPositiveNumber(value)
  return parsed != null ? { [key]: parsed } : {}
}

function imageDocumentDescriptor(
  document: Record<string, unknown>,
): TelegramInboundImageDescriptor | null {
  const fileId = readString(document.file_id)
  const mimeType = readString(document.mime_type)?.toLowerCase()
  const fileName = readString(document.file_name)
  const hasImageMime = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'].includes(
    mimeType ?? '',
  )
  const hasImageExtension = fileName != null && /\.(?:png|jpe?g|webp)$/iu.test(fileName)
  if (fileId == null || (!hasImageMime && !hasImageExtension)) return null
  return {
    fileId,
    ...optionalString('fileUniqueId', document.file_unique_id),
    ...(fileName != null ? { fileName } : {}),
    ...optionalNumber('fileSize', document.file_size),
    ...(mimeType != null ? { mimeType } : {}),
  }
}

export function extractTelegramInboundImages(
  message: Record<string, unknown>,
): TelegramInboundImageDescriptor[] {
  const photos = Array.isArray(message.photo) ? message.photo.filter(isRecord) : []
  const largestPhoto = photos
    .map((photo) => ({
      photo,
      score:
        readPositiveNumber(photo.file_size) ??
        (readPositiveNumber(photo.width) ?? 0) * (readPositiveNumber(photo.height) ?? 0),
    }))
    .sort((left, right) => right.score - left.score)[0]?.photo
  if (largestPhoto != null) {
    const fileId = readString(largestPhoto.file_id)
    if (fileId != null) {
      return [
        {
          fileId,
          ...optionalString('fileUniqueId', largestPhoto.file_unique_id),
          ...optionalNumber('fileSize', largestPhoto.file_size),
          mimeType: 'image/jpeg',
          fileName: 'telegram-photo.jpg',
        },
      ]
    }
  }

  const document = isRecord(message.document) ? imageDocumentDescriptor(message.document) : null
  return document != null ? [document] : []
}

function detectImage(bytes: Buffer): { mimeType: string; extension: string } | null {
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return { mimeType: 'image/png', extension: '.png' }
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mimeType: 'image/jpeg', extension: '.jpg' }
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return { mimeType: 'image/webp', extension: '.webp' }
  }
  return null
}

async function readBodyWithLimit(response: Response, maxBytes: number): Promise<Buffer> {
  const declaredSize = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredSize) && declaredSize > maxBytes) {
    throw new Error(`图片超过 ${Math.round(maxBytes / 1024 / 1024)} MB 限制`)
  }
  if (response.body == null) return Buffer.alloc(0)
  const reader = response.body.getReader()
  const chunks: Buffer[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      throw new Error(`图片超过 ${Math.round(maxBytes / 1024 / 1024)} MB 限制`)
    }
    chunks.push(Buffer.from(value))
  }
  return Buffer.concat(chunks, total)
}

async function telegramJson<T>(response: Response, operation: string): Promise<T> {
  const text = await response.text().catch(() => '')
  let payload: { ok?: boolean; result?: T; description?: string } = {}
  try {
    payload = JSON.parse(text) as typeof payload
  } catch {
    // 下面统一报告为 Telegram 响应异常。
  }
  if (!response.ok || payload.ok === false || payload.result == null) {
    throw new Error(`${operation}失败：${payload.description ?? response.status}`)
  }
  return payload.result
}

export async function downloadTelegramInboundImage(
  input: {
    token: string
    descriptor: TelegramInboundImageDescriptor
    attachmentRoot: string
  },
  fetchImpl: typeof fetch = fetch,
): Promise<SessionAttachment> {
  if (
    input.descriptor.fileSize != null &&
    input.descriptor.fileSize > TELEGRAM_INBOUND_IMAGE_LIMIT_BYTES
  ) {
    throw new Error('Telegram 图片超过 20 MB 限制')
  }
  const metadata = await telegramJson<{ file_path?: string }>(
    await fetchImpl(`https://api.telegram.org/bot${encodeURIComponent(input.token)}/getFile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_id: input.descriptor.fileId }),
    }),
    '获取 Telegram 图片',
  )
  const remotePath = readString(metadata.file_path)
  if (remotePath == null) throw new Error('Telegram 图片响应缺少 file_path')
  const encodedRemotePath = remotePath.split('/').map(encodeURIComponent).join('/')
  const response = await fetchImpl(
    `https://api.telegram.org/file/bot${encodeURIComponent(input.token)}/${encodedRemotePath}`,
  )
  if (!response.ok) throw new Error(`下载 Telegram 图片失败：${response.status}`)
  const bytes = await readBodyWithLimit(response, TELEGRAM_INBOUND_IMAGE_LIMIT_BYTES)
  const image = detectImage(bytes)
  if (image == null) throw new Error('Telegram 文件不是受支持的 PNG、JPEG 或 WebP 图片')

  const dateDirectory = new Date().toISOString().slice(0, 10)
  const directory = path.join(input.attachmentRoot, dateDirectory)
  await fs.mkdir(directory, { recursive: true })
  const identity = (input.descriptor.fileUniqueId ?? crypto.randomUUID()).replace(
    /[^a-zA-Z0-9_-]/gu,
    '_',
  )
  const filePath = path.join(directory, `${Date.now()}-${identity}${image.extension}`)
  await fs.writeFile(filePath, bytes, { flag: 'wx' })
  return {
    type: 'image',
    path: filePath,
  }
}
