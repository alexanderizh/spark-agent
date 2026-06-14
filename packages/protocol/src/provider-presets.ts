import type {
  MediaProviderKind,
  MediaApiType,
  MediaCapabilityId,
  ProviderMediaDefaults,
} from './media-config.js'

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
}

export const VENDOR_CATALOG: VendorMeta[] = [
  /* ─── 现有 13 个 ─── */
  // { id: 'openai',           name: 'OpenAI',          emoji: 'OA',  color: '#10a37f', desc: 'GPT-4.1 / o4 / DALL-E',  logoPath: 'providers/openai.svg' },
  { id: 'anthropic',        name: 'Anthropic',       emoji: 'A',   color: '#d4a574', desc: 'Claude Sonnet 4 / Opus 4 / Haiku', logoPath: 'providers/anthropic.svg' },
  { id: 'google-gemini',    name: 'Google Gemini',   emoji: 'G',   color: '#4285f4', desc: 'Gemini 2.5 Pro / Flash', logoPath: 'providers/google-gemini.svg' },
  { id: 'tencent-coding-plan',  name: '腾讯云 Coding Plan',  emoji: 'TX', color: '#006eff', desc: '混元 / MiniMax / Kimi / GLM 聚合', logoPath: 'providers/tencent-coding-plan.png' },
  { id: 'aliyun-bailian-coding-plan', name: '阿里云百炼 Coding Plan', emoji: 'AL', color: '#ff6a00', desc: 'Qwen3 / GLM / Kimi / MiniMax 聚合', logoPath: 'providers/aliyun-bailian-coding-plan.svg' },
  { id: 'zhipu-glm-coding-plan', name: '智谱 GLM Coding Plan', emoji: 'GL', color: '#3b5cff', desc: 'GLM-5 / GLM-4.7 / GLM-4.5-air', logoPath: 'providers/zhipu-glm-coding-plan.png' },
  { id: 'qwen-standard',    name: '通义千问',         emoji: 'QW',  color: '#6f42c1', desc: 'Qwen3 / Qwen3-Coder 系列模型', logoPath: 'providers/qwen-standard.png' },
  { id: 'deepseek-api',     name: 'DeepSeek',        emoji: 'DS',  color: '#4d6bfe', desc: 'DeepSeek-V4 Flash / Pro', logoPath: 'providers/deepseek-api.svg' },
  { id: 'minimax',          name: 'MiniMax',         emoji: 'MM',  color: '#6c5ce7', desc: 'MiniMax-M2.7 / M2.5 系列', logoPath: 'providers/minimax.png' },
  { id: 'kimi',             name: 'Kimi',            emoji: 'KM',  color: '#1a1a2e', desc: 'Kimi-K2.6 / K2.5 / K2-Thinking', logoPath: 'providers/kimi.png' },
  { id: 'siliconflow',      name: '硅基流动',        emoji: 'SF',  color: '#7c3aed', desc: 'DeepSeek / Qwen / Kimi 聚合', logoPath: 'providers/siliconflow.svg' },
  { id: 'openrouter',       name: 'OpenRouter',      emoji: 'OR',  color: '#6d28d9', desc: 'GPT-4.1 / Claude / Gemini 聚合', logoPath: 'providers/openrouter.svg' },
  { id: 'ollama',           name: 'Ollama',          emoji: 'OL',  color: '#6366f1', desc: '本地模型 · Llama / Qwen / DeepSeek', logoPath: 'providers/ollama.svg' },

  /* ─── 新增 15 个（图标来自 coding.mcppla.net 官方平台图标）─── */
  { id: 'xiaomi-mimo',      name: '小米 MiMo',       emoji: 'MM',  color: '#ff6900', desc: 'MiMo-V2-Pro / V2-Omni / V2-TTS', logoPath: 'providers/xiaomi-mimo.png' },
  { id: 'xfyun',            name: '讯飞星火',         emoji: 'SF',  color: '#1e88e5', desc: 'Spark X2 / X1.5 / Ultra / Pro', logoPath: 'providers/xfyun.png' },
  { id: 'jdcloud',          name: '京东云 JoyBuilder', emoji: 'JD',  color: '#e1251b', desc: 'JoyAI-LLM / JoyAI-M3 / Coding Plan', logoPath: 'providers/jdcloud.png' },
  { id: 'ctyun',            name: '天翼云息壤',       emoji: 'CT',  color: '#cf0a2c', desc: '息壤 Tokens · DeepSeek / Qwen / GLM 聚合', logoPath: 'providers/ctyun.svg' },
  { id: 'baidu',            name: '百度千帆',         emoji: 'BD',  color: '#2932e1', desc: 'ERNIE-4.5 / Qianfan-VL / 文心系列', logoPath: 'providers/baidu.png' },
  { id: 'volcengine',       name: '火山方舟',         emoji: 'VK',  color: '#1a73e8', desc: 'Doubao-pro / Doubao-Seed / Seedance', logoPath: 'providers/volcengine.png' },
  { id: 'huaweicloud',      name: '华为云盘古',       emoji: 'HW',  color: '#c7000b', desc: 'Pangu-NLP-N4 718B / Pangu Pro MoE', logoPath: 'providers/huaweicloud.png' },
  { id: 'unicom',           name: '联通云',           emoji: 'UC',  color: '#003c8f', desc: '元景 32B / 编码助手 AISP', logoPath: 'providers/unicom.png' },
  { id: 'ucloud',           name: 'UCloud UModelVerse', emoji: 'UC', color: '#0052d9', desc: 'DeepSeek / Qwen / 文心 / 阶跃 聚合', logoPath: 'providers/ucloud.png' },
  { id: 'infini-ai',        name: '无问芯穹 Infini-AI', emoji: 'IA', color: '#0d47a1', desc: 'DeepSeek / Qwen / 20+ 模型 · 多芯异构', logoPath: 'providers/infini-ai.png' },
  { id: 'alaya',            name: '九章云极 Alaya Code', emoji: 'AC', color: '#ff5722', desc: 'Kimi / Qwen3.5 / GLM-5 / MiniMax 聚合', logoPath: 'providers/alaya.svg' },
  { id: 'mthreads',         name: '摩尔线程',         emoji: 'MT',  color: '#00a86b', desc: '夸娥 GPU · Qwen / DeepSeek / MiniMax', logoPath: 'providers/mthreads.png' },
  { id: 'kuaishou',         name: '快手可灵',         emoji: 'KS',  color: '#ff6633', desc: '可灵 Kling V1.6 / 视频生成', logoPath: 'providers/kuaishou.png' },
  { id: 'trae',             name: 'Trae (字节)',     emoji: 'TR',  color: '#5b21b6', desc: 'Trae IDE · Doubao-1.5 / DeepSeek', logoPath: 'providers/trae.svg' },
  { id: 'qwen-tongyi',      name: '阿里通义',         emoji: 'QY',  color: '#ff6a00', desc: 'Qwen3.5 / Qwen3-Max / Qwen-Coder', logoPath: 'providers/qwen-tongyi.png' },

  /* ─── 新增（2026-06）：海外 / 自建网关 ─── */
  { id: 'github',           name: 'GitHub Models',   emoji: 'GH',  color: '#24292f', desc: 'GitHub Models · GPT-4o / o3 / Llama / Phi', logoPath: 'providers/github.svg' },
  { id: 'new-api',          name: 'New API 网关',    emoji: 'NA',  color: '#0ea5e9', desc: '自建 LLM 网关（One-API / New-API）· OpenAI 格式聚合', logoPath: 'providers/new-api.svg' },

  /* ─── 多媒体模型平台（APIMart / xAI）─── */
  { id: 'apimart',          name: 'APIMart',         emoji: 'AM',  color: '#22c55e', desc: '图片 / 语音 / 视频聚合（GPT Image / Whisper / VEO / Sora）', logoPath: 'providers/apimart.svg' },
  { id: 'xai',              name: 'xAI',             emoji: 'xA',  color: '#0f172a', desc: 'Grok Imagine 图片 / 视频 / 语音合成', logoPath: 'providers/xai.svg' },
]

