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
 *   generate_video     — 文生视频 / 图生视频 / 视频编辑（prompt + 可选 inputImages/inputVideos）
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
// Contract V2 裁剪：MCP 子进程独立纯 JS 实现，与 TS 编译器同语义。
// 多余字段不会到达 provider；describe_model 也能告诉 agent 字段约束。
import { pruneModelParamsByManifest } from '../services/media/media-request-compiler.mjs'

const env = process.env

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}
function result(id, value) {
  send({ jsonrpc: '2.0', id, result: value })
}
function error(id, code, message, data) {
  const payload = { jsonrpc: '2.0', id, error: { code, message } }
  if (data !== undefined) payload.error.data = data
  send(payload)
}

const DESCRIBE_MODEL_HINT =
  'Provider/model-specific field. Call describe_model first for the selected model/capability to inspect supported values; unsupported values are pruned at runtime by the manifest contract.'

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
        size: { type: 'string', description: `Size, pixel dimensions, or aspect ratio (e.g. 1024x1024, 16:9, portrait). ${DESCRIBE_MODEL_HINT}` },
        resolution: { type: 'string', description: `Provider-specific image resolution. ${DESCRIBE_MODEL_HINT}` },
        aspectRatio: { type: 'string', description: `Provider-specific image aspect ratio. ${DESCRIBE_MODEL_HINT}` },
        n: { type: 'integer', minimum: 1, maximum: 4, description: 'Number of images. Default 1.' },
        negative_prompt: { type: 'string' },
        seed: { type: 'integer' },
        output_format: { type: 'string', description: `Provider-specific output format or response container. ${DESCRIBE_MODEL_HINT}` },
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
    description: 'Generate or edit a video from a prompt, first/last frames, reference images, or an input video.',
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
        firstFrame: { type: 'string', description: 'Optional first-frame image url / data url.' },
        lastFrame: { type: 'string', description: 'Optional last-frame image url / data url.' },
        referenceImages: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional reference image urls / data urls for video edit.',
        },
        inputVideos: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional input video urls / file paths for video edit.',
        },
        videoUrl: { type: 'string', description: 'Optional remote input video url for video edit.' },
        videoFile: { type: 'string', description: 'Optional local input video file path for video edit.' },
        capability: { type: 'string', description: `Capability id such as video.generate, video.image_to_video, video.edit, or video.extend. ${DESCRIBE_MODEL_HINT}` },
        videoMode: { type: 'string', description: 'Loose routing hint: generate, image_to_video, reference_to_video, edit, or extend.' },
        aspectRatio: { type: 'string', description: `Provider-specific video aspect ratio. ${DESCRIBE_MODEL_HINT}` },
        durationSeconds: { type: 'integer', minimum: 1, maximum: 120 },
        resolution: { type: 'string', description: `Provider-specific video resolution. ${DESCRIBE_MODEL_HINT}` },
        mode: { type: 'string', description: `Provider-specific generation mode. ${DESCRIBE_MODEL_HINT}` },
        editStrength: { type: 'number', minimum: 0, maximum: 1 },
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
  let mediaDefaults
  let manifests
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
  const capabilities = (manifest.capabilities || []).map((cap) => {
    const summary = summarizeParamPolicy(cap)
    return {
      ...cap,
      ...(summary ? { paramPolicySummary: summary } : {}),
      // 暴露 capability 接受的输入角色（首帧/尾帧/参考图/输入视频/参考视频/参考音频）
      // + 未指定 role 时的默认分配规则，让 skill/MCP 调用方在传图前明确角色语义。
      rolePolicy: inferRolePolicyMjs(cap),
    }
  })
  return {
    success: true,
    model: { ...manifest, capabilities },
    errorContract: summarizeErrorContract(manifest),
  }
}

const FAILED_STATUSES = ['failed', 'error', 'expired', 'cancelled', 'canceled']

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

