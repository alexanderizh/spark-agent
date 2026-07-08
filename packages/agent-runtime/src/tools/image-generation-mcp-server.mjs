#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import readline from 'node:readline'

const DEFAULT_SIZE = '1024x1024'
const DEFAULT_TIMEOUT_MS = 240_000
const DEFAULT_POLL_INTERVAL_MS = 5_000

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

function toolDefinition() {
  return {
    name: 'generate_image',
    description: 'Generate image assets with the Spark-controlled image model. API keys are only available inside this local MCP server.',
    inputSchema: {
      type: 'object',
      required: ['prompt'],
      properties: {
        prompt: { type: 'string', description: 'Detailed image prompt.' },
        size: { type: 'string', description: 'Image size or aspect ratio, such as 1024x1024, 1:1, 16:9, or portrait.' },
        n: { type: 'integer', minimum: 1, maximum: 4, description: 'Number of images to generate. Default 1.' },
        filename: { type: 'string', description: 'Optional output filename. Do not include a path.' },
        extraJson: { type: 'object', additionalProperties: true, description: 'Provider-specific extra parameters.' },
      },
    },
  }
}

function configFromEnv() {
  const provider = (env.SPARK_IMAGE_PROVIDER || 'openai').trim().toLowerCase()
  return {
    apiKey: env.SPARK_IMAGE_API_KEY || '',
    model: env.SPARK_IMAGE_MODEL || '',
    provider,
    mode: env.SPARK_IMAGE_API_TYPE || 'sync',
    baseUrl: (env.SPARK_IMAGE_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, ''),
    outputDir: env.SPARK_IMAGE_OUTPUT_DIR || path.join(process.cwd(), '.spark-artifacts', 'images'),
    urlPrefix: env.SPARK_IMAGE_URL_PREFIX || '',
  }
}

const RATIO_ALIASES = [
  [/^(square|avatar|icon|方图|正方形)$/i, '1:1'],
  [/^(poster|海报)$/i, '2:3'],
  [/^(portrait|vertical|story|mobile|竖版|长图|封面)$/i, '9:16'],
  [/^(landscape|horizontal|hero|banner|横版|横图)$/i, '16:9'],
]

const OPENAI_RATIO_TO_SIZE = {
  '1:1': '1024x1024',
  '2:3': '1024x1536',
  '3:2': '1536x1024',
  '3:4': '1024x1536',
  '4:3': '1536x1024',
  '9:16': '1024x1536',
  '16:9': '1536x1024',
}

const BAILIAN_RATIO_TO_SIZE = {
  '1:1': '1280*1280',
  '3:4': '1104*1472',
  '4:3': '1472*1104',
  '9:16': '960*1696',
  '16:9': '1696*960',
}

function parsePixelSize(value) {
  const match = /^\s*(\d{2,5})\s*x\s*(\d{2,5})\s*$/i.exec(value || '')
  if (!match) return null
  return { width: Number.parseInt(match[1], 10), height: Number.parseInt(match[2], 10) }
}

function ratioFromSize(value) {
  const raw = String(value || '').trim().toLowerCase()
  if (!raw) return null
  if (/^\d+:\d+$/.test(raw)) return raw
  for (const [pattern, ratio] of RATIO_ALIASES) {
    if (pattern.test(raw)) return ratio
  }
  const pixels = parsePixelSize(raw)
  if (!pixels) return null
  const actual = pixels.width / pixels.height
  let best = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (const ratio of ['1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9']) {
    const [w, h] = ratio.split(':').map(Number)
    const distance = Math.abs(actual - w / h)
    if (distance < bestDistance) {
      best = ratio
      bestDistance = distance
    }
  }
  return bestDistance <= 0.12 ? best : null
}

