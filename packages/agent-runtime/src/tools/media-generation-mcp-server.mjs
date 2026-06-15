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
 *   SPARK_MEDIA_MANIFESTS_JSON 可选；已启用 MediaModelManifest[]，用于 list/describe
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
    name: 'list_models',
    description: 'List configured media models and capabilities available to this Spark media MCP server.',
    inputSchema: {
      type: 'object',
      properties: {
        capability: { type: 'string', description: 'Optional capability filter, e.g. image.generate or video.image_to_video.' },
      },
    },
  },
  {
    name: 'describe_model',
    description: 'Describe one configured media model, including capability parameter schemas and invocation metadata.',
    inputSchema: {
      type: 'object',
      required: ['model'],
      properties: {
        model: { type: 'string', description: 'Manifest id or provider model id.' },
      },
    },
  },
  {
    name: 'generate_image',
    description:
      'Generate an image from a prompt (text-to-image) or with reference images (image-to-image). API keys stay inside this local Spark media MCP server.',
    inputSchema: {
      type: 'object',
      required: ['prompt'],
      properties: {
        prompt: { type: 'string', description: 'Detailed image prompt.' },
        model: { type: 'string', description: 'Optional manifest id or provider model id from list_models.' },
        size: { type: 'string', description: 'Size or aspect ratio (e.g. 1024x1024, 16:9, portrait).' },
        resolution: { type: 'string', enum: ['0.5K', '1K', '2K', '3K', '4K', '1k', '2k', '4k'], description: 'Provider-specific image resolution.' },
        aspectRatio: { type: 'string', enum: ['auto', '1:1', '4:3', '3:4', '3:2', '2:3', '16:9', '9:16', '21:9'] },
        n: { type: 'integer', minimum: 1, maximum: 4, description: 'Number of images. Default 1.' },
        negative_prompt: { type: 'string' },
        seed: { type: 'integer' },
        output_format: { type: 'string', enum: ['png', 'jpeg', 'webp', 'url', 'b64_json', 'base64'] },
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
        model: { type: 'string', description: 'Optional manifest id or provider model id from list_models.' },
        mask: { type: 'string' },
        size: { type: 'string' },
        resolution: { type: 'string' },
        aspectRatio: { type: 'string' },
        n: { type: 'integer', minimum: 1, maximum: 4 },
        negative_prompt: { type: 'string' },
        seed: { type: 'integer' },
        output_format: { type: 'string' },
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
        model: { type: 'string', description: 'Optional manifest id or provider model id from list_models.' },
        voice: { type: 'string', description: 'Voice id (provider-specific).' },
        format: { type: 'string', description: 'mp3, wav, opus, aac, flac, pcm.' },
        output_format: { type: 'string', enum: ['url', 'hex'], description: 'Provider-specific output container, e.g. MiniMax url/hex.' },
        speed: { type: 'number' },
        language_boost: { type: 'string' },
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
        model: { type: 'string', description: 'Optional manifest id or provider model id from list_models.' },
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
        model: { type: 'string', description: 'Optional manifest id or provider model id from list_models.' },
        inputImages: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional reference image urls / data urls for image-to-video.',
        },
        aspectRatio: { type: 'string', enum: ['auto', 'adaptive', '1:1', '4:3', '3:4', '3:2', '2:3', '16:9', '9:16', '21:9'] },
        durationSeconds: { type: 'integer', minimum: 1, maximum: 120 },
        resolution: { type: 'string', enum: ['480p', '720p', '1080p', '768P', '1080P'] },
        mode: { type: 'string', enum: ['standard', 'professional'] },
        negative_prompt: { type: 'string' },
        seed: { type: 'integer' },
        generate_audio: { type: 'boolean' },
        return_last_frame: { type: 'boolean' },
        prompt_optimizer: { type: 'boolean' },
        fast_pretreatment: { type: 'boolean' },
        aigc_watermark: { type: 'boolean' },
        filename: { type: 'string' },
        extraJson: { type: 'object', additionalProperties: true },
      },
    },
  },
  {
    name: 'get_task',
    description: 'Inspect a media task created by this Spark media MCP process.',
    inputSchema: {
      type: 'object',
      required: ['taskId'],
      properties: {
        taskId: { type: 'string', description: 'Task id returned by a generate/edit/transcribe tool.' },
      },
    },
  },
  {
    name: 'cancel_task',
    description: 'Cancel a pending/running media task when supported by this Spark media MCP process.',
    inputSchema: {
      type: 'object',
      required: ['taskId'],
      properties: {
        taskId: { type: 'string', description: 'Task id returned by a generate/edit/transcribe tool.' },
      },
    },
  },
]

