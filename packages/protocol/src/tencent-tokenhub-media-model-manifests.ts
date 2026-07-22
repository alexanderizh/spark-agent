/**
 * 腾讯云 TokenHub 多媒体模型清单（图片 + 视频）。
 *
 * 仅保存腾讯模型差异；画布继续消费通用 manifest/rolePolicy，不感知 provider。
 * 参数与端点核对自 2026-07-22 抓取的官方文档：
 *   - 图像生成 https://cloud.tencent.com/document/product/1823/130080
 *   - 视频生成 https://cloud.tencent.com/document/product/1823/130081
 *   - 模型清单 https://cloud.tencent.com/document/product/1823/130051
 *   - 错误码   https://cloud.tencent.com/document/product/1823/131595
 *   - Kling/Vidu 参数 https://cloud.tencent.com/document/product/1616/130564 / 130563
 *
 * 端点形态（OpenAI 兼容层，统一小写下划线）：
 *   - hy-image-lite 同步：POST /v1/api/image/lite           → data:[{url}]
 *   - hy-image-v3.0 异步： POST /v1/api/image/submit|query  → query data:[{url}]（数组）
 *   - 视频异步（全部）：   POST /v1/api/video/submit|query   → query data:{url}（对象，非数组）
 *
 * 因专用 TencentTokenhubMediaAdapter.supports() 为真，manifest 的 requestTemplate
 * 不参与线上请求（router shouldUseManifestAdapter 判定）；manifest 仍驱动 UI 表单、
 * 参数校验、错误归一与 catalog 检索。statusEndpoint 为 manifest 校验必填字符串，
 * 实际查询由 adapter 自组装 POST body {model, id}，不读 statusEndpoint 模板。
 */

import type { MediaErrorContract, MediaModelParamPolicy } from './media-model-contract.js'
import type {
  MediaInvocationMode,
  MediaManifestInputKind,
  MediaManifestOutputKind,
  MediaModelCapabilityManifest,
  MediaModelManifest,
} from './media-model-manifest.js'
import type { MediaInputRolePolicy } from './media-config.js'

const DOC_ROOT = 'https://cloud.tencent.com/document/product/1823'
const IMAGE_API_DOC = `${DOC_ROOT}/130080`
const VIDEO_API_DOC = `${DOC_ROOT}/130081`
const MODEL_LIST_DOC = `${DOC_ROOT}/130051`
const ERROR_CODES_DOC = `${DOC_ROOT}/131595`
const KL_VIDEO_DOC = 'https://cloud.tencent.com/document/product/1616/130564'
const KL_IMAGE_VIDEO_DOC = 'https://cloud.tencent.com/document/product/1616/130567'
const KL_DATA_STRUCTURES_DOC = 'https://cloud.tencent.com/document/product/1616/107808'
const VD_VIDEO_DOC = 'https://cloud.tencent.com/document/product/1616/130563'
const VD_IMAGE_VIDEO_DOC = 'https://cloud.tencent.com/document/product/1616/130530'
const VIDEO_FX_DOC = 'https://cloud.tencent.com/document/product/1616/119001'
const VIDEO_FX_TEMPLATES_DOC = 'https://cloud.tencent.com/document/product/1616/119194'
const HUMAN_ACTOR_DOC = 'https://cloud.tencent.com/document/product/1616/125458'
const LAST_CHECKED = '2026-07-23'

/**
 * TokenHub 错误结构（docs/design/tencent-cloud-multimedia/error-codes.md §1.1）：
 *   { error: { message, message_zh, code, type, source, request_id } }
 * code 为整数字符串（如 '401002'），限流场景可能整型返回。
 * 业务码 → MediaNormalizedErrorCode 映射核对自 error-codes.md §1.2。
 */
export const tencentTokenhubErrorContract: MediaErrorContract = {
  codePaths: ['error.code', 'code'],
  messagePaths: ['error.message_zh', 'error.message', 'message'],
  requestIdPaths: ['error.request_id', 'request_id', 'requestId'],
  paramNamePatterns: ['parameter[:\\s]+`?([a-z_]+)`?', '参数[:\\s]+`?([a-z_]+)`?'],
  mappings: {
    // 400xx 参数/请求
    '400001': 'invalid_parameter_value',
    '400002': 'invalid_parameter_value',
    '400003': 'invalid_parameter_value',
    '400004': 'unsupported_parameter',
    '400005': 'unsupported_parameter',
    '400006': 'unsupported_parameter',
    '401006': 'unsupported_parameter',
    // 401 鉴权
    '401001': 'auth_failed',
    '401002': 'auth_failed',
    '401003': 'auth_failed',
    '401004': 'auth_failed',
    '401005': 'auth_failed',
    // 402 付费 / 配额
    '401007': 'quota_exceeded',
    '401008': 'quota_exceeded',
    '403004': 'quota_exceeded',
    // 403 权限
    '403001': 'auth_failed',
    '403002': 'auth_failed',
    '403003': 'auth_failed',
    '403005': 'auth_failed',
    '403006': 'unsupported_parameter',
    // 429 限流（全部可重试）
    '429001': 'rate_limited',
    '429002': 'rate_limited',
    '429003': 'rate_limited',
    '429004': 'rate_limited',
    '429005': 'rate_limited',
    '429006': 'rate_limited',
    // 451 内容
    '451001': 'content_policy_blocked',
    // 5xx 上游/内部（可重试）
    '500001': 'task_failed',
    '502001': 'task_failed',
    '503001': 'task_failed',
    '504001': 'task_timeout',
  },
  retryableCodes: [
    '429001',
    '429002',
    '429003',
    '429004',
    '429005',
    '429006',
    '502001',
    '503001',
    '504001',
  ],
}