function normalizeParams(provider, size, extraJson) {
  const extra = JSON.parse(JSON.stringify(extraJson || {}))
  const ratio = ratioFromSize(size)
  // xAI Images API 不支持 size（HTTP 400: Argument not supported: size），只认 aspect_ratio + resolution。
  // 比例型 size（如 16:9 / 1:1）→ 归一化到 aspect_ratio；分辨率型（如 1024x1024）→ 丢弃。
  if (provider === 'xai') {
    const aspect = extra.aspect_ratio ?? extra.aspectRatio ?? ratio
    if (aspect) extra.aspect_ratio = aspect
    delete extra.aspectRatio
    return { size: '', extraJson: extra }
  }
  if (provider === 'openai') {
    const resolvedSize = size || DEFAULT_SIZE
    return { size: OPENAI_RATIO_TO_SIZE[ratio] || resolvedSize, extraJson: extra }
  }
  const resolvedSize = size || DEFAULT_SIZE
  if (provider === 'bailian') return { size: ratio ? BAILIAN_RATIO_TO_SIZE[ratio] || resolvedSize : String(resolvedSize).replace('x', '*'), extraJson: extra }
  if (provider === 'openrouter' && ratio) {
    extra.image_config = { ...(extra.image_config || {}), aspect_ratio: extra.image_config?.aspect_ratio ?? ratio }
  }
  if ((provider === 'gemini' || provider === 'seeddance' || provider === 'zhipu') && ratio) {
    extra.aspect_ratio ??= ratio
    extra.aspectRatio ??= ratio
  }
  return { size: ratio || resolvedSize, extraJson: extra }
}

function submitPath(provider, mode) {
  if (provider === 'openrouter') return '/chat/completions'
  if (provider === 'bailian') return mode === 'sync' ? '/multimodal-generation/generation' : '/image-generation/generation'
  return '/images/generations'
}

function buildBody(config, prompt, size, n, extraJson) {
  if (config.provider === 'openrouter') {
    return {
      model: config.model,
      messages: [{ role: 'user', content: prompt }],
      modalities: Array.isArray(extraJson.modalities) ? extraJson.modalities : ['image', 'text'],
      ...extraJson,
    }
  }
  if (config.provider === 'bailian') {
    const { negative_prompt, prompt_extend, watermark, seed, ...rest } = extraJson
    return {
      model: config.model,
      input: { messages: [{ role: 'user', content: [{ text: prompt }] }] },
      parameters: {
        n,
        size,
        ...(prompt_extend !== undefined ? { prompt_extend } : {}),
        ...(watermark !== undefined ? { watermark } : {}),
        ...(negative_prompt !== undefined ? { negative_prompt } : {}),
        ...(seed !== undefined ? { seed } : {}),
        ...rest,
      },
    }
  }
  const body = { model: config.model, prompt, n, ...extraJson }
  if (size) body.size = size
  return body
}

