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

export const PROVIDER_PRESETS: ProviderPreset[] = [
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
]

export function getProviderPresetById(id: string): ProviderPreset | undefined {
  return PROVIDER_PRESETS.find((preset) => preset.id === id)
}
