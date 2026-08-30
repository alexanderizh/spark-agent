import { readFile } from 'node:fs/promises'

export function googleMcpImagePart(value) {
  const match = /^data:([^;,]+);base64,(.*)$/i.exec(value)
  if (match) {
    return { type: 'image', mime_type: match[1] || 'image/png', data: match[2] || '' }
  }
  return { type: 'image', uri: value }
}

export function googleMcpVideoPart(value) {
  const match = /^data:([^;,]+);base64,(.*)$/i.exec(value)
  if (match) {
    return { type: 'video', mime_type: match[1] || 'video/mp4', data: match[2] || '' }
  }
  return { type: 'video', uri: value }
}

export function googleMcpVeoImage(value) {
  const part = googleMcpImagePart(value)
  if (part.data) {
    return { inlineData: { mimeType: part.mime_type || 'image/png', data: part.data } }
  }
  return { uri: part.uri }
}

export async function openAiMcpUpload(value, fallbackName) {
  const dataMatch = /^data:([^;,]+);base64,(.*)$/i.exec(value)
  if (dataMatch) {
    const contentType = dataMatch[1] || 'image/png'
    return {
      filename: `${fallbackName}.${extensionForMime(contentType)}`,
      contentType,
      content: Buffer.from(dataMatch[2] || '', 'base64'),
    }
  }
  if (/^https?:\/\//i.test(value)) {
    const response = await fetch(value)
    if (!response.ok) throw new Error(`Failed to read OpenAI media input: HTTP ${response.status}`)
    const contentType = response.headers.get('content-type')?.split(';')[0] || 'image/png'
    return {
      filename: `${fallbackName}.${extensionForMime(contentType)}`,
      contentType,
      content: Buffer.from(await response.arrayBuffer()),
    }
  }
  throw new Error('OpenAI media input must be a data URL or HTTP(S) URL')
}

// ── Contract V2 multipart 输入解析 ──────────────────────────────────────────
// 与 TS 侧 media-invocation-compiler 的 valueToBuffer + fileNameForValue 同语义：
// data: URL / 远程 http(s) URL / 本地路径 统一解析为可上传的 {filename, contentType, content}。

const MCP_MIME_BY_EXTENSION = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  flac: 'audio/flac',
}

function extensionOf(filename) {
  const match = /\.([A-Za-z0-9]+)$/.exec(filename)
  return match ? match[1].toLowerCase() : ''
}

function mimeForExtension(ext) {
  return MCP_MIME_BY_EXTENSION[ext] || 'application/octet-stream'
}

function filenameFromUrl(value) {
  try {
    const pathname = new globalThis.URL(value).pathname || ''
    const base = pathname.split('/').filter(Boolean).pop() || ''
    // 仅接受带媒体扩展名的文件名，避免把路由片段当文件名。
    return extensionOf(base) ? decodeURIComponent(base).replace(/["\r\n]/g, '_') : ''
  } catch {
    return ''
  }
}

export async function resolveMcpInputBuffer(value, fallbackName) {
  if (typeof value !== 'string' || !value) {
    throw new Error('multipart input must be a data URL, HTTP(S) URL, or local file path')
  }
  const dataMatch = /^data:([^;,]+);base64,(.*)$/i.exec(value)
  if (dataMatch) {
    const contentType = dataMatch[1] || 'application/octet-stream'
    return {
      filename: `${fallbackName}.${extensionForMime(contentType)}`,
      contentType,
      content: Buffer.from(dataMatch[2] || '', 'base64'),
    }
  }
  if (/^https?:\/\//i.test(value)) {
    const response = await fetch(value)
    if (!response.ok) {
      throw new Error(
        `Failed to download input file ${value.slice(0, 120)}: HTTP ${response.status}`,
      )
    }
    const contentType = response.headers.get('content-type')?.split(';')[0] || 'image/png'
    const urlName = filenameFromUrl(value)
    return {
      filename: urlName || `${fallbackName}.${extensionForMime(contentType)}`,
      contentType,
      content: Buffer.from(await response.arrayBuffer()),
    }
  }
  // 其余按本地路径处理（含 safe-file:// 由调用方先行归一化的场景）。
  const normalized = value.startsWith('safe-file://') ? value.replace(/^safe-file:\/\//, '') : value
  let content
  try {
    content = await readFile(normalized)
  } catch (error) {
    throw new Error(
      `Failed to read local input file ${normalized.slice(0, 200)}: ${error?.message || error}`,
      { cause: error },
    )
  }
  const base = normalized.split(/[\\/]/).filter(Boolean).pop() || fallbackName
  return {
    filename: extensionOf(base) ? base : `${fallbackName}.bin`,
    contentType: mimeForExtension(extensionOf(base)),
    content,
  }
}

export function buildMcpMultipart(fields, files) {
  const boundary = `----spark-openai-${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`
  const chunks = []
  for (const [name, value] of Object.entries(fields)) {
    if (value === undefined || value === null || value === '') continue
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${escapeMcpHeader(name)}"\r\n\r\n${String(value)}\r\n`,
      ),
    )
  }
  for (const file of files) {
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${escapeMcpHeader(file.field)}"; filename="${escapeMcpHeader(file.filename)}"\r\nContent-Type: ${file.contentType}\r\n\r\n`,
      ),
    )
    chunks.push(file.content)
    chunks.push(Buffer.from('\r\n'))
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`))
  return { body: Buffer.concat(chunks), contentType: `multipart/form-data; boundary=${boundary}` }
}

function extensionForMime(contentType) {
  if (contentType.includes('jpeg')) return 'jpg'
  if (contentType.includes('webp')) return 'webp'
  return 'png'
}

function escapeMcpHeader(value) {
  return String(value).replace(/["\r\n]/g, '_')
}
