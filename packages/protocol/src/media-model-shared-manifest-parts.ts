/** Shared provider schemas extracted from the built-in manifest catalog. */

import type { MediaErrorContract, MediaModelParamPolicy } from './media-model-contract.js'

/**
 * Google Generative AI (Gemini / Veo) 错误响应归一规则。
 * 文档：https://ai.google.dev/gemini-api/docs/image-generation
 *
 * 结构形如：
 *   { error: { code: 400, message: '...', status: 'INVALID_ARGUMENT', details: [...] } }
 *
 * 与火山/xAI 不同，Google 的 `error.code` 是 HTTP 数字（如 400/403/429/500），
 * 真正的语义在 `error.status` 字段中。但首期不深挖 status，靠 message 关键词兜底即可。
 */
export const googleGenerativeAiErrorContract: MediaErrorContract = {
  codePaths: ['error.status', 'error.code'],
  messagePaths: ['error.message'],
  requestIdPaths: ['error.details[].request_id', 'request_id'],
  paramNamePatterns: ['parameter[:\\s]+`?([a-z_]+)`?'],
  mappings: {
    INVALID_ARGUMENT: 'invalid_parameter_value',
    FAILED_PRECONDITION: 'invalid_parameter_value',
    PERMISSION_DENIED: 'auth_failed',
    UNAUTHENTICATED: 'auth_failed',
    RESOURCE_EXHAUSTED: 'quota_exceeded',
    UNAVAILABLE: 'rate_limited',
    INTERNAL: 'task_failed',
  },
  retryableCodes: ['UNAVAILABLE', 'INTERNAL', 'RESOURCE_EXHAUSTED'],
}
/**
 * Google Gemini Image Contract V2 参数策略。
 *
 * 设计要点：
 *   - strict + passthrough.enabled=false：Gemini /interactions 端点对未知字段会 400，
 *     必须在编译期裁掉。
 *   - Google schema 用 `size` 接收比例（如 "16:9"），与 OpenAI 兼容路径用 size 接收
 *     像素（如 "1024x1024"）语义不同；这里不做 size → aspectRatio 的 transform，
 *     因为 Google 自己就支持 size 比例字段。
 *   - forbidden 不需要单独声明：strict 模式下任何未声明字段都会被丢弃。
 *   - 该 policy 在 4 个 Gemini image 模型（3.1 flash / 3.1 flash lite / 3 pro /
 *     2.5 flash）间共享。
 *
 * 参考：docs/multimedia-model-platform-adapters-design.md §Google 适配器
 *   https://ai.google.dev/gemini-api/docs/image-generation
 */
export const googleImageParamPolicy: MediaModelParamPolicy = {
  strict: true,
  passthrough: { enabled: false },
}

export const googleImageSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    size: {
      type: 'string',
      title: '画幅',
      enum: ['auto', '1:1', '3:2', '2:3', '4:3', '3:4', '5:4', '4:5', '16:9', '9:16', '21:9'],
    },
    resolution: { type: 'string', title: '分辨率', enum: ['1K', '2K', '4K'], default: '1K' },
    n: { type: 'integer', title: '数量', minimum: 1, maximum: 4, default: 1 },
    outputFormat: {
      type: 'string',
      title: '输出格式',
      enum: ['png', 'jpeg', 'webp'],
      default: 'png',
    },
    google_search: { type: 'boolean', title: 'Google 搜索', default: false },
    google_image_search: { type: 'boolean', title: 'Google 图片搜索', default: false },
  },
}

export const googleVeoVideoSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    aspectRatio: { type: 'string', title: '比例', enum: ['16:9', '9:16'], default: '16:9' },
    durationSeconds: { type: 'integer', title: '时长', minimum: 3, maximum: 10, default: 8 },
    resolution: { type: 'string', title: '分辨率', enum: ['720p', '1080p', '4k'], default: '720p' },
    personGeneration: { type: 'string', title: '人物生成', enum: ['allow_adult', 'dont_allow'] },
    seed: { type: 'integer', title: '随机种子' },
    useFirstFrame: { type: 'boolean', title: '使用首帧', default: true },
    useLastFrame: { type: 'boolean', title: '使用尾帧', default: false },
  },
}