const strictParamPolicy: MediaModelParamPolicy = {
  strict: true,
  passthrough: { enabled: false },
}

const TENCENT_IMAGE_INPUT_MIME = ['image/jpeg', 'image/png', 'image/webp']
const TENCENT_KLING_IMAGE_INPUT_MIME = ['image/jpeg', 'image/png']
const TENCENT_FX_IMAGE_INPUT_MIME = [...TENCENT_IMAGE_INPUT_MIME, 'image/bmp', 'image/tiff']
const TENCENT_HUMAN_ACTOR_INPUT_MIME = [
  ...TENCENT_IMAGE_INPUT_MIME,
  'image/bmp',
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
]
const TENCENT_VIDEO_OUTPUT_MIME = ['video/mp4']

/** 视频 invocation（全部视频模型共享）：submit + query 都是 POST，异步轮询。 */
function tencentVideoInvocation(): MediaModelManifest['invocation'] {
  return {
    mode: 'async_polling' as MediaInvocationMode,
    endpoint: '/v1/api/video/submit',
    method: 'POST',
    contentType: 'json',
    requestTemplate: { model: '{{modelId}}', prompt: '{{prompt}}' },
    response: {
      kind: 'task_poll',
      taskIdPaths: ['id'],
      // adapter 实际用 POST body {model, id}；此字段仅供 manifest 校验通过（纯路径无变量）
      statusEndpoint: '/v1/api/video/query',
      resultPaths: ['data.url'],
    },
    polling: {
      intervalMs: 5_000,
      timeoutMs: 30 * 60 * 1_000,
      statusMap: {
        queued: 'queued',
        pending: 'queued',
        in_progress: 'running',
        running: 'running',
        processing: 'running',
        completed: 'succeeded',
        succeeded: 'succeeded',
        success: 'succeeded',
        done: 'succeeded',
        failed: 'failed',
        error: 'failed',
        cancelled: 'cancelled',
        canceled: 'cancelled',
      },
    },
  }
}

// ─── 图片：hy-image-lite 同步 ────────────────────────────────────────────────
function hunyuanImageLiteManifest(): MediaModelManifest {
  const schema = {
    type: 'object',
    additionalProperties: false,
    properties: {
      rspImgType: {
        type: 'string',
        title: '响应类型',
        enum: ['url'],
        default: 'url',
        readOnly: true,
      },
    },
  }
  return {
    id: 'tencent-tokenhub:hy-image-lite',
    providerKind: 'tencent-tokenhub',
    modelId: 'hy-image-lite',
    displayName: '混元 Image Lite（同步）',
    domains: ['image'],
    capabilities: [
      {
        id: 'image.generate',
        label: '文生图',
        input: { required: ['prompt'] as MediaManifestInputKind[] },
        output: {
          types: ['image'] as MediaManifestOutputKind[],
          mimeTypes: ['image/png', 'image/jpeg'],
        },
        paramSchema: schema,
        defaults: { rspImgType: 'url' },
        aliases: { rspImgType: 'rsp_img_type' },
        paramPolicy: strictParamPolicy,
      },
    ],
    invocation: {
      mode: 'sync' as MediaInvocationMode,
      endpoint: '/v1/api/image/lite',
      method: 'POST',
      contentType: 'json',
      requestTemplate: {
        model: '{{modelId}}',
        prompt: '{{prompt}}',
        rsp_img_type: '{{rspImgType}}',
      },
      response: { kind: 'url', jsonPaths: ['data[].url'], download: true },
    },
    docs: {
      sourceUrls: [IMAGE_API_DOC, MODEL_LIST_DOC, ERROR_CODES_DOC],
      lastCheckedAt: LAST_CHECKED,
    },
    safety: { maxPromptLength: 2000, allowLocalFiles: true, maxInputBytes: 10 * 1024 * 1024 },
    error: tencentTokenhubErrorContract,
  }
}

