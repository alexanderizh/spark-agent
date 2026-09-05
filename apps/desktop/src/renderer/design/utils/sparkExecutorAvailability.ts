/**
 * Spark 执行器可用性判定（渲染端纯函数）。
 *
 * 语义与 agent-runtime 侧 `resolveSparkUpstreamProtocol`（packages/agent-runtime/src/sdk/spark-engine/model-route.ts）保持一致：
 * spark-engine 只有 anthropic-messages / openai-responses 两种上游协议，
 * 因此 Anthropic 格式渠道与 OpenAI 格式 + Responses API 渠道可用，
 * 仅支持 Chat Completions 的渠道当前不可用（开关置灰并提示原因）。
 * 两处逻辑如需调整请同步修改。
 */

export type SparkExecutorUnavailableReason = 'chat-completions-openai'

export type SparkExecutorAvailability =
  | { available: true }
  | { available: false; reason: SparkExecutorUnavailableReason }

export const SPARK_EXECUTOR_UNAVAILABLE_HINTS: Record<SparkExecutorUnavailableReason, string> = {
  'chat-completions-openai':
    'Spark 执行器暂不支持 Chat Completions API 渠道，将 API 协议切换为 Responses API 后可开启',
}

export function sparkExecutorAvailability(
  provider: 'anthropic' | 'openai',
  codexApiKind: 'chat' | 'responses' | 'embedding' | null | undefined,
): SparkExecutorAvailability {
  if (provider === 'anthropic') return { available: true }
  // 与引擎侧一致：旧渠道未写 codexApiKind 时按 responses 口径视为可用
  if (codexApiKind == null || codexApiKind === 'responses') return { available: true }
  return { available: false, reason: 'chat-completions-openai' }
}