export const googleOmniVideoSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    aspectRatio: { type: 'string', title: '比例', enum: ['16:9', '9:16', '1:1'], default: '16:9' },
    durationSeconds: { type: 'integer', title: '时长', minimum: 3, maximum: 10, default: 6 },
    resolution: { type: 'string', title: '分辨率', enum: ['720p'], default: '720p' },
    seed: { type: 'integer', title: '随机种子' },
    useFirstFrame: { type: 'boolean', title: '使用首帧/参考图', default: true },
  },
}

export const midjourneyGatewayImageSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    aspectRatio: { type: 'string', title: '比例', examples: ['1:1', '16:9', '9:16'] },
    stylize: { type: 'integer', title: 'Stylize', minimum: 0, maximum: 1000 },
    chaos: { type: 'integer', title: 'Chaos', minimum: 0, maximum: 100 },
    seed: { type: 'integer', title: '随机种子' },
    submitPath: { type: 'string', title: '提交路径', default: '/imagine' },
    statusPath: { type: 'string', title: '轮询路径', default: '/tasks/{{taskId}}' },
  },
}

export const bailianImageSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    size: {
      type: 'string',
      title: '画幅 / 图像规格',
      enum: ['1K', '2K', '4K'],
      examples: ['2048*2048', '2048*1536', '1536*2048', '2048*1152', '1152*2048'],
      'x-template-labels': {
        '2048*2048': '1:1',
        '2048*1536': '4:3',
        '1536*2048': '3:4',
        '2048*1152': '16:9',
        '1152*2048': '9:16',
      },
      // 百炼 Wan 2.7 同时支持 1K/2K/4K 档位和 width*height 自定义尺寸。
      'x-allow-custom': true,
      pattern: '^\\d+\\s*\\*\\s*\\d+$',
      default: '2K',
    },
    n: { type: 'integer', title: '数量', minimum: 1, maximum: 12, default: 1 },
    seed: { type: 'integer', title: '随机种子' },
    thinking_mode: { type: 'boolean', title: '思考模式', default: true },
    enable_sequential: { type: 'boolean', title: '组图模式', default: false },
    bbox_list: { type: 'array', title: '交互式编辑框' },
    color_palette: { type: 'array', title: '自定义颜色主题' },
    watermark: { type: 'boolean', title: '水印', default: false },
  },
}

/**
 * 百炼 Qwen-Image 2.0 系列图像参数（DashScope 原生协议）。
 * 与 wan 的 bailianImageSchema 关键差异：
 * - size 为像素星号格式（宽*高，如 2048*2048），不是 1K/2K/4K；
 * - 无 resolution / thinking_mode / enable_sequential / bbox_list / color_palette；
 * - n 上限 6（2.0 系列）。
 * 这是百炼渠道的独立 schema，与 apimart 的 qwen（比例 enum）完全不同，不可混用。
 * 官方来源：help.aliyun.com/zh/model-studio/qwen-image-api (nodeId 2975126)。
 */
export const bailianQwenImageSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    size: {
      type: 'string',
      title: '画幅',
      enum: ['2048*2048', '2688*1536', '1536*2688', '2368*1728', '1728*2368'],
      'x-template-labels': {
        '2048*2048': '1:1',
        '2688*1536': '16:9',
        '1536*2688': '9:16',
        '2368*1728': '4:3',
        '1728*2368': '3:4',
      },
      // 官方推荐尺寸对应 1:1、16:9、9:16、4:3、3:4；除此之外允许输入
      // 满足 provider 像素范围的自定义 width*height。
      'x-allow-custom': true,
      pattern: '^\\d+\\*\\d+$',
      default: '2048*2048',
    },
    n: { type: 'integer', title: '数量', minimum: 1, maximum: 6, default: 1 },
    negative_prompt: { type: 'string', title: '负面提示词', maxLength: 500 },
    prompt_extend: { type: 'boolean', title: '提示词智能改写', default: true },
    watermark: { type: 'boolean', title: '水印', default: false },
    seed: { type: 'integer', title: '随机种子', minimum: 0, maximum: 2147483647 },
  },
}

