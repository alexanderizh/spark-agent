import type {
  MediaProviderKind,
  MediaApiType,
  MediaCapabilityId,
  ProviderMediaDefaults,
} from './media-config.js'
import type { ProviderMediaModelRef } from './media-model-manifest.js'

export type ProviderPresetKind = 'anthropic' | 'openai'

export type ProviderPresetModelType = 'image' | 'text' | 'multimodal' | 'voice' | 'video'
export type ImageGenApiType = 'sync' | 'async' | 'auto'

export interface ProviderPreset {
  id: string
  vendorId: string
  name: string
  provider: ProviderPresetKind
  apiEndpoint: string
  defaultModel: string
  modelIds: string[]
  sourceUrls: string[]
  codexApiKind?: 'chat' | 'responses'
  modelType?: ProviderPresetModelType
  imageProvider?: string
  imageApiType?: ImageGenApiType
  /** 多媒体平台 adapter 种类（图片/语音/视频统一） */
  mediaProvider?: MediaProviderKind
  /** 多媒体调用方式 */
  mediaApiType?: MediaApiType
  /** 已声明支持的多媒体能力列表 */
  mediaCapabilities?: MediaCapabilityId[]
  /** 多媒体能力默认值 */
  mediaDefaults?: ProviderMediaDefaults
  /** 默认启用的多媒体模型 manifest 引用 */
  mediaModelRefs?: ProviderMediaModelRef[]
}

/* ─── Vendor 元数据（用于 UI 展示：emoji logo + 颜色 + 描述） ─── */

export interface VendorMeta {
  id: string
  name: string
  emoji: string
  color: string
  desc: string
  /**
   * 渲染时优先加载的 logo 资源路径（相对 renderer 进程）。
   * 缺省或加载失败时，UI 应回退到 emoji + color 组合。
   */
  logoPath: string
  /**
   * 对应平台的购买 / 注册 / 充值入口。
   * 模板卡片右上角会渲染一个外链小按钮，点击后由 Electron main 进程
   * 调起系统默认浏览器。无 URL（如本地 / 自建网关）则不渲染按钮。
   */
  purchaseUrl?: string
}

export const VENDOR_CATALOG: VendorMeta[] = [
  /* ─── 现有 13 个 ─── */
  {
    id: 'openai',
    name: 'OpenAI',
    emoji: 'OA',
    color: '#10a37f',
    desc: 'GPT-5.5 / GPT-5.4 / GPT-Image',
    logoPath: 'providers/openai.svg',
    purchaseUrl: 'https://platform.openai.com/settings/organization/billing',
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    emoji: 'A',
    color: '#d4a574',
    desc: 'Claude Sonnet 4 / Opus 4 / Haiku',
    logoPath: 'providers/anthropic.svg',
    purchaseUrl: 'https://console.anthropic.com/settings/billing',
  },
  {
    id: 'google-gemini',
    name: 'Google Gemini',
    emoji: 'G',
    color: '#4285f4',
    desc: 'Gemini 2.5 Pro / Flash',
    logoPath: 'providers/google-gemini.svg',
    purchaseUrl: 'https://aistudio.google.com/apikey',
  },
  {
    id: 'tencent-coding-plan',
    name: '腾讯云 Coding Plan',
    emoji: 'TX',
    color: '#006eff',
    desc: '混元 / MiniMax / Kimi / GLM 聚合',
    logoPath: 'providers/tencent-coding-plan.png',
    purchaseUrl: 'https://buy.cloud.tencent.com/lkeap',
  },
  {
    id: 'aliyun-bailian-coding-plan',
    name: '阿里云百炼 Coding Plan',
    emoji: 'AL',
    color: '#ff6a00',
    desc: 'Qwen3 / GLM / Kimi / MiniMax 聚合',
    logoPath: 'providers/aliyun-bailian-coding-plan.svg',
    purchaseUrl: 'https://bailian.console.aliyun.com/',
  },
  {
    id: 'bailian',
    name: '阿里云百炼',
    emoji: 'AL',
    color: '#ff6a00',
    desc: 'Wan / HappyHorse / Qwen3 TTS / 多媒体聚合',
    logoPath: 'providers/aliyun-bailian-coding-plan.svg',
    purchaseUrl: 'https://bailian.console.aliyun.com/',
  },
  {
    id: 'zhipu-glm-coding-plan',
    name: '智谱 GLM Coding Plan',
    emoji: 'GL',
    color: '#3b5cff',
    desc: 'GLM-5 / GLM-4.7 / GLM-4.5-air',
    logoPath: 'providers/zhipu-glm-coding-plan.png',
    purchaseUrl: 'https://bigmodel.cn/claude-code',
  },
  {
    id: 'qwen-standard',
    name: '通义千问',
    emoji: 'QW',
    color: '#6f42c1',
    desc: 'Qwen3 / Qwen3-Coder 系列模型',
    logoPath: 'providers/qwen-standard.png',
    purchaseUrl: 'https://bailian.console.aliyun.com/',
  },
  {
    id: 'deepseek-api',
    name: 'DeepSeek',
    emoji: 'DS',
    color: '#4d6bfe',
    desc: 'DeepSeek-V4 Flash / Pro',
    logoPath: 'providers/deepseek-api.svg',
    purchaseUrl: 'https://platform.deepseek.com/topup',
  },
  {
    id: 'minimax',
    name: 'MiniMax',
    emoji: 'MM',
    color: '#6c5ce7',
    desc: 'MiniMax-M2.7 / M2.5 系列',
    logoPath: 'providers/minimax.png',
    purchaseUrl: 'https://platform.minimaxi.com/user-center/basic-information/interface-key',
  },
  {
    id: 'kimi',
    name: 'Kimi',
    emoji: 'KM',
    color: '#1a1a2e',
    desc: 'Kimi-K2.6 / K2.5 / K2-Thinking',
    logoPath: 'providers/kimi.png',
    purchaseUrl: 'https://platform.moonshot.cn/console/account',
  },
  {
    id: 'siliconflow',
    name: '硅基流动',
    emoji: 'SF',
    color: '#7c3aed',
    desc: 'DeepSeek / Qwen / Kimi 聚合',
    logoPath: 'providers/siliconflow.svg',
    purchaseUrl: 'https://cloud.siliconflow.cn/',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    emoji: 'OR',
    color: '#6d28d9',
    desc: 'GPT-4.1 / Claude / Gemini 聚合',
    logoPath: 'providers/openrouter.svg',
    purchaseUrl: 'https://openrouter.ai/keys',
  },
  {
    id: 'ollama',
    name: 'Ollama',
    emoji: 'OL',
    color: '#6366f1',
    desc: '本地模型 · Llama / Qwen / DeepSeek',
    logoPath: 'providers/ollama.svg',
  },

  /* ─── 新增 15 个（图标来自 coding.mcppla.net 官方平台图标）─── */
  {
    id: 'xiaomi-mimo',
    name: '小米 MiMo',
    emoji: 'MM',
    color: '#ff6900',
    desc: 'MiMo-V2-Pro / V2-Omni / V2-TTS',
    logoPath: 'providers/xiaomi-mimo.png',
    purchaseUrl: 'https://platform.xiaomimimo.com/',
  },
  {
    id: 'xfyun',
    name: '讯飞星火',
    emoji: 'SF',
    color: '#1e88e5',
    desc: 'Spark X2 / X1.5 / Ultra / Pro',
    logoPath: 'providers/xfyun.png',
    purchaseUrl: 'https://xinghuo.xfyun.cn/sparkapi',
  },
  {
    id: 'jdcloud',
    name: '京东云 JoyBuilder',
    emoji: 'JD',
    color: '#e1251b',
    desc: 'JoyAI-LLM / JoyAI-M3 / Coding Plan',
    logoPath: 'providers/jdcloud.png',
    purchaseUrl: 'https://www.jdcloud.com/cn/products/jdcloud-joybuilder',
  },
  {
    id: 'ctyun',
    name: '天翼云息壤',
    emoji: 'CT',
    color: '#cf0a2c',
    desc: '息壤 Tokens · DeepSeek / Qwen / GLM 聚合',
    logoPath: 'providers/ctyun.svg',
    purchaseUrl: 'https://www.ctyun.cn/h5/huiju/',
  },
  {
    id: 'baidu',
    name: '百度千帆',
    emoji: 'BD',
    color: '#2932e1',
    desc: 'ERNIE-4.5 / Qianfan-VL / 文心系列',
    logoPath: 'providers/baidu.png',
    purchaseUrl: 'https://console.bce.baidu.com/qianfan/',
  },
  {
    id: 'volcengine',
    name: '火山方舟',
    emoji: 'VK',
    color: '#1a73e8',
    desc: 'Doubao-pro / Doubao-Seed / Seedance',
    logoPath: 'providers/volcengine.png',
    purchaseUrl: 'https://www.volcengine.com/product/ark',
  },
  {
    id: 'huaweicloud',
    name: '华为云盘古',
    emoji: 'HW',
    color: '#c7000b',
    desc: 'Pangu-NLP-N4 718B / Pangu Pro MoE',
    logoPath: 'providers/huaweicloud.png',
    purchaseUrl: 'https://console.huaweicloud.com/modelarts/',
  },
  {
    id: 'ucloud',
    name: 'UCloud UModelVerse',
    emoji: 'UC',
    color: '#0052d9',
    desc: 'DeepSeek / Qwen / 文心 / 阶跃 聚合',
    logoPath: 'providers/ucloud.png',
    purchaseUrl: 'https://console.ucloud.cn/modelverse',
  },
  {
    id: 'infini-ai',
    name: '无问芯穹 Infini-AI',
    emoji: 'IA',
    color: '#0d47a1',
    desc: 'DeepSeek / Qwen / 20+ 模型 · 多芯异构',
    logoPath: 'providers/infini-ai.png',
    purchaseUrl: 'https://cloud.infini-ai.com/genstudio',
  },
  {
    id: 'alaya',
    name: '九章云极 Alaya Code',
    emoji: 'AC',
    color: '#ff5722',
    desc: 'Kimi / Qwen3.5 / GLM-5 / MiniMax 聚合',
    logoPath: 'providers/alaya.svg',
    purchaseUrl: 'https://www.alayacode.com/',
  },
  {
    id: 'mthreads',
    name: '摩尔线程',
    emoji: 'MT',
    color: '#00a86b',
    desc: '夸娥 GPU · Qwen / DeepSeek / MiniMax',
    logoPath: 'providers/mthreads.png',
    purchaseUrl: 'https://www.mthreads.com/',
  },
  {
    id: 'kuaishou',
    name: '快手可灵',
    emoji: 'KS',
    color: '#ff6633',
    desc: '可灵 Kling V1.6 / 视频生成',
    logoPath: 'providers/kuaishou.png',
    purchaseUrl: 'https://klingai.kuaishou.com/',
  },
  {
    id: 'trae',
    name: 'Trae (字节)',
    emoji: 'TR',
    color: '#5b21b6',
    desc: 'Trae IDE · Doubao-1.5 / DeepSeek',
    logoPath: 'providers/trae.svg',
    purchaseUrl: 'https://www.trae.cn/',
  },
  {
    id: 'qwen-tongyi',
    name: '阿里通义',
    emoji: 'QY',
    color: '#ff6a00',
    desc: 'Qwen3.5 / Qwen3-Max / Qwen-Coder',
    logoPath: 'providers/qwen-tongyi.png',
    purchaseUrl: 'https://bailian.console.aliyun.com/',
  },

  /* ─── 新增（2026-06）：海外 / 自建网关 ─── */
  {
    id: 'github',
    name: 'GitHub Models',
    emoji: 'GH',
    color: '#24292f',
    desc: 'GitHub Models · GPT-4o / o3 / Llama / Phi',
    logoPath: 'providers/github.svg',
    purchaseUrl: 'https://github.com/marketplace/models',
  },
  {
    id: 'new-api',
    name: 'New API 网关',
    emoji: 'NA',
    color: '#0ea5e9',
    desc: '自建 LLM 网关（One-API / New-API）· OpenAI 格式聚合',
    logoPath: 'providers/new-api.svg',
  },

  /* ─── 多媒体模型平台（APIMart / xAI）─── */
  {
    id: 'apimart',
    name: 'APIMart',
    emoji: 'AM',
    color: '#22c55e',
    desc: '图片 / 语音 / 视频聚合（GPT Image / Whisper / VEO / Sora）',
    logoPath: 'providers/apimart.svg',
    purchaseUrl: 'https://apimart.ai/',
  },
  {
    id: 'agnes-ai',
    name: 'Agnes AI',
    emoji: 'AG',
    color: '#2563eb',
    desc: 'Agnes 文本 / 图片 / 视频统一接入',
    logoPath: 'providers/openai.svg',
    purchaseUrl: 'https://agnes-ai.com/',
  },
  {
    id: 'xai',
    name: 'xAI',
    emoji: 'xA',
    color: '#0f172a',
    desc: 'Grok Imagine 图片 / 视频 / 语音合成',
    logoPath: 'providers/xai.svg',
    purchaseUrl: 'https://console.x.ai/',
  },
  {
    id: 'midjourney',
    name: 'Midjourney',
    emoji: 'MJ',
    color: '#111827',
    desc: 'Midjourney 外部网关（非官方 HTTP API）',
    logoPath: 'providers/midjourney.svg',
    purchaseUrl: 'https://www.midjourney.com/',
  },
]

