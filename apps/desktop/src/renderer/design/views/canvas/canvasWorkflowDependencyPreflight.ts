export interface CanvasWorkflowDependencyTextProvider {
  id: string
  modelType?: 'image' | 'text' | 'multimodal' | 'voice' | 'video'
  modelIds: string[]
  defaultModel: string
}

export interface CanvasWorkflowDependencyMediaProvider {
  providerProfileId: string
  mediaCapabilities: string[]
}

export interface CanvasWorkflowRequiredProvider {
  nodeLabel: string
  providerProfileId?: string
  modelId?: string
}

export function checkCanvasWorkflowDependencies(input: {
  requiredCapabilities: string[]
  requiredProviders: CanvasWorkflowRequiredProvider[]
  textProviders: CanvasWorkflowDependencyTextProvider[]
  mediaProviders: CanvasWorkflowDependencyMediaProvider[]
}): string[] {
  const issues: string[] = []
  const textReady = input.textProviders.some(
    (provider) =>
      provider.modelType === undefined ||
      provider.modelType === 'text' ||
      provider.modelType === 'multimodal',
  )
  const mediaCapabilities = new Set(
    input.mediaProviders.flatMap((provider) => provider.mediaCapabilities),
  )
  for (const capability of [...new Set(input.requiredCapabilities)]) {
    const operation = CanvasOperationTypeSchema.safeParse(capability)
    const mappedCapabilities = operation.success ? capabilityForOperation(operation.data) : []
    const available = operation.success
      ? mappedCapabilities.length === 0
        ? textReady
        : mappedCapabilities.some((item) => mediaCapabilities.has(item))
      : capability.startsWith('text.')
        ? textReady
        : mediaCapabilities.has(capability)
    if (!available) {
      const mappedLabel =
        mappedCapabilities.length > 0 ? `（${mappedCapabilities.join(' / ')}）` : ''
      issues.push(`缺少支持 ${capability}${mappedLabel} 的可用 Provider`)
    }
  }

  const textById = new Map(input.textProviders.map((provider) => [provider.id, provider]))
  const mediaIds = new Set(input.mediaProviders.map((provider) => provider.providerProfileId))
  for (const required of input.requiredProviders) {
    if (!required.providerProfileId) continue
    const textProvider = textById.get(required.providerProfileId)
    if (!textProvider && !mediaIds.has(required.providerProfileId)) {
      issues.push(`节点“${required.nodeLabel}”缺少 Provider ${required.providerProfileId}`)
      continue
    }
    if (
      textProvider &&
      required.modelId &&
      required.modelId !== textProvider.defaultModel &&
      !textProvider.modelIds.includes(required.modelId)
    ) {
      issues.push(`节点“${required.nodeLabel}”的模型 ${required.modelId} 未在 Provider 中启用`)
    }
  }
  return issues
}
import { CanvasOperationTypeSchema, capabilityForOperation } from '@spark/protocol'