// ─── 图片：hy-image-v3.0 异步（文生图 + 图生图）──────────────────────────────
function hunyuanImageV3Manifest(): MediaModelManifest {
  const schema = {
    type: 'object',
    additionalProperties: false,
    properties: {},
  }
  const generateCap: MediaModelCapabilityManifest = {
    id: 'image.generate',
    label: '文生图',
    input: { required: ['prompt'] as MediaManifestInputKind[] },
    output: {
      types: ['image'] as MediaManifestOutputKind[],
      mimeTypes: ['image/png', 'image/jpeg'],
    },
    paramSchema: schema,
    paramPolicy: strictParamPolicy,
  }
  const editCap: MediaModelCapabilityManifest = {
    id: 'image.edit',
    label: '图生图',
    input: {
      required: ['prompt', 'image'] as MediaManifestInputKind[],
      maxImages: 3,
      acceptedMimeTypes: TENCENT_IMAGE_INPUT_MIME,
    },
    rolePolicy: {
      imageRoles: ['reference_image'],
      defaultRoleAssignment: 'all_reference',
    } as MediaInputRolePolicy,
    output: {
      types: ['image'] as MediaManifestOutputKind[],
      mimeTypes: ['image/png', 'image/jpeg'],
    },
    paramSchema: schema,
    paramPolicy: strictParamPolicy,
  }
  return {
    id: 'tencent-tokenhub:hy-image-v3.0',
    providerKind: 'tencent-tokenhub',
    modelId: 'hy-image-v3.0',
    displayName: '混元 Image 3.0（异步）',
    domains: ['image'],
    capabilities: [generateCap, editCap],
    invocation: {
      mode: 'async_polling' as MediaInvocationMode,
      endpoint: '/v1/api/image/submit',
      method: 'POST',
      contentType: 'json',
      requestTemplate: { model: '{{modelId}}', prompt: '{{prompt}}', images: '{{images}}' },
      response: {
        kind: 'task_poll',
        taskIdPaths: ['id'],
        statusEndpoint: '/v1/api/image/query',
        resultPaths: ['data[].url'],
      },
      polling: {
        intervalMs: 3_000,
        timeoutMs: 10 * 60 * 1_000,
        statusMap: {
          queued: 'queued',
          pending: 'queued',
          in_progress: 'running',
          running: 'running',
          completed: 'succeeded',
          succeeded: 'succeeded',
          success: 'succeeded',
          failed: 'failed',
          error: 'failed',
          cancelled: 'cancelled',
          canceled: 'cancelled',
        },
      },
    },
    docs: {
      sourceUrls: [IMAGE_API_DOC, MODEL_LIST_DOC, ERROR_CODES_DOC],
      lastCheckedAt: LAST_CHECKED,
    },
    safety: { maxPromptLength: 2000, allowLocalFiles: true, maxInputBytes: 10 * 1024 * 1024 },
    error: tencentTokenhubErrorContract,
  }
}

// ─── 混元 / 优图原生视频（4 个）──────────────────────────────────────────────
type NativeVideoKind = 'generic' | 'template' | 'human'

const LOGO_PROPERTIES = {
  logoAdd: { type: 'integer', title: '显式标识', enum: [0, 1], default: 1 },
  logoParam: { type: 'object', title: '自定义标识', additionalProperties: true },
} as const

const LOGO_ALIASES = { logoAdd: 'logo_add', logoParam: 'logo_param' } as const

/** 119194 于 2026-07-23 页面列出的 141 个唯一 template 值。 */
const TENCENT_VIDEO_FX_TEMPLATES = [
  'kissing',
  'hearting',
  'hug',
  'kissface',
  'fuzzy',
  'pinch',
  'befigure',
  'longhair',
  'bloom',
  'morphlab',
  'balloonfly',
  'dragme',
  'minidoll',
  'graduation',
  'rotate',
  'knockedfly',
  'windonface',
  'return2dust',
  'deflate',
  'flying',
  'surfme',
  'birthdayme',
  'egyptme',
  'neverlookback',
  'futuresoldier',
  'petdance',
  'mermaidme',
  'falldown',
  'picmotion',
  'shoehit',
  'napme',
  'arrestrandom',
  'pandahug',
  'bridalcarry',
  'manhair',
  'muscleme',
  'crushme',
  'facepinch',
  'baldme',
  'mywings',
  'breaklens',
  'zoomout',
  'animelive',
  'livephoto',
  'surfing',
  'heavensentlove',
  'zoomin',
  'cartoonlive',
  '3dfigure',
  'caresskiss',
  'frenchkiss',
  'onestory',
  'removeperson',
  'hairstyle',
  'timegaze',
  'dissipation',
  '3dfigurerot',
  'y2kparty',
  'wallkiss',
  'befire',
  'babyme',
  'duplicateself',
  'atomy',
  'flashman5',
  'koalakiss',
  'figurine',
  'ridefly',
  'cheeks',
  'rainfall',
  'cyber',
  'prison',
  'asiaswag',
  'bullettime',
  'acgnme',
  'somecakes',
  'turkeyfeast',
  'oldlive',
  'seastyle',
  'skiing2',
  'beauty',
  'santahat',
  'santashow',
  'ontosleigh',
  'reindeerme',
  'hairstyle2',
  'xmasparty',
  'santaaround',
  'dollyzoomin',
  'dollyzoomout',
  'to2026',
  'kaleidoscope',
  'elvesme',
  'unboxing',
  'blinkwinter',
  'goldcoinshower',
  'dreamyclouds',
  'firstsip',
  'oilpainting',
  'petsgreetings',
  'sendblessings',
  'goldsilver',
  'berich1',
  'wealthgod',
  'fortunebags',
  'focusme',
  'greetingsmoney',
  'berich2',
  'horseback',
  'skylantern',
  'gallopingsoar2',
  'springportrait',
  'theone',
  'festblessings',
  'gallopingsoar1',
  'fireworksphoto',
  'horseback1',
  'horseback3',
  'animalgreetings',
  'mangreetings',
  'babygreetings',
  'womangreetings',
  'fireworksbox',
  'familypic',
  'familyjoy',
  'petfest',
  'joyreunion',
  'joybaby',
  'cutpaperfest',
  '3dcoltlantern',
  'horselantern',
  'sweetfairy',
  'bowlstars',
  '38unbox',
  'befamous',
  'tvprank',
  'turnintovase',
  'boatinggreen',
  'facepet',
  'petworking',
  'petbricking',
  'pettripping',
] as const

