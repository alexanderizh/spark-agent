/**
 * MiniMax media endpoint helpers shared by the Provider UI and runtime adapter.
 *
 * MiniMax exposes versioned paths (/v1 and /v2) below the service root. Users
 * may still paste a BaseURL that already ends in one of those version segments;
 * normalize that segment before appending the model-specific endpoint.
 */

const MINIMAX_VERSION_SUFFIX_RE = /\/v[12]$/i

export function normalizeMinimaxBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '').replace(MINIMAX_VERSION_SUFFIX_RE, '')
}

export function resolveMinimaxEndpoint(baseUrl: string, path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return `${normalizeMinimaxBaseUrl(baseUrl)}${normalizedPath}`
}

export function getMinimaxImageEndpointPath(): string {
  return '/v1/image_generation'
}

export function getMinimaxVideoEndpointPath(modelId: string): string {
  const normalizedModelId = modelId.trim()
  if (normalizedModelId === 'MiniMax-H3') return '/v2/video_generation'
  if (normalizedModelId === 'video-agent') return '/v1/video_template_generation'
  return '/v1/video_generation'
}
