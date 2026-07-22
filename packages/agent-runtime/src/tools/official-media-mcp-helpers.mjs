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