function nativeVideoManifest(input: {
  modelId: string
  displayName: string
  textToVideo: boolean
  kind: NativeVideoKind
}): MediaModelManifest {
  const capabilities: MediaModelCapabilityManifest[] = []
  if (input.textToVideo) {
    capabilities.push({
      id: 'video.generate',
      label: '文生视频',
      input: { required: ['prompt'] as MediaManifestInputKind[] },
      output: { types: ['video'], mimeTypes: TENCENT_VIDEO_OUTPUT_MIME },
      paramSchema: { type: 'object', additionalProperties: false, properties: {} },
      paramPolicy: strictParamPolicy,
    })
  }

  if (input.kind === 'template') {
    capabilities.push({
      id: 'video.image_to_video',
      label: '视频特效（图片 + 模板）',
      input: {
        required: ['image'] as MediaManifestInputKind[],
        maxImages: 10,
        acceptedMimeTypes: TENCENT_FX_IMAGE_INPUT_MIME,
      },
      rolePolicy: {
        imageRoles: ['reference_image'],
        defaultRoleAssignment: 'all_reference',
      } as MediaInputRolePolicy,
      output: { types: ['video'], mimeTypes: TENCENT_VIDEO_OUTPUT_MIME },
      paramSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          template: {
            type: 'string',
            title: '特效模板',
            enum: [...TENCENT_VIDEO_FX_TEMPLATES],
            'x-allow-custom': true,
            minLength: 1,
            default: 'hug',
            description:
              '腾讯视频特效 template；已录入官方当前 141 个唯一值，并允许新模板自定义输入',
          },
          resolution: {
            type: 'string',
            title: '分辨率',
            enum: ['360p', '540p', '720p'],
            default: '360p',
          },
          bgm: { type: 'boolean', title: '背景音乐', default: false },
          ...LOGO_PROPERTIES,
          extraParam: { type: 'object', title: '扩展参数', additionalProperties: true },
        },
      },
      defaults: { template: 'hug', resolution: '360p', bgm: false, logoAdd: 1 },
      aliases: { ...LOGO_ALIASES, extraParam: 'extra_param' },
      paramPolicy: strictParamPolicy,
    })
  } else if (input.kind === 'human') {
    capabilities.push({
      id: 'video.image_to_video',
      label: '人像驱动（图片 + 音频）',
      input: {
        required: ['prompt', 'image', 'audio'] as MediaManifestInputKind[],
        maxImages: 1,
        maxAudios: 1,
        acceptedMimeTypes: TENCENT_HUMAN_ACTOR_INPUT_MIME,
      },
      rolePolicy: {
        imageRoles: ['first_frame'],
        audioRoles: ['reference_audio'],
        defaultRoleAssignment: 'first_then_last_then_reference',
      } as MediaInputRolePolicy,
      output: { types: ['video'], mimeTypes: TENCENT_VIDEO_OUTPUT_MIME },
      paramSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          resolution: {
            type: 'string',
            title: '分辨率',
            enum: ['720p', '1080p'],
            default: '1080p',
          },
          frameRate: { type: 'integer', title: '帧率', enum: [25, 50], default: 50 },
          ...LOGO_PROPERTIES,
        },
      },
      defaults: { resolution: '1080p', frameRate: 50, logoAdd: 1 },
      aliases: { ...LOGO_ALIASES, frameRate: 'frame_rate' },
      paramPolicy: strictParamPolicy,
    })
  } else {
    capabilities.push({
      id: 'video.image_to_video',
      label: '图生视频',
      input: {
        required: ['image'] as MediaManifestInputKind[],
        maxImages: 1,
        acceptedMimeTypes: TENCENT_IMAGE_INPUT_MIME,
      },
      rolePolicy: {
        imageRoles: ['first_frame'],
        defaultRoleAssignment: 'first_then_last_then_reference',
      } as MediaInputRolePolicy,
      output: { types: ['video'], mimeTypes: TENCENT_VIDEO_OUTPUT_MIME },
      paramSchema: { type: 'object', additionalProperties: false, properties: {} },
      paramPolicy: strictParamPolicy,
    })
  }

  const sourceUrls =
    input.kind === 'template'
      ? [VIDEO_API_DOC, VIDEO_FX_DOC, VIDEO_FX_TEMPLATES_DOC, ERROR_CODES_DOC]
      : input.kind === 'human'
        ? [VIDEO_API_DOC, HUMAN_ACTOR_DOC, ERROR_CODES_DOC]
        : [VIDEO_API_DOC, MODEL_LIST_DOC, ERROR_CODES_DOC]
  return {
    id: `tencent-tokenhub:${input.modelId}`,
    providerKind: 'tencent-tokenhub',
    modelId: input.modelId,
    displayName: input.displayName,
    domains: ['video'],
    capabilities,
    invocation: tencentVideoInvocation(),
    docs: { sourceUrls, lastCheckedAt: LAST_CHECKED },
    safety: {
      maxPromptLength: input.kind === 'human' ? 5000 : 2500,
      promptLengthUnit: 'characters',
      promptOverflowBehavior: 'reject',
      allowLocalFiles: true,
      maxInputBytes: 10 * 1024 * 1024,
    },
    error: tencentTokenhubErrorContract,
  }
}

