import type { RemoteAgentModelCatalogResponse, RemoteAgentModelSelection } from '@spark/protocol'

export class RemoteAgentModelSelectionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RemoteAgentModelSelectionError'
  }
}

/** Validate an untrusted provider/model pair against the target device's live catalog. */
export function resolveRemoteAgentModelSelection(
  value: { providerProfileId?: unknown; modelId?: unknown },
  catalog: RemoteAgentModelCatalogResponse,
): RemoteAgentModelSelection {
  const providerProfileId =
    typeof value.providerProfileId === 'string' ? value.providerProfileId.trim() : ''
  if (!providerProfileId)
    throw new RemoteAgentModelSelectionError('A providerProfileId is required.')

  const provider = catalog.providers.find((item) => item.id === providerProfileId)
  if (provider == null) {
    throw new RemoteAgentModelSelectionError(
      'The selected provider is not available on the target.',
    )
  }

  const modelId = value.modelId == null ? null : value.modelId
  if (modelId !== null && typeof modelId !== 'string') {
    throw new RemoteAgentModelSelectionError('The selected modelId is invalid.')
  }
  if (
    modelId !== null &&
    (provider.isAutoRouter || !provider.models.some((model) => model.id === modelId))
  ) {
    throw new RemoteAgentModelSelectionError(
      'The selected model is not available on that provider.',
    )
  }

  return { providerProfileId, modelId }
}
