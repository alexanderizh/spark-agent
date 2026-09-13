import crypto from 'node:crypto'
import dns from 'node:dns/promises'
import fs from 'node:fs/promises'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { SessionAttachment } from '@spark/protocol'

export const REMOTE_IMAGE_LIMIT_BYTES = 20 * 1024 * 1024

export function detectRemoteImage(bytes: Buffer): { mimeType: string; extension: string } | null {
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    return { mimeType: 'image/png', extension: '.png' }
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mimeType: 'image/jpeg', extension: '.jpg' }
  }
  if (
    bytes.length >= 12 &&
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return { mimeType: 'image/webp', extension: '.webp' }
  }
  return null
}

export async function readRemoteImageResponse(response: Response): Promise<Buffer> {
  if (!response.ok) throw new Error(`图片下载失败：HTTP ${response.status}`)
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > REMOTE_IMAGE_LIMIT_BYTES)
    throw new Error('图片超过 20 MB 限制')
  if (response.body == null) throw new Error('图片响应为空')
  const reader = response.body.getReader()
  const chunks: Buffer[] = []
  let total = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > REMOTE_IMAGE_LIMIT_BYTES) {
      await reader.cancel()
      throw new Error('图片超过 20 MB 限制')
    }
    chunks.push(Buffer.from(value))
  }
  return Buffer.concat(chunks, total)
}

export async function persistRemoteImage(bytes: Buffer, root: string): Promise<SessionAttachment> {
  if (bytes.length > REMOTE_IMAGE_LIMIT_BYTES) throw new Error('图片超过 20 MB 限制')
  const image = detectRemoteImage(bytes)
  if (image == null) throw new Error('仅支持 PNG、JPEG 或 WebP 图片')
  const directory = path.join(root, new Date().toISOString().slice(0, 10))
  await fs.mkdir(directory, { recursive: true })
  const filePath = path.join(directory, `${Date.now()}-${crypto.randomUUID()}${image.extension}`)
  await fs.writeFile(filePath, bytes, { flag: 'wx' })
  return { type: 'image', path: filePath }
}

export async function readOutboundImage(
  source: string,
): Promise<{ bytes: Buffer; fileName: string; mimeType: string }> {
  const localPath = source.startsWith('file://') ? fileURLToPath(source) : source
  let bytes: Buffer
  let fileName: string
  if (path.isAbsolute(localPath)) {
    const resolved = await fs.realpath(localPath)
    const stat = await fs.stat(resolved)
    if (!stat.isFile() || stat.size > REMOTE_IMAGE_LIMIT_BYTES)
      throw new Error('图片文件无效或超过 20 MB')
    bytes = await fs.readFile(resolved)
    fileName = path.basename(resolved)
  } else {
    const response = await fetchPublicImage(source)
    bytes = await readRemoteImageResponse(response)
    fileName = path.basename(new URL(source).pathname) || 'image'
  }
  const image = detectRemoteImage(bytes)
  if (image == null) throw new Error('仅支持 PNG、JPEG 或 WebP 图片')
  return {
    bytes,
    fileName: `${path.parse(fileName).name || 'image'}${image.extension}`,
    mimeType: image.mimeType,
  }
}

function publicIp(address: string): boolean {
  if (net.isIP(address) === 4) {
    const [a = 0, b = 0] = address.split('.').map(Number)
    return (
      a !== 0 &&
      a !== 10 &&
      a !== 127 &&
      a !== 169 &&
      a < 224 &&
      !(a === 172 && b >= 16 && b <= 31) &&
      !(a === 100 && b >= 64 && b <= 127) &&
      !(a === 192 && b === 168)
    )
  }
  if (net.isIP(address) === 6) {
    const lower = address.toLowerCase()
    return (
      lower !== '::1' &&
      lower !== '::' &&
      !lower.startsWith('fc') &&
      !lower.startsWith('fd') &&
      !lower.startsWith('fe8') &&
      !lower.startsWith('fe9') &&
      !lower.startsWith('fea') &&
      !lower.startsWith('feb') &&
      !lower.startsWith('::ffff:')
    )
  }
  return false
}

async function assertPublicHttps(url: string): Promise<void> {
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port)
    throw new Error('图片 URL 必须是公开 HTTPS 地址')
  const addresses = await dns.lookup(parsed.hostname, { all: true })
  if (addresses.length === 0 || addresses.some((entry) => !publicIp(entry.address)))
    throw new Error('图片 URL 解析到非公网地址')
}

export async function fetchPublicImage(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  await assertPublicHttps(url)
  return fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(30_000) })
}