// ─── Kling（TokenHub 当前 9 个 kl-video-*）──────────────────────────────────
const KLING_ALIASES = {
  durationSeconds: 'duration',
  aspectRatio: 'aspect_ratio',
  cfgScale: 'cfg_scale',
  negativePrompt: 'negative_prompt',
  ...LOGO_ALIASES,
  multiShot: 'multi_shot',
  shotType: 'shot_type',
  multiPrompt: 'multi_prompt',
  cameraControl: 'camera_control',
  callbackUrl: 'callback_url',
  externalTaskId: 'external_task_id',
  elementList: 'element_list',
  staticMask: 'static_mask',
  dynamicMasks: 'dynamic_masks',
  voiceList: 'voice_list',
} as const

function klingProperties(input: {
  durations: number[]
  modes: string[]
  cfgScale: boolean
  sound: boolean
  imageToVideo: boolean
  voiceList: boolean
}): Record<string, unknown> {
  const properties: Record<string, unknown> = {
    durationSeconds: {
      type: 'integer',
      title: '时长（秒）',
      enum: input.durations,
      default: 5,
    },
    negativePrompt: { type: 'string', title: '负向提示词', maxLength: 2500 },
    ...LOGO_PROPERTIES,
    multiShot: { type: 'boolean', title: '多镜头', default: false },
    shotType: {
      type: 'string',
      title: '分镜方式',
      enum: ['customize', 'intelligence'],
    },
    multiPrompt: {
      type: 'array',
      title: '分镜列表',
      minItems: 1,
      maxItems: 6,
      description: '1–6 个分镜；每项使用 index / prompt / duration，时长合计必须等于总时长',
      items: { type: 'object', additionalProperties: true },
    },
    cameraControl: {
      type: 'object',
      title: '运镜控制',
      description: 'type=simple 时 config 六选一；数值范围 -10～10',
      additionalProperties: true,
    },
    callbackUrl: { type: 'string', title: '回调地址' },
    externalTaskId: { type: 'string', title: '外部任务 ID' },
  }
  if (!input.imageToVideo) {
    properties.aspectRatio = {
      type: 'string',
      title: '比例',
      enum: ['16:9', '9:16', '1:1'],
      default: '16:9',
    }
  }
  if (input.modes.length > 0) {
    properties.mode = {
      type: 'string',
      title: '模式',
      enum: input.modes,
      default: input.modes[0],
    }
  }
  if (input.cfgScale) {
    properties.cfgScale = {
      type: 'number',
      title: '提示词相关性',
      minimum: 0,
      maximum: 1,
      default: 0.5,
    }
  }
  if (input.sound) {
    properties.sound = {
      type: 'string',
      title: '同步生成声音',
      enum: ['on', 'off'],
      default: 'off',
    }
  }
  if (input.imageToVideo) {
    Object.assign(properties, {
      elementList: {
        type: 'array',
        title: '参考主体',
        maxItems: 3,
        items: { type: 'object', additionalProperties: true },
      },
      staticMask: { type: 'string', title: '静态笔刷蒙版' },
      dynamicMasks: {
        type: 'array',
        title: '动态笔刷',
        maxItems: 6,
        items: { type: 'object', additionalProperties: true },
      },
    })
    if (input.voiceList) {
      properties.voiceList = {
        type: 'array',
        title: '指定音色',
        maxItems: 2,
        items: { type: 'object', additionalProperties: true },
      }
    }
  }
  return properties
}

