/**
 * Provider 用量计量口径的单一事实源。
 *
 * 主进程（context ledger 的历史段反推）与渲染进程（上下文用量指示器）都需要把
 * usage_update 换算成「最近一次请求的真实 prompt 规模」，口径必须一致——
 * 抽到 shared 避免两份实现漂移。
 */

export interface ProviderPromptWindowTokensParams {
  /** usage_update 的 provider 字段（引擎计量族：claude / codex / ...） */
  provider: string | undefined
  inputTokens: number
  cacheHitTokens?: number | undefined
  cacheWriteTokens?: number | undefined
}

/**
 * 把 usage_update 换算成「最近一次请求的真实 prompt 规模」（上下文占用口径）。
 *
 * - claude（Anthropic 计量）：inputTokens 只是未命中缓存的余量，真实规模 =
 *   input + cache_read + cache_creation。漏掉缓存字段会把 95% 占用显示成 4%。
 * - codex（OpenAI 计量）：inputTokens 已含 cached，直接可用。
 */
export function providerPromptWindowTokens(params: ProviderPromptWindowTokensParams): number {
  if (params.provider !== 'claude') return Math.max(0, params.inputTokens)
  return Math.max(
    0,
    params.inputTokens + (params.cacheHitTokens ?? 0) + (params.cacheWriteTokens ?? 0),
  )
}
