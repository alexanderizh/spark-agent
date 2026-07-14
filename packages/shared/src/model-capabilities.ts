import type { ModelCapability } from '@spark/protocol'

// ─── 能力数据库（modelId → capability）────────────────────────────────────────

const CAPABILITIES: Record<string, ModelCapability> = {
  // ── Anthropic ──────────────────────────────────────────────────────────────
  'claude-opus-4-20250514': {
    contextWindow: 200_000, maxOutputTokens: 32_000,
    supportsVision: true, supportsToolUse: true, supportsStreaming: true, supportsExtendedThinking: true,
    supportedModalities: ['text', 'image'],
  },
  'claude-sonnet-4-20250514': {
    contextWindow: 200_000, maxOutputTokens: 16_000,
    supportsVision: true, supportsToolUse: true, supportsStreaming: true, supportsExtendedThinking: true,
    supportedModalities: ['text', 'image'],
  },
  'claude-sonnet-4-5-20250929': {
    contextWindow: 200_000, maxOutputTokens: 16_000,
    supportsVision: true, supportsToolUse: true, supportsStreaming: true, supportsExtendedThinking: true,
    supportedModalities: ['text', 'image'],
  },
  'claude-opus-4-1-20250805': {
    contextWindow: 200_000, maxOutputTokens: 32_000,
    supportsVision: true, supportsToolUse: true, supportsStreaming: true, supportsExtendedThinking: true,
    supportedModalities: ['text', 'image'],
  },
  'claude-3-5-sonnet-20241022': {
    contextWindow: 200_000, maxOutputTokens: 8_192,
    supportsVision: true, supportsToolUse: true, supportsStreaming: true, supportsExtendedThinking: false,
    supportedModalities: ['text', 'image'],
  },
  'claude-3-5-haiku-20241022': {
    contextWindow: 200_000, maxOutputTokens: 8_192,
    supportsVision: true, supportsToolUse: true, supportsStreaming: true, supportsExtendedThinking: false,
    supportedModalities: ['text', 'image'],
  },
  'claude-haiku-4-20250514': {
    contextWindow: 200_000, maxOutputTokens: 8_192,
    supportsVision: true, supportsToolUse: true, supportsStreaming: true, supportsExtendedThinking: false,
    supportedModalities: ['text', 'image'],
  },

  // ── OpenAI ─────────────────────────────────────────────────────────────────
  'gpt-4o': {
    contextWindow: 128_000, maxOutputTokens: 16_384,
    supportsVision: true, supportsToolUse: true, supportsStreaming: true, supportsExtendedThinking: false,
    supportedModalities: ['text', 'image'],
  },
  'gpt-4o-mini': {
    contextWindow: 128_000, maxOutputTokens: 16_384,
    supportsVision: true, supportsToolUse: true, supportsStreaming: true, supportsExtendedThinking: false,
    supportedModalities: ['text', 'image'],
  },
  'gpt-4-turbo': {
    contextWindow: 128_000, maxOutputTokens: 4_096,
    supportsVision: true, supportsToolUse: true, supportsStreaming: true, supportsExtendedThinking: false,
    supportedModalities: ['text', 'image'],
  },
  'o1': {
    contextWindow: 200_000, maxOutputTokens: 100_000,
    supportsVision: true, supportsToolUse: true, supportsStreaming: true, supportsExtendedThinking: true,
    supportedModalities: ['text', 'image'],
  },
  'o1-mini': {
    contextWindow: 128_000, maxOutputTokens: 65_536,
    supportsVision: false, supportsToolUse: false, supportsStreaming: true, supportsExtendedThinking: true,
    supportedModalities: ['text'],
  },
  'o3': {
    contextWindow: 200_000, maxOutputTokens: 100_000,
    supportsVision: true, supportsToolUse: true, supportsStreaming: true, supportsExtendedThinking: true,
    supportedModalities: ['text', 'image'],
  },
  'o3-mini': {
    contextWindow: 200_000, maxOutputTokens: 65_536,
    supportsVision: false, supportsToolUse: true, supportsStreaming: true, supportsExtendedThinking: true,
    supportedModalities: ['text'],
  },
  'gpt-5': {
    contextWindow: 400_000, maxOutputTokens: 128_000,
    supportsVision: true, supportsToolUse: true, supportsStreaming: true, supportsExtendedThinking: true,
    supportedModalities: ['text', 'image'],
  },
  'gpt-5-codex': {
    contextWindow: 400_000, maxOutputTokens: 128_000,
    supportsVision: true, supportsToolUse: true, supportsStreaming: true, supportsExtendedThinking: true,
    supportedModalities: ['text', 'image'],
  },
  'gpt-4.1': {
    contextWindow: 400_000, maxOutputTokens: 32_768,
    supportsVision: true, supportsToolUse: true, supportsStreaming: true, supportsExtendedThinking: false,
    supportedModalities: ['text', 'image'],
  },

  // ── DeepSeek ───────────────────────────────────────────────────────────────
  'deepseek-chat': {
    contextWindow: 64_000, maxOutputTokens: 8_192,
    supportsVision: false, supportsToolUse: true, supportsStreaming: true, supportsExtendedThinking: false,
    supportedModalities: ['text'],
  },
  'deepseek-v4-flash': {
    contextWindow: 1_000_000, maxOutputTokens: 384_000,
    supportsVision: false, supportsToolUse: true, supportsStreaming: true, supportsExtendedThinking: true,
    supportedModalities: ['text'],
  },
  'deepseek-v4-pro': {
    contextWindow: 1_000_000, maxOutputTokens: 384_000,
    supportsVision: false, supportsToolUse: true, supportsStreaming: true, supportsExtendedThinking: true,
    supportedModalities: ['text'],
  },
  'deepseek-reasoner': {
    contextWindow: 64_000, maxOutputTokens: 8_000,
    supportsVision: false, supportsToolUse: false, supportsStreaming: true, supportsExtendedThinking: true,
    supportedModalities: ['text'],
  },

  // ── Google Gemini ──────────────────────────────────────────────────────────
  'gemini-2.0-flash': {
    contextWindow: 1_048_576, maxOutputTokens: 8_192,
    supportsVision: true, supportsToolUse: true, supportsStreaming: true, supportsExtendedThinking: false,
    supportedModalities: ['text', 'image', 'audio', 'video'],
  },
  'gemini-2.5-pro': {
    contextWindow: 1_048_576, maxOutputTokens: 65_536,
    supportsVision: true, supportsToolUse: true, supportsStreaming: true, supportsExtendedThinking: true,
    supportedModalities: ['text', 'image', 'audio', 'video'],
  },
  'gemini-1.5-pro': {
    contextWindow: 2_097_152, maxOutputTokens: 8_192,
    supportsVision: true, supportsToolUse: true, supportsStreaming: true, supportsExtendedThinking: false,
    supportedModalities: ['text', 'image', 'audio', 'video'],
  },

  // ── 智谱 GLM ───────────────────────────────────────────────────────────────
  'glm-5.2': {
    contextWindow: 1_000_000, maxOutputTokens: 131_072,
    supportsVision: false, supportsToolUse: true, supportsStreaming: true, supportsExtendedThinking: true,
    supportedModalities: ['text'],
  },
  'glm-5.1': {
    contextWindow: 200_000, maxOutputTokens: 131_072,
    supportsVision: false, supportsToolUse: true, supportsStreaming: true, supportsExtendedThinking: true,
    supportedModalities: ['text'],
  },
  'glm-5': {
    contextWindow: 200_000, maxOutputTokens: 131_072,
    supportsVision: false, supportsToolUse: true, supportsStreaming: true, supportsExtendedThinking: true,
    supportedModalities: ['text'],
  },
  'glm-5-turbo': {
    contextWindow: 200_000, maxOutputTokens: 131_072,
    supportsVision: false, supportsToolUse: true, supportsStreaming: true, supportsExtendedThinking: true,
    supportedModalities: ['text'],
  },
  'glm-4.7': {
    contextWindow: 200_000, maxOutputTokens: 131_072,
    supportsVision: false, supportsToolUse: true, supportsStreaming: true, supportsExtendedThinking: true,
    supportedModalities: ['text'],
  },
  'glm-4.6': {
    contextWindow: 200_000, maxOutputTokens: 131_072,
    supportsVision: false, supportsToolUse: true, supportsStreaming: true, supportsExtendedThinking: true,
    supportedModalities: ['text'],
  },
  'glm-4.5': {
    contextWindow: 128_000, maxOutputTokens: 98_304,
    supportsVision: false, supportsToolUse: true, supportsStreaming: true, supportsExtendedThinking: true,
    supportedModalities: ['text'],
  },
  'glm-4': {
    contextWindow: 128_000, maxOutputTokens: 4_096,
    supportsVision: false, supportsToolUse: true, supportsStreaming: true, supportsExtendedThinking: false,
    supportedModalities: ['text'],
  },
  'glm-4v': {
    contextWindow: 8_192, maxOutputTokens: 1_024,
    supportsVision: true, supportsToolUse: false, supportsStreaming: true, supportsExtendedThinking: false,
    supportedModalities: ['text', 'image'],
  },

  // ── 通义千问 ───────────────────────────────────────────────────────────────
  'qwen-max': {
    contextWindow: 32_768, maxOutputTokens: 8_192,
    supportsVision: false, supportsToolUse: true, supportsStreaming: true, supportsExtendedThinking: false,
    supportedModalities: ['text'],
  },
  'qwen-plus': {
    contextWindow: 131_072, maxOutputTokens: 8_192,
    supportsVision: false, supportsToolUse: true, supportsStreaming: true, supportsExtendedThinking: false,
    supportedModalities: ['text'],
  },
  'qwen-vl-max': {
    contextWindow: 32_768, maxOutputTokens: 2_000,
    supportsVision: true, supportsToolUse: false, supportsStreaming: true, supportsExtendedThinking: false,
    supportedModalities: ['text', 'image'],
  },

  // ── Moonshot / Kimi ────────────────────────────────────────────────────────
  'moonshot-v1-128k': {
    contextWindow: 128_000, maxOutputTokens: 4_096,
    supportsVision: false, supportsToolUse: true, supportsStreaming: true, supportsExtendedThinking: false,
    supportedModalities: ['text'],
  },
}

