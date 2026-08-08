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
                parts: Object.entries(invocation.requestTemplate).map(([name, value]) => ({
                  name,
                  kind: 'text' as const,
                  value,
                })),
              }
            : { kind: 'binary' as const, variable: '{{inputFiles}}' },
  }

  const response = invocation.response
  const nextResponse: MediaArtifactRetrieval =
    response.kind !== 'task_poll' || response.poll || !response.statusEndpoint
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
  const nextPolling = polling
    ? {
        ...polling,
        maxAttempts:
          polling.maxAttempts ??
          Math.max(1, Math.ceil(polling.timeoutMs / Math.max(1, polling.intervalMs))),
        unknownStatus: polling.unknownStatus ?? ('fail' as const),
      }
    : polling

  return {
    ...manifest,
    contractVersion: 2,
    adapterMode: manifest.adapterMode ?? (manifest.providerKind === 'custom' ? 'template' : 'native'),
    invocation: {
      ...invocation,
      request,
      response: nextResponse,
      ...(nextPolling ? { polling: nextPolling } : {}),
    },
  }
}

/**
 * Migrate only inline manifests inside a Provider model ref. Template-backed
 * refs remain references and are resolved by the catalog/resolver later.
 */
export function migrateProviderMediaModelRefToV2(ref: ProviderMediaModelRef): ProviderMediaModelRef {
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
