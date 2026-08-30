import { MANAGED_MCP_SCOPE, type McpService } from '@spark/agent-runtime'
import { McpServerRepository, type SparkDatabase } from '@spark/storage'
import { createLogger } from '@spark/shared'

const log = createLogger('custom-tools-runtime')
export const LEGACY_CUSTOM_TOOLS_MCP_NAME = 'spark_custom_tools'

/** Remove the legacy managed MCP registration. Custom tools are now exposed
 * from SessionService's native runtime catalog; this class remains for one
 * release so existing installations migrate before startAllEnabled(). */
export class CustomToolsRuntimeService {
  private readonly repository: McpServerRepository
  private readonly mcpService: McpService

  constructor(
    db: SparkDatabase,
    mcpServiceOrLegacyCustomTools: McpService | unknown,
    legacyMcpService?: McpService,
  ) {
    this.repository = new McpServerRepository(db)
    // Keep the previous three-argument constructor source-compatible for one
    // release while the managed MCP implementation is being retired.
    this.mcpService = legacyMcpService ?? (mcpServiceOrLegacyCustomTools as McpService)
  }

  async start(): Promise<void> {
    const legacy = this.repository
      .findByScope(MANAGED_MCP_SCOPE)
      .find((row) => row.name === LEGACY_CUSTOM_TOOLS_MCP_NAME)
    if (legacy == null) return
    await this.mcpService.stopServer(legacy.id).catch((error) => {
      log.warn('failed to stop legacy custom-tools MCP before cleanup', {
        error: error instanceof Error ? error.message : String(error),
      })
    })
    this.repository.deleteById(legacy.id)
    log.info('removed legacy spark_custom_tools MCP registration')
  }

  async stop(): Promise<void> {
    // Native catalog lifetime is owned by SessionService and has no process to stop.
  }
}