// 收集 args 中的输入文件类型，用于 paramPolicy.transforms.drop_when_input_kind
// （如 image.edit 模式下丢弃 generate_audio / return_last_frame）。
function collectInputFileKinds(args) {
  if (!args || typeof args !== 'object') return []
  const files = []
  const hasImageInput =
    Array.isArray(args.imageUrls) || Array.isArray(args.imageFiles) || Array.isArray(args.inputImages) || Array.isArray(args.referenceImages)
  if (hasImageInput) files.push({ type: 'image' })
  if (args.firstFrame) files.push({ type: 'image', role: 'first_frame' })
  if (args.lastFrame) files.push({ type: 'image', role: 'last_frame' })
  const hasVideoInput = args.videoUrl || args.videoFile || (Array.isArray(args.inputVideos) && args.inputVideos.length > 0)
  if (hasVideoInput) files.push({ type: 'video' })
  if (args.audioUrl || args.audioFile) files.push({ type: 'audio' })
  if (args.mask) files.push({ type: 'mask' })
  if (typeof args.text === 'string' && args.text.trim()) files.push({ type: 'text' })
  return files
}

// 从 fetchJson 抛出的 Error.message（"HTTP <code>: <body>"）解析 status 与原始文本。
function parseHttpError(err) {
  const message = err instanceof Error ? err.message : String(err)
  const match = /^HTTP (\d+)(?::\s*([\s\S]*))?$/.exec(message)
  if (!match) return { statusCode: undefined, rawText: message }
  const statusCode = Number.parseInt(match[1], 10)
  const rawText = match[2] ?? ''
  let body
  try { body = rawText ? JSON.parse(rawText) : null } catch { body = rawText }
  return { statusCode, rawText, body }
}

// 按 manifest.error 契约归一化 provider 错误响应。MCP 子进程不能 import TS
// normalizer，这里实现与 media-error-normalizer.ts 对齐的子集（codePaths /
// messagePaths / paramNamePaths / mappings / retryableCodes），其余兜底路径
// 由 fetchJson 的 message 携带。
function normalizeMcpMediaError(manifest, err) {
  const contract = manifest?.error
  const { statusCode, rawText, body } = parseHttpError(err)
  const codePaths = contract?.codePaths || []
  const messagePaths = contract?.messagePaths || []
  const requestIdPaths = contract?.requestIdPaths || []
  const paramNamePaths = contract?.paramNamePaths || []

  const providerCode = pickStringPath(body, codePaths)
  const providerMessage = pickStringPath(body, messagePaths)
  const requestId = pickStringPath(body, requestIdPaths)
  const paramName = pickStringPath(body, paramNamePaths)

  const mapped = providerCode ? contract?.mappings?.[providerCode] : undefined
  const retryable = providerCode ? Boolean(contract?.retryableCodes?.includes(providerCode)) : false

  let code = mapped
  if (!code) {
    if (statusCode === 401 || statusCode === 403) code = 'auth_failed'
    else if (statusCode === 429) code = 'rate_limited'
    else if (statusCode === 402) code = 'quota_exceeded'
    else code = 'provider_http_error'
  }

  const message = providerMessage || rawText || (err instanceof Error ? err.message : String(err))

  return {
    code,
    providerCode,
    message: String(message).slice(0, 400),
    ...(requestId ? { requestId } : {}),
    ...(paramName ? { paramName } : {}),
    retryable,
    rawSnippet: String(rawText).slice(0, 800),
  }
}

function pickStringPath(value, paths) {
  if (!Array.isArray(paths) || paths.length === 0) return undefined
  for (const path of paths) {
    const found = readPath(value, path)
    if (typeof found === 'string' && found.length > 0) return found
  }
  return undefined
}

function readPath(value, path) {
  if (value == null) return undefined
  const parts = String(path).split(/[.[\]]+/).filter(Boolean)
  let cursor = value
  for (const part of parts) {
    if (cursor == null) return undefined
    cursor = cursor[part]
  }
  return cursor
}

