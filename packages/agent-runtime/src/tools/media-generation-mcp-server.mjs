#!/usr/bin/env node
/**
 * spark_media MCP server — 统一多媒体生成（图片 / 语音 / 视频）。
 *
 * 协议：stdio JSON-RPC 2.0（与 tools/image-generation-mcp-server.mjs 一致）。
 *
 * 工具（design doc §3.2 §7）：
 *   generate_image     — 文生图 / 图生图（prompt + 可选 inputImages）
 *   edit_image         — 图片编辑（imageFiles/imageUrls + prompt）
 *   generate_audio     — 语音合成（text → audio）
 *   transcribe_audio   — 语音转写（audioFile/audioUrl → text）
 *   generate_video     — 文生视频 / 图生视频（prompt + 可选 inputImages）
 *
 * 配置全部来自环境变量（API key 仅在本子进程内存内，不外泄）：
 *   SPARK_MEDIA_API_KEY       API key（必填）
 *   SPARK_MEDIA_PROVIDER      apimart | xai | openai-compatible | custom（默认 openai-compatible）
 *   SPARK_MEDIA_MODEL         默认模型 id
 *   SPARK_MEDIA_API_TYPE      sync | async | auto（默认 auto）
 *   SPARK_MEDIA_BASE_URL      API base url
 *   SPARK_MEDIA_OUTPUT_DIR    产物落盘根目录
 *   SPARK_MEDIA_DEFAULTS_JSON 可选；mediaDefaults 的 JSON 字符串
 */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import readline from 'node:readline'
// 响应解析逻辑复用 TS adapter 的单一事实源（media-extract.mjs），避免分叉
import {
  extractImages,
  extractMediaUrls,
  extractText,
  extractTaskId,
  extractStatus,
} from '../services/media/media-extract.mjs'

const env = process.env

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}
function result(id, value) {
  send({ jsonrpc: '2.0', id, result: value })
}
function error(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message } })
}

const TOOLS = [
  {
    name: 'generate_image',
    description:
      'Generate an image from a prompt (text-to-image) or with reference images (image-to-image). API keys stay inside this local Spark media MCP server.',
    inputSchema: {
      type: 'object',
      required: ['prompt'],
      properties: {
        prompt: { type: 'string', description: 'Detailed image prompt.' },
        size: { type: 'string', description: 'Size or aspect ratio (e.g. 1024x1024, 16:9, portrait).' },
        n: { type: 'integer', minimum: 1, maximum: 4, description: 'Number of images. Default 1.' },
        inputImages: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional reference image urls / data urls for image-to-image.',
        },
        filename: { type: 'string', description: 'Optional output filename (no path).' },
        extraJson: { type: 'object', additionalProperties: true },
      },
    },
  },
  {
    name: 'edit_image',
    description: 'Edit one or more input images with a prompt (image edit / multi-reference compose).',
    inputSchema: {
      type: 'object',
      required: ['prompt'],
      properties: {
        prompt: { type: 'string', description: 'Edit instruction.' },
        imageUrls: { type: 'array', items: { type: 'string' } },
        imageFiles: { type: 'array', items: { type: 'string' }, description: 'Local file paths.' },
        mask: { type: 'string' },
        size: { type: 'string' },
        n: { type: 'integer', minimum: 1, maximum: 4 },
        filename: { type: 'string' },
        extraJson: { type: 'object', additionalProperties: true },
      },
    },
  },
  {
    name: 'generate_audio',
    description: 'Synthesize speech audio from text (text-to-speech).',
    inputSchema: {
      type: 'object',
      required: ['text'],
      properties: {
        text: { type: 'string', description: 'Text to synthesize.' },
        voice: { type: 'string', description: 'Voice id (provider-specific).' },
        format: { type: 'string', description: 'mp3, wav, opus, aac, flac, pcm.' },
        speed: { type: 'number' },
        filename: { type: 'string' },
        extraJson: { type: 'object', additionalProperties: true },
      },
    },
  },
  {
    name: 'transcribe_audio',
    description: 'Transcribe an audio file into text (speech-to-text).',
    inputSchema: {
      type: 'object',
      properties: {
        audioFile: { type: 'string', description: 'Local audio file path.' },
        audioUrl: { type: 'string', description: 'Remote audio url.' },
        language: { type: 'string' },
        responseFormat: { type: 'string' },
        extraJson: { type: 'object', additionalProperties: true },
      },
    },
  },
  {
    name: 'generate_video',
    description: 'Generate a video from a prompt (text-to-video) or image + prompt (image-to-video).',
    inputSchema: {
      type: 'object',
      required: ['prompt'],
      properties: {
        prompt: { type: 'string' },
        inputImages: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional reference image urls / data urls for image-to-video.',
        },
        aspectRatio: { type: 'string' },
        durationSeconds: { type: 'integer', minimum: 1, maximum: 120 },
        filename: { type: 'string' },
        extraJson: { type: 'object', additionalProperties: true },
      },
    },
  },
]

