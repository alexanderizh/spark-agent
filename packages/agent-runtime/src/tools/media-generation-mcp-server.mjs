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
 *   upload/get/list/delete_file、list/get/cancel_task — Provider 文件与异步任务生命周期
 *
 * 配置全部来自环境变量（API key 仅在本子进程内存内，不外泄）：
 *   SPARK_MEDIA_API_KEY       API key（必填）
 *   SPARK_MEDIA_PROVIDER      apimart | xai | bailian | volcengine-ark | openai-compatible | custom（默认 openai-compatible）
 *   SPARK_MEDIA_MODEL         默认模型 id
 *   SPARK_MEDIA_API_TYPE      sync | async | auto（默认 auto）
 *   SPARK_MEDIA_BASE_URL      API base url
 *   SPARK_MEDIA_OUTPUT_DIR    产物落盘根目录
 *   SPARK_MEDIA_DEFAULTS_JSON 可选；mediaDefaults 的 JSON 字符串
 *   SPARK_MEDIA_MANIFESTS_JSON 可选；已启用 MediaModelManifest[]，用于 list/describe
 */
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
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
        imageFileIds: { type: 'array', items: { type: 'string' }, description: 'xAI Files API file ids.' },
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
        language: { type: 'string', description: 'BCP-47 language or auto (provider-specific).' },
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
      properties: {
        prompt: { type: 'string' },
        model: { type: 'string', description: 'Optional manifest id or provider model id from list_models.' },
        inputImages: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional reference image urls / data urls for image-to-video.',
        },
        firstFrame: { type: 'string', description: 'Optional first-frame image url / data url.' },
        firstFrameFileId: { type: 'string', description: 'Optional xAI Files API id for the first frame.' },
        lastFrame: { type: 'string', description: 'Optional last-frame image url / data url.' },
        referenceImages: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional reference image urls / data urls for video edit.',
        },
        referenceImageFileIds: { type: 'array', items: { type: 'string' }, description: 'xAI Files API ids for reference images.' },
        inputVideos: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional input video urls / file paths for video edit.',
        },
        referenceVideos: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional reference video URLs. Provider/model limits come from describe_model.',
        },
        referenceAudios: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional reference audio URLs / data URLs. Provider/model limits come from describe_model.',
        },
        videoUrl: { type: 'string', description: 'Optional remote input video url for video edit.' },
        videoFile: { type: 'string', description: 'Optional local input video file path for video edit.' },
        videoFileId: { type: 'string', description: 'Optional xAI Files API id for video edit or extension.' },
        capability: { type: 'string', description: `Capability id such as video.generate, video.image_to_video, video.edit, or video.extend. ${DESCRIBE_MODEL_HINT}` },
        videoMode: { type: 'string', description: 'Loose routing hint: generate, image_to_video, reference_to_video, edit, or extend.' },
        aspectRatio: { type: 'string', description: `Provider-specific video aspect ratio. ${DESCRIBE_MODEL_HINT}` },
        durationSeconds: { type: 'integer', minimum: -1, maximum: 120, description: `Duration in seconds; some models use -1 for automatic duration. ${DESCRIBE_MODEL_HINT}` },
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
    name: 'upload_file',
    description:
      'Upload/import a file to the configured provider file platform. Volcengine Ark supports local binary or URL/TOS imports; Bailian supports local DashScope multipart uploads for file-extract, batch, and fine-tune only.',
    inputSchema: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Local file path. Mutually exclusive with url.' },
        url: {
          type: 'string',
          description: 'HTTP/HTTPS or tos:// URL. Mutually exclusive with filePath.',
        },
        purpose: { type: 'string', enum: ['user_data', 'file-extract', 'batch', 'fine-tune'] },
        description: { type: 'string', description: 'Optional Bailian file description.' },
        expireAt: {
          type: 'integer',
          description: 'UTC Unix seconds; Volcengine allows now+1 day through now+30 days.',
        },
        tos: {
          type: 'object',
          required: ['bucket', 'prefix'],
          properties: {
            bucket: { type: 'string' },
            prefix: { type: 'string', description: 'Relative TOS object prefix.' },
          },
        },
        preprocessVideo: {
          type: 'object',
          properties: {
            fps: { type: 'number', minimum: 0.2, maximum: 5 },
            model: { type: 'string' },
            max_video_tokens: { type: 'integer', minimum: 10240, maximum: 204800 },
            min_frame_tokens: { type: 'integer', minimum: 16, maximum: 128 },
            max_frame_tokens: { type: 'integer', minimum: 128, maximum: 640 },
            min_frames: { type: 'integer', minimum: 5, maximum: 16 },
          },
        },
        waitUntilActive: { type: 'boolean', default: true },
      },
    },
  },
  {
    name: 'get_file',
    description: 'Retrieve one file object from the configured provider file platform.',
    inputSchema: {
      type: 'object',
      required: ['fileId'],
      properties: { fileId: { type: 'string' } },
    },
  },
  {
    name: 'list_files',
    description: 'List files from the configured provider file platform.',
    inputSchema: {
      type: 'object',
      properties: {
        after: { type: 'string' },
        pageNo: { type: 'integer', minimum: 1, description: 'Bailian Files page number; defaults to 1.' },
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 100 },
        purpose: { type: 'string', enum: ['user_data', 'file-extract', 'batch', 'fine-tune'] },
        order: { type: 'string', enum: ['asc', 'desc'], default: 'desc' },
        scopeId: { type: 'string', description: 'Managed Agents Session ID when applicable.' },
      },
    },
  },
  {
    name: 'delete_file',
    description: 'Delete one file from the configured provider file platform.',
    inputSchema: {
      type: 'object',
      required: ['fileId'],
      properties: { fileId: { type: 'string' } },
    },
  },
  {
    name: 'list_tasks',
    description: 'List provider asynchronous tasks. Bailian supports the documented 24-hour task query window.',
    inputSchema: {
      type: 'object',
      properties: {
        startTime: { type: 'string', description: 'Bailian task start time as YYYYMMDDhhmmss.' },
        endTime: { type: 'string', description: 'Bailian task end time as YYYYMMDDhhmmss.' },
        modelName: { type: 'string' },
        status: { type: 'string', enum: ['PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELED', 'UNKNOWN'] },
        pageNo: { type: 'integer', minimum: 1 },
        limit: { type: 'integer', minimum: 1, maximum: 100 },
      },
    },
  },
  {
    name: 'get_task',
    description: 'Inspect a media task created by this Spark media MCP process, or a Bailian provider task by task id.',
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
    description: 'Cancel a pending/running media task. Bailian permits remote cancellation only while the task is PENDING.',
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

async function handleListTasks(config, args) {
  if (config.provider === 'bailian') return handleBailianListTasks(config, args)
  const limit = Math.max(1, Math.min(100, Math.floor(Number(args.limit) || 20)))
  return {
    success: true,
    tasks: [...TASKS.values()]
      .filter((task) => task.provider === config.provider)
      .slice(-limit)
      .reverse(),
  }
}

async function handleGetTask(config, args) {
  const taskId = String(args.taskId || '').trim()
  if (!taskId) throw new Error('taskId is required')
  const task = TASKS.get(taskId)
  if (!task && config.provider === 'bailian') return handleBailianGetTask(config, taskId)
  if (!task) throw new Error(`Unknown media task: ${taskId}`)
  return { success: true, task }
}

async function handleCancelTask(config, args) {
  const taskId = String(args.taskId || '').trim()
  if (!taskId) throw new Error('taskId is required')
  const task = TASKS.get(taskId)
  if (!task && config.provider === 'bailian') return handleBailianCancelTask(config, taskId)
  if (!task) throw new Error(`Unknown media task: ${taskId}`)
  if (task.status !== 'pending' && task.status !== 'running') {
    return { success: true, cancelled: false, task, message: `Task is already ${task.status}` }
  }
  const now = new Date().toISOString()
  const cancelled = { ...task, status: 'cancelled', updatedAt: now, completedAt: now }
  TASKS.set(taskId, cancelled)
  return { success: true, cancelled: true, task: cancelled }
}

function assertVolcengineFilesConfig(config) {
  if (config.provider !== 'volcengine-ark') {
    throw new Error(
      `Provider file management is not implemented for ${config.provider}; select a Volcengine Ark provider`,
    )
  }
  if (!config.apiKey) throw new Error('No media API key configured')
}

async function handleUploadFile(config, args) {
  if (config.provider === 'bailian') return handleBailianUploadFile(config, args)
  assertVolcengineFilesConfig(config)
  const filePath = typeof args.filePath === 'string' ? args.filePath.trim() : ''
  const urlValue = typeof args.url === 'string' ? args.url.trim() : ''
  if (Boolean(filePath) === Boolean(urlValue)) {
    throw new Error('Exactly one of filePath or url is required')
  }
  if (urlValue && !/^(?:https?:\/\/|tos:\/\/)/i.test(urlValue)) {
    throw new Error('Volcengine Files url must use http://, https://, or tos://')
  }
  const tos = normalizeVolcengineTos(args.tos)
  if (urlValue.toLowerCase().startsWith('tos://') && !tos) {
    throw new Error('Volcengine tos:// imports require tos.bucket and tos.prefix')
  }
  const purpose = String(args.purpose || 'user_data')
  if (purpose !== 'user_data') {
    throw new Error('Volcengine Files purpose must be user_data')
  }
  const nowSeconds = Math.floor(Date.now() / 1000)
  const expireAt = args.expireAt == null ? undefined : Number(args.expireAt)
  if (
    expireAt != null &&
    (!Number.isInteger(expireAt) ||
      expireAt < nowSeconds + 86400 ||
      expireAt > nowSeconds + 2592000)
  ) {
    throw new Error(
      'Volcengine expireAt must be a UTC Unix timestamp between now+1 day and now+30 days',
    )
  }

  const form = new globalThis.FormData()
  form.append('purpose', purpose)
  if (filePath) {
    const info = await stat(filePath)
    if (!info.isFile()) throw new Error(`Volcengine Files path is not a file: ${filePath}`)
    const extension = path.extname(filePath).toLowerCase()
    assertVolcengineFileExtension(extension)
    if (args.preprocessVideo && !VOLCENGINE_VIDEO_EXTENSIONS.has(extension)) {
      throw new Error('Volcengine video preprocessing only supports MP4, AVI, or MOV files')
    }
    const maxBytes =
      tos && VOLCENGINE_VIDEO_EXTENSIONS.has(extension)
        ? 2 * 1024 * 1024 * 1024
        : 512 * 1024 * 1024
    if (info.size > maxBytes) {
      throw new Error(
        `Volcengine Files local file exceeds ${Math.round(maxBytes / 1024 / 1024)} MB`,
      )
    }
    const buffer = await readFile(filePath)
    form.append(
      'file',
      new globalThis.Blob([buffer], { type: mimeFromFilename(filePath) }),
      path.basename(filePath),
    )
  } else {
    const extension = remoteFileExtension(urlValue)
    if (extension) assertVolcengineFileExtension(extension)
    if (args.preprocessVideo && extension && !VOLCENGINE_VIDEO_EXTENSIONS.has(extension)) {
      throw new Error('Volcengine video preprocessing only supports MP4, AVI, or MOV files')
    }
    form.append('url', urlValue)
  }
  if (expireAt != null) form.append('expire_at', String(expireAt))
  if (tos) {
    form.append('tos[bucket]', tos.bucket)
    form.append('tos[prefix]', tos.prefix)
  }
  if (args.preprocessVideo && typeof args.preprocessVideo === 'object') {
    appendVolcengineVideoPreprocess(form, args.preprocessVideo)
  }
  const uploaded = await fetchJson(
    `${volcengineFilesBaseUrl(config.baseUrl)}/files`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${config.apiKey}` },
      body: form,
    },
    300_000,
  )
  if (!uploaded?.id) throw new Error('Volcengine Files response missing id')
  const file =
    args.waitUntilActive === false ? uploaded : await waitForVolcengineFile(config, uploaded.id)
  return { success: true, provider: config.provider, file }
}

async function handleGetFile(config, args) {
  if (config.provider === 'bailian') return handleBailianGetFile(config, args)
  assertVolcengineFilesConfig(config)
  const fileId = String(args.fileId || '').trim()
  if (!fileId) throw new Error('fileId is required')
  const file = await fetchJson(
    `${volcengineFilesBaseUrl(config.baseUrl)}/files/${encodeURIComponent(fileId)}`,
    { headers: authHeaders(config) },
    30_000,
  )
  return { success: true, provider: config.provider, file }
}

async function handleListFiles(config, args) {
  if (config.provider === 'bailian') return handleBailianListFiles(config, args)
  assertVolcengineFilesConfig(config)
  const query = new URLSearchParams()
  if (args.after) query.set('after', String(args.after))
  query.set('limit', String(Math.max(1, Math.min(100, Number(args.limit) || 100))))
  if (args.purpose && args.purpose !== 'user_data') {
    throw new Error('Volcengine Files purpose must be user_data')
  }
  if (args.purpose) query.set('purpose', 'user_data')
  query.set('order', args.order === 'asc' ? 'asc' : 'desc')
  if (args.scopeId) query.set('scope_id', String(args.scopeId))
  const files = await fetchJson(
    `${volcengineFilesBaseUrl(config.baseUrl)}/files?${query.toString()}`,
    { headers: authHeaders(config) },
    30_000,
  )
  return { success: true, provider: config.provider, ...files }
}

async function handleDeleteFile(config, args) {
  if (config.provider === 'bailian') return handleBailianDeleteFile(config, args)
  assertVolcengineFilesConfig(config)
  const fileId = String(args.fileId || '').trim()
  if (!fileId) throw new Error('fileId is required')
  const deleted = await fetchJson(
    `${volcengineFilesBaseUrl(config.baseUrl)}/files/${encodeURIComponent(fileId)}`,
    { method: 'DELETE', headers: authHeaders(config) },
    30_000,
  )
  return { success: true, provider: config.provider, deleted }
}

function assertBailianFilesConfig(config) {
  if (config.provider !== 'bailian') throw new Error('Bailian Files requires a Bailian provider')
  if (!config.apiKey) throw new Error('No media API key configured')
  return bailianFilesBaseUrl(config.baseUrl)
}

async function handleBailianUploadFile(config, args) {
  const baseUrl = assertBailianFilesConfig(config)
  const filePath = typeof args.filePath === 'string' ? args.filePath.trim() : ''
  if (!filePath || args.url) throw new Error('Bailian Files requires filePath and does not support URL/TOS imports')
  const purpose = String(args.purpose || '').trim()
  if (!['file-extract', 'batch', 'fine-tune'].includes(purpose)) {
    throw new Error('Bailian Files purpose must be file-extract, batch, or fine-tune')
  }
  const info = await stat(filePath)
  if (!info.isFile()) throw new Error(`Bailian Files path is not a file: ${filePath}`)
  const maxBytes = purpose === 'file-extract'
    ? 150 * 1024 * 1024
    : purpose === 'batch'
      ? 500 * 1024 * 1024
      : 1024 * 1024 * 1024
  if (info.size > maxBytes) {
    throw new Error(`Bailian Files ${purpose} local file exceeds ${Math.round(maxBytes / 1024 / 1024)} MB`)
  }
  const form = new globalThis.FormData()
  const buffer = await readFile(filePath)
  form.append('files', new globalThis.Blob([buffer], { type: mimeFromFilename(filePath) }), path.basename(filePath))
  form.append('purpose', purpose)
  if (typeof args.description === 'string' && args.description.trim()) {
    form.append('descriptions', args.description.trim())
  }
  const response = await fetchJson(
    `${baseUrl}/files`,
    { method: 'POST', headers: { authorization: `Bearer ${config.apiKey}` }, body: form },
    300_000,
  )
  const failed = response?.data?.failed_uploads?.[0]
  const file = response?.data?.uploaded_files?.[0]
  if (!file?.file_id) {
    const detail = [failed?.code, failed?.message].filter(Boolean).join(': ')
    throw new Error(`Bailian Files upload did not return an uploaded file${detail ? `: ${detail}` : ''}${requestIdSuffix(response)}`)
  }
  return { success: true, provider: config.provider, file, requestId: response?.request_id || null }
}

async function handleBailianGetFile(config, args) {
  const baseUrl = assertBailianFilesConfig(config)
  const fileId = String(args.fileId || '').trim()
  if (!fileId) throw new Error('fileId is required')
  const response = await fetchJson(
    `${baseUrl}/files/${encodeURIComponent(fileId)}`,
    { headers: { authorization: `Bearer ${config.apiKey}` } },
    30_000,
  )
  if (!response?.data?.file_id) throw new Error(`Bailian Files response missing file_id${requestIdSuffix(response)}`)
  return { success: true, provider: config.provider, file: response.data, requestId: response.request_id || null }
}

async function handleBailianListFiles(config, args) {
  const baseUrl = assertBailianFilesConfig(config)
  if (args.after || args.scopeId || args.purpose || args.order) {
    throw new Error('Bailian Files list supports only pageNo and limit; purpose/order/after/scopeId are not documented for this API')
  }
  const pageNo = Math.max(1, Math.floor(Number(args.pageNo) || 1))
  const pageSize = Math.max(1, Math.min(100, Math.floor(Number(args.limit) || 20)))
  const response = await fetchJson(
    `${baseUrl}/files?page_no=${pageNo}&page_size=${pageSize}`,
    { headers: { authorization: `Bearer ${config.apiKey}` } },
    30_000,
  )
  return { success: true, provider: config.provider, ...(response?.data || {}), requestId: response?.request_id || null }
}

async function handleBailianDeleteFile(config, args) {
  const baseUrl = assertBailianFilesConfig(config)
  const fileId = String(args.fileId || '').trim()
  if (!fileId) throw new Error('fileId is required')
  const response = await fetchJson(
    `${baseUrl}/files/${encodeURIComponent(fileId)}`,
    { method: 'DELETE', headers: { authorization: `Bearer ${config.apiKey}` } },
    30_000,
  )
  return { success: true, provider: config.provider, deleted: true, id: fileId, requestId: response?.request_id || null }
}

async function handleBailianGetTask(config, taskId) {
  const baseUrl = assertBailianFilesConfig(config)
  const response = await fetchJson(
    `${baseUrl}/tasks/${encodeURIComponent(taskId)}`,
    { headers: { authorization: `Bearer ${config.apiKey}` } },
    30_000,
  )
  return { success: true, provider: config.provider, task: response?.output || response, requestId: response?.request_id || null }
}

async function handleBailianListTasks(config, args) {
  const baseUrl = assertBailianFilesConfig(config)
  const query = new URLSearchParams()
  const taskId = typeof args.taskId === 'string' ? args.taskId.trim() : ''
  if (taskId) query.set('task_id', taskId)
  for (const [argName, queryName] of [
    ['startTime', 'start_time'],
    ['endTime', 'end_time'],
    ['modelName', 'model_name'],
    ['status', 'status'],
  ]) {
    if (args[argName] == null || args[argName] === '') continue
    const value = String(args[argName]).trim()
    if ((argName === 'startTime' || argName === 'endTime') && !/^\d{14}$/.test(value)) {
      throw new Error(`Bailian ${argName} must use YYYYMMDDhhmmss`)
    }
    query.set(queryName, value)
  }
  const pageNo = args.pageNo == null ? undefined : Number(args.pageNo)
  const pageSize = args.limit == null ? undefined : Number(args.limit)
  if (pageNo != null && (!Number.isInteger(pageNo) || pageNo < 1)) throw new Error('Bailian pageNo must be a positive integer')
  if (pageSize != null && (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100)) throw new Error('Bailian limit must be an integer between 1 and 100')
  if (pageNo != null) query.set('page_no', String(pageNo))
  if (pageSize != null) query.set('page_size', String(pageSize))
  const response = await fetchJson(
    `${baseUrl}/tasks/?${query.toString()}`,
    { headers: { authorization: `Bearer ${config.apiKey}` } },
    30_000,
  )
  return { success: true, provider: config.provider, ...(response || {}) }
}

async function handleBailianCancelTask(config, taskId) {
  const baseUrl = assertBailianFilesConfig(config)
  const response = await fetchJson(
    `${baseUrl}/tasks/${encodeURIComponent(taskId)}/cancel`,
    { method: 'POST', headers: { authorization: `Bearer ${config.apiKey}` } },
    30_000,
  )
  return { success: true, provider: config.provider, cancelled: true, taskId, requestId: response?.request_id || null }
}

function appendVolcengineVideoPreprocess(form, raw) {
  const allowedFields = new Set([
    'fps',
    'model',
    'max_video_tokens',
    'min_frame_tokens',
    'max_frame_tokens',
    'min_frames',
  ])
  const unsupportedField = Object.keys(raw).find((name) => !allowedFields.has(name))
  if (unsupportedField) {
    throw new Error(`Unsupported Volcengine preprocessVideo field: ${unsupportedField}`)
  }
  const fields = [
    ['fps', 0.2, 5, false],
    ['max_video_tokens', 10240, 204800, true],
    ['min_frame_tokens', 16, 128, true],
    ['max_frame_tokens', 128, 640, true],
    ['min_frames', 5, 16, true],
  ]
  for (const [name, minimum, maximum, integer] of fields) {
    if (raw[name] == null) continue
    const value = Number(raw[name])
    if (
      !Number.isFinite(value) ||
      (integer && !Number.isInteger(value)) ||
      value < minimum ||
      value > maximum
    ) {
      throw new Error(
        `Volcengine preprocessVideo.${name} must be ${integer ? 'an integer ' : ''}between ${minimum} and ${maximum}`,
      )
    }
    form.append(`preprocess_configs[video][${name}]`, String(value))
  }
  if (raw.model != null) {
    const model = String(raw.model).trim()
    if (!model) throw new Error('Volcengine preprocessVideo.model cannot be empty')
    form.append('preprocess_configs[video][model]', model)
  }
  if (
    raw.min_frame_tokens != null &&
    raw.max_frame_tokens != null &&
    Number(raw.min_frame_tokens) > Number(raw.max_frame_tokens)
  ) {
    throw new Error('Volcengine preprocessVideo.min_frame_tokens cannot exceed max_frame_tokens')
  }
}

async function waitForVolcengineFile(config, fileId) {
  const deadline = Date.now() + 300_000
  let interval = 1000
  while (Date.now() < deadline) {
    const file = await fetchJson(
      `${volcengineFilesBaseUrl(config.baseUrl)}/files/${encodeURIComponent(fileId)}`,
      { headers: authHeaders(config) },
      30_000,
    )
    if (file?.status === 'active') return file
    if (file?.status === 'failed') {
      throw new Error(
        `Volcengine file preprocessing failed: ${file?.error?.code || ''} ${file?.error?.message || ''}`.trim(),
      )
    }
    await new Promise((resolve) => setTimeout(resolve, interval))
    interval = Math.min(Math.ceil(interval * 1.5), 5000)
  }
  throw new Error(`Volcengine file ${fileId} did not become active within 5 minutes`)
}

function mimeFromFilename(filename) {
  const extension = path.extname(filename).toLowerCase()
  const map = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.bmp': 'image/bmp',
    '.tiff': 'image/tiff',
    '.heic': 'image/heic',
    '.heif': 'image/heif',
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
    '.avi': 'video/x-msvideo',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.aac': 'audio/aac',
    '.m4a': 'audio/mp4',
    '.pdf': 'application/pdf',
  }
  return map[extension] || 'application/octet-stream'
}

const VOLCENGINE_FILE_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
  '.bmp',
  '.tiff',
  '.ico',
  '.icns',
  '.sgi',
  '.jp2',
  '.heic',
  '.heif',
  '.mp4',
  '.avi',
  '.mov',
  '.pdf',
  '.mp3',
  '.wav',
  '.aac',
  '.m4a',
])
const VOLCENGINE_VIDEO_EXTENSIONS = new Set(['.mp4', '.avi', '.mov'])

function assertVolcengineFileExtension(extension) {
  if (!VOLCENGINE_FILE_EXTENSIONS.has(extension)) {
    throw new Error(`Volcengine Files does not support ${extension || 'extensionless'} files`)
  }
}

function normalizeVolcengineTos(raw) {
  if (raw == null) return null
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Volcengine tos must be an object with bucket and prefix')
  }
  const bucket = String(raw.bucket || '').trim()
  const prefix = String(raw.prefix || '').trim()
  if (!bucket || !prefix) throw new Error('Volcengine tos.bucket and tos.prefix are required')
  if (prefix.startsWith('/')) throw new Error('Volcengine tos.prefix must be a relative path')
  return { bucket, prefix }
}

function remoteFileExtension(value) {
  try {
    if (value.toLowerCase().startsWith('tos://')) {
      return path.extname(value.slice('tos://'.length).split(/[?#]/, 1)[0] || '').toLowerCase()
    }
    return path.extname(new globalThis.URL(value).pathname).toLowerCase()
  } catch {
    return ''
  }
}

function volcengineFilesBaseUrl(value) {
  const baseUrl = String(value || '').replace(/\/+$/, '')
  try {
    const parsed = new globalThis.URL(baseUrl)
    if (parsed.hostname.toLowerCase() === 'ark.cn-beijing.volces.com') {
      return `${parsed.origin}/api/v3`
    }
  } catch {
    // fetchJson will surface the invalid URL through its normal provider error path.
  }
  return baseUrl
}

function bailianFilesBaseUrl(value) {
  const configured = String(value || 'https://dashscope.aliyuncs.com/api/v1').replace(/\/+$/, '')
  try {
    const parsed = new globalThis.URL(configured)
    if (parsed.hostname.toLowerCase() === 'dashscope.aliyuncs.com') {
      return `${parsed.origin}/api/v1`
    }
  } catch {
    // Report the same clear configuration guidance below.
  }
  throw new Error(
    'Bailian Files supports only the Beijing public DashScope Base URL: https://dashscope.aliyuncs.com/api/v1',
  )
}

function requestIdSuffix(body) {
  return body?.request_id ? ` (RequestId: ${body.request_id})` : ''
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
  const provider = (env.SPARK_MEDIA_PROVIDER || 'openai-compatible').trim().toLowerCase()
  const configuredBaseUrl = (env.SPARK_MEDIA_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '')
  return {
    apiKey: env.SPARK_MEDIA_API_KEY || '',
    provider,
    model: env.SPARK_MEDIA_MODEL || '',
    mode: env.SPARK_MEDIA_API_TYPE || 'auto',
    baseUrl: provider === 'bailian' ? bailianMediaBaseUrl(configuredBaseUrl) : configuredBaseUrl,
    outputDir: env.SPARK_MEDIA_OUTPUT_DIR || path.join(process.cwd(), '.spark-artifacts', 'media'),
    mediaDefaults,
    manifests,
  }
}

function bailianMediaBaseUrl(value) {
  const configured = String(value || 'https://dashscope.aliyuncs.com/api/v1').replace(/\/+$/, '')
  try {
    const parsed = new globalThis.URL(configured)
    const pathName = parsed.pathname.replace(/\/+$/, '')
    if (pathName.endsWith('/api/v1/services/aigc') || pathName.endsWith('/services/aigc')) {
      return `${parsed.origin}${pathName}`
    }
    if (pathName.endsWith('/api/v1')) return `${parsed.origin}${pathName}/services/aigc`
    return `${parsed.origin}/api/v1/services/aigc`
  } catch {
    throw new Error('Bailian media Base URL is invalid; expected an HTTP(S) API endpoint')
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
    if (!res.ok) {
      const providerDetail = body && typeof body === 'object'
        ? [body.code, body.message, body.request_id ? `RequestId: ${body.request_id}` : '']
          .filter(Boolean)
          .join(': ')
        : ''
      throw new Error(`HTTP ${res.status}: ${providerDetail || String(text).slice(0, 800)}`)
    }
    return body
  } finally {
    clearTimeout(timer)
  }
}

async function pollTask(config, url, inspect, fallbackTimeoutMs = 600_000) {
  const defaults = config.mediaDefaults?.polling || {}
  const deadline = Date.now() + (defaults.timeoutMs || fallbackTimeoutMs)
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

function stringHeaders(value) {
  if (!isPlainRecord(value)) return {}
  return Object.fromEntries(
    Object.entries(value).filter(([, headerValue]) => typeof headerValue === 'string' && headerValue.length > 0),
  )
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
  const hasVideoInput = args.videoUrl || args.videoFile ||
    (Array.isArray(args.inputVideos) && args.inputVideos.length > 0) ||
    (Array.isArray(args.referenceVideos) && args.referenceVideos.length > 0)
  if (hasVideoInput) files.push({ type: 'video' })
  if (args.audioUrl || args.audioFile || (Array.isArray(args.referenceAudios) && args.referenceAudios.length > 0)) files.push({ type: 'audio' })
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
  if (capability?.rolePolicy && typeof capability.rolePolicy === 'object') {
    return capability.rolePolicy
  }
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

async function writeBinaryAsset(config, buffer, kind, filename, extension) {
  const dir = path.join(config.outputDir, kind === 'audio' ? 'audio' : 'videos')
  await mkdir(dir, { recursive: true })
  const parsed = path.parse(filename || `${kind}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`)
  const file = path.join(dir, `${parsed.name}${parsed.ext || `.${extension}`}`)
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

async function normalizeBailianMcpInputs(args, capabilityId) {
  const next = { ...args }
  for (const key of ['inputImages', 'referenceImages', 'imageUrls', 'imageFiles']) {
    if (!Array.isArray(args[key])) continue
    next[key] = await Promise.all(
      args[key]
        .filter((value) => typeof value === 'string' && value.trim())
        .map((value) => bailianMcpImageReference(value)),
    )
  }
  if (typeof args.firstFrame === 'string' && args.firstFrame.trim()) {
    next.firstFrame = await bailianMcpImageReference(args.firstFrame)
  }
  if (typeof args.lastFrame === 'string' && args.lastFrame.trim()) {
    next.lastFrame = await bailianMcpImageReference(args.lastFrame)
  }
  for (const key of ['videoUrl', 'videoFile', 'inputVideos', 'referenceVideos', 'referenceAudios']) {
    const values = Array.isArray(args[key]) ? args[key] : [args[key]]
    const present = values.filter((value) => typeof value === 'string' && value.trim())
    for (const value of present) {
      if (!/^(?:https?:|oss:)/i.test(value)) {
        throw new Error(
          `Bailian ${capabilityId} video/audio inputs must use HTTP(S) or OSS temporary URLs; local files are supported from Canvas after public upload, but not from the isolated spark_media process.`,
        )
      }
    }
  }
  return next
}

async function bailianMcpImageReference(value) {
  const reference = String(value || '').trim()
  if (/^(?:https?:|oss:|data:image\/)/i.test(reference)) return reference
  const buffer = await readFile(reference)
  const mimeType = mimeFromFilename(reference)
  if (!mimeType.startsWith('image/')) throw new Error(`Bailian image input is not a supported image: ${reference}`)
  return `data:${mimeType};base64,${buffer.toString('base64')}`
}

function buildBailianMcpMedia(args, capabilityId) {
  const inputImages = Array.isArray(args.inputImages) ? args.inputImages.filter(Boolean) : []
  const referenceImages = Array.isArray(args.referenceImages) ? args.referenceImages.filter(Boolean) : []
  const inputVideos = Array.isArray(args.inputVideos) ? args.inputVideos.filter(Boolean) : []
  const referenceVideos = Array.isArray(args.referenceVideos) ? args.referenceVideos.filter(Boolean) : []
  const referenceAudios = Array.isArray(args.referenceAudios) ? args.referenceAudios.filter(Boolean) : []
  const hasExplicitFirstFrame = Boolean(args.firstFrame)
  const firstFrame = args.firstFrame || inputImages[0] || ''
  const lastFrame = args.lastFrame || ''

  if (capabilityId === 'video.generate') return []
  if (capabilityId === 'video.image_to_video') {
    if (inputVideos.length > 1 || referenceAudios.length > 1) {
      throw new Error('Bailian image-to-video accepts at most one first clip and one driving audio')
    }
    if (inputVideos.length > 0) {
      if (firstFrame || referenceAudios.length > 0) {
        throw new Error('Bailian video extension accepts only first_clip, optionally followed by last_frame')
      }
      return [
        { type: 'first_clip', url: inputVideos[0] },
        ...(lastFrame ? [{ type: 'last_frame', url: lastFrame }] : []),
      ]
    }
    if (!firstFrame) throw new Error('Bailian image-to-video requires a first frame or first clip')
    return [
      { type: 'first_frame', url: firstFrame },
      ...(lastFrame ? [{ type: 'last_frame', url: lastFrame }] : []),
      ...(referenceAudios[0] ? [{ type: 'driving_audio', url: referenceAudios[0] }] : []),
    ]
  }
  if (capabilityId === 'video.reference_to_video') {
    const references = [
      ...(hasExplicitFirstFrame ? inputImages : inputImages.slice(firstFrame ? 1 : 0)),
      ...referenceImages,
    ]
    if ((firstFrame ? 1 : 0) + references.length + referenceVideos.length > 5) {
      throw new Error('Bailian reference-to-video accepts at most five image/video references')
    }
    if (!firstFrame && references.length + referenceVideos.length === 0) {
      throw new Error('Bailian reference-to-video requires at least one image or video reference')
    }
    if (referenceAudios.length > 1) throw new Error('Bailian reference-to-video accepts at most one reference voice')
    return [
      ...(firstFrame ? [{ type: 'first_frame', url: firstFrame }] : []),
      ...references.map((url) => ({ type: 'reference_image', url })),
      ...referenceVideos.map((url) => ({ type: 'reference_video', url })),
      ...(referenceAudios[0] ? [{ type: 'reference_voice', url: referenceAudios[0] }] : []),
    ]
  }
  if (capabilityId === 'video.edit') {
    const video = args.videoUrl || inputVideos[0] || ''
    const images = [...inputImages, ...referenceImages]
    if (!video || inputVideos.length > 1) throw new Error('Bailian video edit requires exactly one input video')
    if (images.length > 4) throw new Error('Bailian video edit accepts at most four reference images')
    return [
      { type: 'video', url: video },
      ...images.map((url) => ({ type: 'reference_image', url })),
    ]
  }
  return []
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
  const negativePrompt = typeof args.negative_prompt === 'string' ? args.negative_prompt : ''
  const text = typeof args.text === 'string' ? args.text : prompt
  const media = manifest.providerKind === 'bailian'
    ? buildBailianMcpMedia(args, capability.id)
    : undefined
  const content = manifest.providerKind === 'bailian' && capability.id.startsWith('image.')
    ? [...images.map((imageUrl) => ({ image: imageUrl })), { text: prompt }]
    : undefined
  if (manifest.providerKind === 'bailian') {
    delete providerParams.negativePrompt
    delete providerParams.negative_prompt
  }
  return {
    modelId,
    prompt,
    negativePrompt,
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
    media,
    content,
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
  const resolvedArgs = manifest.providerKind === 'bailian'
    ? await normalizeBailianMcpInputs(args, capability.id)
    : args
  const collectedParams = argsToModelParams(toolName, resolvedArgs)
  const prune = pruneModelParamsByManifest({
    manifest,
    capability,
    modelId,
    params: collectedParams,
    inputFiles: collectInputFileKinds(resolvedArgs),
    providerDefaults: config.mediaDefaults?.providerParams,
    mode: 'mcp',
  })

  const variables = buildManifestVariables(
    toolName,
    resolvedArgs,
    manifest,
    capability,
    modelId,
    prune.prunedParams,
  )

  const endpoint = renderTemplateString(manifest.invocation.endpoint || '', variables)
  const url = resolveManifestUrl(config.baseUrl, endpoint)
  const invocationHeaders = renderTemplate(manifest.invocation.headers || {}, variables)
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
        headers: {
          ...authHeaders(config),
          ...stringHeaders(invocationHeaders),
        },
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
  const pollingBaseUrl = manifest.providerKind === 'bailian'
    ? config.baseUrl.replace(/\/services\/aigc$/, '')
    : config.baseUrl
  const pollUrl = resolveManifestUrl(
    pollingBaseUrl,
    renderTemplateString(responseSpec.statusEndpoint || '', { taskId }),
  )
  const defaultTimeoutMs = Array.isArray(manifest.domains) && manifest.domains.includes('video')
    ? 1_800_000
    : 600_000
  const deadline = Date.now() + (config.mediaDefaults?.polling?.timeoutMs || polling.timeoutMs || defaultTimeoutMs)
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
  if (isPlainRecord(next.parameters)) {
    next.parameters = { ...next.parameters, ...providerParams }
    return next
  }
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
  const source = { ...(args.extraJson || {}) }
  const params = {}
  // xAI 不支持 size（HTTP 400: Argument not supported: size）。若调用方用 size 传了比例，
  // 归一化到 aspect_ratio；分辨率型 size 对 xAI 无意义，直接丢弃。绝不输出 size。
  const sizeLikeRatio = typeof args.size === 'string' && RATIO_RE.test(args.size.trim()) ? args.size.trim() : ''
  if (sizeLikeRatio && args.aspectRatio == null) params.aspect_ratio = sizeLikeRatio
  if (args.aspectRatio || source.aspect_ratio) params.aspect_ratio = args.aspectRatio || source.aspect_ratio
  if (args.resolution || source.resolution) params.resolution = args.resolution || source.resolution
  if (args.n != null || source.n != null) params.n = args.n ?? source.n
  if (args.output_format && ['url', 'b64_json'].includes(String(args.output_format))) {
    params.response_format = args.output_format
  } else if (['url', 'b64_json'].includes(String(source.response_format))) {
    params.response_format = source.response_format
  }
  if (typeof source.user === 'string' && source.user) params.user = source.user
  return params
}

function xaiStorageOptions(args, extension) {
  const configured = typeof args.filename === 'string' && args.filename.trim() ? args.filename.trim() : ''
  return { filename: configured || `spark-${Date.now()}.${extension}`, public_url: true }
}

function xaiFileOutputStrings(value, key) {
  const found = []
  const visit = (node) => {
    if (Array.isArray(node)) return node.forEach(visit)
    if (!node || typeof node !== 'object') return
    if (typeof node[key] === 'string' && node[key]) found.push(node[key])
    if (node.file_output && typeof node.file_output === 'object' && typeof node.file_output[key] === 'string') {
      found.push(node.file_output[key])
    }
    Object.values(node).forEach(visit)
  }
  visit(value)
  return [...new Set(found)]
}

function xaiPublicUrls(value) {
  return xaiFileOutputStrings(value, 'public_url').filter(isHttpUrl)
}

function xaiImageResults(value) {
  const items = Array.isArray(value?.data) ? value.data : [value]
  return items.flatMap((item) => {
    const publicUrl = xaiPublicUrls(item)[0]
    if (publicUrl) return [{ kind: 'url', value: publicUrl }]
    const image = extractImages(item)[0]
    return image ? [image] : []
  })
}

async function xaiInputReference(config, value, kind, explicitFileId = '') {
  if (explicitFileId) return { file_id: explicitFileId }
  if (isHttpUrl(value)) return { url: value }
  let buffer
  let mimeType = kind === 'image' ? 'image/png' : 'video/mp4'
  let filename = `spark-input-${Date.now()}.${kind === 'image' ? 'png' : 'mp4'}`
  if (String(value || '').startsWith('data:')) {
    mimeType = mimeFromDataUrl(value) || mimeType
    buffer = Buffer.from(normalizeBase64(value), 'base64')
  } else if (value) {
    const { readFile } = await import('node:fs/promises')
    buffer = await readFile(value)
    filename = path.basename(value) || filename
  }
  if (!buffer) throw new Error(`xAI ${kind} input requires URL, file_id, data URL, or local file`)
  try {
    const form = new globalThis.FormData()
    form.append('file', new globalThis.Blob([buffer], { type: mimeType }), filename)
    const uploaded = await fetchJson(`${config.baseUrl}/files`, {
      method: 'POST', headers: { authorization: `Bearer ${config.apiKey}` }, body: form,
    }, 120_000)
    if (!uploaded?.id) throw new Error('xAI Files response missing id')
    return { file_id: uploaded.id }
  } catch (error) {
    if (kind === 'image') return { url: `data:${mimeType};base64,${buffer.toString('base64')}` }
    throw new Error(
      `xAI Files upload failed; video input cannot fall back to base64: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    )
  }
}

