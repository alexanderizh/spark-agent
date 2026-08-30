import type {
  MediaArtifactRetrieval,
  MediaModelManifest,
  ProviderMediaModelRef,
} from './media-model-manifest.js'

/**
 * Convert a legacy flat invocation to the additive V2 shape.
 *
 * The returned object deliberately keeps every legacy field. This makes the
 * result safe to persist through older import/export code while new runtimes
 * prefer `invocation.request` and `response.poll`.
 */
export function migrateMediaModelManifestToV2(manifest: MediaModelManifest): MediaModelManifest {
  const invocation = manifest.invocation
  // This migration is also used at configuration boundaries before Zod has
  // validated an Agent-authored draft. Keep it total for malformed input so
  // callers can return field-level schema errors instead of a TypeError.
  if (!isRecord(invocation)) {
    return {
      ...manifest,
      contractVersion: 2,
      adapterMode:
        manifest.adapterMode ?? (manifest.providerKind === 'custom' ? 'template' : 'native'),
    }
  }
  const request = invocation.request ?? {
    method: invocation.method,
    endpoint: invocation.endpoint,
    ...(invocation.headers ? { headers: invocation.headers } : {}),
    auth: { kind: 'bearer' as const, credentialRef: 'apiKey' },
    body:
      invocation.method === 'GET'
        ? { kind: 'none' as const }
        : invocation.contentType === 'json'
          ? { kind: 'json' as const, template: invocation.requestTemplate }
          : invocation.contentType === 'multipart'
            ? {
                kind: 'multipart' as const,
                parts: Object.entries(
                  isRecord(invocation.requestTemplate) ? invocation.requestTemplate : {},
                ).map(([name, value]) => ({ name, kind: 'text' as const, value })),
              }
            : { kind: 'binary' as const, variable: '{{inputFiles}}' },
  }

  const response = invocation.response
  const nextResponse: MediaArtifactRetrieval =
    !isRecord(response) ||
    response.kind !== 'task_poll' ||
    response.poll ||
    typeof response.statusEndpoint !== 'string' ||
    !response.statusEndpoint
      ? response
      : {
          ...response,
          taskId: { location: 'path', name: 'taskId' },
          poll: {
            method: 'GET',
            endpoint: response.statusEndpoint.replace(/{{\s*taskId\s*}}/g, '{taskId}'),
            auth: { kind: 'bearer', credentialRef: 'apiKey' },
            body: { kind: 'none' },
          },
        }

  const polling = invocation.polling
  const inferredMaxAttempts =
    polling &&
    polling.maxAttempts == null &&
    typeof polling.timeoutMs === 'number' &&
    Number.isFinite(polling.timeoutMs) &&
    typeof polling.intervalMs === 'number' &&
    Number.isFinite(polling.intervalMs)
      ? Math.max(1, Math.ceil(polling.timeoutMs / Math.max(1, polling.intervalMs)))
      : undefined
  const nextPolling = polling
    ? {
        ...polling,
        ...(polling.maxAttempts != null
          ? { maxAttempts: polling.maxAttempts }
          : inferredMaxAttempts != null
            ? { maxAttempts: inferredMaxAttempts }
            : {}),
        unknownStatus: polling.unknownStatus ?? ('fail' as const),
      }
    : polling

  return {
    ...manifest,
    contractVersion: 2,
    adapterMode:
      manifest.adapterMode ?? (manifest.providerKind === 'custom' ? 'template' : 'native'),
    invocation: {
      ...invocation,
      request,
      response: nextResponse,
      ...(nextPolling ? { polling: nextPolling } : {}),
    },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Migrate only inline manifests inside a Provider model ref. Template-backed
 * refs remain references and are resolved by the catalog/resolver later.
 */
export function migrateProviderMediaModelRefToV2(
  ref: ProviderMediaModelRef,
): ProviderMediaModelRef {
  return {
    ...ref,
    ...(ref.manifest ? { manifest: migrateMediaModelManifestToV2(ref.manifest) } : {}),
    ...(ref.adapterMode
      ? { adapterMode: ref.adapterMode }
      : ref.manifest
        ? { adapterMode: ref.manifest.adapterMode ?? 'template' }
        : {}),
  }
}