const TASKS = new Map()

function createTaskRecord(toolName, args, config) {
  const taskId = `media_task_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  const now = new Date().toISOString()
  const record = {
    taskId,
    toolName,
    status: 'running',
    provider: config.provider,
    model: config.model,
    prompt: typeof args.prompt === 'string' ? args.prompt : typeof args.text === 'string' ? args.text : undefined,
    createdAt: now,
    updatedAt: now,
  }
  TASKS.set(taskId, record)
  return record
}

function completeTaskRecord(task, data) {
  const now = new Date().toISOString()
  const record = {
    ...task,
    status: 'succeeded',
    mode: data.mode || null,
    files: Array.isArray(data.files) ? data.files : [],
    requestId: data.requestId || null,
    text: data.text || undefined,
    updatedAt: now,
    completedAt: now,
  }
  TASKS.set(task.taskId, record)
  return record
}

function failTaskRecord(task, err) {
  const now = new Date().toISOString()
  const record = {
    ...task,
    status: 'failed',
    error: {
      code: 'tool_error',
      message: err instanceof Error ? err.message : String(err),
    },
    updatedAt: now,
    completedAt: now,
  }
  TASKS.set(task.taskId, record)
  return record
}

function handleGetTask(args) {
  const taskId = String(args.taskId || '').trim()
  if (!taskId) throw new Error('taskId is required')
  const task = TASKS.get(taskId)
  if (!task) throw new Error(`Unknown media task: ${taskId}`)
  return { success: true, task }
}

function handleCancelTask(args) {
  const taskId = String(args.taskId || '').trim()
  if (!taskId) throw new Error('taskId is required')
  const task = TASKS.get(taskId)
  if (!task) throw new Error(`Unknown media task: ${taskId}`)
  if (task.status !== 'pending' && task.status !== 'running') {
    return { success: true, cancelled: false, task, message: `Task is already ${task.status}` }
  }
  const now = new Date().toISOString()
  const cancelled = { ...task, status: 'cancelled', updatedAt: now, completedAt: now }
  TASKS.set(taskId, cancelled)
  return { success: true, cancelled: true, task: cancelled }
}

function configFromEnv() {
  let mediaDefaults = {}
  let manifests = []
  try {
    mediaDefaults = env.SPARK_MEDIA_DEFAULTS_JSON ? JSON.parse(env.SPARK_MEDIA_DEFAULTS_JSON) : {}
  } catch {
    mediaDefaults = {}
  }
  try {
    const parsed = env.SPARK_MEDIA_MANIFESTS_JSON ? JSON.parse(env.SPARK_MEDIA_MANIFESTS_JSON) : []
    manifests = Array.isArray(parsed) ? parsed.filter(isManifestLike) : []
  } catch {
    manifests = []
  }
  return {
    apiKey: env.SPARK_MEDIA_API_KEY || '',
    provider: (env.SPARK_MEDIA_PROVIDER || 'openai-compatible').trim().toLowerCase(),
    model: env.SPARK_MEDIA_MODEL || '',
    mode: env.SPARK_MEDIA_API_TYPE || 'auto',
    baseUrl: (env.SPARK_MEDIA_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, ''),
    outputDir: env.SPARK_MEDIA_OUTPUT_DIR || path.join(process.cwd(), '.spark-artifacts', 'media'),
    mediaDefaults,
    manifests,
  }
}

function isManifestLike(value) {
  return value && typeof value === 'object' &&
    typeof value.id === 'string' &&
    typeof value.modelId === 'string' &&
    Array.isArray(value.capabilities)
}

function fallbackManifest(config) {
  if (!config.model) return null
  const capabilities = []
  if (config.provider.includes('xai') || config.provider.includes('apimart') || config.provider.includes('openai')) {
    capabilities.push({ id: 'image.generate', label: '文生图', paramSchema: {}, input: { required: ['prompt'] }, output: { types: ['image'] } })
  }
  return {
    id: `${config.provider}:${config.model}`,
    providerKind: config.provider,
    modelId: config.model,
    displayName: config.model,
    domains: ['image', 'video', 'audio'],
    capabilities,
    invocation: { mode: config.mode === 'async' ? 'async_polling' : 'sync', endpoint: config.baseUrl, method: 'POST', contentType: 'json', requestTemplate: {}, response: { kind: 'url', jsonPaths: ['data[].url'], download: true } },
    docs: { sourceUrls: [] },
  }
}

function manifestCapabilities(manifest) {
  return [...new Set((manifest.capabilities || []).map((cap) => cap?.id).filter(Boolean))]
}

function handleListModels(config, args) {
  const manifests = config.manifests.length > 0 ? config.manifests : [fallbackManifest(config)].filter(Boolean)
  const capability = typeof args.capability === 'string' ? args.capability : ''
  const models = manifests
    .filter((manifest) => !capability || manifestCapabilities(manifest).includes(capability))
    .map((manifest) => ({
      id: manifest.id,
      providerKind: manifest.providerKind,
      modelId: manifest.modelId,
      displayName: manifest.displayName,
      domains: manifest.domains || [],
      capabilities: manifestCapabilities(manifest),
      docs: manifest.docs || { sourceUrls: [] },
    }))
  return { success: true, models }
}

function handleDescribeModel(config, args) {
  const key = String(args.model || '').trim()
  if (!key) throw new Error('model is required')
  const manifests = config.manifests.length > 0 ? config.manifests : [fallbackManifest(config)].filter(Boolean)
  const manifest = manifests.find((item) => item.id === key || item.modelId === key)
  if (!manifest) throw new Error(`Unknown media model: ${key}`)
  return { success: true, model: manifest }
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

// ── manifest-driven executor ──────────────────────────────────────────────

const TOOL_CAPABILITY_CANDIDATES = {
  generate_image: (args) => Array.isArray(args.inputImages) && args.inputImages.length > 0
    ? ['image.image_to_image', 'image.edit', 'image.generate']
    : ['image.generate'],
  edit_image: () => ['image.edit', 'image.compose', 'image.image_to_image'],
  generate_audio: () => ['audio.speech'],
  transcribe_audio: () => ['audio.transcription'],
  generate_video: (args) => Array.isArray(args.inputImages) && args.inputImages.length > 0
    ? ['video.image_to_video', 'video.generate']
    : ['video.generate'],
}

function resolveManifestForTool(config, toolName, args) {
  if (!Array.isArray(config.manifests) || config.manifests.length === 0) return null
  const candidates = TOOL_CAPABILITY_CANDIDATES[toolName]?.(args) || []
  if (candidates.length === 0) return null
  const requestedModel = typeof args.model === 'string' ? args.model.trim() : ''
  const manifests = requestedModel
    ? config.manifests.filter((manifest) =>
      manifest.id === requestedModel ||
      manifest.modelId === requestedModel ||
      manifest.displayName === requestedModel)
    : config.manifests.filter((manifest) => !config.model || manifest.modelId === config.model || manifest.id === config.model)
  const pool = manifests.length > 0 ? manifests : config.manifests
  for (const capabilityId of candidates) {
    for (const manifest of pool) {
      const capability = (manifest.capabilities || []).find((item) => item?.id === capabilityId)
      if (capability) return { manifest, capability, capabilityId }
    }
  }
  return null
}

function argsToModelParams(toolName, args) {
  const params = { ...(args.extraJson && typeof args.extraJson === 'object' ? args.extraJson : {}) }
  for (const key of [
    'size',
    'n',
    'mask',
    'voice',
    'format',
    'output_format',
    'speed',
    'language',
    'language_boost',
    'responseFormat',
    'aspectRatio',
    'resolution',
    'durationSeconds',
    'mode',
    'negative_prompt',
    'seed',
    'generate_audio',
    'return_last_frame',
    'prompt_optimizer',
    'fast_pretreatment',
    'aigc_watermark',
    'filename',
  ]) {
    if (args[key] !== undefined && args[key] !== null && args[key] !== '') params[key] = args[key]
  }
  if (toolName === 'transcribe_audio' && args.responseFormat && params.response_format == null) {
    params.response_format = args.responseFormat
  }
  return params
}

function buildManifestVariables(toolName, args, manifest, capability, modelId) {
  const params = {
    ...(capability.defaults || {}),
    ...argsToModelParams(toolName, args),
  }
  const providerParams = {}
  for (const [key, value] of Object.entries(params)) {
    const providerKey = capability.aliases?.[key] || key
    providerParams[providerKey] = value
  }
  const inputImages = Array.isArray(args.inputImages) ? args.inputImages.filter((item) => typeof item === 'string') : []
  const imageUrls = Array.isArray(args.imageUrls) ? args.imageUrls.filter((item) => typeof item === 'string') : []
  const imageFiles = Array.isArray(args.imageFiles) ? args.imageFiles.filter((item) => typeof item === 'string') : []
  const images = [...inputImages, ...imageUrls, ...imageFiles]
  const audio = typeof args.audioUrl === 'string' && args.audioUrl ? args.audioUrl : typeof args.audioFile === 'string' ? args.audioFile : ''
  const prompt = typeof args.prompt === 'string' ? args.prompt : ''
  const text = typeof args.text === 'string' ? args.text : prompt
  return {
    modelId,
    prompt,
    text,
    audio,
    audioUrl: args.audioUrl || '',
    audioFile: args.audioFile || '',
    image: images[0] || '',
    images,
    params,
    providerParams,
    ...params,
    manifestId: manifest.id,
  }
}

async function handleManifestTool(config, toolName, args, match) {
  if (!config.apiKey) throw new Error('No media API key configured')
  const { manifest, capability } = match
  const requestedModel = typeof args.model === 'string' ? args.model.trim() : ''
  const modelId = requestedModel && requestedModel !== manifest.id
    ? requestedModel
    : manifest.modelId || config.model
  if (!modelId) throw new Error('No media model configured')
  if (manifest.invocation?.contentType !== 'json') return null

  const variables = buildManifestVariables(toolName, args, manifest, capability, modelId)
  const endpoint = renderTemplateString(manifest.invocation.endpoint || '', variables)
  const url = resolveManifestUrl(config.baseUrl, endpoint)
  const requestBody = mergeProviderParams(
    renderTemplate(manifest.invocation.requestTemplate || {}, variables),
    variables.providerParams,
  )
  const responseSpec = manifest.invocation.response || { kind: 'url', jsonPaths: ['data[].url'], download: true }
  let raw = await fetchJson(
    url,
    {
      method: manifest.invocation.method || 'POST',
      headers: authHeaders(config),
      body: JSON.stringify(requestBody),
    },
    60_000,
    responseSpec.kind === 'binary_response',
  )
  let mode = manifest.invocation.mode === 'async_polling' ? 'async' : 'sync'
  let requestId = ''

  if (responseSpec.kind === 'task_poll') {
    const immediate = firstStringAtPaths(raw, responseSpec.resultPaths || [])
    if (!immediate) {
      const taskId = firstStringAtPaths(raw, responseSpec.taskIdPaths || [])
      if (!taskId) throw new Error(`No task id in response: ${JSON.stringify(raw).slice(0, 800)}`)
      requestId = taskId
      mode = 'async'
      raw = await pollManifestTask(config, manifest, responseSpec, taskId)
    }
  }

  const materialized = await materializeManifestResult(config, responseSpec, raw, capability, args)
  return {
    success: true,
    provider: `${manifest.providerKind}/${modelId}`,
    manifestId: manifest.id,
    model: modelId,
    mode,
    ...(requestId ? { requestId } : {}),
    ...materialized,
  }
}

async function pollManifestTask(config, manifest, responseSpec, taskId) {
  const polling = manifest.invocation?.polling || {}
  const pollUrl = resolveManifestUrl(
    config.baseUrl,
    renderTemplateString(responseSpec.statusEndpoint || '', { taskId }),
  )
  const deadline = Date.now() + (config.mediaDefaults?.polling?.timeoutMs || polling.timeoutMs || 600_000)
  let interval = Math.max(1, config.mediaDefaults?.polling?.intervalMs || polling.intervalMs || 5000)
  while (Date.now() < deadline) {
    const data = await fetchJson(pollUrl, { headers: authHeaders(config) }, 30_000)
    if (firstStringAtPaths(data, responseSpec.resultPaths || [])) return data
    const status = String(extractStatus(data) || '').toLowerCase()
    const mapped = polling.statusMap?.[status]
    if (mapped === 'succeeded') return data
    if (mapped === 'failed' || mapped === 'cancelled') throw new Error(`Task failed: ${JSON.stringify(data).slice(0, 800)}`)
    if (FAILED_STATUSES.includes(status)) throw new Error(`Task failed: ${JSON.stringify(data).slice(0, 800)}`)
    await new Promise((resolve) => setTimeout(resolve, interval))
    interval = Math.min(Math.max(interval * 1.3, interval), 15_000)
  }
  throw new Error('Task timed out')
}

async function materializeManifestResult(config, responseSpec, raw, capability, args) {
  const outputKind = primaryOutputKind(capability)
  const filename = args.filename || ''
  if (responseSpec.kind === 'binary_response') {
    if (!Buffer.isBuffer(raw)) throw new Error('binary_response did not return binary data')
    if (outputKind === 'text') {
      const text = raw.toString('utf8')
      return { files: [await writeTextAsset(config, text, filename)], text }
    }
    if (outputKind === 'image') {
      const image = { kind: 'base64', value: raw.toString('base64'), mimeType: 'image/png' }
      return { files: [await materializeImage(config, image, filename, 0, 1)] }
    }
    const dataUrl = `data:${defaultMime(outputKind, args)};base64,${raw.toString('base64')}`
    return { files: [await downloadMedia(config, dataUrl, outputKind === 'audio' ? 'audio' : 'video', filename)] }
  }
  const paths = responseSpec.kind === 'task_poll'
    ? responseSpec.resultPaths || []
    : responseSpec.jsonPaths || []
  const values = stringsAtPaths(raw, paths)
  if (values.length === 0) throw new Error('No media artifacts in manifest response')
  const files = []
  let text = ''
  for (let i = 0; i < values.length; i++) {
    const value = values[i]
    if (outputKind === 'text') {
      text = text ? `${text}\n${value}` : value
      files.push(await writeTextAsset(config, value, filename))
    } else if (outputKind === 'image') {
      const image = isHttpUrl(value)
        ? { kind: 'url', value }
        : { kind: 'base64', value: normalizeBase64(value), mimeType: mimeFromDataUrl(value) || 'image/png' }
      files.push(await materializeImage(config, image, filename, i, values.length))
    } else {
      const source = isHttpUrl(value) ? value : `data:${defaultMime(outputKind, args)};base64,${normalizeBase64(value)}`
      files.push(await downloadMedia(config, source, outputKind === 'audio' ? 'audio' : 'video', filename))
    }
  }
  return { files, ...(text ? { text } : {}) }
}

function renderTemplate(value, variables) {
  if (typeof value === 'string') return renderTemplateStringOrValue(value, variables)
  if (Array.isArray(value)) return value.map((item) => renderTemplate(item, variables)).filter((item) => item !== undefined)
  if (isPlainRecord(value)) {
    const rendered = {}
    for (const [key, child] of Object.entries(value)) {
      const next = renderTemplate(child, variables)
      if (next !== undefined && next !== '') rendered[key] = next
    }
    return rendered
  }
  return value
}

function renderTemplateStringOrValue(template, variables) {
  const exact = template.match(/^{{\s*([^}]+?)\s*}}$/)
  if (exact) return getPath(variables, exact[1]?.trim() || '')
  return renderTemplateString(template, variables)
}

function renderTemplateString(template, variables) {
  return String(template).replace(/{{\s*([^}]+?)\s*}}/g, (_match, key) => {
    const value = getPath(variables, key.trim())
    return value == null ? '' : String(value)
  })
}

function mergeProviderParams(body, providerParams) {
  if (!isPlainRecord(body) || !isPlainRecord(providerParams)) return body
  const next = { ...body }
  for (const [key, value] of Object.entries(providerParams)) {
    if (value !== undefined && value !== null && value !== '') next[key] = value
  }
  return next
}

function resolveManifestUrl(baseUrl, endpoint) {
  if (/^https?:\/\//i.test(endpoint)) return endpoint
  const cleanBase = String(baseUrl || '').replace(/\/+$/, '')
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`
  return `${cleanBase}${cleanEndpoint}`
}