// ─── ModelCapabilityRegistry ──────────────────────────────────────────────────

/** 模型能力注册表 — 纯静态查询，无副作用 */
export const ModelCapabilityRegistry = {
  /** 获取指定模型的能力元数据（精确匹配，再尝试前缀匹配） */
  getCapabilities(modelId: string): ModelCapability | undefined {
    const normalized = normalizeModelId(modelId)
    if (CAPABILITIES[normalized]) return CAPABILITIES[normalized]
    // 前缀匹配：如 "claude-sonnet-4" 匹配 "claude-sonnet-4-20250514"
    const key = Object.keys(CAPABILITIES).find((k) => k.startsWith(normalized) || normalized.startsWith(k))
      ?? inferFamilyCapabilityKey(normalized)
    return key ? CAPABILITIES[key] : undefined
  },

  /** 判断模型是否具备某项能力 */
  isCapable(modelId: string, capability: keyof ModelCapability): boolean {
    const cap = this.getCapabilities(modelId)
    if (!cap) return false
    const val = cap[capability]
    return typeof val === 'boolean' ? val : Array.isArray(val) ? val.length > 0 : val > 0
  },

  /** 获取所有已知模型 ID */
  getAllModelIds(): string[] {
    return Object.keys(CAPABILITIES)
  },
}

