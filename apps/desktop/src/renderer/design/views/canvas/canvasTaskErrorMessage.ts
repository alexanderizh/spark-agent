const PROVIDER_NOT_CONFIGURED_MESSAGE = '请先在『模型 / Agent 配置』中添加可用模型'

const GENERIC_PROVIDER_NOT_CONFIGURED_MESSAGES = new Set([
  '',
  'No media provider configured',
  'No provider configured',
])

/**
 * Only localize the generic missing-provider error. Some adapters historically
 * reused provider_not_configured for more specific failures; their actionable
 * message must not be hidden behind an unrelated model-configuration prompt.
 */
export function canvasTaskErrorMessage(code: string | undefined, fallback: string): string {
  if (
    code === 'provider_not_configured' &&
    GENERIC_PROVIDER_NOT_CONFIGURED_MESSAGES.has(fallback.trim())
  ) {
    return PROVIDER_NOT_CONFIGURED_MESSAGE
  }
  return fallback
}