function stringsAtPaths(data, paths) {
  const values = (paths || []).flatMap((path) => valuesAtPath(data, path))
  return [...new Set(values.filter((value) => typeof value === 'string' && value.length > 0))]
}

function firstStringAtPaths(data, paths) {
  return stringsAtPaths(data, paths)[0] || ''
}

function valuesAtPath(root, path) {
  const parts = String(path || '').split('.').filter(Boolean)
  let current = [root]
  for (const part of parts) {
    const isArray = part.endsWith('[]')
    const key = isArray ? part.slice(0, -2) : part
    const next = []
    for (const item of current) {
      const value = key ? getProperty(item, key) : item
      if (isArray) {
        if (Array.isArray(value)) next.push(...value)
      } else {
        next.push(value)
      }
    }
    current = next
  }
  return current.filter((value) => value !== undefined && value !== null)
}

function getPath(root, path) {
  return String(path || '').split('.').filter(Boolean).reduce((value, key) => getProperty(value, key), root)
}

function getProperty(value, key) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  return value[key]
}

function isPlainRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function primaryOutputKind(capability) {
  const first = capability?.output?.types?.[0]
  if (first === 'audio' || first === 'video' || first === 'text') return first
  return 'image'
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(value)
}

function normalizeBase64(value) {
  const raw = String(value || '')
  const comma = raw.indexOf(',')
  return raw.startsWith('data:') && comma >= 0 ? raw.slice(comma + 1) : raw
}