export const PROVIDER_PRESETS: ProviderPreset[] = [
  /* ─── OpenAI 官方 ─── */
  {
    id: 'openai-official',
    vendorId: 'openai',
    name: 'OpenAI',
    provider: 'openai',
    apiEndpoint: 'https://api.openai.com/v1',
    codexApiKind: 'responses',
    defaultModel: 'gpt-5.5',
    modelIds: ['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-5.3-codex-spark'],
    sourceUrls: [
      'https://developers.openai.com/codex/models',
      'https://developers.openai.com/codex/config-advanced',
    ],
  },
  {
    id: 'openai-images',
    vendorId: 'openai',
    name: 'OpenAI Images',
    provider: 'openai',
    apiEndpoint: 'https://api.openai.com/v1',
    defaultModel: 'gpt-image-2',
    modelIds: ['gpt-image-2', 'gpt-image-1'],
    modelType: 'image',
    imageProvider: 'openai',
    imageApiType: 'sync',
    sourceUrls: [
      'https://developers.openai.com/codex/pricing',
      'https://platform.openai.com/docs/guides/image-generation',
      'https://platform.openai.com/docs/api-reference/images',
    ],
  },
  // {
  //   id: 'apimart-images',
  //   vendorId: 'openai',
  //   name: 'APIMart Images',
  //   provider: 'openai',
  //   apiEndpoint: 'https://api.apimart.ai/v1',
  //   defaultModel: 'gpt-image-2',
  //   modelIds: ['gpt-image-2', 'gpt-image-1'],
  //   modelType: 'image',
  //   imageProvider: 'apimart',
  //   imageApiType: 'async',
  //   sourceUrls: [
  //     'https://docs.apimart.ai/en/api-reference/images/gpt-image-2/official',
  //     'https://docs.apimart.ai/en/api-reference/images/gpt-image-1/generation',
  //   ],
  // },
  // {
  //   id: 'openrouter-images',
  //   vendorId: 'openrouter',
  //   name: 'OpenRouter Images',
  //   provider: 'openai',
  //   apiEndpoint: 'https://openrouter.ai/api/v1',
  //   defaultModel: 'google/gemini-2.5-flash-image-preview',
  //   modelIds: [
  //     'google/gemini-2.5-flash-image-preview',
  //     'black-forest-labs/flux.1-kontext-pro',
  //     'recraft/recraft-v3',
  //   ],
  //   modelType: 'image',
  //   imageProvider: 'openrouter',
  //   imageApiType: 'sync',
  //   sourceUrls: [
  //     'https://openrouter.ai/docs/guides/overview/multimodal/image-generation',
  //   ],
  // },
  // {
  //   id: 'google-gemini-images',
  //   vendorId: 'google-gemini',
  //   name: 'Google Gemini Images',
  //   provider: 'openai',
  //   apiEndpoint: 'https://generativelanguage.googleapis.com/v1beta/openai',
  //   defaultModel: 'gemini-2.5-flash-image-preview',
  //   modelIds: ['gemini-2.5-flash-image-preview', 'imagen-4.0-generate-001'],
  //   modelType: 'image',
  //   imageProvider: 'gemini',
  //   imageApiType: 'sync',
  //   sourceUrls: [
  //     'https://ai.google.dev/gemini-api/docs/image-generation',
  //     'https://ai.google.dev/gemini-api/docs/imagen',
  //   ],
  // },
  // {
  //   id: 'volcengine-seedream-images',
  //   vendorId: 'volcengine',
  //   name: '火山方舟 Seedream',
  //   provider: 'openai',
  //   apiEndpoint: 'https://ark.cn-beijing.volces.com/api/v3',
  //   defaultModel: 'doubao-seedream-4-0-250828',
  //   modelIds: ['doubao-seedream-4-0-250828', 'doubao-seedream-3-0-t2i-250415'],
  //   modelType: 'image',
  //   imageProvider: 'seeddance',
  //   imageApiType: 'sync',
  //   sourceUrls: [
  //     'https://www.volcengine.com/docs/82379/1666945',
  //   ],
  // },

  /* ─── Anthropic 官方 ─── */
  {
    id: 'anthropic-official',
    vendorId: 'anthropic',
    name: 'Anthropic',
    provider: 'anthropic',
    apiEndpoint: 'https://api.anthropic.com',
    defaultModel: 'claude-sonnet-4-20250514',
    modelIds: ['claude-sonnet-4-20250514', 'claude-opus-4-20250514', 'claude-3-5-haiku-20241022'],
    sourceUrls: [
      'https://docs.anthropic.com/en/docs/about-claude/models',
      'https://docs.anthropic.com/en/api/messages',
    ],
  },

  /* ─── Google Gemini ─── */
  // {
  //   id: 'google-gemini',
  //   vendorId: 'google-gemini',
  //   name: 'Google Gemini',
  //   provider: 'openai',
  //   apiEndpoint: 'https://generativelanguage.googleapis.com/v1beta/openai',
  //   defaultModel: 'gemini-2.5-pro',
  //   modelIds: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash'],
  //   sourceUrls: [
  //     'https://ai.google.dev/gemini-api/docs/models',
  //     'https://ai.google.dev/gemini-api/docs/openai',
  //   ],
  // },
  {
    id: 'google-gemini',
    vendorId: 'google-gemini',
    name: 'Google Gemini',
    provider: 'openai',
    apiEndpoint: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-2.5-pro',
    modelIds: ['gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.0-flash'],
    sourceUrls: [
      'https://ai.google.dev/gemini-api/docs/models',
      'https://ai.google.dev/gemini-api/docs/openai',
    ],
  },

  /* ─── 腾讯云 Coding Plan ─── */
  {
    id: 'tencent-coding-plan-anthropic',
    vendorId: 'tencent-coding-plan',
    name: '腾讯云 Coding Plan',
    provider: 'anthropic',
    apiEndpoint: 'https://api.lkeap.cloud.tencent.com/coding/anthropic',
    defaultModel: 'glm-5',
    modelIds: ['glm-5'],
    sourceUrls: ['https://cloud.tencent.com/document/product/1823/130092'],
  },
  // {
  //   id: 'tencent-coding-plan-openai',
  //   vendorId: 'tencent-coding-plan',
  //   name: '腾讯云 Coding Plan',
  //   provider: 'openai',
  //   apiEndpoint: 'https://api.lkeap.cloud.tencent.com/coding/v3',
  //   defaultModel: 'tc-code-latest',
  //   modelIds: ['tc-code-latest', 'hunyuan-2.0-instruct', 'hunyuan-2.0-thinking', 'minimax-m2.5', 'kimi-k2.5', 'glm-5'],
  //   sourceUrls: [
  //     'https://cloud.tencent.com/document/product/1823/130092',
  //   ],
  // },
  {
    id: 'tencent-coding-plan-openai',
    vendorId: 'tencent-coding-plan',
    name: '腾讯云 Coding Plan',
    provider: 'openai',
    apiEndpoint: 'https://api.lkeap.cloud.tencent.com/coding/v3',
    codexApiKind: 'responses',
    defaultModel: 'tc-code-latest',
    modelIds: [
      'tc-code-latest',
      'minimax-m2.5',
      'kimi-k2.5',
      'glm-5',
      'hunyuan-t1',
      'hunyuan-turbos',
    ],
    sourceUrls: ['https://cloud.tencent.com/document/product/1823/130092'],
  },

  /* ─── 阿里云百炼 Coding Plan ─── */
  {
    id: 'aliyun-bailian-coding-plan-anthropic',
    vendorId: 'aliyun-bailian-coding-plan',
    name: '阿里云百炼 Coding Plan',
    provider: 'anthropic',
    apiEndpoint: 'https://coding.dashscope.aliyuncs.com/apps/anthropic',
    defaultModel: 'qwen3.6-plus',
    modelIds: ['qwen3.6-plus', 'glm-5'],
    sourceUrls: [
      'https://help.aliyun.com/zh/model-studio/coding-plan-faq',
      'https://help.aliyun.com/zh/model-studio/text-generation-model/',
      'https://help.aliyun.com/zh/model-studio/opencode',
    ],
  },
  // {
  //   id: 'aliyun-bailian-coding-plan-openai',
  //   vendorId: 'aliyun-bailian-coding-plan',
  //   name: '阿里云百炼 Coding Plan',
  //   provider: 'openai',
  //   apiEndpoint: 'https://coding.dashscope.aliyuncs.com/v1',
  //   defaultModel: 'qwen3.6-plus',
  //   modelIds: ['qwen3.6-plus', 'qwen3.5-plus', 'qwen3-coder-plus', 'glm-5', 'kimi-k2.5', 'MiniMax-M2.5'],
  //   sourceUrls: [
  //     'https://help.aliyun.com/zh/model-studio/coding-plan-faq',
  //     'https://help.aliyun.com/zh/model-studio/text-generation-model/',
  //     'https://help.aliyun.com/zh/model-studio/opencode',
  //   ],
  // },
  {
    id: 'aliyun-bailian-coding-plan-openai',
    vendorId: 'aliyun-bailian-coding-plan',
    name: '阿里云百炼 Coding Plan',
    provider: 'openai',
    apiEndpoint: 'https://coding.dashscope.aliyuncs.com/v1',
    codexApiKind: 'responses',
    defaultModel: 'qwen3.7-plus',
    modelIds: [
      'qwen3.7-plus',
      'qwen3.6-plus',
      'qwen3.5-plus',
      'qwen3-coder-plus',
      'qwen3-coder-next',
      'qwen3-max-2026-01-23',
      'glm-5',
      'glm-4.7',
      'kimi-k2.5',
      'MiniMax-M2.5',
    ],
    sourceUrls: [
      'https://help.aliyun.com/zh/model-studio/cline',
      'https://help.aliyun.com/zh/model-studio/coding-plan-faq',
      'https://help.aliyun.com/zh/model-studio/opencode',
    ],
  },

  /* ─── 智谱 GLM Coding Plan ─── */
  {
    id: 'zhipu-glm-coding-plan-anthropic',
    vendorId: 'zhipu-glm-coding-plan',
    name: '智谱 GLM Coding Plan',
    provider: 'anthropic',
    apiEndpoint: 'https://open.bigmodel.cn/api/anthropic',
    defaultModel: 'glm-5.1',
    modelIds: ['glm-4.7', 'glm-5-turbo', 'glm-5.1'],
    sourceUrls: [
      'https://docs.bigmodel.cn/cn/coding-plan/tool/claude',
      'https://docs.bigmodel.cn/cn/guide/develop/claude/introduction',
      'https://bigmodel.cn/claude-code',
    ],
  },
  // {
  //   id: 'zhipu-glm-coding-plan-openai',
  //   vendorId: 'zhipu-glm-coding-plan',
  //   name: '智谱 GLM Coding Plan',
  //   provider: 'openai',
  //   apiEndpoint: 'https://open.bigmodel.cn/api/coding/paas/v4',
  //   defaultModel: 'glm-4.7',
  //   modelIds: ['glm-4.7', 'glm-4.5-air', 'glm-5-turbo', 'glm-5.1'],
  //   sourceUrls: [
  //     'https://docs.bigmodel.cn/cn/coding-plan/tool/kilo',
  //     'https://bigmodel.cn/claude-code',
  //   ],
  // },
  {
    id: 'zhipu-glm-coding-plan-openai',
    vendorId: 'zhipu-glm-coding-plan',
    name: '智谱 GLM Coding Plan',
    provider: 'openai',
    apiEndpoint: 'https://open.bigmodel.cn/api/coding/paas/v4',
    codexApiKind: 'responses',
    defaultModel: 'glm-5.2',
    modelIds: ['glm-5.2', 'glm-5.1', 'glm-5-turbo', 'glm-4.7', 'glm-4.5-air'],
    sourceUrls: [
      'https://docs.bigmodel.cn/cn/coding-plan/quick-start',
      'https://docs.bigmodel.cn/cn/coding-plan/tool/others',
    ],
  },

  /* ─── 通义千问标准版 ─── */
  // {
  //   id: 'qwen-standard-openai',
  //   vendorId: 'qwen-standard',
  //   name: '通义千问',
  //   provider: 'openai',
  //   apiEndpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  //   defaultModel: 'qwen3-235b-a22b',
  //   modelIds: ['qwen3-235b-a22b', 'qwen3-30b-a3b', 'qwen3-coder-plus', 'qwen-plus-latest', 'qwen-turbo-latest'],
  //   sourceUrls: [
  //     'https://help.aliyun.com/zh/model-studio/developer-reference/use-qwen-by-calling-api',
  //     'https://help.aliyun.com/zh/model-studio/getting-started/models',
  //   ],
  // },
  {
    id: 'qwen-standard-openai',
    vendorId: 'qwen-standard',
    name: '通义千问',
    provider: 'openai',
    apiEndpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen3.7-plus',
    modelIds: [
      'qwen3.7-plus',
      'qwen3.6-plus',
      'qwen3.5-plus',
      'qwen3-coder-plus',
      'qwen-plus',
      'qwen-turbo',
      'qwen-max',
    ],
    sourceUrls: [
      'https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope',
      'https://help.aliyun.com/zh/model-studio/cline',
      'https://help.aliyun.com/zh/model-studio/qwen-api-via-dashscope',
    ],
  },

  /* ─── DeepSeek API ─── */
  {
    id: 'deepseek-api-anthropic',
    vendorId: 'deepseek-api',
    name: 'DeepSeek API',
    provider: 'anthropic',
    apiEndpoint: 'https://api.deepseek.com/anthropic',
    defaultModel: 'deepseek-v4-flash',
    modelIds: ['deepseek-v4-flash', 'deepseek-v4-pro'],
    sourceUrls: ['https://api-docs.deepseek.com/quick_start/pricing'],
  },
  {
    id: 'deepseek-api-openai',
    vendorId: 'deepseek-api',
    name: 'DeepSeek API',
    provider: 'openai',
    apiEndpoint: 'https://api.deepseek.com',
    defaultModel: 'deepseek-v4-flash',
    modelIds: ['deepseek-v4-flash', 'deepseek-v4-pro'],
    sourceUrls: [
      'https://api-docs.deepseek.com/quick_start/pricing',
      'https://api-docs.deepseek.com/',
    ],
  },

  /* ─── MiniMax ─── */
  {
    id: 'minimax-anthropic',
    vendorId: 'minimax',
    name: 'MiniMax',
    provider: 'anthropic',
    apiEndpoint: 'https://api.minimaxi.com/anthropic',
    defaultModel: 'MiniMax-M3',
    modelIds: ['MiniMax-M2.7', 'MiniMax-M2.7-highspeed', 'MiniMax-M3'],
    sourceUrls: [
      'https://platform.minimaxi.com/docs/api-reference/text-chat-anthropic',
      'https://platform.minimaxi.com/docs/api-reference/models/anthropic/list-models',
      'https://platform.minimaxi.com/docs/api-reference/text-ai-sdk',
    ],
  },
  // {
  //   id: 'minimax-openai',
  //   vendorId: 'minimax',
  //   name: 'MiniMax',
  //   provider: 'openai',
  //   apiEndpoint: 'https://api.minimaxi.com/v1',
  //   defaultModel: 'MiniMax-M2.7',
  //   modelIds: ['MiniMax-M2.7', 'MiniMax-M2.7-highspeed', 'MiniMax-M2.5', 'MiniMax-M2.5-highspeed'],
  //   sourceUrls: [
  //     'https://platform.minimaxi.com/docs/api-reference/api-overview',
  //     'https://platform.minimaxi.com/docs/api-reference/text-ai-sdk',
  //   ],
  // },

  /* ─── Kimi (Moonshot) ─── */
  // {
  //   id: 'kimi-openai',
  //   vendorId: 'kimi',
  //   name: 'Kimi',
  //   provider: 'openai',
  //   apiEndpoint: 'https://api.moonshot.cn/v1',
  //   defaultModel: 'kimi-k2.6',
  //   modelIds: ['kimi-k2.6', 'kimi-k2.5', 'kimi-k2-thinking', 'kimi-k2-thinking-turbo'],
  //   sourceUrls: [
  //     'https://platform.moonshot.cn/',
  //     'https://platform.moonshot.cn/docs/intro',
  //     'https://platform.moonshot.cn/docs/guide/kimi-k2-5-quickstart',
  //   ],
  // },

  /* ─── 硅基流动 ─── */
  // {
  //   id: 'siliconflow-openai',
  //   vendorId: 'siliconflow',
  //   name: '硅基流动',
  //   provider: 'openai',
  //   apiEndpoint: 'https://api.siliconflow.cn/v1',
  //   defaultModel: 'deepseek-ai/DeepSeek-V3.1-Terminus',
  //   modelIds: ['deepseek-ai/DeepSeek-V3.1-Terminus', 'moonshotai/Kimi-K2-Instruct-0905', 'Qwen/Qwen3-30B-A3B-Instruct'],
  //   sourceUrls: [
  //     'https://docs.siliconflow.cn/en/userguide/quickstart',
  //     'https://docs.siliconflow.cn/en/api-reference/models/get-model-list',
  //     'https://docs.siliconflow.cn/api-reference/chat-completions/chat-completions',
  //   ],
  // },

  /* ─── OpenRouter ─── */
  // {
  //   id: 'openrouter-openai',
  //   vendorId: 'openrouter',
  //   name: 'OpenRouter',
  //   provider: 'openai',
  //   apiEndpoint: 'https://openrouter.ai/api/v1',
  //   defaultModel: 'openai/gpt-4.1',
  //   modelIds: ['openai/gpt-4.1', 'anthropic/claude-sonnet-4', 'google/gemini-2.5-pro-preview'],
  //   sourceUrls: [
  //     'https://openrouter.ai/docs/api/reference/overview',
  //     'https://openrouter.ai/docs/api/api-reference/models/get-models',
  //     'https://openrouter.ai/docs/guides/overview/models',
  //   ],
  // },

  /* ─── Ollama 本地 ─── */
  // {
  //   id: 'ollama-local',
  //   vendorId: 'ollama',
  //   name: 'Ollama 本地',
  //   provider: 'openai',
  //   apiEndpoint: 'http://localhost:11434/v1',
  //   defaultModel: 'qwen3:14b',
  //   modelIds: ['qwen3:14b', 'deepseek-r1:14b', 'llama3.1:8b', 'codellama:13b', 'gemma3:12b'],
  //   sourceUrls: [
  //     'https://ollama.com/library',
  //     'https://github.com/ollama/ollama/blob/main/docs/openai.md',
  //   ],
  // },

  /* ════════════════════════════════════════════════════════════════ */
  /* ─── 新增 vendor 模板（14+） ───                                  */
  /* ════════════════════════════════════════════════════════════════ */

  /* ─── 小米 MiMo ─── */
  // {
  //   id: 'xiaomi-mimo-openai',
  //   vendorId: 'xiaomi-mimo',
  //   name: '小米 MiMo',
  //   provider: 'openai',
  //   apiEndpoint: 'https://api.xiaomimimo.com/v1',
  //   defaultModel: 'mimo-v2-flash',
  //   modelIds: ['mimo-v2-flash', 'MiMo-V2-Pro', 'MiMo-V2-Omni', 'MiMo-Coder', 'MiMo-V2-7B-Instruct'],
  //   sourceUrls: [
  //     'https://platform.xiaomimimo.com/',
  //     'https://aistudio.xiaomimimo.com/',
  //   ],
  // },

  /* ─── 讯飞星火（Spark）─── */
  // {
  //   id: 'xfyun-spark-openai',
  //   vendorId: 'xfyun',
  //   name: '讯飞星火 Spark',
  //   provider: 'openai',
  //   apiEndpoint: 'https://spark-api.xf-yun.com/v4.0/chat',
  //   defaultModel: 'general',
  //   modelIds: ['general', '4.0Ultra', 'max-32k', 'pro-128k', 'lite'],
  //   sourceUrls: [
  //     'https://www.xfyun.cn/doc/spark/Web.html',
  //     'https://xinghuo.xfyun.cn/sparkapi',
  //   ],
  // },

  /* ─── 京东云 JoyBuilder ─── */
  // {
  //   id: 'jdcloud-joybuilder-openai',
  //   vendorId: 'jdcloud',
  //   name: '京东云 JoyBuilder',
  //   provider: 'openai',
  //   apiEndpoint: 'https://aiapi.jdcloud.com/v1',
  //   defaultModel: 'JoyAI-LLM-Flash',
  //   modelIds: ['JoyAI-LLM-Flash', 'JoyAI-LLM-Pro', 'JoyAI-M3', 'kimi-k2.5', 'glm-5', 'MiniMax-M2.5'],
  //   sourceUrls: [
  //     'https://www.jdcloud.com/cn/products/jdcloud-joybuilder',
  //     'https://lavm-console.jdcloud.com/lavm/create',
  //   ],
  // },

  /* ─── 天翼云息壤（中国电信）─── */
  // {
  //   id: 'ctyun-xirang-openai',
  //   vendorId: 'ctyun',
  //   name: '天翼云息壤',
  //   provider: 'openai',
  //   apiEndpoint: 'https://wishub-x1.ctyun.cn/v1/chat/completions',
  //   defaultModel: 'Qwen3.5-397B-A17B',
  //   modelIds: ['Qwen3.5-397B-A17B', 'DeepSeek-V3.2', 'Doubao-Seed-2.0-pro', 'GLM-5', 'TeleChat-12B', 'kimi-k2.5'],
  //   sourceUrls: [
  //     'https://www.ctyun.cn/h5/huiju/',
  //     'https://huiju.ctyun.cn/modelSquare',
  //   ],
  // },

  /* ─── 百度千帆 ─── */
  // {
  //   id: 'baidu-qianfan-openai',
  //   vendorId: 'baidu',
  //   name: '百度千帆',
  //   provider: 'openai',
  //   apiEndpoint: 'https://qianfan.baidubce.com/v2',
  //   defaultModel: 'ernie-4.5-8k',
  //   modelIds: ['ernie-4.5-8k', 'ernie-4.0-8k', 'ernie-3.5-128k', 'ernie-speed-8k', 'ernie-lite-8k', 'Qianfan-VL-72B'],
  //   sourceUrls: [
  //     'https://cloud.baidu.com/doc/qianfan/s/hlrk4akp7',
  //     'https://console.bce.baidu.com/qianfan/modelcenter/model/buildIn/list',
  //   ],
  // },

  /* ─── 火山方舟（字节）─── */
  // {
  //   id: 'volcengine-ark-openai',
  //   vendorId: 'volcengine',
  //   name: '火山方舟',
  //   provider: 'openai',
  //   apiEndpoint: 'https://ark.cn-beijing.volces.com/api/v3',
  //   defaultModel: 'doubao-pro-32k',
  //   modelIds: ['doubao-pro-32k', 'doubao-pro-256k', 'doubao-lite-32k', 'doubao-seed-1-6-250615', 'deepseek-v3-1-250821', 'kimi-k2-250711'],
  //   sourceUrls: [
  //     'https://www.volcengine.com/docs/82379/1356615',
  //     'https://www.volcengine.com/product/ark',
  //   ],
  // },
  {
    id: 'volcengine-ark-openai',
    vendorId: 'volcengine',
    name: '火山方舟',
    provider: 'openai',
    apiEndpoint: 'https://ark.cn-beijing.volces.com/api/coding/v3',
    codexApiKind: 'responses',
    defaultModel: 'glm-5.2',
    modelIds: [
      'glm-5.2',
      'doubao-seed-1-6-250615',
      'doubao-pro-32k',
      'doubao-pro-256k',
      'doubao-lite-32k',
      'deepseek-v3-1-250821',
      'kimi-k2-250711',
    ],
    sourceUrls: [
      'https://www.volcengine.com/docs/82379/2160841',
      'https://www.volcengine.com/docs/82379/1356615',
      'https://www.volcengine.com/product/ark',
    ],
  },
  /* 火山方舟 Coding Plan：anthropic 协议（Claude Code） */
  {
    id: 'volcengine-ark-anthropic',
    vendorId: 'volcengine',
    name: '火山方舟 Coding Plan',
    provider: 'anthropic',
    apiEndpoint: 'https://ark.cn-beijing.volces.com/api/coding',
    defaultModel: 'glm-5.2',
    modelIds: ['glm-5.2', 'doubao-seed-code', 'deepseek-v4-flash', 'deepseek-v4-pro'],
    sourceUrls: ['https://www.volcengine.com/docs/82379/1356615'],
  },
  /* 火山方舟 Doubao-Seed-2.1：标准 OpenAI 兼容端点（/api/v3）。
     Seed 2.1 是文本/多模态理解 LLM（深度思考 + 工具调用 + 图片/视频理解），
     走标准 ark 端点，区别于上面的 Coding Plan 端点（/api/coding/v3）。 */
  {
    id: 'volcengine-ark-seed21',
    vendorId: 'volcengine',
    name: '火山方舟 Seed 2.1',
    provider: 'openai',
    apiEndpoint: 'https://ark.cn-beijing.volces.com/api/v3',
    codexApiKind: 'chat',
    defaultModel: 'doubao-seed-2-1-pro',
    modelIds: ['doubao-seed-2-1-pro', 'doubao-seed-2-1-turbo', 'doubao-seed-evolving'],
    modelType: 'multimodal',
    sourceUrls: [
      'https://www.volcengine.com/docs/82379/1399009',
      'https://console.volcengine.com/ark/region:cn-beijing/docs/82379/1569618?lang=zh',
      'https://console.volcengine.com/ark/region:ark+cn-beijing/model/detail?Id=doubao-seed-2-1-pro',
      'https://console.volcengine.com/ark/region:ark+cn-beijing/model/detail?Id=doubao-seed-2-1-turbo',
    ],
  },

  /* ─── 华为云盘古 ─── */
  // {
  //   id: 'huaweicloud-pangu-openai',
  //   vendorId: 'huaweicloud',
  //   name: '华为云盘古',
  //   provider: 'openai',
  //   apiEndpoint: 'https://api.modelarts-maas.com/v1',
  //   defaultModel: 'Pangu-NLP-N4-718B',
  //   modelIds: ['Pangu-NLP-N4-718B', 'Pangu-NLP-N2-128K', 'Pangu-NLP-N1-32K', 'Pangu-Pro-MoE-72B', 'DeepSeek-V3', 'Qwen3-32B'],
  //   sourceUrls: [
  //     'https://support.huaweicloud.com/api-pangulm/pangulm_05_0011.html',
  //     'https://www.huaweicloud.com/product/pangu.html',
  //   ],
  // },

  /* ─── 联通云 ─── */
  {
    id: 'unicom-aisp-anthropic',
    vendorId: 'unicom',
    name: '联通云 AISP',
    provider: 'anthropic',
    apiEndpoint: 'https://aigw-sh22.cucloud.cn/v1',
    defaultModel: 'GLM-4.7',
    modelIds: ['GLM-4.7', 'MiniMax-M2.5'],
    sourceUrls: ['https://www.cucloud.cn/product/aisp', 'https://www.cucloud.cn/'],
  },
  // {
  //   id: 'unicom-aisp-openai',
  //   vendorId: 'unicom',
  //   name: '联通云 AISP',
  //   provider: 'openai',
  //   apiEndpoint: 'https://aigw-sh22.cucloud.cn/v1',
  //   defaultModel: 'Qwen3-235B',
  //   modelIds: ['Qwen3-235B', 'DeepSeek-V3.1', 'MiniMax-M2.5', 'Qwen3.5', 'GLM-5', 'kimi-k2.5'],
  //   sourceUrls: [
  //     'https://www.cucloud.cn/product/aisp',
  //   ],
  // },

  /* ─── UCloud UModelVerse ─── */
  // {
  //   id: 'ucloud-modelverse-openai',
  //   vendorId: 'ucloud',
  //   name: 'UCloud UModelVerse',
  //   provider: 'openai',
  //   apiEndpoint: 'https://api.modelverse.ucloud.cn/v1',
  //   defaultModel: 'DeepSeek-R1',
  //   modelIds: ['DeepSeek-R1', 'DeepSeek-V3', 'Qwen/Qwen2.5-14B-Instruct', 'Qwen/Qwen2.5-7B-Instruct', 'meta-llama/Meta-Llama-3.1-8B-Instruct', 'Qwen/Qwen1.5-14B-Chat'],
  //   sourceUrls: [
  //     'https://www.ucloud.cn/site/product/modelverse.html',
  //     'https://doc.ucloud.cn/api/uai-modelverse-api/README',
  //   ],
  // },

  /* ─── 无问芯穹 Infini-AI ─── */
  // {
  //   id: 'infini-ai-maas-openai',
  //   vendorId: 'infini-ai',
  //   name: '无问芯穹 Infini-AI',
  //   provider: 'openai',
  //   apiEndpoint: 'https://cloud.infini-ai.com/maas/v1',
  //   defaultModel: 'deepseek-r1',
  //   modelIds: ['deepseek-r1', 'deepseek-v3', 'deepseek-r1-distill-qwen-32b', 'Qwen/Qwen2.5-72B-Instruct', 'meta-llama/Meta-Llama-3.1-70B-Instruct', 'Megrez-3B-Omni'],
  //   sourceUrls: [
  //     'https://cloud.infini-ai.com/genstudio',
  //     'https://docs.infini-ai.com/',
  //   ],
  // },

  /* ─── 九章云极 Alaya Code ─── */
  {
    id: 'alaya-code-anthropic',
    vendorId: 'alaya',
    name: '九章云极 Alaya Code',
    provider: 'anthropic',
    apiEndpoint: 'https://api.alayacode.com/coding/anthropic',
    defaultModel: 'GLM-5',
    modelIds: ['GLM-5', 'deepseek-v4-pro'],
    sourceUrls: ['https://www.datacanvas.com/', 'https://www.alayacode.com/'],
  },
  // {
  //   id: 'alaya-code-openai',
  //   vendorId: 'alaya',
  //   name: '九章云极 Alaya Code',
  //   provider: 'openai',
  //   apiEndpoint: 'https://api.alayacode.com/v1',
  //   defaultModel: 'kimi-k2.5',
  //   modelIds: ['kimi-k2.5', 'Qwen3.5-Plus', 'GLM-5', 'MiniMax-M2.5', 'deepseek-v4-pro'],
  //   sourceUrls: [
  //     'https://www.datacanvas.com/',
  //   ],
  // },

  /* ─── 摩尔线程（夸娥 GPU + 多模型推理）─── */
  // {
  //   id: 'mthreads-kuae-openai',
  //   vendorId: 'mthreads',
  //   name: '摩尔线程夸娥',
  //   provider: 'openai',
  //   apiEndpoint: 'https://api.mthreads.com/v1',
  //   defaultModel: 'Qwen3-32B',
  //   modelIds: ['Qwen3-32B', 'Qwen3-14B', 'DeepSeek-V4', 'MiniMax-M2.7', 'MiniMax-M2.5', 'GLM-5'],
  //   sourceUrls: [
  //     'https://www.mthreads.com/',
  //     'https://developer.mthreads.com/',
  //   ],
  // },

  /* ─── 快手可灵（视频/图像）─── */
  // {
  //   id: 'kuaishou-kling-openai',
  //   vendorId: 'kuaishou',
  //   name: '快手可灵 Kling',
  //   provider: 'openai',
  //   apiEndpoint: 'https://api.klingai.com/v1',
  //   defaultModel: 'kling-v1-6',
  //   modelIds: ['kling-v1-6', 'kling-v1-5', 'kling-v1', 'kling-virtual-try-on'],
  //   modelType: 'video',
  //   sourceUrls: [
  //     'https://klingai.kuaishou.com/',
  //     'https://platform.klingai.com/',
  //   ],
  // },

  /* ─── Trae IDE（字节 AI 原生 IDE）─── */
  {
    id: 'trae-cn-anthropic',
    vendorId: 'trae',
    name: 'Trae 国内版',
    provider: 'anthropic',
    apiEndpoint: 'https://api.trae.cn/v1',
    defaultModel: 'doubao-1.5-pro',
    modelIds: ['doubao-1.5-pro', 'doubao-1.5-thinking', 'DeepSeek-V3', 'DeepSeek-R1'],
    sourceUrls: ['https://www.trae.cn/'],
  },
  // {
  //   id: 'trae-global-openai',
  //   vendorId: 'trae',
  //   name: 'Trae 国际版',
  //   provider: 'openai',
  //   apiEndpoint: 'https://api.trae.ai/v1',
  //   defaultModel: 'claude-3-5-sonnet',
  //   modelIds: ['claude-3-5-sonnet', 'claude-3-7-sonnet', 'gpt-4o', 'gpt-4.1'],
  //   sourceUrls: [
  //     'https://www.trae.ai/',
  //   ],
  // },

  /* ─── 阿里通义（qwen-tongyi）─── */
  // {
  //   id: 'qwen-tongyi-openai',
  //   vendorId: 'qwen-tongyi',
  //   name: '阿里通义',
  //   provider: 'openai',
  //   apiEndpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  //   defaultModel: 'qwen3-max',
  //   modelIds: ['qwen3-max', 'qwen3.5-plus', 'qwen3-coder-plus', 'qwen3-235b-a22b', 'qwen3-vl-plus', 'qwen-long'],
  //   sourceUrls: [
  //     'https://help.aliyun.com/zh/model-studio/developer-reference/use-qwen-by-calling-api',
  //     'https://tongyi.aliyun.com/',
  //   ],
  // },
  {
    id: 'qwen-tongyi-anthropic',
    vendorId: 'qwen-tongyi',
    name: '阿里通义',
    provider: 'anthropic',
    apiEndpoint: 'https://dashscope.aliyuncs.com/apps/anthropic',
    defaultModel: 'qwen3-max',
    modelIds: ['qwen3-max', 'qwen3.5-plus', 'qwen3-coder-plus', 'qwen3-235b-a22b', 'qwen3-vl-plus'],
    sourceUrls: ['https://help.aliyun.com/zh/model-studio/claude-code'],
  },

  /* ════════════════════════════════════════════════════════════════ */
  /* ─── 新增（2026-06）：更多 Claude Code / Codex 兼容供应商 ───      */
  /* ════════════════════════════════════════════════════════════════ */

  /* ─── 无问芯穹 Infini-AI（Coding Plan，Anthropic 协议）─── */
  {
    id: 'infini-ai-coding-plan-anthropic',
    vendorId: 'infini-ai',
    name: '无问芯穹 Coding Plan',
    provider: 'anthropic',
    apiEndpoint: 'https://cloud.infini-ai.com/maas/coding',
    defaultModel: 'glm-5.1',
    modelIds: ['glm-5.1'],
    sourceUrls: ['https://docs.infini-ai.com/gen-studio-coding-plan/'],
  },

  /* ─── Kimi（月之暗面，Anthropic 协议）─── */
  {
    id: 'kimi-anthropic',
    vendorId: 'kimi',
    name: 'Kimi (Moonshot)',
    provider: 'anthropic',
    apiEndpoint: 'https://api.moonshot.ai/anthropic',
    defaultModel: 'kimi-k2.6',
    modelIds: ['kimi-k2.6'],
    sourceUrls: [
      'https://platform.kimi.com/docs/guide/agent-support',
      'https://platform.moonshot.cn/',
    ],
  },

  /* ─── OpenRouter（Anthropic 协议；注意 base_url 为 /api 而非 /api/v1）─── */
  {
    id: 'openrouter-anthropic',
    vendorId: 'openrouter',
    name: 'OpenRouter',
    provider: 'anthropic',
    apiEndpoint: 'https://openrouter.ai/api',
    defaultModel: 'anthropic/claude-sonnet-4',
    modelIds: ['anthropic/claude-sonnet-4', 'anthropic/claude-opus-4'],
    sourceUrls: ['https://openrouter.ai/docs/cookbook/coding-agents/claude-code-integration'],
  },

  /* ─── GitHub Models（OpenAI 协议；旧 models.inference.ai.azure.com 已于 2025-07 弃用）─── */
  {
    id: 'github-models-openai',
    vendorId: 'github',
    name: 'GitHub Models',
    provider: 'openai',
    apiEndpoint: 'https://models.github.ai/inference',
    defaultModel: 'gpt-4o',
    modelIds: ['gpt-4o'],
    sourceUrls: ['https://docs.github.com/github-models/prototyping-with-ai-models'],
  },

  /* ─── New API / One-API 自建网关（OpenAI 协议；endpoint 由用户自建部署决定）─── */
  {
    id: 'new-api-gateway-openai',
    vendorId: 'new-api',
    name: 'New API 网关',
    provider: 'openai',
    apiEndpoint: 'https://your-newapi-host/v1',
    defaultModel: 'gpt-4.1',
    modelIds: ['gpt-4.1'],
    sourceUrls: [
      'https://www.newapi.ai/zh/docs/apps/claude-code',
      'https://github.com/Calcium-Ion/new-api',
    ],
  },

  /* ─── 百度千帆 Coding Plan（Anthropic 协议；统一模型名 qianfan-code-latest 聚合多模型）─── */
  {
    id: 'baidu-coding-plan-anthropic',
    vendorId: 'baidu',
    name: '百度千帆 Coding Plan',
    provider: 'anthropic',
    apiEndpoint: 'https://qianfan.baidubce.com/anthropic/coding',
    defaultModel: 'qianfan-code-latest',
    modelIds: ['qianfan-code-latest'],
    sourceUrls: [
      'https://cloud.baidu.com/doc/qianfan/s/imlg0beiu',
      'https://cloud.baidu.com/doc/qianfan/s/0mn2mnemj',
    ],
  },

  /* ─── 小米 MiMo（Anthropic 协议）─── */
  {
    id: 'xiaomi-mimo-anthropic',
    vendorId: 'xiaomi-mimo',
    name: '小米 MiMo',
    provider: 'anthropic',
    apiEndpoint: 'https://api.xiaomimimo.com/anthropic',
    defaultModel: 'mimo-v2.5-flash',
    modelIds: ['mimo-v2.5-pro', 'mimo-v2.5-flash'],
    sourceUrls: [
      'https://platform.xiaomimimo.com/docs/en-US/integration/claudecode',
      'https://platform.xiaomimimo.com/docs/en-US/quick-start/first-api-call',
    ],
  },

  /* ════════════════════════════════════════════════════════════════ */
  /* ─── 多媒体模型平台 adapter preset（APIMart / xAI）───             */
  /* ════════════════════════════════════════════════════════════════ */

  /* ─── APIMart 图片（GPT Image 2）─── */
  {
    id: 'agnes-ai',
    vendorId: 'agnes-ai',
    name: 'Agnes AI',
    provider: 'openai',
    apiEndpoint: 'https://apihub.agnes-ai.com/v1',
    defaultModel: 'agnes-2.0-flash',
    modelIds: ['agnes-2.0-flash'],
    modelType: 'multimodal',
    mediaProvider: 'agnes',
    mediaApiType: 'auto',
    mediaCapabilities: [
      'image.generate',
      'image.edit',
      'video.generate',
      'video.image_to_video',
      'video.reference_to_video',
    ],
    mediaModelRefs: [
      {
        manifestId: 'agnes:agnes-image-2.0-flash',
        modelId: 'agnes-image-2.0-flash',
        enabled: true,
      },
      {
        manifestId: 'agnes:agnes-image-2.1-flash',
        modelId: 'agnes-image-2.1-flash',
        enabled: true,
      },
      { manifestId: 'agnes:agnes-video-v2.0', modelId: 'agnes-video-v2.0', enabled: true },
    ],
    mediaDefaults: {
      image: { size: '1024x1024', responseFormat: 'url' },
      video: { aspectRatio: '16:9', durationSeconds: 5, resolution: '720p' },
      polling: { intervalMs: 5000, timeoutMs: 1_800_000 },
    },
    sourceUrls: ['https://agnes-ai.com/zh-Hans/docs/overview'],
  },

  /* ─── APIMart 图片（GPT Image 2）─── */
  {
    id: 'apimart-images',
    vendorId: 'apimart',
    name: 'APIMart 图片',
    provider: 'openai',
    apiEndpoint: 'https://api.apimart.ai/v1',
    defaultModel: 'gpt-image-2',
    modelIds: [
      'gpt-image-2',
      'gpt-image-1-official',
      'gpt-image-1.5-official',
      'wan2.7-image',
      'qwen-image-2.0',
      'qwen-image-2.0-pro',
      'doubao-seedream-5-0-lite',
      'doubao-seedream-5-0-pro',
      'doubao-seedream-4-0',
      'doubao-seedream-4-5',
      'gemini-3.1-flash-image-preview',
      'gemini-3-pro-image-preview',
      'gemini-2.5-flash-image-preview',
      'gemini-2.5-flash-image-preview-official',
      'gemini-3-pro-image-preview-official',
      'gemini-3.1-flash-image-preview-official',
      'imagen-4.0-apimart',
      'z-image-turbo',
      'grok-imagine-1.5-apimart',
    ],
    modelType: 'image',
    imageProvider: 'apimart',
    imageApiType: 'async',
    mediaProvider: 'apimart',
    mediaApiType: 'auto',
    mediaCapabilities: ['image.generate', 'image.edit'],
    mediaModelRefs: [
      { manifestId: 'apimart:gpt-image-2', modelId: 'gpt-image-2', enabled: true },
      {
        manifestId: 'apimart:gpt-image-1-official',
        modelId: 'gpt-image-1-official',
        enabled: true,
      },
      {
        manifestId: 'apimart:gpt-image-1.5-official',
        modelId: 'gpt-image-1.5-official',
        enabled: true,
      },
      { manifestId: 'apimart:wan2.7-image', modelId: 'wan2.7-image', enabled: true },
      { manifestId: 'apimart:qwen-image-2.0', modelId: 'qwen-image-2.0', enabled: true },
      { manifestId: 'apimart:qwen-image-2.0-pro', modelId: 'qwen-image-2.0-pro', enabled: true },
      {
        manifestId: 'apimart:doubao-seedream-5-0-lite',
        modelId: 'doubao-seedream-5-0-lite',
        enabled: true,
      },
      {
        manifestId: 'apimart:doubao-seedream-5-0-pro',
        modelId: 'doubao-seedream-5-0-pro',
        enabled: true,
      },
      { manifestId: 'apimart:doubao-seedream-4-0', modelId: 'doubao-seedream-4-0', enabled: true },
      { manifestId: 'apimart:doubao-seedream-4-5', modelId: 'doubao-seedream-4-5', enabled: true },
      {
        manifestId: 'apimart:gemini-3.1-flash-image-preview',
        modelId: 'gemini-3.1-flash-image-preview',
        enabled: true,
      },
      {
        manifestId: 'apimart:gemini-3-pro-image-preview',
        modelId: 'gemini-3-pro-image-preview',
        enabled: true,
      },
      {
        manifestId: 'apimart:gemini-2.5-flash-image-preview',
        modelId: 'gemini-2.5-flash-image-preview',
        enabled: true,
      },
      {
        manifestId: 'apimart:gemini-2.5-flash-image-preview-official',
        modelId: 'gemini-2.5-flash-image-preview-official',
        enabled: true,
      },
      {
        manifestId: 'apimart:gemini-3-pro-image-preview-official',
        modelId: 'gemini-3-pro-image-preview-official',
        enabled: true,
      },
      {
        manifestId: 'apimart:gemini-3.1-flash-image-preview-official',
        modelId: 'gemini-3.1-flash-image-preview-official',
        enabled: true,
      },
      { manifestId: 'apimart:imagen-4.0-apimart', modelId: 'imagen-4.0-apimart', enabled: true },
      { manifestId: 'apimart:z-image-turbo', modelId: 'z-image-turbo', enabled: true },
      {
        manifestId: 'apimart:grok-imagine-1.5-apimart',
        modelId: 'grok-imagine-1.5-apimart',
        enabled: true,
      },
    ],
    mediaDefaults: {
      image: { size: '1:1', n: 1, resolution: '1k', outputFormat: 'png' },
      polling: { intervalMs: 4000, timeoutMs: 600_000 },
    },
    sourceUrls: [
      'https://docs.apimart.ai/cn/api-reference/images/gpt-image-2/official',
      'https://docs.apimart.ai/cn/api-reference/images/gpt-image-1/generation',
      'https://docs.apimart.ai/cn/api-reference/images/seedream-5-0-pro/generation',
      'https://docs.apimart.ai/cn/api-reference/images/z-image-turbo/generation',
      'https://docs.apimart.ai/cn/api-reference/images/grok-imagine/generation',
    ],
  },

  /* ─── APIMart 语音转写（Whisper）─── */
  {
    id: 'apimart-audio-whisper',
    vendorId: 'apimart',
    name: 'APIMart 语音转写',
    provider: 'openai',
    apiEndpoint: 'https://api.apimart.ai/v1',
    defaultModel: 'whisper-1',
    modelIds: ['whisper-1'],
    modelType: 'voice',
    mediaProvider: 'apimart',
    mediaApiType: 'sync',
    mediaCapabilities: ['audio.transcription'],
    mediaDefaults: { audio: { language: 'zh' } },
    sourceUrls: ['https://docs.apimart.ai/cn/api-reference/audios/whisper-1'],
  },

  /* ─── APIMart 语音合成（TTS）─── */
  {
    id: 'apimart-audio-tts',
    vendorId: 'apimart',
    name: 'APIMart 语音合成',
    provider: 'openai',
    apiEndpoint: 'https://api.apimart.ai/v1',
    defaultModel: 'tts-1',
    modelIds: ['tts-1', 'tts-1-hd'],
    modelType: 'voice',
    mediaProvider: 'apimart',
    mediaApiType: 'sync',
    mediaCapabilities: ['audio.speech'],
    mediaDefaults: { audio: { voice: 'alloy', format: 'mp3', speed: 1 } },
    sourceUrls: ['https://docs.apimart.ai/cn/api-reference/audios/speech'],
  },

  /* ─── APIMart 视频（VEO 3）─── */
  {
    id: 'apimart-video-veo3',
    vendorId: 'apimart',
    name: 'APIMart 视频 VEO 3',
    provider: 'openai',
    apiEndpoint: 'https://api.apimart.ai/v1',
    defaultModel: 'veo3.1-quality',
    modelIds: ['veo3', 'veo3.1-fast', 'veo3.1-quality', 'veo3.1-lite'],
    modelType: 'video',
    mediaProvider: 'apimart',
    mediaApiType: 'async',
    mediaCapabilities: ['video.generate', 'video.image_to_video', 'video.edit'],
    mediaModelRefs: [
      { manifestId: 'apimart:veo3', modelId: 'veo3', enabled: true },
      { manifestId: 'apimart:veo3.1-fast', modelId: 'veo3.1-fast', enabled: true },
      { manifestId: 'apimart:veo3.1-quality', modelId: 'veo3.1-quality', enabled: true },
      { manifestId: 'apimart:veo3.1-lite', modelId: 'veo3.1-lite', enabled: true },
    ],
    mediaDefaults: {
      video: { aspectRatio: '16:9', durationSeconds: 8, quality: 'hd' },
      polling: { intervalMs: 6000, timeoutMs: 1_800_000 },
    },
    sourceUrls: ['https://docs.apimart.ai/cn/api-reference/videos/veo3/generation'],
  },

  /* ─── APIMart 视频（Sora 2）─── */
  {
    id: 'apimart-video-sora2',
    vendorId: 'apimart',
    name: 'APIMart 视频 Sora 2',
    provider: 'openai',
    apiEndpoint: 'https://api.apimart.ai/v1',
    defaultModel: 'sora-2',
    modelIds: ['sora-2', 'sora-2-pro'],
    modelType: 'video',
    mediaProvider: 'apimart',
    mediaApiType: 'async',
    mediaCapabilities: ['video.generate', 'video.image_to_video', 'video.edit'],
    mediaModelRefs: [
      { manifestId: 'apimart:sora-2', modelId: 'sora-2', enabled: true },
      { manifestId: 'apimart:sora-2-pro', modelId: 'sora-2-pro', enabled: true },
    ],
    mediaDefaults: {
      video: { aspectRatio: '16:9', durationSeconds: 8, quality: 'hd' },
      polling: { intervalMs: 6000, timeoutMs: 1_800_000 },
    },
    sourceUrls: ['https://docs.apimart.ai/cn/api-reference/videos/sora-2/generation'],
  },

  /* ─── APIMart 视频（Kling / Vidu / Wan / HappyHorse / SkyReels / Pixverse / Omni 等）─── */
  {
    id: 'apimart-video-collection',
    vendorId: 'apimart',
    name: 'APIMart 视频合集',
    provider: 'openai',
    apiEndpoint: 'https://api.apimart.ai/v1',
    defaultModel: 'kling-v3',
    modelIds: [
      'kling-v2-6',
      'kling-v3',
      'kling-v3-omni',
      'kling-3.0-turbo',
      'kling-video-o1',
      'viduq3-pro',
      'viduq3-turbo',
      'viduq3',
      'viduq3-mix',
      'wan2.5-preview',
      'wan2.6',
      'wan2.7',
      'wan2.7-r2v',
      'wan2.7-videoedit',
      'happyhorse-1.0',
      'happyhorse-1.1',
      'skyreels-v4-fast',
      'skyreels-v4-std',
      'pixverse-v6',
      'gemini-omni-flash-preview',
      'Omni-Flash-Ext',
      'MiniMax-Hailuo-02',
      'MiniMax-Hailuo-2.3',
      'grok-imagine-1.5-video-apimart',
      'doubao-seedance-1-5-pro',
      'doubao-seedance-2-0-fast',
      'doubao-seedance-2-0-mini',
      'doubao-seedance-1-0-pro-fast',
      'doubao-seedance-1-0-pro-quality',
      'doubao-seedance-2.0',
    ],
    modelType: 'video',
    mediaProvider: 'apimart',
    mediaApiType: 'async',
    mediaCapabilities: ['video.generate', 'video.image_to_video', 'video.edit'],
    mediaModelRefs: [
      { manifestId: 'apimart:kling-v2-6', modelId: 'kling-v2-6', enabled: true },
      { manifestId: 'apimart:kling-v3', modelId: 'kling-v3', enabled: true },
      { manifestId: 'apimart:kling-v3-omni', modelId: 'kling-v3-omni', enabled: true },
      { manifestId: 'apimart:kling-3.0-turbo', modelId: 'kling-3.0-turbo', enabled: true },
      { manifestId: 'apimart:kling-video-o1', modelId: 'kling-video-o1', enabled: true },
      { manifestId: 'apimart:viduq3-pro', modelId: 'viduq3-pro', enabled: true },
      { manifestId: 'apimart:viduq3-turbo', modelId: 'viduq3-turbo', enabled: true },
      { manifestId: 'apimart:viduq3', modelId: 'viduq3', enabled: true },
      { manifestId: 'apimart:viduq3-mix', modelId: 'viduq3-mix', enabled: true },
      { manifestId: 'apimart:wan2.5-preview', modelId: 'wan2.5-preview', enabled: true },
      { manifestId: 'apimart:wan2.6', modelId: 'wan2.6', enabled: true },
      { manifestId: 'apimart:wan2.7', modelId: 'wan2.7', enabled: true },
      { manifestId: 'apimart:wan2.7-r2v', modelId: 'wan2.7-r2v', enabled: true },
      { manifestId: 'apimart:wan2.7-videoedit', modelId: 'wan2.7-videoedit', enabled: true },
      { manifestId: 'apimart:happyhorse-1.0', modelId: 'happyhorse-1.0', enabled: true },
      { manifestId: 'apimart:happyhorse-1.1', modelId: 'happyhorse-1.1', enabled: true },
      { manifestId: 'apimart:skyreels-v4-fast', modelId: 'skyreels-v4-fast', enabled: true },
      { manifestId: 'apimart:skyreels-v4-std', modelId: 'skyreels-v4-std', enabled: true },
      { manifestId: 'apimart:pixverse-v6', modelId: 'pixverse-v6', enabled: true },
      {
        manifestId: 'apimart:gemini-omni-flash-preview',
        modelId: 'gemini-omni-flash-preview',
        enabled: true,
      },
      { manifestId: 'apimart:Omni-Flash-Ext', modelId: 'Omni-Flash-Ext', enabled: true },
      {
        manifestId: 'apimart:MiniMax-Hailuo-02-apimart',
        modelId: 'MiniMax-Hailuo-02',
        enabled: true,
      },
      {
        manifestId: 'apimart:MiniMax-Hailuo-2.3-apimart',
        modelId: 'MiniMax-Hailuo-2.3',
        enabled: true,
      },
      {
        manifestId: 'apimart:grok-imagine-1.5-video-apimart',
        modelId: 'grok-imagine-1.5-video-apimart',
        enabled: true,
      },
      {
        manifestId: 'apimart:doubao-seedance-1-5-pro-apimart',
        modelId: 'doubao-seedance-1-5-pro',
        enabled: true,
      },
      {
        manifestId: 'apimart:doubao-seedance-2-0-fast-apimart',
        modelId: 'doubao-seedance-2-0-fast',
        enabled: true,
      },
      {
        manifestId: 'apimart:doubao-seedance-2-0-mini-apimart',
        modelId: 'doubao-seedance-2-0-mini',
        enabled: true,
      },
      {
        manifestId: 'apimart:doubao-seedance-1-0-pro-fast',
        modelId: 'doubao-seedance-1-0-pro-fast',
        enabled: true,
      },
      {
        manifestId: 'apimart:doubao-seedance-1-0-pro-quality',
        modelId: 'doubao-seedance-1-0-pro-quality',
        enabled: true,
      },
      { manifestId: 'apimart:doubao-seedance-2.0', modelId: 'doubao-seedance-2.0', enabled: true },
    ],
    mediaDefaults: {
      video: { aspectRatio: '16:9', durationSeconds: 5, resolution: '720p' },
      polling: { intervalMs: 6000, timeoutMs: 1_800_000 },
    },
    sourceUrls: ['https://docs.apimart.ai/cn/api-reference/videos'],
  },

  /* ─── xAI 图片（Grok Imagine）─── */
  {
    id: 'xai-imagine-image',
    vendorId: 'xai',
    name: 'xAI Imagine 图片',
    provider: 'openai',
    apiEndpoint: 'https://api.x.ai/v1',
    defaultModel: 'grok-imagine-image-quality',
    modelIds: [
      'grok-imagine-image-quality',
      'grok-imagine-image-quality-latest',
      'grok-imagine-image-pro',
      'grok-imagine-image',
    ],
    modelType: 'image',
    imageProvider: 'xai',
    imageApiType: 'sync',
    mediaProvider: 'xai',
    mediaApiType: 'sync',
    mediaCapabilities: ['image.generate', 'image.edit'],
    mediaModelRefs: [
      {
        manifestId: 'xai:grok-imagine-image',
        modelId: 'grok-imagine-image-quality',
        enabled: true,
      },
    ],
    mediaDefaults: {
      image: { aspectRatio: '1:1', n: 1, responseFormat: 'url' },
    },
    sourceUrls: ['https://docs.x.ai/developers/model-capabilities/imagine'],
  },

  /* ─── xAI 视频（Imagine Video）─── */
  {
    id: 'xai-imagine-video',
    vendorId: 'xai',
    name: 'xAI Imagine 视频',
    provider: 'openai',
    apiEndpoint: 'https://api.x.ai/v1',
    defaultModel: 'grok-imagine-video',
    modelIds: [
      'grok-imagine-video-1.5',
      'grok-imagine-video',
      'grok-imagine-video-1.5-preview',
      'grok-imagine-video-1.5-2026-05-30',
    ],
    modelType: 'video',
    mediaProvider: 'xai',
    mediaApiType: 'async',
    mediaCapabilities: [
      'video.generate',
      'video.image_to_video',
      'video.reference_to_video',
      'video.edit',
      'video.extend',
    ],
    mediaModelRefs: [
      {
        manifestId: 'xai:grok-imagine-video-1.5',
        modelId: 'grok-imagine-video-1.5',
        enabled: true,
      },
      { manifestId: 'xai:grok-imagine-video', modelId: 'grok-imagine-video', enabled: true },
      {
        manifestId: 'xai:grok-imagine-video-1.5-preview',
        modelId: 'grok-imagine-video-1.5-preview',
        enabled: true,
      },
      {
        manifestId: 'xai:grok-imagine-video-1.5-2026-05-30',
        modelId: 'grok-imagine-video-1.5-2026-05-30',
        enabled: true,
      },
    ],
    mediaDefaults: {
      video: { aspectRatio: '16:9', durationSeconds: 8, resolution: '720p' },
      polling: { intervalMs: 5000, timeoutMs: 1_800_000 },
    },
    sourceUrls: [
      'https://docs.x.ai/developers/model-capabilities/video/generation',
      'https://docs.x.ai/developers/model-capabilities/video/editing',
      'https://docs.x.ai/developers/model-capabilities/video/extension',
    ],
  },

  /* ─── 阿里云百炼多媒体 ─── */
  {
    id: 'bailian-images',
    vendorId: 'bailian',
    name: '阿里云百炼 图片',
    provider: 'openai',
    apiEndpoint: 'https://dashscope.aliyuncs.com/api/v1/services/aigc',
    defaultModel: 'wan2.7-image-pro',
    modelIds: ['wan2.7-image-pro', 'wan2.7-image', 'qwen-image-2.0-pro', 'qwen-image-2.0'],
    modelType: 'image',
    mediaProvider: 'bailian',
    mediaApiType: 'async',
    mediaCapabilities: ['image.generate', 'image.edit'],
    mediaModelRefs: [
      { manifestId: 'bailian:wan2.7-image-pro', modelId: 'wan2.7-image-pro', enabled: true },
      { manifestId: 'bailian:wan2.7-image', modelId: 'wan2.7-image', enabled: true },
      { manifestId: 'bailian:qwen-image-2.0-pro', modelId: 'qwen-image-2.0-pro', enabled: true },
      { manifestId: 'bailian:qwen-image-2.0', modelId: 'qwen-image-2.0', enabled: true },
    ],
    mediaDefaults: {
      image: { size: '2K', n: 1 },
      polling: { intervalMs: 5000, timeoutMs: 600_000 },
    },
    sourceUrls: ['https://bailian.console.aliyun.com/cn-beijing/?tab=model#/model-market'],
  },
  {
    id: 'bailian-video-happyhorse',
    vendorId: 'bailian',
    name: '阿里云百炼 HappyHorse 视频',
    provider: 'openai',
    apiEndpoint: 'https://dashscope.aliyuncs.com/api/v1/services/aigc',
    defaultModel: 'happyhorse-1.1-t2v',
    modelIds: [
      'happyhorse-1.1-t2v',
      'happyhorse-1.0-t2v',
      'happyhorse-1.1-i2v',
      'happyhorse-1.0-i2v',
      'happyhorse-1.1-r2v',
      'happyhorse-1.0-video-edit',
    ],
    modelType: 'video',
    mediaProvider: 'bailian',
    mediaApiType: 'async',
    mediaCapabilities: ['video.generate', 'video.image_to_video', 'video.edit'],
    mediaModelRefs: [
      { manifestId: 'bailian:happyhorse-1.1-t2v', modelId: 'happyhorse-1.1-t2v', enabled: true },
      { manifestId: 'bailian:happyhorse-1.0-t2v', modelId: 'happyhorse-1.0-t2v', enabled: true },
      { manifestId: 'bailian:happyhorse-1.1-i2v', modelId: 'happyhorse-1.1-i2v', enabled: true },
      { manifestId: 'bailian:happyhorse-1.0-i2v', modelId: 'happyhorse-1.0-i2v', enabled: true },
      { manifestId: 'bailian:happyhorse-1.1-r2v', modelId: 'happyhorse-1.1-r2v', enabled: true },
      {
        manifestId: 'bailian:happyhorse-1.0-video-edit',
        modelId: 'happyhorse-1.0-video-edit',
        enabled: true,
      },
    ],
    mediaDefaults: {
      video: { resolution: '1080P', durationSeconds: 5 },
      polling: { intervalMs: 15000, timeoutMs: 1_800_000 },
    },
    sourceUrls: [
      'https://help.aliyun.com/zh/model-studio/happyhorse-text-to-video-api-reference',
      'https://help.aliyun.com/zh/model-studio/happyhorse-image-to-video-api-reference',
      'https://help.aliyun.com/zh/model-studio/happyhorse-reference-to-video-api-reference',
      'https://help.aliyun.com/zh/model-studio/happyhorse-video-edit-api-reference',
    ],
  },
  {
    id: 'bailian-video-wan-i2v',
    vendorId: 'bailian',
    name: '阿里云百炼 Wan 视频',
    provider: 'openai',
    apiEndpoint: 'https://dashscope.aliyuncs.com/api/v1/services/aigc',
    defaultModel: 'wan2.7-t2v-2026-06-12',
    modelIds: [
      'wan2.7-t2v-2026-06-12',
      'wan2.7-i2v-2026-04-25',
      'wan2.7-r2v-2026-06-12',
      'wan2.7-videoedit',
    ],
    modelType: 'video',
    mediaProvider: 'bailian',
    mediaApiType: 'async',
    mediaCapabilities: [
      'video.generate',
      'video.image_to_video',
      'video.reference_to_video',
      'video.edit',
    ],
    mediaModelRefs: [
      { manifestId: 'bailian:wan2.7-t2v', modelId: 'wan2.7-t2v-2026-06-12', enabled: true },
      {
        manifestId: 'bailian:wan2.7-i2v-2026-04-25',
        modelId: 'wan2.7-i2v-2026-04-25',
        enabled: true,
      },
      { manifestId: 'bailian:wan2.7-r2v', modelId: 'wan2.7-r2v-2026-06-12', enabled: true },
      { manifestId: 'bailian:wan2.7-videoedit', modelId: 'wan2.7-videoedit', enabled: true },
    ],
    mediaDefaults: {
      video: { resolution: '1080P', durationSeconds: 5, watermark: false },
      polling: { intervalMs: 15000, timeoutMs: 1_800_000 },
    },
    sourceUrls: [
      'https://help.aliyun.com/zh/model-studio/text-to-video-api-reference',
      'https://help.aliyun.com/zh/model-studio/image-to-video-general-api-reference',
      'https://help.aliyun.com/zh/model-studio/wan-reference-to-video-api-reference',
      'https://help.aliyun.com/zh/model-studio/wan-video-editing-api-reference',
    ],
  },
  {
    id: 'bailian-audio-tts',
    vendorId: 'bailian',
    name: '阿里云百炼 语音合成',
    provider: 'openai',
    apiEndpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen3-tts-flash',
    modelIds: ['qwen3-tts-flash'],
    modelType: 'voice',
    mediaProvider: 'bailian',
    mediaApiType: 'sync',
    mediaCapabilities: ['audio.speech'],
    mediaModelRefs: [
      { manifestId: 'bailian:qwen3-tts-flash', modelId: 'qwen3-tts-flash', enabled: true },
    ],
    mediaDefaults: { audio: { voice: 'default', format: 'mp3', speed: 1 } },
    sourceUrls: ['https://bailian.console.aliyun.com/cn-beijing/?tab=model#/model-market'],
  },

  /* ─── 火山方舟视频（Seedance 2.0 / 2.0 Fast / 2.0 Mini / 1.5 Pro / 1.0 Pro / 1.0 Pro Fast）─── */
  {
    id: 'volcengine-seedance-video',
    vendorId: 'volcengine',
    name: '火山方舟 Seedance 视频',
    provider: 'openai',
    // endpoint 必须含 /api/v3，VolcengineArkMediaAdapter 在其后拼接
    // /contents/generations/tasks。原 /api 会导致 /api/contents/... 缺版本号。
    apiEndpoint: 'https://ark.cn-beijing.volces.com/api/v3',
    // 默认 2.0：最新、能力最全（含视频编辑/延长/多模态参考/联网搜索）。
    defaultModel: 'doubao-seedance-2-0-260128',
    modelIds: [
      'doubao-seedance-2-0-260128',
      'doubao-seedance-2-0-fast-260128',
      'doubao-seedance-2-0-mini-260615',
      'doubao-seedance-1-5-pro-251215',
      'doubao-seedance-1-0-pro-250528',
      'doubao-seedance-1-0-pro-fast-251015',
    ],
    modelType: 'video',
    mediaProvider: 'volcengine-ark',
    mediaApiType: 'async',
    mediaCapabilities: [
      'video.generate',
      'video.image_to_video',
      'video.reference_to_video',
      'video.edit',
      'video.extend',
    ],
    mediaModelRefs: [
      {
        manifestId: 'volcengine:doubao-seedance-2-0-260128',
        modelId: 'doubao-seedance-2-0-260128',
        enabled: true,
      },
      {
        manifestId: 'volcengine:doubao-seedance-2-0-fast-260128',
        modelId: 'doubao-seedance-2-0-fast-260128',
        enabled: true,
      },
      {
        manifestId: 'volcengine:doubao-seedance-2-0-mini-260615',
        modelId: 'doubao-seedance-2-0-mini-260615',
        enabled: true,
      },
      {
        manifestId: 'volcengine:doubao-seedance-1-5-pro-251215',
        modelId: 'doubao-seedance-1-5-pro-251215',
        enabled: true,
      },
      {
        manifestId: 'volcengine:doubao-seedance-1-0-pro-250528',
        modelId: 'doubao-seedance-1-0-pro-250528',
        enabled: true,
      },
      {
        manifestId: 'volcengine:doubao-seedance-1-0-pro-fast-251015',
        modelId: 'doubao-seedance-1-0-pro-fast-251015',
        enabled: true,
      },
    ],
    mediaDefaults: {
      video: { aspectRatio: '智能比例', durationSeconds: 5, resolution: '720p' },
      polling: { intervalMs: 8000, timeoutMs: 172_800_000 },
    },
    sourceUrls: [
      'https://www.volcengine.com/docs/82379/2291680',
      'https://www.volcengine.com/docs/82379/1520757',
      'https://seed.bytedance.com/zh/seedance2_0',
    ],
  },

  /* ─── 火山方舟图片（Seedream 4.0 / 4.5 / 5.0 Lite / 5.0 Pro）─── */
  {
    id: 'volcengine-seedream-image',
    vendorId: 'volcengine',
    name: '火山方舟 Seedream 图片',
    provider: 'openai',
    apiEndpoint: 'https://ark.cn-beijing.volces.com/api/v3',
    // 默认最新的 5.0 Pro；需要组图、流式或联网搜索时切到 5.0 Lite。
    defaultModel: 'doubao-seedream-5-0-pro-260628',
    modelIds: [
      'doubao-seedream-5-0-pro-260628',
      'doubao-seedream-5-0-260128',
      'doubao-seedream-5-0-lite-260128',
      'doubao-seedream-4-5-251128',
      'doubao-seedream-4-0-250828',
    ],
    modelType: 'image',
    imageProvider: 'seeddance',
    imageApiType: 'sync',
    mediaProvider: 'volcengine-ark',
    mediaApiType: 'sync',
    mediaCapabilities: ['image.generate', 'image.edit'],
    mediaModelRefs: [
      {
        manifestId: 'volcengine:doubao-seedream-5-0-pro-260628',
        modelId: 'doubao-seedream-5-0-pro-260628',
        enabled: true,
      },
      {
        manifestId: 'volcengine:doubao-seedream-5-0-260128',
        modelId: 'doubao-seedream-5-0-260128',
        enabled: true,
      },
      {
        manifestId: 'volcengine:doubao-seedream-5-0-lite-260128',
        modelId: 'doubao-seedream-5-0-lite-260128',
        enabled: true,
      },
      {
        manifestId: 'volcengine:doubao-seedream-4-5-251128',
        modelId: 'doubao-seedream-4-5-251128',
        enabled: true,
      },
      {
        manifestId: 'volcengine:doubao-seedream-4-0-250828',
        modelId: 'doubao-seedream-4-0-250828',
        enabled: true,
      },
    ],
    mediaDefaults: {
      // output_format 仅 5.0 Pro/Lite 支持；adapter 按 manifest schema 过滤。
      image: { size: '2K', outputFormat: 'jpeg', responseFormat: 'url' },
    },
    sourceUrls: [
      'https://www.volcengine.com/docs/82379/1541523',
      'https://console.volcengine.com/ark/region:cn-beijing/docs/82379/2582774?lang=zh',
      'https://console.volcengine.com/ark/region:ark+cn-beijing/model/detail?Id=doubao-seedream-5-0',
      'https://console.volcengine.com/ark/region:ark+cn-beijing/model/detail?Id=doubao-seedream-5-0-lite',
      'https://console.volcengine.com/ark/region:ark+cn-beijing/model/detail?Id=doubao-seedream-4-5',
      'https://console.volcengine.com/ark/region:ark+cn-beijing/model/detail?Id=doubao-seedream-4-0',
    ],
  },

  /* ─── xAI 语音合成（TTS）─── */
  {
    id: 'xai-tts',
    vendorId: 'xai',
    name: 'xAI 语音合成',
    provider: 'openai',
    apiEndpoint: 'https://api.x.ai/v1',
    defaultModel: 'grok-tts',
    modelIds: ['grok-tts'],
    modelType: 'voice',
    mediaProvider: 'xai',
    mediaApiType: 'sync',
    mediaCapabilities: ['audio.speech'],
    mediaModelRefs: [{ manifestId: 'xai:grok-tts', modelId: 'grok-tts', enabled: true }],
    mediaDefaults: { audio: { voice: 'eve', format: 'mp3', speed: 1 } },
    sourceUrls: ['https://docs.x.ai/developers/model-capabilities/audio/text-to-speech'],
  },

  /* ─── Google Gemini / Veo / Omni ─── */
  {
    id: 'google-gemini-images',
    vendorId: 'google-gemini',
    name: 'Google Gemini Images',
    provider: 'openai',
    apiEndpoint: 'https://generativelanguage.googleapis.com/v1beta',
    defaultModel: 'gemini-3.1-flash-image',
    modelIds: [
      'gemini-3.1-flash-image',
      'gemini-3.1-flash-lite-image',
      'gemini-3-pro-image',
      'gemini-2.5-flash-image',
    ],
    modelType: 'image',
    imageProvider: 'gemini',
    imageApiType: 'sync',
    mediaProvider: 'google-generative-ai',
    mediaApiType: 'sync',
    mediaCapabilities: ['image.generate', 'image.edit'],
    mediaModelRefs: [
      {
        manifestId: 'google:gemini-3.1-flash-image',
        modelId: 'gemini-3.1-flash-image',
        enabled: true,
      },
      {
        manifestId: 'google:gemini-3.1-flash-lite-image',
        modelId: 'gemini-3.1-flash-lite-image',
        enabled: true,
      },
      { manifestId: 'google:gemini-3-pro-image', modelId: 'gemini-3-pro-image', enabled: true },
      {
        manifestId: 'google:gemini-2.5-flash-image',
        modelId: 'gemini-2.5-flash-image',
        enabled: true,
      },
    ],
    mediaDefaults: { image: { resolution: '1K', outputFormat: 'png', n: 1 } },
    sourceUrls: ['https://ai.google.dev/gemini-api/docs/image-generation'],
  },
  {
    id: 'google-veo-video',
    vendorId: 'google-gemini',
    name: 'Google Veo 视频',
    provider: 'openai',
    apiEndpoint: 'https://generativelanguage.googleapis.com/v1beta',
    defaultModel: 'veo-3.1-generate-preview',
    modelIds: ['veo-3.1-generate-preview'],
    modelType: 'video',
    mediaProvider: 'google-generative-ai',
    mediaApiType: 'async',
    mediaCapabilities: ['video.generate', 'video.image_to_video', 'video.reference_to_video'],
    mediaModelRefs: [
      { manifestId: 'google:veo', modelId: 'veo-3.1-generate-preview', enabled: true },
    ],
    mediaDefaults: {
      video: { aspectRatio: '16:9', durationSeconds: 8, resolution: '720p' },
      polling: { intervalMs: 10000, timeoutMs: 1_800_000 },
    },
    sourceUrls: ['https://ai.google.dev/gemini-api/docs/veo'],
  },
  {
    id: 'google-omni-video',
    vendorId: 'google-gemini',
    name: 'Gemini Omni Flash 视频',
    provider: 'openai',
    apiEndpoint: 'https://generativelanguage.googleapis.com/v1beta',
    defaultModel: 'gemini-omni-flash-preview',
    modelIds: ['gemini-omni-flash-preview'],
    modelType: 'video',
    mediaProvider: 'omni',
    mediaApiType: 'async',
    mediaCapabilities: ['video.generate', 'video.image_to_video', 'video.edit'],
    mediaModelRefs: [
      {
        manifestId: 'omni:gemini-omni-flash-preview',
        modelId: 'gemini-omni-flash-preview',
        enabled: true,
      },
    ],
    mediaDefaults: {
      video: { aspectRatio: '16:9', durationSeconds: 6, resolution: '720p' },
      polling: { intervalMs: 10000, timeoutMs: 1_800_000 },
    },
    sourceUrls: ['https://ai.google.dev/gemini-api/docs/models/gemini-omni-flash'],
  },

  /* ─── Midjourney 外部网关 ─── */
  {
    id: 'midjourney-gateway',
    vendorId: 'midjourney',
    name: 'Midjourney 网关',
    provider: 'openai',
    apiEndpoint: 'https://your-midjourney-gateway.example/v1',
    defaultModel: 'midjourney',
    modelIds: ['midjourney'],
    modelType: 'image',
    mediaProvider: 'midjourney',
    mediaApiType: 'async',
    mediaCapabilities: ['image.generate', 'image.edit', 'image.variations'],
    mediaModelRefs: [{ manifestId: 'midjourney:gateway', modelId: 'midjourney', enabled: true }],
    mediaDefaults: {
      image: { aspectRatio: '1:1', n: 1 },
      polling: { intervalMs: 5000, timeoutMs: 900_000 },
    },
    sourceUrls: ['https://docs.midjourney.com/', 'https://www.midjourney.com/'],
  },

  /* ─── Kling 视频 ─── */
  {
    id: 'kling-video',
    vendorId: 'kuaishou',
    name: 'Kling 可灵视频',
    provider: 'openai',
    apiEndpoint: 'https://api.klingai.com',
    defaultModel: 'kling-video-3.0',
    modelIds: [
      'kling-video-3.0',
      'kling-video-3.0-omni',
      'kling-v2.6-pro',
      'kling-v2.6-std',
      'kling-v2.5-turbo',
      'kling-video-o1',
    ],
    modelType: 'video',
    mediaProvider: 'kling',
    mediaApiType: 'async',
    mediaCapabilities: ['video.generate', 'video.image_to_video', 'video.edit'],
    mediaModelRefs: [
      { manifestId: 'kling:kling-video-3.0', modelId: 'kling-video-3.0', enabled: true },
      { manifestId: 'kling:kling-video-3.0-omni', modelId: 'kling-video-3.0-omni', enabled: true },
      { manifestId: 'kling:kling-v2.6-pro', modelId: 'kling-v2.6-pro', enabled: true },
      { manifestId: 'kling:kling-v2.6-std', modelId: 'kling-v2.6-std', enabled: true },
      { manifestId: 'kling:kling-v2.5-turbo', modelId: 'kling-v2.5-turbo', enabled: true },
      { manifestId: 'kling:kling-video-o1', modelId: 'kling-video-o1', enabled: true },
    ],
    mediaDefaults: {
      video: { aspectRatio: '16:9', durationSeconds: 5 },
      polling: { intervalMs: 5000, timeoutMs: 1_800_000 },
    },
    sourceUrls: ['https://klingapi.com/zh/docs/text-to-video'],
  },

  /* ─── MiniMax 图片 ─── */
  {
    id: 'minimax-image',
    vendorId: 'minimax',
    name: 'MiniMax 图片',
    provider: 'openai',
    apiEndpoint: 'https://api.minimaxi.com',
    defaultModel: 'image-01',
    modelIds: ['image-01', 'image-01-live'],
    modelType: 'image',
    imageProvider: 'custom',
    imageApiType: 'sync',
    mediaProvider: 'minimax-hailuo',
    mediaApiType: 'sync',
    mediaCapabilities: ['image.generate'],
    mediaModelRefs: [{ manifestId: 'minimax:image-01', modelId: 'image-01', enabled: true }],
    mediaDefaults: { image: { aspectRatio: '1:1', n: 1, responseFormat: 'url' } },
    sourceUrls: ['https://platform.minimaxi.com/document/image_generation'],
  },

  /* ─── MiniMax 语音 ─── */
  {
    id: 'minimax-speech',
    vendorId: 'minimax',
    name: 'MiniMax 语音合成',
    provider: 'openai',
    apiEndpoint: 'https://api.minimaxi.com',
    defaultModel: 'speech-2.8-turbo',
    modelIds: ['speech-2.8-turbo', 'speech-2.8-hd'],
    modelType: 'voice',
    mediaProvider: 'minimax-hailuo',
    mediaApiType: 'sync',
    mediaCapabilities: ['audio.speech'],
    mediaModelRefs: [
      { manifestId: 'minimax:speech-2.8-turbo', modelId: 'speech-2.8-turbo', enabled: true },
      { manifestId: 'minimax:speech-2.8-hd', modelId: 'speech-2.8-hd', enabled: true },
    ],
    mediaDefaults: { audio: { format: 'mp3', speed: 1 } },
    sourceUrls: ['https://platform.minimaxi.com/document/text-to-speech'],
  },

  /* ─── MiniMax Hailuo 视频 ─── */
  {
    id: 'minimax-hailuo-video',
    vendorId: 'minimax',
    name: 'MiniMax Hailuo 视频',
    provider: 'openai',
    apiEndpoint: 'https://api.minimaxi.com',
    defaultModel: 'MiniMax-Hailuo-2.3',
    modelIds: ['MiniMax-Hailuo-2.3'],
    modelType: 'video',
    mediaProvider: 'minimax-hailuo',
    mediaApiType: 'async',
    mediaCapabilities: ['video.generate', 'video.image_to_video', 'video.edit'],
    mediaModelRefs: [
      { manifestId: 'minimax:hailuo-2.3', modelId: 'MiniMax-Hailuo-2.3', enabled: true },
    ],
    mediaDefaults: {
      video: { durationSeconds: 6, resolution: '768P' },
      polling: { intervalMs: 5000, timeoutMs: 1_800_000 },
    },
    sourceUrls: ['https://platform.minimaxi.com/document/video_generation'],
  },
]