// ── tool handlers ──────────────────────────────────────────────────────────

async function handleGenerateImage(config, args) {
  if (!config.apiKey) throw new Error('No media API key configured')
  const prompt = String(args.prompt || '').trim()
  if (!prompt) throw new Error('prompt is required')
  const manifestMatch = resolveManifestForTool(config, 'generate_image', args)
  if (manifestMatch && config.provider !== 'xai') return handleManifestTool(config, 'generate_image', args, manifestMatch)
  if (config.provider === 'xai' && Array.isArray(args.inputImages) && args.inputImages.length > 0) {
    return handleEditImage(config, { ...args, imageUrls: args.inputImages })
  }
  if (!config.model) throw new Error('No media model configured')
  const parsedN = Number.parseInt(args.n || '1', 10) || 1
  const n = config.provider === 'xai' ? Math.max(1, parsedN) : Math.max(1, Math.min(4, parsedN))
  const body = {
    model: config.model,
    prompt,
    n,
    // xAI Images API 不支持 size（会 HTTP 400）。xAI 走 xaiImageParams，size 在其中
    // 归一化为 aspect_ratio（若为比例型）或丢弃；其它 provider 原样透传 size。
    ...(config.provider === 'xai' ? {
      ...xaiImageParams(args),
      storage_options: xaiStorageOptions(args, 'png'),
    } : {
      ...(args.size ? { size: args.size } : {}),
      ...(args.resolution ? { resolution: args.resolution } : {}),
      ...(args.aspectRatio ? { aspect_ratio: args.aspectRatio } : {}),
      ...(args.extraJson || {}),
    }),
  }
  const url = `${config.baseUrl}/images/generations`
  const data = await fetchJson(url, { method: 'POST', headers: authHeaders(config), body: JSON.stringify(body) }, 60_000)
  let images = config.provider === 'xai' ? xaiImageResults(data) : extractImages(data)
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
  const imageFileIds = Array.isArray(args.imageFileIds) ? args.imageFileIds : []
  const refs = [...imageUrls, ...imageFiles].filter((s) => typeof s === 'string' && s.length > 0)
  // xAI 图片编辑走 POST /images/edits（官方独立端点），源图按 image（单图：{url, type}）
  // 或 images（多图 ≤3：[{url, type}, ...]）传入。manifest 模板无法表达多端点 + 多图对象数组，
  // 故 xAI 走此 hardcode 分支优先于 manifest。见 https://docs.x.ai/developers/model-capabilities/images/editing。
  if (config.provider === 'xai') {
    if (refs.length + imageFileIds.length === 0) throw new Error('xAI image edit requires input image(s)')
    if (refs.length + imageFileIds.length > 3) throw new Error('xAI image edit supports at most 3 images')
    const imageObjects = [
      ...await Promise.all(refs.map((ref) => xaiInputReference(config, ref, 'image'))),
      ...imageFileIds.map((fileId) => ({ file_id: fileId })),
    ]
    const body = {
      model: config.model,
      prompt,
      ...(imageObjects.length === 1 ? { image: imageObjects[0] } : { images: imageObjects }),
      ...xaiImageParams(args),
      storage_options: xaiStorageOptions(args, 'png'),
    }
    const data = await fetchJson(`${config.baseUrl}/images/edits`, { method: 'POST', headers: authHeaders(config), body: JSON.stringify(body) }, 120_000)
    const images = xaiImageResults(data)
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
  if (config.provider === 'xai') {
    const codec = String(args.format || 'mp3')
    const body = {
      text,
      voice_id: args.voice || 'eve',
      language: args.language || 'auto',
      output_format: { codec },
      ...(args.speed != null ? { speed: args.speed } : {}),
    }
    const audio = await fetchJson(`${config.baseUrl}/tts`, {
      method: 'POST', headers: authHeaders(config), body: JSON.stringify(body),
    }, 60_000, true)
    const file = await writeBinaryAsset(config, audio, 'audio', args.filename || '', codec)
    return { success: true, provider: `${config.provider}/${config.model}`, mode: 'sync', files: [file] }
  }
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

async function handleVolcengineVideoManifestTool(config, args, match) {
  const { manifest, capability } = match
  const modelId =
    typeof args.model === 'string' && args.model !== manifest.id
      ? args.model
      : manifest.modelId || config.model
  const prompt = String(args.prompt || '').trim()
  const inputImages = stringArray(args.inputImages)
  const referenceImages = stringArray(args.referenceImages)
  const inputVideos = stringArray(args.inputVideos)
  const referenceVideos = stringArray(args.referenceVideos)
  const referenceAudios = stringArray(args.referenceAudios)
  const firstFrame =
    typeof args.firstFrame === 'string' && args.firstFrame
      ? args.firstFrame
      : capability.id === 'video.image_to_video'
        ? inputImages[0] || ''
        : ''
  const lastFrame =
    typeof args.lastFrame === 'string' && args.lastFrame
      ? args.lastFrame
      : capability.id === 'video.image_to_video'
        ? inputImages[1] || ''
        : ''
  const extraFrameImages =
    capability.id === 'video.image_to_video' ? inputImages.slice(2) : inputImages
  const videoUrl = typeof args.videoUrl === 'string' ? args.videoUrl : ''
  const videoFile = typeof args.videoFile === 'string' ? args.videoFile : ''
  const referenceModeImages = [...extraFrameImages, ...referenceImages]
  const referenceModeVideos = [...inputVideos, ...referenceVideos, videoUrl, videoFile].filter(
    Boolean,
  )
  const hasFrameMode = Boolean(firstFrame || lastFrame)
  const hasReferenceMode =
    referenceModeImages.length > 0 ||
    referenceModeVideos.length > 0 ||
    referenceAudios.length > 0 ||
    ['video.reference_to_video', 'video.edit', 'video.extend'].includes(capability.id)

  if (lastFrame && !firstFrame) throw new Error('Volcengine Seedance lastFrame requires firstFrame')
  if (hasFrameMode && hasReferenceMode) {
    throw new Error(
      'Volcengine Seedance first/last-frame mode cannot be mixed with multimodal references',
    )
  }
  if (hasReferenceMode && referenceModeImages.length === 0 && referenceModeVideos.length === 0) {
    throw new Error(
      'Volcengine Seedance multimodal reference mode requires at least one image or video; audio-only is unsupported',
    )
  }
  const maxImages = capability.input?.maxImages ?? 0
  const maxVideos = capability.input?.maxVideos ?? 0
  const maxAudios = capability.input?.maxAudios ?? 0
  const totalImages = hasFrameMode
    ? Number(Boolean(firstFrame)) + Number(Boolean(lastFrame))
    : referenceModeImages.length
  if (maxImages > 0 && totalImages > maxImages)
    throw new Error(`Volcengine Seedance accepts at most ${maxImages} images for this capability`)
  if (maxVideos > 0 && referenceModeVideos.length > maxVideos)
    throw new Error(`Volcengine Seedance accepts at most ${maxVideos} reference videos`)
  if (maxAudios > 0 && referenceAudios.length > maxAudios)
    throw new Error(`Volcengine Seedance accepts at most ${maxAudios} reference audios`)

  const prune = pruneModelParamsByManifest({
    manifest,
    capability,
    modelId,
    params: argsToModelParams('generate_video', args),
    inputFiles: collectInputFileKinds(args),
    providerDefaults: config.mediaDefaults?.providerParams,
    mode: 'mcp',
  })
  const variables = buildManifestVariables(
    'generate_video',
    args,
    manifest,
    capability,
    modelId,
    prune.prunedParams,
  )
  const providerParams = { ...variables.providerParams }
  const searchEnabled =
    providerParams.enable_search === true || providerParams.searchEnabled === true
  delete providerParams.enable_search
  delete providerParams.searchEnabled
  if (searchEnabled && (hasFrameMode || hasReferenceMode)) {
    throw new Error(
      'Volcengine Seedance web search is only available for text-only video generation',
    )
  }
  if (providerParams.ratio === '智能比例') providerParams.ratio = 'adaptive'

  const content = []
  if (prompt) content.push({ type: 'text', text: prompt })
  if (hasFrameMode) {
    if (firstFrame) {
      content.push({
        type: 'image_url',
        image_url: { url: await volcengineInputReference(firstFrame, 'image') },
        role: 'first_frame',
      })
    }
    if (lastFrame) {
      content.push({
        type: 'image_url',
        image_url: { url: await volcengineInputReference(lastFrame, 'image') },
        role: 'last_frame',
      })
    }
  } else {
    for (const value of referenceModeImages) {
      content.push({
        type: 'image_url',
        image_url: { url: await volcengineInputReference(value, 'image') },
        role: 'reference_image',
      })
    }
    for (const value of referenceModeVideos) {
      content.push({
        type: 'video_url',
        video_url: { url: await volcengineInputReference(value, 'video') },
        role: 'reference_video',
      })
    }
    for (const value of referenceAudios) {
      content.push({
        type: 'audio_url',
        audio_url: { url: await volcengineInputReference(value, 'audio') },
        role: 'reference_audio',
      })
    }
  }
  if (content.length === 0)
    throw new Error('Volcengine Seedance requires a prompt or supported media input')

  const requestBody = {
    model: modelId,
    content,
    ...providerParams,
    ...(searchEnabled ? { tools: [{ type: 'web_search' }] } : {}),
  }
  const url = resolveManifestUrl(config.baseUrl, manifest.invocation.endpoint)
  const responseSpec = manifest.invocation.response
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
    )
    const taskId = firstStringAtPaths(raw, responseSpec.taskIdPaths || [])
    if (!taskId) throw new Error(`No task id in response: ${JSON.stringify(raw).slice(0, 800)}`)
    raw = await pollManifestTask(config, manifest, responseSpec, taskId)
    const materialized = await materializeManifestResult(
      config,
      responseSpec,
      raw,
      capability,
      args,
    )
    return {
      success: true,
      provider: `${manifest.providerKind}/${modelId}`,
      manifestId: manifest.id,
      model: modelId,
      mode: 'async',
      requestId: taskId,
      ...materialized,
      ...(prune.droppedParams.length > 0 ? { droppedParams: prune.droppedParams } : {}),
      ...(prune.warnings.length > 0 ? { paramWarnings: prune.warnings } : {}),
      ...(prune.validationIssues.length > 0 ? { validationIssues: prune.validationIssues } : {}),
    }
  } catch (err) {
    const normalized = normalizeMcpMediaError(manifest, err)
    const wrapped = new Error(normalized.message)
    wrapped.normalized = normalized
    throw wrapped
  }
}