function configFromEnv() {
  let mediaDefaults = {}
  try {
    mediaDefaults = env.SPARK_MEDIA_DEFAULTS_JSON ? JSON.parse(env.SPARK_MEDIA_DEFAULTS_JSON) : {}
  } catch {
    mediaDefaults = {}
  }
  return {
    apiKey: env.SPARK_MEDIA_API_KEY || '',
    provider: (env.SPARK_MEDIA_PROVIDER || 'openai-compatible').trim().toLowerCase(),
    model: env.SPARK_MEDIA_MODEL || '',
    mode: env.SPARK_MEDIA_API_TYPE || 'auto',
    baseUrl: (env.SPARK_MEDIA_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, ''),
    outputDir: env.SPARK_MEDIA_OUTPUT_DIR || path.join(process.cwd(), '.spark-artifacts', 'media'),
    mediaDefaults,
  }
}

const FAILED_STATUSES = ['failed', 'error', 'cancelled', 'canceled']

async function fetchJson(url, init, timeoutMs, binary = false) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs ?? 30_000)
  try {
    const res = await fetch(url, { ...init, signal: controller.signal })
    if (binary) {
      const buf = Buffer.from(await res.arrayBuffer())
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return buf
    }
    const text = await res.text()
    let body = null
    try { body = text ? JSON.parse(text) : null } catch { body = text }
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${String(text).slice(0, 800)}`)
    return body
  } finally {
    clearTimeout(timer)
  }
}

async function pollTask(config, url, inspect) {
  const defaults = config.mediaDefaults?.polling || {}
  const deadline = Date.now() + (defaults.timeoutMs || 600_000)
  let interval = Math.max(1000, defaults.intervalMs || 5000)
  while (Date.now() < deadline) {
    const data = await fetchJson(url, { headers: authHeaders(config) }, 30_000)
    const state = inspect(data)
    if (state === 'done') return data
    if (state === 'failed') throw new Error(`Task failed: ${JSON.stringify(data).slice(0, 800)}`)
    await new Promise((r) => setTimeout(r, interval))
    interval = Math.min(interval * 1.3, Math.max(interval, 15_000))
  }
  throw new Error('Task timed out')
}

function authHeaders(config) {
  return { 'content-type': 'application/json', authorization: `Bearer ${config.apiKey}` }
}

function videoTaskPath(config, taskId) {
  if (config.provider === 'xai') return `/videos/generations/${encodeURIComponent(taskId)}`
  return `/videos/generations/${encodeURIComponent(taskId)}`
}

function extFromMime(mime = 'image/png') {
  if (mime.includes('jpeg')) return '.jpg'
  if (mime.includes('webp')) return '.webp'
  if (mime.includes('gif')) return '.gif'
  return '.png'
}

async function materializeImage(config, image, filename, index, total) {
  const dir = path.join(config.outputDir, 'images')
  await mkdir(dir, { recursive: true })
  const buffer = image.kind === 'url'
    ? Buffer.from(await (await fetch(image.value)).arrayBuffer())
    : Buffer.from(image.value, 'base64')
  const parsed = path.parse(filename || `img_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`)
  const suffix = total > 1 ? `_${String(index + 1).padStart(3, '0')}` : ''
  const name = `${parsed.name}${suffix}${parsed.ext || extFromMime(image.mimeType)}`
  const file = path.join(dir, name)
  await writeFile(file, buffer)
  return file
}

async function downloadMedia(config, url, kind, filename) {
  const dir = path.join(config.outputDir, kind === 'audio' ? 'audio' : 'videos')
  await mkdir(dir, { recursive: true })
  const buffer = Buffer.from(await (await fetch(url)).arrayBuffer())
  const parsed = path.parse(filename || `${kind}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`)
  const name = `${parsed.name}${parsed.ext || (kind === 'audio' ? '.mp3' : '.mp4')}`
  const file = path.join(dir, name)
  await writeFile(file, buffer)
  return file
}

async function writeTextAsset(config, text, filename) {
  const dir = path.join(config.outputDir, 'text')
  await mkdir(dir, { recursive: true })
  const parsed = path.parse(filename || `transcript_${Date.now()}`)
  const file = path.join(dir, `${parsed.name}.txt`)
  await writeFile(file, text, 'utf8')
  return file
}

// ── tool handlers ──────────────────────────────────────────────────────────

async function handleGenerateImage(config, args) {
  if (!config.apiKey) throw new Error('No media API key configured')
  if (!config.model) throw new Error('No media model configured')
  const prompt = String(args.prompt || '').trim()
  if (!prompt) throw new Error('prompt is required')
  const n = Math.max(1, Math.min(4, Number.parseInt(args.n || '1', 10) || 1))
  const body = {
    model: config.model,
    prompt,
    n,
    ...(args.size ? { size: args.size } : {}),
    ...(args.extraJson || {}),
  }
  const url = `${config.baseUrl}/images/generations`
  const data = await fetchJson(url, { method: 'POST', headers: authHeaders(config), body: JSON.stringify(body) }, 60_000)
  let images = extractImages(data)
  let mode = 'sync'
  if (images.length === 0 && (config.mode === 'async' || config.mode === 'auto')) {
    const taskId = extractTaskId(data)
    if (taskId) {
      mode = 'async'
      const polled = await pollTask(config, `${config.baseUrl}/tasks/${encodeURIComponent(taskId)}`, (d) => {
        if (extractImages(d).length) return 'done'
        return FAILED_STATUSES.includes(extractStatus(d)) ? 'failed' : 'pending'
      })
      images = extractImages(polled)
    }
  }
  if (images.length === 0) throw new Error(`No images in response: ${JSON.stringify(data).slice(0, 800)}`)
  const files = []
  for (let i = 0; i < Math.min(images.length, n); i++) {
    files.push(await materializeImage(config, images[i], args.filename || '', i, Math.min(images.length, n)))
  }
  return { success: true, provider: `${config.provider}/${config.model}`, mode, files }
}

async function handleEditImage(config, args) {
  if (!config.apiKey) throw new Error('No media API key configured')
  const prompt = String(args.prompt || '').trim()
  const imageUrls = Array.isArray(args.imageUrls) ? args.imageUrls : []
  const imageFiles = Array.isArray(args.imageFiles) ? args.imageFiles : []
  const refs = [...imageUrls, ...imageFiles].filter((s) => typeof s === 'string' && s.length > 0)
  const body = {
    model: config.model,
    prompt,
    ...(refs.length > 0 ? { image: refs[0] } : {}),
    ...(refs.length > 1 ? { image_url: refs } : {}),
    ...(args.size ? { size: args.size } : {}),
    ...(args.extraJson || {}),
  }
  const url = `${config.baseUrl}/images/edits`
  const data = await fetchJson(url, { method: 'POST', headers: authHeaders(config), body: JSON.stringify(body) }, 60_000)
  const images = extractImages(data)
  if (images.length === 0) throw new Error(`No images in edit response: ${JSON.stringify(data).slice(0, 800)}`)
  const files = []
  for (let i = 0; i < images.length; i++) {
    files.push(await materializeImage(config, images[i], args.filename || '', i, images.length))
  }
  return { success: true, provider: `${config.provider}/${config.model}`, mode: 'sync', files }
}

async function handleGenerateAudio(config, args) {
  if (!config.apiKey) throw new Error('No media API key configured')
  const text = String(args.text || '').trim()
  if (!text) throw new Error('text is required')
  const audioDefaults = config.mediaDefaults?.audio || {}
  const format = args.format || audioDefaults.format || 'mp3'
  const body = {
    model: config.model,
    input: text,
    voice: args.voice || audioDefaults.voice || 'alloy',
    response_format: format,
    ...(args.speed != null ? { speed: args.speed } : {}),
    ...(args.extraJson || {}),
  }
  const url = `${config.baseUrl}/audio/speech`
  const buffer = await fetchJson(url, { method: 'POST', headers: authHeaders(config), body: JSON.stringify(body) }, 60_000, true)
  const file = await downloadMedia(config, `data:audio/${format};base64,${buffer.toString('base64')}`, 'audio', args.filename || '')
  return { success: true, provider: `${config.provider}/${config.model}`, mode: 'sync', files: [file] }
}

async function handleTranscribeAudio(config, args) {
  if (!config.apiKey) throw new Error('No media API key configured')
  const url = `${config.baseUrl}/audio/transcriptions`
  let data
  if (args.audioUrl) {
    data = await fetchJson(url, {
      method: 'POST',
      headers: authHeaders(config),
      body: JSON.stringify({ model: config.model, url: args.audioUrl, ...(args.language ? { language: args.language } : {}), ...(args.extraJson || {}) }),
    }, 120_000)
  } else if (args.audioFile) {
    const { readFile } = await import('node:fs/promises')
    const buffer = await readFile(args.audioFile)
    data = await fetchJson(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${config.apiKey}` },
      body: buffer,
    }, 120_000)
  } else {
    throw new Error('audioFile or audioUrl is required')
  }
  const text = extractText(data)
  const file = await writeTextAsset(config, text, args.filename || '')
  return { success: true, provider: `${config.provider}/${config.model}`, mode: 'sync', files: [file], text }
}