/* ─── 查询工具函数 ─── */

export function getProviderPresetById(id: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((preset) => preset.id === id)
}

export function getVendorMeta(vendorId: string): VendorMeta | undefined {
  return VENDOR_CATALOG.find((v) => v.id === vendorId)
}

export function getPresetsByVendor(vendorId: string): ProviderPreset[] {
  return PROVIDER_PRESETS.filter((p) => p.vendorId === vendorId)
}

/** 获取去重后的 vendorId 列表（保持顺序） */
export function getUniqueVendorIds(): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const preset of PROVIDER_PRESETS) {
    if (!seen.has(preset.vendorId)) {
      seen.add(preset.vendorId)
      result.push(preset.vendorId)
    }
  }
  return result
}

/* ─── 资产一致性自检（仅 dev / 显式开启时使用） ─── */

/**
 * 在浏览器/Dev 环境下，校验每个 vendor 的 logoPath 看上去合法。
 *
 * - 不强制 import node:fs，避免 protocol 包耦合 Node API。
 * - 只检查字符串形态（路径是否以 .svg / .png 结尾，是否含有非法字符）。
 * - 真正的"文件存在性"在 renderer 端通过 fetch 资源做运行时兜底。
 *
 * 满足条件返回 null；否则返回问题描述数组。
 */
