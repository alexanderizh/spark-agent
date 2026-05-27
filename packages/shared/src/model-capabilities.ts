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

  // ── DeepSeek ───────────────────────────────────────────────────────────────
  'deepseek-chat': {
    contextWindow: 64_000, maxOutputTokens: 8_192,
    supportsVision: false, supportsToolUse: true, supportsStreaming: true, supportsExtendedThinking: false,
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
  'gemini-1.5-pro': {
    contextWindow: 2_097_152, maxOutputTokens: 8_192,
    supportsVision: true, supportsToolUse: true, supportsStreaming: true, supportsExtendedThinking: false,
    supportedModalities: ['text', 'image', 'audio', 'video'],
  },

  // ── 智谱 GLM ───────────────────────────────────────────────────────────────
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
    if (CAPABILITIES[modelId]) return CAPABILITIES[modelId]
    // 前缀匹配：如 "claude-sonnet-4" 匹配 "claude-sonnet-4-20250514"
    const key = Object.keys(CAPABILITIES).find((k) => k.startsWith(modelId) || modelId.startsWith(k))
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