export const apimartSeedance2VideoSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    durationSeconds: { type: 'integer', title: '时长', minimum: 4, maximum: 15, default: 5 },
    aspectRatio: {
      type: 'string',
      title: '比例',
      enum: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', 'adaptive'],
      default: '16:9',
    },
    resolution: {
      type: 'string',
      title: '分辨率',
      enum: ['480p', '720p', '1080p', '4k'],
      default: '720p',
    },
    seed: { type: 'integer', title: '随机种子' },
    generate_audio: { type: 'boolean', title: '生成音频', default: true },
    return_last_frame: { type: 'boolean', title: '返回尾帧', default: false },
    useFirstFrame: { type: 'boolean', title: '使用首帧', default: true },
    useLastFrame: { type: 'boolean', title: '使用尾帧', default: false },
  },
}

export const klingVideoSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    aspectRatio: { type: 'string', title: '比例', enum: ['16:9', '9:16', '1:1'] },
    durationSeconds: { type: 'integer', title: '时长', enum: [5, 10] },
    mode: { type: 'string', title: '模式', enum: ['standard', 'professional'] },
    negative_prompt: { type: 'string', title: '负面提示词' },
    audio: { type: 'boolean', title: '生成音频', default: false },
    useFirstFrame: { type: 'boolean', title: '使用首帧', default: true },
    useLastFrame: { type: 'boolean', title: '使用尾帧', default: false },
  },
}

export const minimaxImageSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    aspectRatio: {
      type: 'string',
      title: '比例',
      enum: ['1:1', '16:9', '4:3', '3:2', '2:3', '3:4', '9:16', '21:9'],
      default: '1:1',
    },
    width: {
      type: 'integer',
      title: '宽度',
      minimum: 512,
      maximum: 2048,
      multipleOf: 8,
      examples: [1024, 1280, 1536, 2048],
      'x-allow-custom': true,
    },
    height: {
      type: 'integer',
      title: '高度',
      minimum: 512,
      maximum: 2048,
      multipleOf: 8,
      examples: [1024, 720, 864, 1280, 1536, 2048],
      'x-allow-custom': true,
    },
    response_format: { type: 'string', title: '响应格式', enum: ['url', 'base64'], default: 'url' },
    seed: { type: 'integer', title: '随机种子' },
    n: { type: 'integer', title: '数量', minimum: 1, maximum: 9, default: 1 },
    prompt_optimizer: { type: 'boolean', title: '提示词优化', default: false },
    aigc_watermark: { type: 'boolean', title: 'AIGC 水印', default: false },
  },
}

export const minimaxSpeechSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    voice: {
      type: 'string',
      title: '音色 ID',
      description: '映射到 MiniMax voice_setting.voice_id',
    },
    speed: { type: 'number', title: '语速', minimum: 0.5, maximum: 2, default: 1 },
    vol: { type: 'number', title: '音量', minimum: 0, maximum: 10, default: 1 },
    pitch: { type: 'integer', title: '音调', minimum: -12, maximum: 12, default: 0 },
    emotion: {
      type: 'string',
      title: '情绪',
      enum: ['happy', 'sad', 'angry', 'fearful', 'disgusted', 'surprised', 'calm', 'fluent', 'whisper'],
      description: 'fluent/whisper 仅 speech-2.6 系生效；speech-2.8 系不支持 whisper（来源 §1.2）',
    },
    language_boost: {
      type: 'string',
      title: '语言增强',
      enum: [
        'Chinese',
        'Chinese,Yue',
        'English',
        'Japanese',
        'Korean',
        'French',
        'German',
        'Spanish',
        'Portuguese',
        'Russian',
        'auto',
      ],
    },
    format: {
      type: 'string',
      title: '音频格式',
      enum: ['mp3', 'wav', 'pcm', 'flac'],
      default: 'mp3',
    },
    output_format: { type: 'string', title: '输出格式', enum: ['url', 'hex'], default: 'url' },
    aigc_watermark: { type: 'boolean', title: 'AIGC 水印', default: false },
    subtitle_enable: { type: 'boolean', title: '字幕', default: false },
    subtitle_type: {
      type: 'string',
      title: '字幕粒度',
      enum: ['sentence', 'word', 'word_streaming'],
      default: 'sentence',
    },
  },
}

export const minimaxMusicSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    lyrics: { type: 'string', title: '歌词' },
    output_format: { type: 'string', title: '输出格式', enum: ['url', 'hex'], default: 'hex' },
    aigc_watermark: { type: 'boolean', title: 'AIGC 水印', default: false },
    lyrics_optimizer: { type: 'boolean', title: '歌词优化', default: false },
    is_instrumental: { type: 'boolean', title: '纯音乐', default: false },
    format: {
      type: 'string',
      title: '音频格式',
      enum: ['mp3', 'wav', 'pcm'],
      default: 'mp3',
      description: '音乐生成仅支持 mp3/wav/pcm（来源 §6.1 audio_setting.format）',
    },
  },
}