function klingVideoManifest(input: {
  modelId: string
  displayName: string
  durations: number[]
  textModes: string[]
  imageModes: string[]
  cfgScale: boolean
  sound: boolean
  voiceList: boolean
}): MediaModelManifest {
  const capability = (
    id: 'video.generate' | 'video.image_to_video',
  ): MediaModelCapabilityManifest => {
    const isImageToVideo = id === 'video.image_to_video'
    const modes = isImageToVideo ? input.imageModes : input.textModes
    const properties = klingProperties({
      durations: input.durations,
      modes,
      cfgScale: input.cfgScale,
      sound: input.sound,
      imageToVideo: isImageToVideo,
      voiceList: input.voiceList,
    })
    return {
      id,
      label: isImageToVideo ? '图生视频（首帧 / 首尾帧）' : '文生视频',
      input: isImageToVideo
        ? {
            required: ['image'] as MediaManifestInputKind[],
            maxImages: 2,
            acceptedMimeTypes: TENCENT_KLING_IMAGE_INPUT_MIME,
          }
        : { required: [] as MediaManifestInputKind[] },
      ...(isImageToVideo
        ? {
            rolePolicy: {
              imageRoles: ['first_frame', 'last_frame'],
              defaultRoleAssignment: 'first_then_last_then_reference',
            } as MediaInputRolePolicy,
          }
        : {}),
      output: { types: ['video'], mimeTypes: TENCENT_VIDEO_OUTPUT_MIME },
      paramSchema: { type: 'object', additionalProperties: false, properties },
      defaults: {
        durationSeconds: 5,
        ...(!isImageToVideo ? { aspectRatio: '16:9' } : {}),
        logoAdd: 1,
        multiShot: false,
        ...(modes.length > 0 ? { mode: modes[0] } : {}),
        ...(input.cfgScale ? { cfgScale: 0.5 } : {}),
        ...(input.sound ? { sound: 'off' } : {}),
      },
      aliases: KLING_ALIASES,
      paramPolicy: strictParamPolicy,
    }
  }
  return {
    id: `tencent-tokenhub:${input.modelId}`,
    providerKind: 'tencent-tokenhub',
    modelId: input.modelId,
    displayName: input.displayName,
    domains: ['video'],
    capabilities: [capability('video.generate'), capability('video.image_to_video')],
    invocation: tencentVideoInvocation(),
    docs: {
      sourceUrls: [
        MODEL_LIST_DOC,
        VIDEO_API_DOC,
        KL_VIDEO_DOC,
        KL_IMAGE_VIDEO_DOC,
        KL_DATA_STRUCTURES_DOC,
        ERROR_CODES_DOC,
      ],
      lastCheckedAt: LAST_CHECKED,
    },
    safety: {
      maxPromptLength: 2500,
      promptLengthUnit: 'characters',
      promptOverflowBehavior: 'reject',
      allowLocalFiles: true,
      maxInputBytes: 10 * 1024 * 1024,
    },
    error: tencentTokenhubErrorContract,
  }
}

// ─── Vidu（TokenHub 当前 6 个 vd-video-*）───────────────────────────────────
const VIDU_ALIASES = {
  durationSeconds: 'duration',
  aspectRatio: 'aspect_ratio',
  isRec: 'is_rec',
  voiceId: 'voice_id',
  audioType: 'audio_type',
  metaData: 'meta_data',
  callbackUrl: 'callback_url',
  offPeak: 'off_peak',
  ...LOGO_ALIASES,
} as const

function viduOperationalProperties(input: {
  minDuration: number
  maxDuration: number
  resolutions: string[]
}): Record<string, unknown> {
  return {
    durationSeconds: {
      type: 'integer',
      title: '时长（秒）',
      minimum: input.minDuration,
      maximum: input.maxDuration,
      default: 5,
    },
    resolution: {
      type: 'string',
      title: '分辨率',
      enum: input.resolutions,
      default: '720p',
    },
    metaData: { type: 'string', title: '元数据 JSON 字符串' },
    callbackUrl: { type: 'string', title: '回调地址' },
    payload: { type: 'string', title: '透传数据', maxLength: 1_048_576 },
    offPeak: { type: 'boolean', title: '错峰模式', default: false },
    ...LOGO_PROPERTIES,
  }
}

