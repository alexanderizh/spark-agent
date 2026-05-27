export type ProviderPresetKind = 'anthropic' | 'openai'

export interface ProviderPreset {
  id: string
  vendorId: string
  name: string
  provider: ProviderPresetKind
  apiEndpoint: string
  defaultModel: string
  modelIds: string[]
  sourceUrls: string[]
}

/* ─── Vendor 元数据（用于 UI 展示：emoji logo + 颜色 + 描述） ─── */

export interface VendorMeta {
  id: string
  name: string
  emoji: string
  color: string
  desc: string
}

export const VENDOR_CATALOG: VendorMeta[] = [
  { id: 'openai',           name: 'OpenAI',          emoji: 'OA',  color: '#10a37f', desc: 'GPT-4.1 / o4 / DALL-E' },
  { id: 'anthropic',        name: 'Anthropic',       emoji: 'A',   color: '#d4a574', desc: 'Claude Sonnet 4 / Opus 4 / Haiku' },
  { id: 'google-gemini',    name: 'Google Gemini',   emoji: 'G',   color: '#4285f4', desc: 'Gemini 2.5 Pro / Flash' },
  { id: 'tencent-coding-plan',  name: '腾讯云 Coding Plan',  emoji: 'TX', color: '#006eff', desc: '混元 / MiniMax / Kimi / GLM 聚合' },
  { id: 'aliyun-bailian-coding-plan', name: '阿里云百炼 Coding Plan', emoji: 'AL', color: '#ff6a00', desc: 'Qwen3 / GLM / Kimi / MiniMax 聚合' },
  { id: 'zhipu-glm-coding-plan', name: '智谱 GLM Coding Plan', emoji: 'GL', color: '#3b5cff', desc: 'GLM-5 / GLM-4.7 / GLM-4.5-air' },
  { id: 'qwen-standard',    name: '通义千问',         emoji: 'QW',  color: '#6f42c1', desc: 'Qwen3 / Qwen3-Coder 系列模型' },
  { id: 'deepseek-api',     name: 'DeepSeek',        emoji: 'DS',  color: '#4d6bfe', desc: 'DeepSeek-V4 Flash / Pro' },
  { id: 'minimax',          name: 'MiniMax',         emoji: 'MM',  color: '#6c5ce7', desc: 'MiniMax-M2.7 / M2.5 系列' },
  { id: 'kimi',             name: 'Kimi',            emoji: 'KM',  color: '#1a1a2e', desc: 'Kimi-K2.6 / K2.5 / K2-Thinking' },
  { id: 'siliconflow',      name: '硅基流动',        emoji: 'SF',  color: '#7c3aed', desc: 'DeepSeek / Qwen / Kimi 聚合' },
  { id: 'openrouter',       name: 'OpenRouter',      emoji: 'OR',  color: '#6d28d9', desc: 'GPT-4.1 / Claude / Gemini 聚合' },
  { id: 'ollama',           name: 'Ollama',          emoji: 'OL',  color: '#6366f1', desc: '本地模型 · Llama / Qwen / DeepSeek' },
]

