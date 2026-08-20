import type {
  CodexRuntimeResource,
  SDKExecutorConfig,
  SDKMcpServerConfig,
} from '../../sdk/types.js'

/**
 * Associates opaque MCP server configs with sidecars owned by a persistent Codex runtime.
 * Kept outside SessionService so bearer lifecycle policy remains independently testable and the
 * already oversized session orchestrator only performs narrow registration/collection calls.
 */
export class CodexRuntimeMcpResourceCoordinator {
  private readonly resourceByServer = new WeakMap<object, CodexRuntimeResource>()

  register(server: SDKMcpServerConfig, resource: CodexRuntimeResource): void {
    this.resourceByServer.set(server, resource)
  }

  buildConfig(
    servers: Array<SDKMcpServerConfig | null | undefined>,
  ): Pick<SDKExecutorConfig, 'codexRuntimeResources'> {
    const resources = new Map<string, CodexRuntimeResource>()
    for (const server of servers) {
      if (server == null || typeof server !== 'object') continue
      const resource = this.resourceByServer.get(server)
      if (resource == null) continue
      const existing = resources.get(resource.id)
      if (existing != null && existing !== resource) {
        throw new Error(`Conflicting Codex runtime MCP resource: ${resource.id}`)
      }
      resources.set(resource.id, resource)
    }
    return resources.size > 0 ? { codexRuntimeResources: [...resources.values()] } : {}
  }
}