function mimeFromDataUrl(value) {
  const match = String(value || '').match(/^data:([^;,]+)[;,]/)
  return match?.[1]
}

function defaultMime(kind, args) {
  if (kind === 'audio') {
    const format = String(args.format || args.extraJson?.format || 'mp3').toLowerCase()
    if (format === 'wav') return 'audio/wav'
    if (format === 'opus') return 'audio/opus'
    if (format === 'aac') return 'audio/aac'
    if (format === 'flac') return 'audio/flac'
    if (format === 'pcm') return 'audio/pcm'
    return 'audio/mpeg'
  }
  if (kind === 'image') return 'image/png'
  return 'video/mp4'
}

// ── tool handlers ──────────────────────────────────────────────────────────

async function handleGenerateImage(config, args) {
  if (!config.apiKey) throw new Error('No media API key configured')
  const prompt = String(args.prompt || '').trim()
  if (!prompt) throw new Error('prompt is required')
  const manifestMatch = resolveManifestForTool(config, 'generate_image', args)
  if (manifestMatch) return handleManifestTool(config, 'generate_image', args, manifestMatch)
  if (!config.model) throw new Error('No media model configured')
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
  const manifestMatch = resolveManifestForTool(config, 'edit_image', args)
  if (manifestMatch) return handleManifestTool(config, 'edit_image', args, manifestMatch)
  const imageUrls = Array.isArray(args.imageUrls) ? args.imageUrls : []
  const imageFiles = Array.isArray(args.imageFiles) ? args.imageFiles : []
  const refs = [...imageUrls, ...imageFiles].filter((s) => typeof s === 'string' && s.length > 0)
  // xAI does NOT support the OpenAI-style /images/edits endpoint (multipart is rejected,
  // and a JSON body there fails with HTTP 422 "expected struct ImageUrl"). Image editing
  // on xAI reuses /images/generations with image_url (single) / image_urls (up to 3).
  // See https://docs.x.ai/docs/guides/image-generations.
  if (config.provider === 'xai') {
    if (refs.length === 0) throw new Error('xAI image edit requires input image(s)')
    const editRefs = refs.slice(0, 3)
    const body = {
      model: config.model,
      prompt,
      ...(editRefs.length === 1 ? { image_url: editRefs[0] } : { image_urls: editRefs }),
      ...(args.extraJson || {}),
    }
    const data = await fetchJson(`${config.baseUrl}/images/generations`, { method: 'POST', headers: authHeaders(config), body: JSON.stringify(body) }, 120_000)
    const images = extractImages(data)
    if (images.length === 0) throw new Error(`No images in xAI edit response: ${JSON.stringify(data).slice(0, 800)}`)
    const files = []
    for (let i = 0; i < images.length; i++) {
      files.push(await materializeImage(config, images[i], args.filename || '', i, images.length))
    }
    return { success: true, provider: `${config.provider}/${config.model}`, mode: 'sync', files }
  }
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
  const manifestMatch = resolveManifestForTool(config, 'generate_audio', args)
  if (manifestMatch) return handleManifestTool(config, 'generate_audio', args, manifestMatch)
  if (!config.model) throw new Error('No media model configured')
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
  const manifestMatch = resolveManifestForTool(config, 'transcribe_audio', args)
  if (manifestMatch) return handleManifestTool(config, 'transcribe_audio', args, manifestMatch)
  if (!config.model) throw new Error('No media model configured')
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
  const manifestMatch = resolveManifestForTool(config, 'generate_video', args)
  if (manifestMatch) return handleManifestTool(config, 'generate_video', args, manifestMatch)
  if (!config.model) throw new Error('No media model configured')
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
      let task = null
      switch (name) {
        case 'list_models': data = handleListModels(config, args); break
        case 'describe_model': data = handleDescribeModel(config, args); break
        case 'get_task': data = handleGetTask(args); break
        case 'cancel_task': data = handleCancelTask(args); break
        case 'generate_image':
          task = createTaskRecord(name, args, config)
          try { data = await handleGenerateImage(config, args); data.taskId = task.taskId; data.task = completeTaskRecord(task, data) } catch (err) { failTaskRecord(task, err); throw err }
          break
        case 'edit_image':
          task = createTaskRecord(name, args, config)
          try { data = await handleEditImage(config, args); data.taskId = task.taskId; data.task = completeTaskRecord(task, data) } catch (err) { failTaskRecord(task, err); throw err }
          break
        case 'generate_audio':
          task = createTaskRecord(name, args, config)
          try { data = await handleGenerateAudio(config, args); data.taskId = task.taskId; data.task = completeTaskRecord(task, data) } catch (err) { failTaskRecord(task, err); throw err }
          break
        case 'transcribe_audio':
          task = createTaskRecord(name, args, config)
          try { data = await handleTranscribeAudio(config, args); data.taskId = task.taskId; data.task = completeTaskRecord(task, data) } catch (err) { failTaskRecord(task, err); throw err }
          break
        case 'generate_video':
          task = createTaskRecord(name, args, config)
          try { data = await handleGenerateVideo(config, args); data.taskId = task.taskId; data.task = completeTaskRecord(task, data) } catch (err) { failTaskRecord(task, err); throw err }
          break
        default: throw new Error(`Unknown tool: ${name}`)
      }
      const files = Array.isArray(data.files) ? data.files : []
      result(id, {
        content: [{ type: 'text', text: `${name} succeeded${files.length > 0 ? `: ${files.join(', ')}` : ''}` }],
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