async function handleGenerateVideo(config, args) {
  if (!config.apiKey) throw new Error('No media API key configured')
  const prompt = String(args.prompt || '').trim()
  if (!prompt) throw new Error('prompt is required')
  const videoDefaults = config.mediaDefaults?.video || {}
  const inputImages = Array.isArray(args.inputImages) ? args.inputImages : []
  const body = {
    model: config.model,
    prompt,
    ...(args.aspectRatio || videoDefaults.aspectRatio ? { aspect_ratio: args.aspectRatio || videoDefaults.aspectRatio } : {}),
    ...(args.durationSeconds || videoDefaults.durationSeconds ? { duration: args.durationSeconds || videoDefaults.durationSeconds } : {}),
    ...(inputImages.length > 0 ? { image: inputImages[0] } : {}),
    ...(args.extraJson || {}),
  }
  const url = `${config.baseUrl}/videos/generations`
  const data = await fetchJson(url, { method: 'POST', headers: authHeaders(config), body: JSON.stringify(body) }, 60_000)
  let videoUrls = extractMediaUrls(data, { kind: 'video' })
  if (videoUrls.length === 0) {
    const taskId = extractTaskId(data)
    if (!taskId) throw new Error(`No video url or task id: ${JSON.stringify(data).slice(0, 800)}`)
    const polled = await pollTask(config, `${config.baseUrl}${videoTaskPath(config, taskId)}`, (d) => {
      if (extractMediaUrls(d, { kind: 'video' }).length) return 'done'
      return FAILED_STATUSES.includes(extractStatus(d)) ? 'failed' : 'pending'
    })
    videoUrls = extractMediaUrls(polled, { kind: 'video' })
  }
  const files = []
  for (let i = 0; i < videoUrls.length; i++) {
    files.push(await downloadMedia(config, videoUrls[i], 'video', args.filename || ''))
  }
  return { success: true, provider: `${config.provider}/${config.model}`, mode: 'async', files }
}