function viduVideoManifest(input: {
  modelId: string
  displayName: string
  family: 'q2' | 'q3'
  textMinDuration: number
  textMaxDuration: number
  imageMinDuration: number
  imageMaxDuration: number
  imageResolutions: string[]
}): MediaModelManifest {
  const isQ3 = input.family === 'q3'
  const textProperties = {
    ...viduOperationalProperties({
      minDuration: input.textMinDuration,
      maxDuration: input.textMaxDuration,
      resolutions: ['540p', '720p', '1080p'],
    }),
    aspectRatio: {
      type: 'string',
      title: '比例',
      enum: ['16:9', '9:16', '4:3', '3:4', '1:1'],
      default: '16:9',
    },
    ...(isQ3
      ? { audio: { type: 'boolean', title: '音视频直出', default: false } }
      : { bgm: { type: 'boolean', title: '背景音乐', default: false } }),
  }
  const imageProperties = {
    ...viduOperationalProperties({
      minDuration: input.imageMinDuration,
      maxDuration: input.imageMaxDuration,
      resolutions: input.imageResolutions,
    }),
    isRec: { type: 'boolean', title: '推荐提示词', default: false },
    audio: { type: 'boolean', title: '音视频直出', default: isQ3 },
    voiceId: { type: 'string', title: '指定音色 ID' },
    ...(!isQ3
      ? {
          audioType: {
            type: 'string',
            title: '音频类型',
            enum: ['all', 'speech_only', 'sound_effect_only'],
            default: 'all',
          },
          bgm: { type: 'boolean', title: '背景音乐', default: false },
        }
      : {}),
  }
  const textCapability: MediaModelCapabilityManifest = {
    id: 'video.generate',
    label: '文生视频',
    input: { required: ['prompt'] as MediaManifestInputKind[] },
    output: { types: ['video'], mimeTypes: TENCENT_VIDEO_OUTPUT_MIME },
    paramSchema: { type: 'object', additionalProperties: false, properties: textProperties },
    defaults: {
      durationSeconds: 5,
      resolution: '720p',
      aspectRatio: '16:9',
      offPeak: false,
      logoAdd: 1,
      ...(isQ3 ? { audio: false } : { bgm: false }),
    },
    aliases: VIDU_ALIASES,
    paramPolicy: strictParamPolicy,
  }
  const imageCapability: MediaModelCapabilityManifest = {
    id: 'video.image_to_video',
    label: '图生视频（首帧 / 首尾帧）',
    input: {
      required: ['image'] as MediaManifestInputKind[],
      maxImages: 2,
      acceptedMimeTypes: TENCENT_IMAGE_INPUT_MIME,
    },
    rolePolicy: {
      imageRoles: ['first_frame', 'last_frame'],
      defaultRoleAssignment: 'first_then_last_then_reference',
    } as MediaInputRolePolicy,
    output: { types: ['video'], mimeTypes: TENCENT_VIDEO_OUTPUT_MIME },
    paramSchema: { type: 'object', additionalProperties: false, properties: imageProperties },
    defaults: {
      durationSeconds: 5,
      resolution: '720p',
      isRec: false,
      audio: isQ3,
      offPeak: false,
      logoAdd: 1,
      ...(!isQ3 ? { audioType: 'all', bgm: false } : {}),
    },
    aliases: VIDU_ALIASES,
    paramPolicy: strictParamPolicy,
  }
  return {
    id: `tencent-tokenhub:${input.modelId}`,
    providerKind: 'tencent-tokenhub',
    modelId: input.modelId,
    displayName: input.displayName,
    domains: ['video'],
    capabilities: [textCapability, imageCapability],
    invocation: tencentVideoInvocation(),
    docs: {
      sourceUrls: [
        MODEL_LIST_DOC,
        VIDEO_API_DOC,
        VD_VIDEO_DOC,
        VD_IMAGE_VIDEO_DOC,
        ERROR_CODES_DOC,
      ],
      lastCheckedAt: LAST_CHECKED,
    },
    safety: {
      maxPromptLength: 2000,
      promptLengthUnit: 'characters',
      promptOverflowBehavior: 'reject',
      allowLocalFiles: true,
      maxInputBytes: 50 * 1024 * 1024,
    },
    error: tencentTokenhubErrorContract,
  }
}