function stringArray(value) {
  return Array.isArray(value)
    ? value.filter((item) => typeof item === 'string' && item.trim().length > 0)
    : []
}

async function volcengineInputReference(value, kind) {
  const source = String(value || '').trim()
  if (!source) throw new Error(`Volcengine ${kind} input is empty`)
  if (isHttpUrl(source) || source.startsWith('asset://') || source.startsWith('data:')) {
    if (kind === 'video' && source.startsWith('data:')) {
      throw new Error('Volcengine Seedance reference videos do not support base64 data URLs')
    }
    return source
  }
  if (kind === 'video') {
    throw new Error(
      'Volcengine Seedance local video references must be uploaded to a public URL or asset:// ID first',
    )
  }
  const buffer = await readFile(source)
  const extension = path.extname(source).toLowerCase()
  const mime =
    kind === 'audio'
      ? extension === '.wav'
        ? 'audio/wav'
        : 'audio/mpeg'
      : extension === '.jpg' || extension === '.jpeg'
        ? 'image/jpeg'
        : extension === '.webp'
          ? 'image/webp'
          : 'image/png'
  return `data:${mime};base64,${buffer.toString('base64')}`
}


async function handleGenerateVideo(config, args) {
  if (!config.apiKey) throw new Error('No media API key configured')
  const prompt = String(args.prompt || '').trim()
  const manifestMatch = resolveManifestForTool(config, 'generate_video', args)
  if (manifestMatch && config.provider === 'volcengine-ark') {
    return handleVolcengineVideoManifestTool(config, args, manifestMatch)
  }
  if (!prompt && !(config.provider === 'bailian' && manifestMatch?.capability.id === 'video.edit')) {
    throw new Error('prompt is required')
  }
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
    const wantsImageToVideo = args.capability === 'video.image_to_video' || args.videoMode === 'image_to_video' || Boolean(firstFrame || args.firstFrameFileId)
    const isVideo15 = String(config.model).startsWith('grok-imagine-video-1.5')
    if (lastFrame) throw new Error('xAI video generation does not support a last frame')
    if (isVideo15 && !wantsImageToVideo) throw new Error(`${config.model} only supports image-to-video`)
    if (isVideo15 && wantsReference) throw new Error(`${config.model} does not support reference-to-video`)
    const referenceFileIds = Array.isArray(args.referenceImageFileIds)
      ? args.referenceImageFileIds.filter((item) => typeof item === 'string' && item)
      : []
    if (referenceImages.length + referenceFileIds.length > 7) throw new Error('xAI reference-to-video supports at most 7 images')
    let endpoint = '/videos/generations'
    const body = { model: config.model, prompt }
    const explicitVideoFileId = typeof args.videoFileId === 'string' ? args.videoFileId : ''
    if (video || explicitVideoFileId) {
      endpoint = wantsExtend ? '/videos/extensions' : '/videos/edits'
      body.video = await xaiInputReference(config, video, 'video', explicitVideoFileId)
      if (wantsExtend) {
        const rawDuration = Number.parseInt(args.durationSeconds ?? '6', 10)
        if (!Number.isFinite(rawDuration) || rawDuration < 2 || rawDuration > 10) {
          throw new Error('xAI video extension duration must be between 2 and 10 seconds')
        }
        body.duration = rawDuration
      }
    } else {
      const firstImage = firstFrame || inputImages[0] || ''
      if (wantsReference && referenceImages.length + referenceFileIds.length > 0) {
        body.reference_images = [
          ...await Promise.all(referenceImages.map((reference) => xaiInputReference(config, reference, 'image'))),
          ...referenceFileIds.map((fileId) => ({ file_id: fileId })),
        ]
      } else if (firstImage) {
        body.image = await xaiInputReference(config, firstImage, 'image', args.firstFrameFileId || '')
      } else if (args.firstFrameFileId) {
        body.image = { file_id: args.firstFrameFileId }
      } else if (referenceImages.length > 0) {
        body.reference_images = await Promise.all(referenceImages.map((reference) => xaiInputReference(config, reference, 'image')))
      }
      if (args.aspectRatio || videoDefaults.aspectRatio) body.aspect_ratio = args.aspectRatio || videoDefaults.aspectRatio
      if (args.durationSeconds || videoDefaults.durationSeconds) body.duration = args.durationSeconds || videoDefaults.durationSeconds
      if (args.resolution) body.resolution = args.resolution
    }
    body.storage_options = xaiStorageOptions(args, 'mp4')
    if (wantsEdit && !video && !explicitVideoFileId) throw new Error('xAI video edit requires videoUrl/videoFile/videoFileId/inputVideos')
    if (wantsExtend && !video && !explicitVideoFileId) throw new Error('xAI video extend requires videoUrl/videoFile/videoFileId/inputVideos')
    const data = await fetchJson(`${config.baseUrl}${endpoint}`, { method: 'POST', headers: authHeaders(config), body: JSON.stringify(body) }, 60_000)
    let videoUrls = xaiPublicUrls(data)
    let requestId = null
    if (videoUrls.length === 0) {
      const taskId = extractTaskId(data)
      if (!taskId) throw new Error(`No video url or task id: ${JSON.stringify(data).slice(0, 800)}`)
      requestId = taskId
      const polled = await pollTask(config, `${config.baseUrl}/videos/${encodeURIComponent(taskId)}`, (d) => {
        if (xaiPublicUrls(d).length || xaiFileOutputStrings(d, 'public_url_error').length) return 'done'
        return FAILED_STATUSES.includes(extractStatus(d)) ? 'failed' : 'pending'
      }, 1_800_000)
      videoUrls = xaiPublicUrls(polled)
      if (videoUrls.length === 0) {
        const publicUrlError = xaiFileOutputStrings(polled, 'public_url_error')[0]
        throw new Error(`xAI video generated but official CDN persistence failed${publicUrlError ? `: ${publicUrlError}` : ''}`)
      }
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
    }, 1_800_000)
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
  let errorContext
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
      errorContext = {
        provider: config.provider,
        model: config.model,
        tool: name,
        ...(typeof args.capability === 'string' ? { capability: args.capability } : {}),
      }
      let data
      let task = null
      switch (name) {
        case 'list_models': data = handleListModels(config, args); break
        case 'describe_model': data = handleDescribeModel(config, args); break
        case 'upload_file': data = await handleUploadFile(config, args); break
        case 'get_file': data = await handleGetFile(config, args); break
        case 'list_files': data = await handleListFiles(config, args); break
        case 'delete_file': data = await handleDeleteFile(config, args); break
        case 'list_tasks': data = await handleListTasks(config, args); break
        case 'get_task': data = await handleGetTask(config, args); break
        case 'cancel_task': data = await handleCancelTask(config, args); break
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
    const data = {
      ...(errorContext || {}),
      ...(err && typeof err === 'object' && 'normalized' in err && err.normalized
        ? { normalized: err.normalized }
        : {}),
    }
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