// describe_model 输出 helper：把 capability.paramPolicy 折叠为 agent 友好提示。
function summarizeParamPolicy(capability) {
  const policy = capability?.paramPolicy
  if (!policy) return undefined
  const summary = {}
  if (typeof policy.strict === 'boolean') summary.strict = policy.strict
  if (policy.passthrough) {
    summary.passthrough = {
      enabled: Boolean(policy.passthrough.enabled),
      ...(Array.isArray(policy.passthrough.allow) && policy.passthrough.allow.length > 0
        ? { allow: policy.passthrough.allow }
        : {}),
      ...(Array.isArray(policy.passthrough.deny) && policy.passthrough.deny.length > 0
        ? { deny: policy.passthrough.deny }
        : {}),
    }
  }
  if (Array.isArray(policy.forbidden) && policy.forbidden.length > 0) {
    summary.forbidden = policy.forbidden.map((entry) => ({ name: entry.name, reason: entry.reason }))
  }
  if (Array.isArray(policy.transforms) && policy.transforms.length > 0) {
    summary.transforms = policy.transforms.map((rule) => {
      if (rule.kind === 'rename') return { kind: 'rename', from: rule.from, to: rule.to }
      if (rule.kind === 'map_value') return { kind: 'map_value', field: rule.field }
      if (rule.kind === 'ratio_size_to_aspect') return { kind: 'ratio_size_to_aspect', from: rule.from, to: rule.to }
      if (rule.kind === 'drop_when_input_kind') return { kind: 'drop_when_input_kind', field: rule.field, inputKinds: rule.inputKinds }
      return { kind: rule.kind }
    })
  }
  return Object.keys(summary).length > 0 ? summary : undefined
}

/**
 * 推断 capability 支持的输入角色（首帧/尾帧/参考图/输入视频/参考视频/参考音频）。
 * 与 packages/protocol/src/media-config.ts 的 inferRolePolicy 保持同步——
 * describe_model 据此向 agent 暴露结构化角色规则，让 skill/MCP 调用方在传图前知道
 * 当前 capability 接受哪些角色、未指定 role 时的默认分配。
 */
function inferRolePolicyMjs(capability) {
  const req = Array.isArray(capability?.input?.required) ? capability.input.required : []
  const hasImage = req.includes('image') || req.includes('images')
  const maxImages = typeof capability?.input?.maxImages === 'number' ? capability.input.maxImages : 0
  switch (capability?.id) {
    case 'video.image_to_video':
      return {
        imageRoles: [
          'first_frame',
          ...(maxImages >= 2 ? ['last_frame'] : []),
          ...(maxImages > 2 ? ['reference_image'] : []),
        ],
        defaultRoleAssignment: 'first_then_last_then_reference',
      }
    case 'video.edit':
      return hasImage
        ? {
            imageRoles: ['first_frame', 'last_frame', 'reference_image'],
            videoRoles: ['input_video'],
            defaultRoleAssignment: 'first_then_last_then_reference',
          }
        : { videoRoles: ['input_video'], defaultRoleAssignment: 'none' }
    case 'video.extend':
      return { videoRoles: ['input_video'], defaultRoleAssignment: 'none' }
    case 'video.reference_to_video':
      return { imageRoles: ['reference_image'], defaultRoleAssignment: 'all_reference' }
    case 'video.generate':
      if (hasImage || maxImages > 0) {
        return {
          imageRoles: ['reference_image'],
          videoRoles: ['reference_video'],
          audioRoles: ['reference_audio'],
          defaultRoleAssignment: 'all_reference',
        }
      }
      return { defaultRoleAssignment: 'none' }
    case 'image.edit':
    case 'image.image_to_image':
    case 'image.compose':
    case 'image.variations':
      return { imageRoles: ['reference_image'], defaultRoleAssignment: 'all_reference' }
    default:
      return { defaultRoleAssignment: 'none' }
  }
}

function summarizeErrorContract(manifest) {
  const contract = manifest?.error
  if (!contract) return undefined
  const summary = {}
  if (Array.isArray(contract.codePaths) && contract.codePaths.length > 0) summary.codePaths = contract.codePaths
  if (Array.isArray(contract.messagePaths) && contract.messagePaths.length > 0) summary.messagePaths = contract.messagePaths
  if (Array.isArray(contract.paramNamePaths) && contract.paramNamePaths.length > 0) summary.paramNamePaths = contract.paramNamePaths
  if (contract.mappings && typeof contract.mappings === 'object') summary.mappings = contract.mappings
  if (Array.isArray(contract.retryableCodes) && contract.retryableCodes.length > 0) summary.retryableCodes = contract.retryableCodes
  return Object.keys(summary).length > 0 ? summary : undefined
}