export const TENCENT_TOKENHUB_MEDIA_MODEL_MANIFESTS: readonly MediaModelManifest[] = [
  // 图片（2）
  hunyuanImageLiteManifest(),
  hunyuanImageV3Manifest(),
  // 混元/优图原生视频（4）
  nativeVideoManifest({
    modelId: 'hy-video-1.5',
    displayName: '混元 Video 1.5',
    textToVideo: true,
    kind: 'generic',
  }),
  nativeVideoManifest({
    modelId: 'yt-video-2.0',
    displayName: '优图 Video 2.0（通用图生视频）',
    textToVideo: false,
    kind: 'generic',
  }),
  nativeVideoManifest({
    modelId: 'yt-video-fx',
    displayName: '优图 Video FX（特效模板）',
    textToVideo: false,
    kind: 'template',
  }),
  nativeVideoManifest({
    modelId: 'yt-video-humanactor',
    displayName: '优图 Video HumanActor（人像驱动）',
    textToVideo: false,
    kind: 'human',
  }),
  // Kling（9）
  klingVideoManifest({
    modelId: 'kl-video-v3',
    displayName: 'Kling Video v3',
    durations: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    textModes: [],
    imageModes: [],
    cfgScale: true,
    sound: true,
    voiceList: false,
  }),
  klingVideoManifest({
    modelId: 'kl-video-v2-6',
    displayName: 'Kling Video v2.6',
    durations: [5, 10],
    textModes: ['pro'],
    imageModes: ['pro'],
    cfgScale: false,
    sound: true,
    voiceList: true,
  }),
  klingVideoManifest({
    modelId: 'kl-video-v2-5-turbo',
    displayName: 'Kling Video v2.5 Turbo',
    durations: [5, 10],
    textModes: [],
    imageModes: ['pro'],
    cfgScale: false,
    sound: false,
    voiceList: true,
  }),
  klingVideoManifest({
    modelId: 'kl-video-v2-1-master',
    displayName: 'Kling Video v2.1 Master',
    durations: [5, 10],
    textModes: [],
    imageModes: [],
    cfgScale: true,
    sound: false,
    voiceList: true,
  }),
  klingVideoManifest({
    modelId: 'kl-video-v2-1',
    displayName: 'Kling Video v2.1',
    durations: [5, 10],
    textModes: ['std', 'pro'],
    imageModes: ['std', 'pro'],
    cfgScale: true,
    sound: false,
    voiceList: true,
  }),
  klingVideoManifest({
    modelId: 'kl-video-v2-master',
    displayName: 'Kling Video v2 Master',
    durations: [5, 10],
    textModes: [],
    imageModes: [],
    cfgScale: false,
    sound: false,
    voiceList: true,
  }),
  klingVideoManifest({
    modelId: 'kl-video-v1-6',
    displayName: 'Kling Video v1.6',
    durations: [5, 10],
    textModes: ['std', 'pro'],
    imageModes: ['pro'],
    cfgScale: true,
    sound: false,
    voiceList: true,
  }),
  klingVideoManifest({
    modelId: 'kl-video-v1-5',
    displayName: 'Kling Video v1.5',
    durations: [5, 10],
    textModes: ['pro'],
    imageModes: ['pro'],
    cfgScale: true,
    sound: false,
    voiceList: true,
  }),
  klingVideoManifest({
    modelId: 'kl-video-v1',
    displayName: 'Kling Video v1',
    durations: [5, 10],
    textModes: ['pro'],
    imageModes: ['pro'],
    cfgScale: true,
    sound: false,
    voiceList: true,
  }),
  // Vidu（6）
  viduVideoManifest({
    modelId: 'vd-video-q3-pro',
    displayName: 'Vidu Video Q3 Pro',
    family: 'q3',
    textMinDuration: 1,
    textMaxDuration: 16,
    imageMinDuration: 1,
    imageMaxDuration: 16,
    imageResolutions: ['540p', '720p', '1080p'],
  }),
  viduVideoManifest({
    modelId: 'vd-video-q3-turbo',
    displayName: 'Vidu Video Q3 Turbo',
    family: 'q3',
    textMinDuration: 1,
    textMaxDuration: 16,
    imageMinDuration: 1,
    imageMaxDuration: 16,
    imageResolutions: ['540p', '720p', '1080p'],
  }),
  viduVideoManifest({
    modelId: 'vd-video-q2-pro',
    displayName: 'Vidu Video Q2 Pro',
    family: 'q2',
    textMinDuration: 1,
    textMaxDuration: 10,
    imageMinDuration: 1,
    imageMaxDuration: 10,
    imageResolutions: ['720p', '1080p'],
  }),
  viduVideoManifest({
    modelId: 'vd-video-q2-pro-fast',
    displayName: 'Vidu Video Q2 Pro Fast',
    family: 'q2',
    textMinDuration: 1,
    textMaxDuration: 10,
    imageMinDuration: 1,
    imageMaxDuration: 10,
    imageResolutions: ['720p', '1080p'],
  }),
  viduVideoManifest({
    modelId: 'vd-video-q2-turbo',
    displayName: 'Vidu Video Q2 Turbo',
    family: 'q2',
    textMinDuration: 1,
    textMaxDuration: 10,
    imageMinDuration: 1,
    imageMaxDuration: 10,
    imageResolutions: ['720p', '1080p'],
  }),
  viduVideoManifest({
    modelId: 'vd-video-q2',
    displayName: 'Vidu Video Q2',
    family: 'q2',
    textMinDuration: 1,
    textMaxDuration: 10,
    imageMinDuration: 2,
    imageMaxDuration: 8,
    imageResolutions: ['540p', '720p', '1080p'],
  }),
]
