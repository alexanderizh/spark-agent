import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export type TelegramOutboundImage = {
  source: string
  alt: string
}

export type TelegramOutboundMedia = {
  text: string
  images: TelegramOutboundImage[]
}

const MAX_IMAGES_PER_REPLY = 10
const TELEGRAM_PHOTO_LIMIT_BYTES = 10 * 1024 * 1024
const TELEGRAM_DOCUMENT_LIMIT_BYTES = 50 * 1024 * 1024
const MARKDOWN_IMAGE_PATTERN =
  /!\[([^\]]*)\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+["'][^"']*["'])?\s*\)/gu

function isSupportedImageSource(source: string): boolean {
  return /^https?:\/\//iu.test(source) || /^file:\/\//iu.test(source) || path.isAbsolute(source)
}

function imageSourceKey(source: string): string {
  const localPath = localPathFromSource(source)
  if (localPath != null) return `file:${path.resolve(localPath)}`
  try {
    return `url:${new URL(source).href}`
  } catch {
    return `raw:${source}`
  }
}

export function mergeTelegramOutboundImages(
  ...groups: Array<readonly TelegramOutboundImage[]>
): TelegramOutboundImage[] {
  const seen = new Set<string>()
  const result: TelegramOutboundImage[] = []
  for (const image of groups.flat()) {
    const key = imageSourceKey(image.source)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(image)
    if (result.length >= MAX_IMAGES_PER_REPLY) break
  }
  return result
}

export function extractTelegramOutboundMedia(text: string): TelegramOutboundMedia {
  const images: TelegramOutboundImage[] = []
  const remainingText = text.replace(
    MARKDOWN_IMAGE_PATTERN,
    (match, alt: string, angleSource: string | undefined, plainSource: string | undefined) => {
      const source = (angleSource ?? plainSource ?? '').trim()
      if (images.length >= MAX_IMAGES_PER_REPLY || !isSupportedImageSource(source)) return match
      images.push({ source, alt: alt.trim() })
      return ''
    },
  )
  return {
    text: remainingText.replace(/\n{3,}/gu, '\n\n').trim(),
    images,
  }
}

function mimeTypeFromPath(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.webp':
      return 'image/webp'
    case '.png':
    default:
      return 'image/png'
  }
}

function localPathFromSource(source: string): string | null {
  if (/^file:\/\//iu.test(source)) {
    try {
      return fileURLToPath(source)
    } catch {
      return null
    }
  }
  return path.isAbsolute(source) ? source : null
}

async function ensureTelegramResponse(response: Response): Promise<void> {
  const body = await response.text().catch(() => '')
  let description = body.slice(0, 300)
  try {
    const parsed = JSON.parse(body) as { ok?: boolean; description?: string }
    if (parsed.ok !== false && response.ok) return
    description = parsed.description ?? description
  } catch {
    if (response.ok) return
  }
  throw new Error(`Telegram 图片发送失败：${response.status} ${description}`.trim())
}

type TelegramMediaMethod = 'sendPhoto' | 'sendDocument'

async function sendRemoteMedia(
  fetchImpl: typeof fetch,
  input: { token: string; chatId: string; source: string; caption: string },
  method: TelegramMediaMethod,
): Promise<void> {
  const field = method === 'sendPhoto' ? 'photo' : 'document'
  const response = await fetchImpl(
    `https://api.telegram.org/bot${encodeURIComponent(input.token)}/${method}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: input.chatId,
        [field]: input.source,
        ...(input.caption.length > 0 ? { caption: input.caption } : {}),
      }),
    },
  )
  await ensureTelegramResponse(response)
}

async function sendLocalMedia(
  fetchImpl: typeof fetch,
  input: {
    token: string
    chatId: string
    bytes: Buffer
    fileName: string
    mimeType: string
    caption: string
  },
  method: TelegramMediaMethod,
): Promise<void> {
  const field = method === 'sendPhoto' ? 'photo' : 'document'
  const form = new FormData()
  form.append('chat_id', input.chatId)
  form.append(field, new Blob([input.bytes], { type: input.mimeType }), input.fileName)
  if (input.caption.length > 0) form.append('caption', input.caption)
  const response = await fetchImpl(
    `https://api.telegram.org/bot${encodeURIComponent(input.token)}/${method}`,
    { method: 'POST', body: form },
  )
  await ensureTelegramResponse(response)
}

export async function sendTelegramOutboundImage(
  input: {
    token: string
    chatId: string
    image: TelegramOutboundImage
  },
  dependencies: {
    fetch?: typeof fetch
    uploadTemporaryFile: (input: {
      filePath: string
      fileName: string
      mimeType: string
    }) => Promise<string>
  },
): Promise<
  | 'telegram-url'
  | 'telegram-upload'
  | 'telegram-document-url'
  | 'telegram-document-upload'
  | 'spark-transfer'
> {
  const fetchImpl = dependencies.fetch ?? fetch
  const caption = input.image.alt.slice(0, 1024)
  const localPath = localPathFromSource(input.image.source)

  if (localPath == null) {
    try {
      await sendRemoteMedia(
        fetchImpl,
        { token: input.token, chatId: input.chatId, source: input.image.source, caption },
        'sendPhoto',
      )
      return 'telegram-url'
    } catch {
      await sendRemoteMedia(
        fetchImpl,
        { token: input.token, chatId: input.chatId, source: input.image.source, caption },
        'sendDocument',
      )
      return 'telegram-document-url'
    }
  }

  const realPath = await fs.realpath(localPath)
  const stat = await fs.stat(realPath)
  if (!stat.isFile()) throw new Error('图片路径不是文件')
  if (stat.size > TELEGRAM_DOCUMENT_LIMIT_BYTES) {
    throw new Error('Telegram 图片超过 50 MB 发送限制')
  }
  const fileName = path.basename(realPath)
  const mimeType = mimeTypeFromPath(realPath)
  const bytes = await fs.readFile(realPath)
  const localMedia = {
    token: input.token,
    chatId: input.chatId,
    bytes,
    fileName,
    mimeType,
    caption,
  }

  let directError: unknown
  try {
    if (stat.size <= TELEGRAM_PHOTO_LIMIT_BYTES) {
      await sendLocalMedia(fetchImpl, localMedia, 'sendPhoto')
      return 'telegram-upload'
    }
  } catch (error) {
    directError = error
  }
  try {
    await sendLocalMedia(fetchImpl, localMedia, 'sendDocument')
    return 'telegram-document-upload'
  } catch (error) {
    directError = directError ?? error
  }

  try {
    const publicUrl = await dependencies.uploadTemporaryFile({
      filePath: realPath,
      fileName,
      mimeType,
    })
    try {
      await sendRemoteMedia(
        fetchImpl,
        { token: input.token, chatId: input.chatId, source: publicUrl, caption },
        'sendPhoto',
      )
      return 'spark-transfer'
    } catch {
      await sendRemoteMedia(
        fetchImpl,
        { token: input.token, chatId: input.chatId, source: publicUrl, caption },
        'sendDocument',
      )
      return 'spark-transfer'
    }
  } catch (fallbackError) {
    throw new Error(
      `Telegram 直传失败：${directError instanceof Error ? directError.message : String(directError)}；Spark 临时中转也失败：${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`,
      { cause: fallbackError },
    )
  }
}