function videoTaskPath(config, taskId) {
  if (config.provider === 'xai') return `/videos/${encodeURIComponent(taskId)}`
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
  generate_video: (args) => {
    if (args.capability === 'video.extend' || args.videoMode === 'extend') return ['video.extend']
    if (args.capability === 'video.edit' || args.videoMode === 'edit') return ['video.edit']
    if (args.capability === 'video.reference_to_video' || args.videoMode === 'reference_to_video') return ['video.reference_to_video', 'video.image_to_video', 'video.generate']
    if (args.capability === 'video.image_to_video' || args.videoMode === 'image_to_video') return ['video.image_to_video', 'video.generate']
    if (args.capability === 'video.generate' || args.videoMode === 'generate') return ['video.generate']
    const hasInputVideo = Boolean(args.videoUrl || args.videoFile) ||
      (Array.isArray(args.inputVideos) && args.inputVideos.some((item) => typeof item === 'string' && item.length > 0))
    const hasInputImage = Boolean(args.firstFrame || args.lastFrame) ||
      (Array.isArray(args.inputImages) && args.inputImages.some((item) => typeof item === 'string' && item.length > 0)) ||
      (Array.isArray(args.referenceImages) && args.referenceImages.some((item) => typeof item === 'string' && item.length > 0))
    if (hasInputVideo) return ['video.edit', 'video.extend', 'video.image_to_video', 'video.generate']
    if (hasInputImage) return ['video.image_to_video', 'video.edit', 'video.generate']
    return ['video.generate']
  },
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
    'editStrength',
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

function buildManifestVariables(toolName, args, manifest, capability, modelId, prePrunedParams) {
  // prePrunedParams：当调用方（handleManifestTool）已通过 Contract V2 prune 后，
  // 直接使用裁剪后的 canonical 参数；否则回退到原 argsToModelParams 收集行为。
  const params = prePrunedParams !== undefined
    ? { ...(capability.defaults || {}), ...prePrunedParams }
    : {
        ...(capability.defaults || {}),
        ...argsToModelParams(toolName, args),
      }
  // xAI Images API 不支持 size（HTTP 400: Argument not supported: size）。
  // 用户/LLM 可能经 size 传比例（如 16:9）或分辨率（如 1024x1024）：
  //   - 比例型 → 归一化到 aspect_ratio（xAI 官方字段），并移除 size
  //   - 分辨率型 → 对 xAI 无意义，直接丢弃
  // 兜底：即使 Contract V2 未生效（旧 manifest 无 paramPolicy），也保留这段硬编码。
  if (manifest.providerKind === 'xai') {
    const sizeVal = typeof params.size === 'string' ? params.size.trim() : ''
    if (RATIO_RE.test(sizeVal) && params.aspect_ratio == null) params.aspect_ratio = sizeVal
    delete params.size
  }
  const providerParams = {}
  for (const [key, value] of Object.entries(params)) {
    const providerKey = capability.aliases?.[key] || key
    providerParams[providerKey] = value
  }
  const inputImages = Array.isArray(args.inputImages) ? args.inputImages.filter((item) => typeof item === 'string') : []
  const referenceImages = Array.isArray(args.referenceImages) ? args.referenceImages.filter((item) => typeof item === 'string') : []
  const imageUrls = Array.isArray(args.imageUrls) ? args.imageUrls.filter((item) => typeof item === 'string') : []
  const imageFiles = Array.isArray(args.imageFiles) ? args.imageFiles.filter((item) => typeof item === 'string') : []
  const firstFrame = typeof args.firstFrame === 'string' ? args.firstFrame : ''
  const lastFrame = typeof args.lastFrame === 'string' ? args.lastFrame : ''
  const images = [firstFrame, ...inputImages, ...imageUrls, ...imageFiles, lastFrame, ...referenceImages].filter(Boolean)
  const inputVideos = Array.isArray(args.inputVideos) ? args.inputVideos.filter((item) => typeof item === 'string') : []
  const video = typeof args.videoUrl === 'string' && args.videoUrl
    ? args.videoUrl
    : typeof args.videoFile === 'string' && args.videoFile
      ? args.videoFile
      : inputVideos[0] || ''
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
    firstFrame: firstFrame || images[0] || '',
    lastFrame,
    referenceImages,
    video,
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

  // Contract V2 preflight：在 canonical 空间裁剪，确保 prune.prunedParams 与
  // capability.paramSchema（canonical 命名）对齐；buildManifestVariables 再通过
  // capability.aliases 把 canonical → provider-native 字段。
  const collectedParams = argsToModelParams(toolName, args)
  const prune = pruneModelParamsByManifest({
    manifest,
    capability,
    modelId,
    params: collectedParams,
    inputFiles: collectInputFileKinds(args),
    providerDefaults: config.mediaDefaults?.providerParams,
    mode: 'mcp',
  })

  const variables = buildManifestVariables(toolName, args, manifest, capability, modelId, prune.prunedParams)

  const endpoint = renderTemplateString(manifest.invocation.endpoint || '', variables)
  const url = resolveManifestUrl(config.baseUrl, endpoint)
  const requestBody = mergeProviderParams(
    renderTemplate(manifest.invocation.requestTemplate || {}, variables),
    variables.providerParams,
  )
  const responseSpec = manifest.invocation.response || { kind: 'url', jsonPaths: ['data[].url'], download: true }
  let raw
  try {
    raw = await fetchJson(
      url,
      {
        method: manifest.invocation.method || 'POST',
        headers: authHeaders(config),
        body: JSON.stringify(requestBody),
      },
      60_000,
      responseSpec.kind === 'binary_response',
    )
  } catch (err) {
    // 优先返回 normalized error，agent 可据 code 决定重试/换模型/换参数。
    const normalized = normalizeMcpMediaError(manifest, err)
    const wrapped = new Error(normalized.message)
    wrapped.normalized = normalized
    throw wrapped
  }
  let mode = manifest.invocation.mode === 'async_polling' ? 'async' : 'sync'
  let requestId = ''

  if (responseSpec.kind === 'task_poll') {
    const immediate = firstStringAtPaths(raw, responseSpec.resultPaths || [])
    if (!immediate) {
      const taskId = firstStringAtPaths(raw, responseSpec.taskIdPaths || [])
      if (!taskId) throw new Error(`No task id in response: ${JSON.stringify(raw).slice(0, 800)}`)
      requestId = taskId
      mode = 'async'
      try {
        raw = await pollManifestTask(config, manifest, responseSpec, taskId)
      } catch (err) {
        const normalized = normalizeMcpMediaError(manifest, err)
        const wrapped = new Error(normalized.message)
        wrapped.normalized = normalized
        throw wrapped
      }
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
    ...(prune.droppedParams.length > 0 ? { droppedParams: prune.droppedParams } : {}),
    ...(prune.warnings.length > 0 ? { paramWarnings: prune.warnings } : {}),
    ...(prune.validationIssues.length > 0 ? { validationIssues: prune.validationIssues } : {}),
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

// 匹配 xAI 支持的比例值（如 16:9、19.5:9、1:1），用于把「用 size 传比例」归一化到 aspect_ratio。
// xAI Images API 不支持 size（仅 aspect_ratio + resolution），分辨率型 size（如 1024x1024）不会命中。
const RATIO_RE = /^\d+(?:\.\d+)?:\d+(?:\.\d+)?$/

function xaiImageParams(args) {
  const params = { ...(args.extraJson || {}) }
  // xAI 不支持 size（HTTP 400: Argument not supported: size）。若调用方用 size 传了比例，
  // 归一化到 aspect_ratio；分辨率型 size 对 xAI 无意义，直接丢弃。绝不输出 size。
  const sizeLikeRatio = typeof args.size === 'string' && RATIO_RE.test(args.size.trim()) ? args.size.trim() : ''
  if (sizeLikeRatio && params.aspect_ratio == null && args.aspectRatio == null) params.aspect_ratio = sizeLikeRatio
  if (args.aspectRatio && params.aspect_ratio == null) params.aspect_ratio = args.aspectRatio
  if (args.resolution && params.resolution == null) params.resolution = args.resolution
  if (args.n != null && params.n == null) params.n = args.n
  if (args.output_format && params.response_format == null && ['url', 'b64_json'].includes(String(args.output_format))) {
    params.response_format = args.output_format
  }
  if (args.output_format && params.image_format == null && !['url', 'b64_json', 'base64'].includes(String(args.output_format))) {
    params.image_format = args.output_format
  }
  if (args.negative_prompt && params.negative_prompt == null) params.negative_prompt = args.negative_prompt
  if (args.seed != null && params.seed == null) params.seed = args.seed
  // 兜底：即使经 extraJson 混入 size（如 { size: '1024x1024' }），也必须移除——xAI 不支持 size。
  delete params.size
  return params
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
    // xAI Images API 不支持 size（会 HTTP 400）。xAI 走 xaiImageParams，size 在其中
    // 归一化为 aspect_ratio（若为比例型）或丢弃；其它 provider 原样透传 size。
    ...(config.provider === 'xai' ? xaiImageParams(args) : {
      ...(args.size ? { size: args.size } : {}),
      ...(args.resolution ? { resolution: args.resolution } : {}),
      ...(args.aspectRatio ? { aspect_ratio: args.aspectRatio } : {}),
      ...(args.extraJson || {}),
    }),
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
  if (manifestMatch && config.provider !== 'xai') return handleManifestTool(config, 'edit_image', args, manifestMatch)
  const imageUrls = Array.isArray(args.imageUrls) ? args.imageUrls : []
  const imageFiles = Array.isArray(args.imageFiles) ? args.imageFiles : []
  const refs = [...imageUrls, ...imageFiles].filter((s) => typeof s === 'string' && s.length > 0)
  // xAI 图片编辑走 POST /images/edits（官方独立端点），源图按 image（单图：{url, type}）
  // 或 images（多图 ≤3：[{url, type}, ...]）传入。manifest 模板无法表达多端点 + 多图对象数组，
  // 故 xAI 走此 hardcode 分支优先于 manifest。见 https://docs.x.ai/developers/model-capabilities/images/editing。
  if (config.provider === 'xai') {
    if (refs.length === 0) throw new Error('xAI image edit requires input image(s)')
    const editRefs = refs.slice(0, 3)
    const imageObjects = editRefs.map((ref) => ({ url: ref, type: 'image_url' }))
    const body = {
      model: config.model,
      prompt,
      ...(imageObjects.length === 1 ? { image: imageObjects[0] } : { images: imageObjects }),
      ...xaiImageParams(args),
    }
    const data = await fetchJson(`${config.baseUrl}/images/edits`, { method: 'POST', headers: authHeaders(config), body: JSON.stringify(body) }, 120_000)
    const images = extractImages(data)
    if (images.length === 0) throw new Error(`No images in xAI edit response: ${JSON.stringify(data).slice(0, 800)}`)
    const files = []
    for (let i = 0; i < images.length; i++) {
      files.push(await materializeImage(config, images[i], args.filename || '', i, images.length))
    }
    return { success: true, provider: `${config.provider}/${config.model}`, mode: 'sync', files }
  }
  if (manifestMatch) return handleManifestTool(config, 'edit_image', args, manifestMatch)
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
  const videoDefaults = config.mediaDefaults?.video || {}
  const inputImages = Array.isArray(args.inputImages) ? args.inputImages : []
  const firstFrame = typeof args.firstFrame === 'string' && args.firstFrame
    ? args.firstFrame
    : inputImages[0]
  const lastFrame = typeof args.lastFrame === 'string' ? args.lastFrame : ''
  const referenceImages = Array.isArray(args.referenceImages) ? args.referenceImages.filter((item) => typeof item === 'string' && item.length > 0) : []
  const inputVideos = Array.isArray(args.inputVideos) ? args.inputVideos.filter((item) => typeof item === 'string' && item.length > 0) : []
  const video = typeof args.videoUrl === 'string' && args.videoUrl
    ? args.videoUrl
    : typeof args.videoFile === 'string' && args.videoFile
      ? args.videoFile
      : inputVideos[0] || ''
  // xAI 视频有三个真实端点：/videos/generations、/videos/edits、/videos/extensions。
  // manifest 模板无法表达“有 video 时根据模式切端点”，所以 xAI 视频统一走 native 分支。
  if (config.provider === 'xai') {
    if (!config.model) throw new Error('No media model configured')
    const wantsExtend = args.capability === 'video.extend' || args.videoMode === 'extend' || args.extraJson?.mode === 'extend-video'
    const wantsEdit = args.capability === 'video.edit' || args.videoMode === 'edit' || args.extraJson?.mode === 'edit-video'
    const wantsReference = args.capability === 'video.reference_to_video' || args.videoMode === 'reference_to_video' || args.extraJson?.mode === 'reference-to-video'
    let endpoint = '/videos/generations'
    const body = { model: config.model, prompt, ...(args.extraJson || {}) }
    delete body.mode
    if (video) {
      endpoint = wantsExtend ? '/videos/extensions' : '/videos/edits'
      body.video = { url: video }
      if (wantsExtend) {
        const rawDuration = Number.parseInt(args.durationSeconds ?? videoDefaults.durationSeconds ?? '6', 10)
        body.duration = Math.max(1, Math.min(15, Number.isFinite(rawDuration) ? rawDuration : 6))
      }
    } else {
      const firstImage = firstFrame || inputImages[0] || ''
      if (wantsReference && referenceImages.length > 0) {
        body.reference_images = referenceImages.slice(0, 4).map((url) => ({ url }))
      } else if (firstImage) {
        body.image = { url: firstImage }
      } else if (referenceImages.length > 0) {
        body.reference_images = referenceImages.slice(0, 4).map((url) => ({ url }))
      }
      if (args.aspectRatio || videoDefaults.aspectRatio) body.aspect_ratio = args.aspectRatio || videoDefaults.aspectRatio
      if (args.durationSeconds || videoDefaults.durationSeconds) body.duration = args.durationSeconds || videoDefaults.durationSeconds
      if (args.resolution) body.resolution = args.resolution
      if (args.seed != null) body.seed = args.seed
    }
    if (wantsEdit && !video) throw new Error('xAI video edit requires videoUrl/videoFile/inputVideos')
    if (wantsExtend && !video) throw new Error('xAI video extend requires videoUrl/videoFile/inputVideos')
    const data = await fetchJson(`${config.baseUrl}${endpoint}`, { method: 'POST', headers: authHeaders(config), body: JSON.stringify(body) }, 60_000)
    let videoUrls = extractMediaUrls(data, { kind: 'video' })
    let requestId = null
    if (videoUrls.length === 0) {
      const taskId = extractTaskId(data)
      if (!taskId) throw new Error(`No video url or task id: ${JSON.stringify(data).slice(0, 800)}`)
      requestId = taskId
      const polled = await pollTask(config, `${config.baseUrl}/videos/${encodeURIComponent(taskId)}`, (d) => {
        if (extractMediaUrls(d, { kind: 'video' }).length) return 'done'
        return FAILED_STATUSES.includes(extractStatus(d)) ? 'failed' : 'pending'
      })
      videoUrls = extractMediaUrls(polled, { kind: 'video' })
    }
    const files = []
    for (let i = 0; i < videoUrls.length; i++) {
      files.push(await downloadMedia(config, videoUrls[i], 'video', args.filename || ''))
    }
    return { success: true, provider: `${config.provider}/${config.model}`, mode: 'async', files, requestId }
  }
  if (manifestMatch) return handleManifestTool(config, 'generate_video', args, manifestMatch)
  if (!config.model) throw new Error('No media model configured')
  const body = {
    model: config.model,
    prompt,
    ...(args.aspectRatio || videoDefaults.aspectRatio ? { aspect_ratio: args.aspectRatio || videoDefaults.aspectRatio } : {}),
    ...(args.durationSeconds || videoDefaults.durationSeconds ? { duration: args.durationSeconds || videoDefaults.durationSeconds } : {}),
    ...(firstFrame ? { image: firstFrame, first_frame_image: firstFrame } : {}),
    ...(lastFrame ? { last_frame_image: lastFrame } : {}),
    ...(referenceImages.length > 0 ? { reference_images: referenceImages.map((url) => ({ url })) } : {}),
    ...(video ? { video, video_url: video } : {}),
    ...(args.editStrength != null ? { edit_strength: args.editStrength } : {}),
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
    videoUrls = extractMediaUrls(polled)
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
    const message = err instanceof Error ? err.message : String(err)
    const data = err && typeof err === 'object' && 'normalized' in err && err.normalized
      ? { normalized: err.normalized }
      : undefined
    error(id, -32000, message, data)
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
