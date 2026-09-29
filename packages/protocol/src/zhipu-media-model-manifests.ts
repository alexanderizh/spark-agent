/**
 * 智谱开放平台（Zhipu / BigModel）音频模型清单。
 *
 * 端点与参数全部核对自官方 OpenAPI（https://docs.bigmodel.cn/openapi/openapi.json）：
 *   - 文本转语音 GLM-TTS：`POST /paas/v4/audio/speech`（JSON 请求，返回二进制音频）
 *   - 语音转文本 GLM-ASR-2512：`POST /paas/v4/audio/transcriptions`（multipart 文件上传）
 *
 * 与「智谱 GLM Coding Plan」分属不同产品线：Coding Plan 走 `/api/anthropic` 与
 * `/api/coding/paas/v4`，而音频能力在 `/api/paas/v4`，一个 profile 只能有一个
 * apiEndpoint，因此独立成 provider kind，不复用 Coding Plan 渠道。
 *
 * 本清单**不注册专用 adapter**，由 TemplateMediaAdapter 按契约编译执行：
 *   - TTS 用 `binary_response` 接收 `audio/wav`（先例 xai:grok-tts）
 *   - ASR 用 Contract V2 `request.body` 显式声明 multipart `kind: 'file'` 段。
 *     ⚠️ 不能用 legacy `contentType: 'multipart'`：该分支只产出 text parts，
 *     永远不会上传文件（见 media-invocation-compiler.ts legacyInvocationRequest）。
 *
 * 智谱错误体是标准 `{ error: { code, message } }`，无需专用 adapter 做业务错误
 * 断言（区别于 MiniMax 的 HTTP 200 + base_resp.status_code 非 0 陷阱）。
 */

import type {
  MediaDomain,
  MediaInvocationMode,
  MediaManifestInputKind,
  MediaManifestOutputKind,
  MediaModelManifest,
} from './media-model-manifest.js'
import type { MediaErrorContract } from './media-model-contract.js'

const GLM_TTS_DOC = 'https://docs.bigmodel.cn/api-reference/模型-api/文本转语音'
const GLM_ASR_DOC = 'https://docs.bigmodel.cn/api-reference/模型-api/语音转文本'

/** 官方系统音色（AudioSpeechRequest.voice 枚举，7 个）。复刻音色另行动态创建。 */
export const ZHIPU_SYSTEM_VOICES = [
  'tongtong',
  'chuichui',
  'xiaochen',
  'jam',
  'kazi',
  'douji',
  'luodo',
] as const

/**
 * 官方错误体统一为 `{ error: { code, message } }`。
 *
 * 刻意**不写 mappings / retryableCodes**：智谱错误码（如 `1210`）没有可核对的
 * 官方完整码表，臆造映射会把真实错误归一错误。保留路径提取即可让用户看到
 * 厂商原文；归一化交给默认 HTTP 兜底。
 */
const zhipuErrorContract: MediaErrorContract = {
  codePaths: ['error.code'],
  messagePaths: ['error.message'],
  requestIdPaths: ['request_id', 'error.request_id'],
  paramNamePatterns: [
    'parameter[:\\s]+`?([a-zA-Z0-9_.-]+)`?',
    'param(?:eter)?[:\\s]+`?([a-zA-Z0-9_.-]+)`?',
  ],
}

/**
 * GLM-TTS 参数 schema。
 *
 * `voice` 用 `examples` + `x-allow-custom` 而非 `enum`：官方除 7 个系统音色外
 * 还支持复刻音色（数量不限、动态创建），写成 enum 会让校验器硬拒所有复刻音色。
 * 前端据此渲染为「可选可填」的 AutoComplete。
 *
 * `volume` 官方范围是左开右闭 `(0, 10]`，用 exclusiveMinimum 精确表达。
 */
export const ZHIPU_SPEECH_PARAM_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    voice: {
      type: 'string',
      title: '音色',
      default: 'tongtong',
      description:
        '系统音色（彤彤/锤锤/小陈等）或复刻音色 ID。复刻音色在开放平台创建后直接填入音色 ID。',
      examples: [...ZHIPU_SYSTEM_VOICES],
      'x-allow-custom': true,
    },
    format: {
      type: 'string',
      title: '输出格式',
      enum: ['wav', 'pcm'],
      default: 'wav',
      description:
        '官方默认 pcm 为无头裸流（播放器无法直接播放），平台默认改为 wav；选 pcm 需自行封装容器。',
    },
    speed: { type: 'number', title: '语速', minimum: 0.5, maximum: 2, default: 1 },
    volume: {
      type: 'number',
      title: '音量',
      exclusiveMinimum: 0,
      maximum: 10,
      default: 1,
      description: '官方范围 (0, 10]，默认 1。',
    },
    watermarkEnabled: {
      type: 'boolean',
      title: 'AI 水印',
      default: true,
      description: '生成音频是否添加 AI 显式与隐式数字水印。关闭仅对已完成去水印操作的用户生效。',
    },
  },
} as const

/** GLM-ASR-2512 参数 schema（官方仅 file/model 必填，其余为可选上下文）。 */
export const ZHIPU_ASR_PARAM_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    prompt: {
      type: 'string',
      title: '上下文提示',
      description: '长文本上下文，用于提升专业术语识别准确率，建议不超过 8000 字。',
    },
    hotwords: {
      type: 'array',
      title: '热词表',
      items: { type: 'string' },
      maxItems: 100,
      description: '最多 100 条热词，用于提升专有名词识别准确率。',
    },
  },
} as const

