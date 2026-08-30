import {
  isBuiltInLocalCliProvider,
  type MediaRequestCall,
  type ProviderProfile,
  type SessionAgentAdapter,
} from '@spark/protocol'

const ANTHROPIC_DEFAULT_ENDPOINT = 'https://api.anthropic.com'
const OPENAI_DEFAULT_ENDPOINT = 'https://api.openai.com/v1'

export class CanvasSessionRuntimeInvocationError extends Error {
  override readonly cause: unknown
  readonly requestCall: MediaRequestCall

  constructor(cause: unknown, requestCall: MediaRequestCall) {
    super(cause instanceof Error ? cause.message : String(cause))
    this.name = 'CanvasSessionRuntimeInvocationError'
    this.cause = cause
    this.requestCall = requestCall
  }
}

export function buildCanvasSessionRuntimeRequestCall(input: {
  profile: ProviderProfile
  adapter: SessionAgentAdapter
  model: string
  invocation: Record<string, unknown>
}): MediaRequestCall {
  const isLocalCli = isBuiltInLocalCliProvider(input.profile)
  return {
    method: input.adapter === 'codex' ? (isLocalCli ? 'CODEX CLI' : 'CODEX SDK') : 'CLAUDE SDK',
    url: resolveCanvasSessionRuntimeModelUrl(input.profile, input.adapter),
    body: {
      transport: isLocalCli ? 'local-cli' : 'session-runtime-sdk',
      adapter: input.adapter,
      providerProfileId: input.profile.id,
      provider: input.profile.provider,
      providerName: input.profile.name,
      model: input.model,
      apiKind: input.adapter === 'codex' ? (input.profile.codexApiKind ?? 'responses') : 'messages',
      ...input.invocation,
    },
  }
}

export function resolveCanvasSessionRuntimeModelUrl(
  profile: ProviderProfile,
  adapter: SessionAgentAdapter,
): string {
  if (isBuiltInLocalCliProvider(profile)) {
    return adapter === 'codex' ? 'local-cli://codex' : 'local-cli://claude'
  }
  if (adapter === 'codex') {
    return profile.codexApiKind === 'chat'
      ? openAiChatEndpoint(profile.apiEndpoint)
      : openAiResponsesEndpoint(profile.apiEndpoint)
  }
  return anthropicMessagesEndpoint(profile.apiEndpoint)
}

function anthropicMessagesEndpoint(apiEndpoint?: string): string {
  const base = normalizeEndpoint(apiEndpoint, ANTHROPIC_DEFAULT_ENDPOINT)
  if (base.endsWith('/v1/messages')) return base
  if (base.endsWith('/v1')) return `${base}/messages`
  return `${base}/v1/messages`
}

function openAiChatEndpoint(apiEndpoint?: string): string {
  const base = normalizeEndpoint(apiEndpoint, OPENAI_DEFAULT_ENDPOINT)
  if (base.endsWith('/chat/completions')) return base
  if (base.endsWith('/responses')) return `${base.slice(0, -'/responses'.length)}/chat/completions`
  if (base.endsWith('/v1')) return `${base}/chat/completions`
  return `${base}/v1/chat/completions`
}

function openAiResponsesEndpoint(apiEndpoint?: string): string {
  const base = normalizeEndpoint(apiEndpoint, OPENAI_DEFAULT_ENDPOINT)
  if (base.endsWith('/responses')) return base
  if (base.endsWith('/chat/completions')) {
    return `${base.slice(0, -'/chat/completions'.length)}/responses`
  }
  if (base.endsWith('/v1')) return `${base}/responses`
  return `${base}/v1/responses`
}

function normalizeEndpoint(custom: string | undefined, fallback: string): string {
  return (custom?.trim() || fallback).replace(/\/+$/, '')
}