export const PROVIDER_PRESETS: ProviderPreset[] = [
  /* ─── OpenAI 官方 ─── */
  // {
  //   id: 'openai-official',
  //   vendorId: 'openai',
  //   name: 'OpenAI',
  //   provider: 'openai',
  //   apiEndpoint: 'https://api.openai.com/v1',
  //   defaultModel: 'gpt-4.1',
  //   modelIds: ['gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano', 'o4-mini', 'o3', 'gpt-4o'],
  //   sourceUrls: [
  //     'https://platform.openai.com/docs/models',
  //     'https://platform.openai.com/docs/api-reference/chat',
  //   ],
  // },
  // {
  //   id: 'openai-images',
  //   vendorId: 'openai',
  //   name: 'OpenAI Images',
  //   provider: 'openai',
  //   apiEndpoint: 'https://api.openai.com/v1',
  //   defaultModel: 'gpt-image-1',
  //   modelIds: ['gpt-image-1', 'dall-e-3'],
  //   modelType: 'image',
  //   imageProvider: 'openai',
  //   imageApiType: 'sync',
  //   sourceUrls: [
  //     'https://platform.openai.com/docs/guides/image-generation',
  //     'https://platform.openai.com/docs/api-reference/images',
  //   ],
  // },
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

  /* ─── 腾讯云 Coding Plan ─── */
  {
    id: 'tencent-coding-plan-anthropic',
    vendorId: 'tencent-coding-plan',
    name: '腾讯云 Coding Plan',
    provider: 'anthropic',
    apiEndpoint: 'https://api.lkeap.cloud.tencent.com/coding/anthropic',
    defaultModel: 'glm-5',
    modelIds: ['glm-5'],
    sourceUrls: [
      'https://cloud.tencent.com/document/product/1823/130092',
    ],
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

  /* ─── 智谱 GLM Coding Plan ─── */
  {
    id: 'zhipu-glm-coding-plan-anthropic',
    vendorId: 'zhipu-glm-coding-plan',
    name: '智谱 GLM Coding Plan',
    provider: 'anthropic',
    apiEndpoint: 'https://open.bigmodel.cn/api/anthropic',
    defaultModel:  'glm-5.1',
    modelIds: ['glm-4.7','glm-5-turbo', 'glm-5.1'],
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

  /* ─── DeepSeek API ─── */
  {
    id: 'deepseek-api-anthropic',
    vendorId: 'deepseek-api',
    name: 'DeepSeek API',
    provider: 'anthropic',
    apiEndpoint: 'https://api.deepseek.com/anthropic',
    defaultModel: 'deepseek-v4-flash',
    modelIds: ['deepseek-v4-flash', 'deepseek-v4-pro'],
    sourceUrls: [
      'https://api-docs.deepseek.com/quick_start/pricing',
    ],
  },
  // {
  //   id: 'deepseek-api-openai',
  //   vendorId: 'deepseek-api',
  //   name: 'DeepSeek API',
  //   provider: 'openai',
  //   apiEndpoint: 'https://api.deepseek.com',
  //   defaultModel: 'deepseek-v4-flash',
  //   modelIds: ['deepseek-v4-flash', 'deepseek-v4-pro'],
  //   sourceUrls: [
  //     'https://api-docs.deepseek.com/quick_start/pricing',
  //   ],
  // },

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
  /* 火山方舟 Coding Plan：anthropic 协议（Claude Code） */
  {
    id: 'volcengine-ark-anthropic',
    vendorId: 'volcengine',
    name: '火山方舟 Coding Plan',
    provider: 'anthropic',
    apiEndpoint: 'https://ark.cn-beijing.volces.com/api/coding/anthropic',
    defaultModel: 'doubao-seed-code',
    modelIds: ['doubao-seed-code', 'deepseek-v3-1-250821', 'kimi-k2-250711', 'doubao-pro-32k'],
    sourceUrls: [
      'https://www.volcengine.com/docs/82379/1356615',
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
    sourceUrls: [
      'https://www.cucloud.cn/product/aisp',
      'https://www.cucloud.cn/',
    ],
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
    sourceUrls: [
      'https://www.datacanvas.com/',
      'https://www.alayacode.com/',
    ],
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
    sourceUrls: [
      'https://www.trae.cn/',
    ],
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
    sourceUrls: [
      'https://help.aliyun.com/zh/model-studio/claude-code',
    ],
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
    sourceUrls: [
      'https://docs.infini-ai.com/gen-studio-coding-plan/',
    ],
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
    modelIds: [
      'anthropic/claude-sonnet-4',
      'anthropic/claude-opus-4',
    ],
    sourceUrls: [
      'https://openrouter.ai/docs/cookbook/coding-agents/claude-code-integration',
    ],
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
    sourceUrls: [
      'https://docs.github.com/github-models/prototyping-with-ai-models',
    ],
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
    id: 'apimart-images',
    vendorId: 'apimart',
    name: 'APIMart 图片',
    provider: 'openai',
    apiEndpoint: 'https://api.apimart.ai/v1',
    defaultModel: 'gpt-image-2',
    modelIds: ['gpt-image-2', 'gpt-image-1'],
    modelType: 'image',
    imageProvider: 'apimart',
    imageApiType: 'async',
    mediaProvider: 'apimart',
    mediaApiType: 'auto',
    mediaCapabilities: ['image.generate', 'image.edit'],
    mediaDefaults: {
      image: { size: '1024x1024', n: 1, outputFormat: 'png' },
      polling: { intervalMs: 4000, timeoutMs: 240_000 },
    },
    sourceUrls: [
      'https://docs.apimart.ai/cn/api-reference/images/gpt-image-2/official',
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
    sourceUrls: [
      'https://docs.apimart.ai/cn/api-reference/audios/whisper-1',
    ],
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
    sourceUrls: [
      'https://docs.apimart.ai/cn/api-reference/audios/speech',
    ],
  },

  /* ─── APIMart 视频（VEO 3）─── */
  {
    id: 'apimart-video-veo3',
    vendorId: 'apimart',
    name: 'APIMart 视频 VEO 3',
    provider: 'openai',
    apiEndpoint: 'https://api.apimart.ai/v1',
    defaultModel: 'veo3',
    modelIds: ['veo3'],
    modelType: 'video',
    mediaProvider: 'apimart',
    mediaApiType: 'async',
    mediaCapabilities: ['video.generate', 'video.image_to_video'],
    mediaDefaults: {
      video: { aspectRatio: '16:9', durationSeconds: 8, quality: 'hd' },
      polling: { intervalMs: 6000, timeoutMs: 600_000 },
    },
    sourceUrls: [
      'https://docs.apimart.ai/cn/api-reference/videos/veo3/generation',
    ],
  },

  /* ─── APIMart 视频（Sora 2）─── */
  {
    id: 'apimart-video-sora2',
    vendorId: 'apimart',
    name: 'APIMart 视频 Sora 2',
    provider: 'openai',
    apiEndpoint: 'https://api.apimart.ai/v1',
    defaultModel: 'sora-2',
    modelIds: ['sora-2'],
    modelType: 'video',
    mediaProvider: 'apimart',
    mediaApiType: 'async',
    mediaCapabilities: ['video.generate', 'video.image_to_video'],
    mediaDefaults: {
      video: { aspectRatio: '16:9', durationSeconds: 8, quality: 'hd' },
      polling: { intervalMs: 6000, timeoutMs: 600_000 },
    },
    sourceUrls: [
      'https://docs.apimart.ai/cn/api-reference/videos/sora2/generation',
    ],
  },

  /* ─── xAI 图片（Grok Imagine）─── */
  {
    id: 'xai-imagine-image',
    vendorId: 'xai',
    name: 'xAI Imagine 图片',
    provider: 'openai',
    apiEndpoint: 'https://api.x.ai/v1',
    defaultModel: 'grok-imagine-image',
    modelIds: ['grok-imagine-image'],
    modelType: 'image',
    imageProvider: 'xai',
    imageApiType: 'sync',
    mediaProvider: 'xai',
    mediaApiType: 'sync',
    mediaCapabilities: ['image.generate'],
    mediaDefaults: { image: { aspectRatio: '1:1', n: 1, outputFormat: 'png' } },
    sourceUrls: [
      'https://docs.x.ai/developers/model-capabilities/imagine',
    ],
  },

  /* ─── xAI 视频（Imagine Video）─── */
  {
    id: 'xai-imagine-video',
    vendorId: 'xai',
    name: 'xAI Imagine 视频',
    provider: 'openai',
    apiEndpoint: 'https://api.x.ai/v1',
    defaultModel: 'grok-imagine-video',
    modelIds: ['grok-imagine-video'],
    modelType: 'video',
    mediaProvider: 'xai',
    mediaApiType: 'async',
    mediaCapabilities: ['video.generate', 'video.image_to_video'],
    mediaDefaults: {
      video: { aspectRatio: '16:9', durationSeconds: 6, quality: 'hd' },
      polling: { intervalMs: 5000, timeoutMs: 600_000 },
    },
    sourceUrls: [
      'https://docs.x.ai/developers/model-capabilities/video/generation',
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
    mediaDefaults: { audio: { voice: 'alloy', format: 'mp3', speed: 1 } },
    sourceUrls: [
      'https://docs.x.ai/developers/model-capabilities/audio/text-to-speech',
    ],
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