/**
 * MiniMax Hailuo 2.3 / 2.3-Fast 视频生成（v1，POST /v1/video_generation）参数 schema。
 * 首/尾帧由画布 inputFiles 的 role(first_frame/last_frame) 驱动，不是 API 参数，
 * 因此不再暴露 useFirstFrame/useLastFrame（无对应官方字段，曾误导表单）。
 * 来源：docs/integrations/minimax/video-models.md §5.1-5.2
 */
export const minimaxHailuoVideoSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    durationSeconds: { type: 'integer', title: '时长', enum: [6, 10], default: 6 },
    resolution: { type: 'string', title: '分辨率', enum: ['768P', '1080P'], default: '768P' },
    prompt_optimizer: { type: 'boolean', title: '提示词优化', default: true },
    fast_pretreatment: { type: 'boolean', title: '快速预处理', default: false },
    aigc_watermark: { type: 'boolean', title: 'AIGC 水印', default: false },
  },
}

/**
 * image-01-live 画风增强 schema。与 image-01 的差异（来源 image-models.md §3）：
 *   - 不暴露 width / height（官方仅 image-01 生效）；
 *   - aspect_ratio 排除 21:9（官方仅 image-01 支持）；
 *   - 新增 style_type / style_weight 顶层参数，adapter 在 model=image-01-live 时
 *     组装成官方嵌套 { style: { style_type, style_weight } }（style 仅 image-01-live 生效）。
 */
export const minimaxImage01LiveSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    aspectRatio: {
      type: 'string',
      title: '比例',
      enum: ['1:1', '16:9', '4:3', '3:2', '2:3', '3:4', '9:16'],
      default: '1:1',
    },
    response_format: { type: 'string', title: '响应格式', enum: ['url', 'base64'], default: 'url' },
    seed: { type: 'integer', title: '随机种子' },
    n: { type: 'integer', title: '数量', minimum: 1, maximum: 9, default: 1 },
    prompt_optimizer: { type: 'boolean', title: '提示词优化', default: false },
    aigc_watermark: { type: 'boolean', title: 'AIGC 水印', default: false },
    style_type: {
      type: 'string',
      title: '画风类型',
      enum: ['漫画', '元气', '中世纪', '水彩'],
      description: '仅 image-01-live 生效',
    },
    style_weight: { type: 'number', title: '画风权重', minimum: 0, maximum: 1, default: 0.8 },
  },
}

/**
 * MiniMax-H3 视频生成 V2（POST /v2/video_generation，content[] 多模态数组）参数 schema。
 * 用于 i2v / r2v 场景：ratio 含 adaptive（由输入图或参考决定时用 adaptive）；t2v 用
 * minimaxH3VideoT2VSchema（ratio 必填且不含 adaptive）。resolution 官方支持 768P / 2K，
 * 默认 2K（adapter 读取后透传，缺省发 2K）。
 * 来源：docs/integrations/minimax/video-models-v2.md §4
 */
export const minimaxH3VideoSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    durationSeconds: { type: 'integer', title: '时长(秒)', minimum: 4, maximum: 15, default: 5 },
    resolution: {
      type: 'string',
      title: '分辨率',
      enum: ['768P', '2K'],
      default: '2K',
      description: '768P 出片更快更省，2K 画质更高（默认）',
    },
    aspectRatio: {
      type: 'string',
      title: '画幅',
      enum: ['adaptive', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16'],
      default: 'adaptive',
    },
    aigc_watermark: { type: 'boolean', title: 'AIGC 水印', default: false },
  },
}

/**
 * H3 文生视频（t2v, video.generate）专用比例 schema：ratio 必填且不能为 adaptive，
 * 故 enum 不含 adaptive（与 validator 约束一致）；resolution 与 i2v/r2v 一致。
 * 来源：video-models-v2.md §4.3。
 */
