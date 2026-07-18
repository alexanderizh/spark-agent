import {
  isBuiltInLocalCliProvider,
  isLocalCodexCliProvider,
  type ProviderProfile,
  type SessionAgentAdapter,
} from '@spark/protocol'

export interface CanvasTextTaskAgentConfig {
  agentAdapter?: string | null
  modelId?: string | null
}

export function resolveCanvasTextExecutionAdapter(
  profile: Pick<ProviderProfile, 'id' | 'provider' | 'codexApiKind'>,
  agent: CanvasTextTaskAgentConfig | null,
): SessionAgentAdapter | null {
  if (isLocalCodexCliProvider(profile)) return 'codex'
  if (isBuiltInLocalCliProvider(profile)) return 'claude-sdk'
  // Agent adapter describes the preferred host, not the remote provider wire protocol.
  // Anthropic-compatible profiles must stay on the direct Messages API path; forcing
  // them through Codex would make the SDK probe a non-existent `/responses` WebSocket.
  // Legacy OpenAI-compatible profiles may not have codexApiKind persisted. Keep those
  // on the direct HTTP path, whose compatibility default is Chat Completions, instead
  // of letting the session runtime default them to Responses.
  if (
    agent?.agentAdapter === 'codex' &&
    profile.provider !== 'anthropic' &&
    (profile.codexApiKind === 'chat' || profile.codexApiKind === 'responses')
  ) {
    return 'codex'
  }
  return null
}

export function resolveCanvasTextModel(
  requestedModelId: string | null | undefined,
  agentModelId: string | null | undefined,
  providerDefaultModel: string,
): string {
  return requestedModelId?.trim() || agentModelId?.trim() || providerDefaultModel
}

export function buildCanvasTextOutputBudgetInstruction(
  taskPipelineRole: string | null | undefined,
  maxTokens: number | undefined,
): string {
  if (maxTokens == null || (taskPipelineRole !== 'screenplay' && taskPipelineRole !== 'shot')) {
    return ''
  }
  const taskLabel = taskPipelineRole === 'screenplay' ? '剧本' : '分镜脚本'
  return [
    `[输出预算] 本次${taskLabel}输出上限约为 ${maxTokens} tokens。`,
    '优先保证内容完整、JSON/表格闭合和结尾完整，不要为了填满额度而扩写。',
  ].join('\n')
}