export const PROVIDER_PRESETS: ProviderPreset[] = [
  /* ─── OpenAI 官方 ─── */
  {
    id: 'openai-official',
    vendorId: 'openai',
    name: 'OpenAI',
    provider: 'openai',
    apiEndpoint: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4.1',
    modelIds: ['gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano', 'o4-mini', 'o3', 'gpt-4o'],
    sourceUrls: [
      'https://platform.openai.com/docs/models',
      'https://platform.openai.com/docs/api-reference/chat',
    ],
  },

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
    defaultModel: 'tc-code-latest',
    modelIds: ['tc-code-latest', 'hunyuan-2.0-instruct', 'hunyuan-2.0-thinking', 'minimax-m2.5', 'kimi-k2.5', 'glm-5'],
    sourceUrls: [
      'https://cloud.tencent.com/document/product/1823/130092',
    ],
  },
  {
    id: 'tencent-coding-plan-openai',
    vendorId: 'tencent-coding-plan',
    name: '腾讯云 Coding Plan',
    provider: 'openai',
    apiEndpoint: 'https://api.lkeap.cloud.tencent.com/coding/v3',
    defaultModel: 'tc-code-latest',
    modelIds: ['tc-code-latest', 'hunyuan-2.0-instruct', 'hunyuan-2.0-thinking', 'minimax-m2.5', 'kimi-k2.5', 'glm-5'],
    sourceUrls: [
      'https://cloud.tencent.com/document/product/1823/130092',
    ],
  },

  /* ─── 阿里云百炼 Coding Plan ─── */
  {
    id: 'aliyun-bailian-coding-plan-anthropic',
    vendorId: 'aliyun-bailian-coding-plan',
    name: '阿里云百炼 Coding Plan',
    provider: 'anthropic',
    apiEndpoint: 'https://coding.dashscope.aliyuncs.com/apps/anthropic',
    defaultModel: 'qwen3.6-plus',
    modelIds: ['qwen3.6-plus', 'qwen3.5-plus', 'qwen3-coder-plus', 'glm-5', 'kimi-k2.5', 'MiniMax-M2.5'],
    sourceUrls: [
      'https://help.aliyun.com/zh/model-studio/coding-plan-faq',
      'https://help.aliyun.com/zh/model-studio/text-generation-model/',
      'https://help.aliyun.com/zh/model-studio/opencode',
    ],
  },
  {
    id: 'aliyun-bailian-coding-plan-openai',
    vendorId: 'aliyun-bailian-coding-plan',
    name: '阿里云百炼 Coding Plan',
    provider: 'openai',
    apiEndpoint: 'https://coding.dashscope.aliyuncs.com/v1',
    defaultModel: 'qwen3.6-plus',
    modelIds: ['qwen3.6-plus', 'qwen3.5-plus', 'qwen3-coder-plus', 'glm-5', 'kimi-k2.5', 'MiniMax-M2.5'],
    sourceUrls: [
      'https://help.aliyun.com/zh/model-studio/coding-plan-faq',
      'https://help.aliyun.com/zh/model-studio/text-generation-model/',
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
    defaultModel: 'glm-4.7',
    modelIds: ['glm-4.7', 'glm-4.5-air', 'glm-5-turbo', 'glm-5.1'],
    sourceUrls: [
      'https://docs.bigmodel.cn/cn/coding-plan/tool/claude',
      'https://docs.bigmodel.cn/cn/guide/develop/claude/introduction',
      'https://bigmodel.cn/claude-code',
    ],
  },
  {
    id: 'zhipu-glm-coding-plan-openai',
    vendorId: 'zhipu-glm-coding-plan',
    name: '智谱 GLM Coding Plan',
    provider: 'openai',
    apiEndpoint: 'https://open.bigmodel.cn/api/coding/paas/v4',
    defaultModel: 'glm-4.7',
    modelIds: ['glm-4.7', 'glm-4.5-air', 'glm-5-turbo', 'glm-5.1'],
    sourceUrls: [
      'https://docs.bigmodel.cn/cn/coding-plan/tool/kilo',
      'https://bigmodel.cn/claude-code',
    ],
  },

  /* ─── 通义千问标准版 ─── */
  {
    id: 'qwen-standard-openai',
    vendorId: 'qwen-standard',
    name: '通义千问',
    provider: 'openai',
    apiEndpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen3-235b-a22b',
    modelIds: ['qwen3-235b-a22b', 'qwen3-30b-a3b', 'qwen3-coder-plus', 'qwen-plus-latest', 'qwen-turbo-latest'],
    sourceUrls: [
      'https://help.aliyun.com/zh/model-studio/developer-reference/use-qwen-by-calling-api',
      'https://help.aliyun.com/zh/model-studio/getting-started/models',
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
    sourceUrls: [
      'https://api-docs.deepseek.com/quick_start/pricing',
    ],
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
    ],
  },

  /* ─── MiniMax ─── */
  {
    id: 'minimax-anthropic',
    vendorId: 'minimax',
    name: 'MiniMax',
    provider: 'anthropic',
    apiEndpoint: 'https://api.minimaxi.com/anthropic',
    defaultModel: 'MiniMax-M2.7',
    modelIds: ['MiniMax-M2.7', 'MiniMax-M2.7-highspeed', 'MiniMax-M2.5', 'MiniMax-M2.5-highspeed'],
    sourceUrls: [
      'https://platform.minimaxi.com/docs/api-reference/text-chat-anthropic',
      'https://platform.minimaxi.com/docs/api-reference/models/anthropic/list-models',
      'https://platform.minimaxi.com/docs/api-reference/text-ai-sdk',
    ],
  },
  {
    id: 'minimax-openai',
    vendorId: 'minimax',
    name: 'MiniMax',
    provider: 'openai',
    apiEndpoint: 'https://api.minimaxi.com/v1',
    defaultModel: 'MiniMax-M2.7',
    modelIds: ['MiniMax-M2.7', 'MiniMax-M2.7-highspeed', 'MiniMax-M2.5', 'MiniMax-M2.5-highspeed'],
    sourceUrls: [
      'https://platform.minimaxi.com/docs/api-reference/api-overview',
      'https://platform.minimaxi.com/docs/api-reference/text-ai-sdk',
    ],
  },

  /* ─── Kimi (Moonshot) ─── */
  {
    id: 'kimi-openai',
    vendorId: 'kimi',
    name: 'Kimi',
    provider: 'openai',
    apiEndpoint: 'https://api.moonshot.cn/v1',
    defaultModel: 'kimi-k2.6',
    modelIds: ['kimi-k2.6', 'kimi-k2.5', 'kimi-k2-thinking', 'kimi-k2-thinking-turbo'],
    sourceUrls: [
      'https://platform.moonshot.cn/',
      'https://platform.moonshot.cn/docs/intro',
      'https://platform.moonshot.cn/docs/guide/kimi-k2-5-quickstart',
    ],
  },

  /* ─── 硅基流动 ─── */
  {
    id: 'siliconflow-openai',
    vendorId: 'siliconflow',
    name: '硅基流动',
    provider: 'openai',
    apiEndpoint: 'https://api.siliconflow.cn/v1',
    defaultModel: 'deepseek-ai/DeepSeek-V3.1-Terminus',
    modelIds: ['deepseek-ai/DeepSeek-V3.1-Terminus', 'moonshotai/Kimi-K2-Instruct-0905', 'Qwen/Qwen3-30B-A3B-Instruct'],
    sourceUrls: [
      'https://docs.siliconflow.cn/en/userguide/quickstart',
      'https://docs.siliconflow.cn/en/api-reference/models/get-model-list',
      'https://docs.siliconflow.cn/api-reference/chat-completions/chat-completions',
    ],
  },

  /* ─── OpenRouter ─── */
  {
    id: 'openrouter-openai',
    vendorId: 'openrouter',
    name: 'OpenRouter',
    provider: 'openai',
    apiEndpoint: 'https://openrouter.ai/api/v1',
    defaultModel: 'openai/gpt-4.1',
    modelIds: ['openai/gpt-4.1', 'anthropic/claude-sonnet-4', 'google/gemini-2.5-pro-preview'],
    sourceUrls: [
      'https://openrouter.ai/docs/api/reference/overview',
      'https://openrouter.ai/docs/api/api-reference/models/get-models',
      'https://openrouter.ai/docs/guides/overview/models',
    ],
  },

  /* ─── Ollama 本地 ─── */
  {
    id: 'ollama-local',
    vendorId: 'ollama',
    name: 'Ollama 本地',
    provider: 'openai',
    apiEndpoint: 'http://localhost:11434/v1',
    defaultModel: 'qwen3:14b',
    modelIds: ['qwen3:14b', 'deepseek-r1:14b', 'llama3.1:8b', 'codellama:13b', 'gemma3:12b'],
    sourceUrls: [
      'https://ollama.com/library',
      'https://github.com/ollama/ollama/blob/main/docs/openai.md',
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
