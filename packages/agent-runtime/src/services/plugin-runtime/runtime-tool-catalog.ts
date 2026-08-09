import type { ConnectorRuntimeDescriptor, RuntimeToolDefinition } from '@spark/protocol'
import type { ConnectorRuntimeAdapter, RuntimeContext } from './runtime-types.js'

export interface CatalogTool extends RuntimeToolDefinition {
  runtimeId: string
  pluginId: string
  provider: string
  qualifiedName: string
}

export async function buildRuntimeToolCatalog(
  adapters: Iterable<ConnectorRuntimeAdapter>,
  contexts: Map<string, RuntimeContext>,
): Promise<CatalogTool[]> {
  const tools: CatalogTool[] = []
  for (const adapter of adapters) {
    const descriptor: ConnectorRuntimeDescriptor = adapter.descriptor
    const context = contexts.get(descriptor.id)
    if (context == null) continue
    for (const tool of await adapter.listTools(context)) {
      tools.push({
        ...tool,
        runtimeId: descriptor.id,
        pluginId: descriptor.pluginId,
        provider: descriptor.provider,
        qualifiedName: `${descriptor.toolNamespace}_${tool.name}`,
      })
    }
  }
  return tools.sort((left, right) => left.qualifiedName.localeCompare(right.qualifiedName))
}
