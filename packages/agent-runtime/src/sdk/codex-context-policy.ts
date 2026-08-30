/**
 * Codex native runtime 的模型上下文治理策略。
 *
 * `tool_output_token_limit` 是 Codex 官方配置：限制单个工具/函数输出写入历史时的
 * token 数。三条 native transport（SDK / app-server / CLI）必须共用同一值，避免
 * 某条回退路径重新把超大 Bash/MCP 结果完整带入后续模型调用。
 */
export const CODEX_TOOL_OUTPUT_TOKEN_LIMIT = 12_000

export const CODEX_CONTEXT_POLICY_CONFIG = {
  tool_output_token_limit: CODEX_TOOL_OUTPUT_TOKEN_LIMIT,
} as const