async function fetchJson(url, init, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { ...init, signal: controller.signal })
    const text = await response.text()
    let body = null
    try {
      body = text ? JSON.parse(text) : null
    } catch {
      body = text
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${String(text).slice(0, 800)}`)
    return body
  } finally {
    clearTimeout(timer)
  }
}

function walk(value, visit) {
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit)
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      visit(child, key)
      walk(child, visit)
    }
  }
}

function extractImages(value) {
  const images = []
  walk(value, (node, key) => {
    if (typeof node !== 'string') {
      if (key === 'url' && Array.isArray(node)) {
        for (const item of node) if (typeof item === 'string' && /^https?:\/\//i.test(item)) images.push({ kind: 'url', value: item })
      }
      return
    }
    if ((key === 'url' || key === 'image_url' || key === 'imageUrl') && /^https?:\/\//i.test(node)) images.push({ kind: 'url', value: node })
    if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(node)) {
      const match = /^data:(image\/[a-z0-9.+-]+);base64,(.*)$/i.exec(node)
      images.push({ kind: 'base64', value: match?.[2] || '', mimeType: match?.[1] || 'image/png' })
    }
    if ((key === 'b64_json' || key === 'base64') && node.length > 64) images.push({ kind: 'base64', value: node, mimeType: 'image/png' })
  })
  const seen = new Set()
  return images.filter((image) => {
    const key = `${image.kind}:${image.value.slice(0, 120)}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function extractTaskId(value) {
  const priority = ['task_id', 'taskId', 'job_id', 'jobId', 'request_id', 'requestId', 'id']
  const found = {}
  walk(value, (node, key) => {
    if (priority.includes(key) && typeof node === 'string' && node.trim()) {
      found[key] ??= []
      found[key].push(node)
    }
  })
  for (const key of priority) if (found[key]?.length) return found[key][0]
  return ''
}

async function pollTask(config, taskId) {
  const deadline = Date.now() + DEFAULT_TIMEOUT_MS
  const url = `${config.baseUrl}/tasks/${encodeURIComponent(taskId)}`
  while (Date.now() < deadline) {
    const data = await fetchJson(url, { headers: { authorization: `Bearer ${config.apiKey}` } }, 30_000)
    const images = extractImages(data)
    if (images.length > 0) return images
    let status = ''
    walk(data, (node, key) => {
      if ((key === 'status' || key === 'task_status') && typeof node === 'string') status ||= node.toLowerCase()
    })
    if (['failed', 'error', 'cancelled', 'canceled'].includes(status)) throw new Error(`Image task failed: ${JSON.stringify(data).slice(0, 800)}`)
    await new Promise((resolve) => setTimeout(resolve, DEFAULT_POLL_INTERVAL_MS))
  }
  throw new Error('Image task timed out')
}

function extFromMime(mime = 'image/png') {
  if (mime.includes('jpeg')) return '.jpg'
  if (mime.includes('webp')) return '.webp'
  return '.png'
}

async function materialize(config, images, filename, count) {
  await mkdir(config.outputDir, { recursive: true })
  const files = []
  for (let i = 0; i < Math.min(images.length, count); i++) {
    const image = images[i]
    const buffer = image.kind === 'url'
      ? Buffer.from(await (await fetch(image.value)).arrayBuffer())
      : Buffer.from(image.value, 'base64')
    const parsed = path.parse(filename || `img_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`)
    const suffix = count > 1 ? `_${String(i + 1).padStart(3, '0')}` : ''
    const name = `${parsed.name}${suffix}${parsed.ext || extFromMime(image.mimeType)}`
    const file = path.join(config.outputDir, name)
    await writeFile(file, buffer)
    files.push(file)
  }
  return files
}

async function generateImage(args) {
  const config = configFromEnv()
  if (!config.apiKey) throw new Error('No image API key configured')
  if (!config.model) throw new Error('No image model configured')
  const prompt = String(args.prompt || '').trim()
  if (!prompt) throw new Error('prompt is required')
  const n = Math.max(1, Math.min(4, Number.parseInt(args.n || '1', 10) || 1))
  const normalized = normalizeParams(config.provider, args.size, args.extraJson || {})
  const body = buildBody(config, prompt, normalized.size, n, normalized.extraJson)
  const url = `${config.baseUrl}${submitPath(config.provider, config.mode)}`
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${config.apiKey}` }
  if (config.provider === 'bailian' && config.mode !== 'sync') headers['X-DashScope-Async'] = 'enable'
  const data = await fetchJson(url, { method: 'POST', headers, body: JSON.stringify(body) }, config.mode === 'sync' ? DEFAULT_TIMEOUT_MS : 30_000)
  let images = extractImages(data)
  if (images.length === 0 && (config.mode === 'async' || config.mode === 'auto')) {
    const taskId = extractTaskId(data)
    if (!taskId) throw new Error(`No images or task id found in response: ${JSON.stringify(data).slice(0, 800)}`)
    images = await pollTask(config, taskId)
  }
  if (images.length === 0) throw new Error(`No images found in response: ${JSON.stringify(data).slice(0, 800)}`)
  const files = await materialize(config, images, args.filename || '', n)
  const urls = config.urlPrefix
    ? files.map((file) => `${config.urlPrefix.replace(/\/+$/, '')}/${encodeURIComponent(path.basename(file))}`)
    : files
  return { success: true, provider: `${config.provider}/${config.model}`, mode: config.mode, files, urls }
}

async function handle(request) {
  const id = request.id
  try {
    if (request.method === 'initialize') {
      result(id, { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'spark-image', version: '0.1.0' } })
      return
    }
    if (request.method === 'tools/list') {
      result(id, { tools: [toolDefinition()] })
      return
    }
    if (request.method === 'tools/call') {
      if (request.params?.name !== 'generate_image') throw new Error(`Unknown tool: ${request.params?.name}`)
      const data = await generateImage(request.params?.arguments || {})
      result(id, {
        content: [{ type: 'text', text: `Image generation succeeded: ${data.urls.join(', ')}` }],
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