export function assertProviderAssetsConsistency(): string[] | null {
  const issues: string[] = []

  if (VENDOR_CATALOG.length === 0) {
    issues.push('VENDOR_CATALOG is empty')
  }

  // 每个 vendor 必须有 logoPath
  for (const v of VENDOR_CATALOG) {
    if (!v.logoPath || v.logoPath.trim().length === 0) {
      issues.push(`vendor[${v.id}] missing logoPath`)
      continue
    }
    if (!/^providers\/[a-z0-9._-]+\.(svg|png)$/i.test(v.logoPath)) {
      issues.push(`vendor[${v.id}] logoPath "${v.logoPath}" has unexpected format`)
    }
  }

  // vendorId 唯一
  const seen = new Set<string>()
  for (const v of VENDOR_CATALOG) {
    if (seen.has(v.id)) {
      issues.push(`duplicate vendor id: ${v.id}`)
    }
    seen.add(v.id)
  }

  // preset 引用了已存在的 vendorId
  const known = new Set(VENDOR_CATALOG.map((v) => v.id))
  for (const p of PROVIDER_PRESETS) {
    if (!known.has(p.vendorId)) {
      issues.push(`preset[${p.id}] references unknown vendorId=${p.vendorId}`)
    }
    if (!p.id || p.id.trim().length === 0) {
      issues.push('preset has empty id')
    }
    if (!p.apiEndpoint || !/^https?:\/\//.test(p.apiEndpoint)) {
      issues.push(`preset[${p.id}] apiEndpoint invalid: ${p.apiEndpoint}`)
    }
    if (p.modelIds.length === 0 || !p.modelIds.includes(p.defaultModel)) {
      issues.push(`preset[${p.id}] defaultModel "${p.defaultModel}" not in modelIds`)
    }
  }

  return issues.length === 0 ? null : issues
}