export function resolveModelContextWindow(modelId: string): number {
  const normalized = normalizeModelId(modelId)
  if (!normalized) return 0

  const cap = ModelCapabilityRegistry.getCapabilities(normalized)
  if (cap && cap.contextWindow > 0) return cap.contextWindow

  if (normalized.includes('claude')) return 200_000
  if (normalized.includes('gpt-5') || normalized.includes('gpt-4.1')) return 400_000
  if (normalized.includes('gpt-4')) return 128_000
  if (normalized.includes('o1') || normalized.includes('o3') || normalized.includes('o4')) return 200_000
  if (normalized.includes('gemini-1.5')) return 2_097_152
  if (normalized.includes('gemini')) return 1_048_576
  if (normalized.includes('qwen')) return 131_072
  if (normalized.includes('deepseek-v4')) return 1_000_000
  if (normalized.includes('deepseek')) return 64_000
  if (normalized.includes('glm-5.2')) return 1_000_000
  if (normalized.includes('glm-5') || normalized.includes('glm-4.7') || normalized.includes('glm-4.6')) return 200_000
  if (normalized.includes('glm-4.5')) return 128_000
  if (normalized.includes('glm')) return 128_000
  if (normalized.includes('moonshot') || normalized.includes('kimi')) return 128_000
  return 128_000
}

export function resolveSoftContextLimit(modelId: string): number {
  const contextWindow = resolveModelContextWindow(modelId)
  return resolveSoftContextLimitForWindow(contextWindow)
}

/**
 * 解析 Provider 上下文窗口。
 * 优先级：customContextWindow > supportsMillionContext > 200k。
 * customContextWindow 单位为 tokens；<=0 或未设视为未配置。
 */
export function resolveProviderContextWindow(
  supportsMillionContext?: boolean,
  customContextWindow?: number,
): number {
  if (typeof customContextWindow === 'number' && customContextWindow > 0) {
    return Math.floor(customContextWindow)
  }
  return supportsMillionContext === true ? 1_000_000 : 200_000
}

export function resolveSoftContextLimitForWindow(contextWindow: number): number {
  return contextWindow > 0 ? Math.floor(contextWindow * 0.7) : 100_000
}

function normalizeModelId(modelId: string): string {
  const lower = modelId.trim().toLowerCase()
  const withoutProviderPrefix = lower.includes('/') ? lower.split('/').pop() ?? lower : lower
  return withoutProviderPrefix
}

function inferFamilyCapabilityKey(modelId: string): string | undefined {
  if (modelId.includes('claude-opus')) return 'claude-opus-4-20250514'
  if (modelId.includes('claude')) return 'claude-sonnet-4-20250514'
  if (modelId.includes('gpt-5')) return 'gpt-5'
  if (modelId.includes('gpt-4.1')) return 'gpt-4.1'
  if (modelId.includes('gpt-4o-mini')) return 'gpt-4o-mini'
  if (modelId.includes('gpt-4o')) return 'gpt-4o'
  if (modelId.includes('gpt-4')) return 'gpt-4-turbo'
  if (modelId.includes('deepseek')) return 'deepseek-chat'
  if (modelId.includes('gemini-2.5')) return 'gemini-2.5-pro'
  if (modelId.includes('gemini')) return 'gemini-2.0-flash'
  if (modelId.includes('qwen')) return 'qwen-plus'
  if (modelId.includes('glm')) return 'glm-4'
  if (modelId.includes('moonshot') || modelId.includes('kimi')) return 'moonshot-v1-128k'
  return undefined
}