async function handle(request) {
  const id = request.id
  try {
    if (request.method === 'initialize') {
      result(id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'spark-media', version: '0.1.0' },
      })
      return
    }
    if (request.method === 'tools/list') {
      result(id, { tools: TOOLS })
      return
    }
    if (request.method === 'tools/call') {
      const name = request.params?.name
      const args = request.params?.arguments || {}
      const config = configFromEnv()
      let data
      switch (name) {
        case 'generate_image': data = await handleGenerateImage(config, args); break
        case 'edit_image': data = await handleEditImage(config, args); break
        case 'generate_audio': data = await handleGenerateAudio(config, args); break
        case 'transcribe_audio': data = await handleTranscribeAudio(config, args); break
        case 'generate_video': data = await handleGenerateVideo(config, args); break
        default: throw new Error(`Unknown tool: ${name}`)
      }
      result(id, {
        content: [{ type: 'text', text: `${name} succeeded: ${(data.files || []).join(', ')}` }],
        structuredContent: data,
      })
      return
    }
    if (id !== undefined) result(id, {})
  } catch (err) {
    error(id, -32000, err instanceof Error ? err.message : String(err))
  }
}

const rl = readline.createInterface({ input: process.stdin })
rl.on('line', (line) => {
  if (!line.trim()) return
  try {
    void handle(JSON.parse(line))
  } catch (err) {
    error(null, -32700, err instanceof Error ? err.message : String(err))
  }
})