export const ZHIPU_MEDIA_MODEL_MANIFESTS: readonly MediaModelManifest[] = [
  {
    /* GLM-TTS 文本转语音。响应为 audio/wav 二进制裸流（非 JSON），
       因此用 binary_response 直接落盘；同步调用，无轮询。 */
    id: 'zhipu:glm-tts',
    providerKind: 'zhipu',
    modelId: 'glm-tts',
    displayName: 'GLM-TTS 语音合成',
    domains: ['audio'] as MediaDomain[],
    capabilities: [
      {
        id: 'audio.speech',
        label: '语音合成',
        input: { required: ['text'] as MediaManifestInputKind[] },
        output: {
          types: ['audio'] as MediaManifestOutputKind[],
          mimeTypes: ['audio/wav', 'audio/pcm'],
        },
        paramSchema: ZHIPU_SPEECH_PARAM_SCHEMA as unknown as Record<string, unknown>,
        defaults: {
          voice: 'tongtong',
          format: 'wav',
          speed: 1,
          volume: 1,
          watermarkEnabled: true,
        },
        aliases: {
          format: 'response_format',
          watermarkEnabled: 'watermark_enabled',
        },
      },
    ],
    invocation: {
      mode: 'sync' as MediaInvocationMode,
      endpoint: '/audio/speech',
      method: 'POST',
      contentType: 'json',
      requestTemplate: {
        model: '{{modelId}}',
        input: '{{text}}',
        voice: '{{voice}}',
        response_format: '{{format}}',
        speed: '{{speed}}',
        volume: '{{volume}}',
        watermark_enabled: '{{watermarkEnabled}}',
      },
      // 官方默认 pcm 是裸流；已由 defaults.format='wav' 覆盖为可播放格式。
      response: { kind: 'binary_response' },
    },
    docs: { sourceUrls: [GLM_TTS_DOC], lastCheckedAt: '2026-09-30' },
    // input 官方 maxLength=1024（字符）。按平台规则仅作参考阈值与前端软提示，
    // 不在本地硬阻断；超长由厂商拒绝并回传原始错误。
    safety: {
      maxPromptLength: 1024,
      promptLengthUnit: 'characters',
      promptOverflowBehavior: 'reject',
      allowLocalFiles: true,
    },
    error: zhipuErrorContract,
  },
  {
    /* GLM-ASR-2512 语音转文本。请求是 multipart/form-data 文件上传，
       必须用 Contract V2 request.body 声明 file 段；legacy contentType:'multipart'
       只产出 text parts，会导致「发出一个没有文件的请求」并必然失败。
       响应是 JSON { text }，走 url retrieval 且 download:false（不下载，直接取文本）。 */
    id: 'zhipu:glm-asr-2512',
    providerKind: 'zhipu',
    modelId: 'glm-asr-2512',
    displayName: 'GLM-ASR-2512 语音转文本',
    domains: ['audio'] as MediaDomain[],
    capabilities: [
      {
        id: 'audio.transcription',
        label: '语音转文本',
        input: { required: ['audio'] as MediaManifestInputKind[], maxAudios: 1 },
        output: {
          types: ['text'] as MediaManifestOutputKind[],
          mimeTypes: ['text/plain'],
        },
        paramSchema: ZHIPU_ASR_PARAM_SCHEMA as unknown as Record<string, unknown>,
        defaults: {},
      },
    ],
    invocation: {
      mode: 'sync' as MediaInvocationMode,
      endpoint: '/audio/transcriptions',
      method: 'POST',
      // legacy 镜像字段：承载契约展示与调试链路；真实请求由下方 request 编译。
      contentType: 'multipart',
      requestTemplate: {
        model: '{{modelId}}',
        prompt: '{{prompt}}',
        hotwords: '{{hotwords}}',
        stream: false,
      },
      request: {
        method: 'POST',
        endpoint: '/audio/transcriptions',
        auth: { kind: 'inherit' },
        body: {
          kind: 'multipart',
          parts: [
            // 官方仅支持 wav / mp3；文件名由输入文件路径推断，contentType 交由
            // 默认 application/octet-stream，避免写死单一格式。
            { name: 'file', kind: 'file', value: '{{audio}}' },
            { name: 'model', kind: 'text', value: '{{modelId}}' },
            // 同步调用官方要求 stream=false。
            { name: 'stream', kind: 'text', value: 'false' },
            { name: 'prompt', kind: 'text', value: '{{prompt}}' },
            // 热词是 string[]，用 json kind 序列化；空值时编译期自动跳过该段。
            { name: 'hotwords', kind: 'json', value: '{{hotwords}}' },
          ],
        },
      },
      response: { kind: 'url', jsonPaths: ['text'], download: false },
    },
    docs: { sourceUrls: [GLM_ASR_DOC], lastCheckedAt: '2026-09-30' },
    // 官方硬约束：文件 ≤ 25MB、时长 ≤ 30 秒，格式 wav/mp3。
    // maxInputBytes 仅作契约记录与诊断提示，本地不做阻断（由 P1 validator 做确定性预检）。
    safety: {
      maxInputBytes: 25 * 1024 * 1024,
      allowLocalFiles: true,
    },
    error: zhipuErrorContract,
  },
]