export const minimaxH3VideoT2VSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    durationSeconds: { type: 'integer', title: '时长(秒)', minimum: 4, maximum: 15, default: 5 },
    resolution: {
      type: 'string',
      title: '分辨率',
      enum: ['768P', '2K'],
      default: '2K',
      description: '768P 出片更快更省，2K 画质更高（默认）',
    },
    aspectRatio: {
      type: 'string',
      title: '画幅',
      enum: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'],
      default: '16:9',
    },
    aigc_watermark: { type: 'boolean', title: 'AIGC 水印', default: false },
  },
}

/**
 * 视频 Agent 模板 id 清单（11 个，2026-07-31 抓取自官方 FAQ）。
 * 来源：docs/integrations/minimax/video-templates.md §4
 * https://platform.minimaxi.com/docs/faq/video-agent-templates
 */
export const MINIMAX_VIDEO_TEMPLATE_IDS = [
  '392753057216684038',
  '393881433990066176',
  '393769180141805569',
  '394246956137422856',
  '393879757702918151',
  '393766210733957121',
  '394125185182695432',
  '393857704283172864',
  '398574688191234048',
  '393866076583718914',
  '393876118804459526',
] as const

/** template_id → 中文模板名（供画布下拉渲染）。来源同上。 */
export const MINIMAX_VIDEO_TEMPLATE_LABELS: Record<string, string> = {
  '392753057216684038': '跳水',
  '393881433990066176': '吊环',
  '393769180141805569': '绝地求生',
  '394246956137422856': '万物皆可 labubu',
  '393879757702918151': '麦当劳宠物外卖员',
  '393766210733957121': '藏族风写真',
  '394125185182695432': '生无可恋',
  '393857704283172864': '情书写真',
  '398574688191234048': '四季写真',
  '393866076583718914': '女模特试穿广告',
  '393876118804459526': '男模特试穿广告',
}

/**
 * 视频 Agent（POST /v1/video_template_generation）参数 schema。templateId 作为 enum 字段，
 * 画布 CanvasParameterControl 自动渲染下拉（Path 1，零画布层改动）；中文名通过自定义
 * 关键字 x-template-labels 注入。media_inputs / text_inputs 由画布 inputFiles / prompt 驱动。
 * 来源：docs/integrations/minimax/video-templates.md §2-4
 */
export const minimaxVideoTemplateSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    templateId: {
      type: 'string',
      title: '模板',
      enum: [...MINIMAX_VIDEO_TEMPLATE_IDS],
      'x-template-labels': MINIMAX_VIDEO_TEMPLATE_LABELS,
      description: '视频 Agent 模板，清单见 docs/integrations/minimax/video-templates.md §4',
    },
    callbackUrl: { type: 'string', title: '回调地址（可选）' },
  },
}

export const audioSpeechSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    voice: { type: 'string', title: '音色' },
    format: { type: 'string', title: '格式', enum: ['mp3', 'wav', 'opus', 'aac', 'flac', 'pcm'] },
    speed: { type: 'number', title: '速度', minimum: 0.25, maximum: 4 },
  },
}

export const agnesImageSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    size: {
      type: 'string',
      title: '尺寸',
      enum: ['1024x1024', '1024x768', '768x1024', '1152x768', '768x1152'],
      default: '1024x1024',
    },
    responseFormat: {
      type: 'string',
      title: '响应格式',
      enum: ['url', 'b64_json'],
      default: 'url',
    },
    returnBase64: { type: 'boolean', title: '直接返回 Base64', default: false },
    seed: { type: 'integer', title: '随机种子' },
  },
}

export const agnesVideoSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    aspectRatio: {
      type: 'string',
      title: '比例',
      enum: ['16:9', '9:16', '1:1', '4:3', '3:4'],
      default: '16:9',
    },
    resolution: {
      type: 'string',
      title: '分辨率',
      enum: ['480p', '720p', '1080p'],
      default: '720p',
    },
    durationSeconds: { type: 'integer', title: '时长', minimum: 1, maximum: 18, default: 5 },
    fps: { type: 'integer', title: '帧率', minimum: 1, maximum: 60, default: 24 },
    numFrames: { type: 'integer', title: '总帧数', minimum: 9, maximum: 441 },
    numInferenceSteps: { type: 'integer', title: '推理步数', minimum: 1, maximum: 100 },
    mode: { type: 'string', title: '模式', enum: ['ti2vid', 'keyframes'] },
    negativePrompt: { type: 'string', title: '负面提示词' },
    seed: { type: 'integer', title: '随机种子' },
  },
}
