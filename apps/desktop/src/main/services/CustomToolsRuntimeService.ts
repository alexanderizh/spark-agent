import {
  CustomToolsBridgeService,
  MANAGED_MCP_SCOPE,
  resolveRuntimeToolPath,
  type CustomToolService,
  type McpService,
} from '@spark/agent-runtime'
import { McpServerRepository, type SparkDatabase } from '@spark/storage'
import { createLogger } from '@spark/shared'
import { resolveStandaloneNodeRuntimePath } from './StandaloneNodeRuntime.js'

const log = createLogger('custom-tools-runtime')
export const CUSTOM_TOOLS_MCP_NAME = 'spark_custom_tools'

export class CustomToolsRuntimeService {
  private readonly bridge: CustomToolsBridgeService
  private readonly repository: McpServerRepository
  private unsubscribe: (() => void) | null = null
  private bridgeInfo: { port: number; token: string } | null = null
  private registrationId: string | null = null
  private refreshTail: Promise<void> = Promise.resolve()
  private refreshQueued = false
  private stopping = false

  constructor(
    db: SparkDatabase,
    private readonly customTools: CustomToolService,
    private readonly mcpService: McpService,
  ) {
    this.bridge = new CustomToolsBridgeService(customTools)
    this.repository = new McpServerRepository(db)
  }

  async start(): Promise<void> {
    if (this.bridgeInfo != null) return
    this.stopping = false
    this.bridgeInfo = await this.bridge.start()
    this.unsubscribe = this.customTools.onChange(() => {
      this.queueRefresh()
    })
    // Subscribe before the initial connection attempt. A transient MCP start
    // failure is still surfaced to boot logs, while later edits can repair and
    // retry the runtime without restarting the application.
    await this.synchronizeRegistration(false)
  }

  async stop(): Promise<void> {
    this.unsubscribe?.()
    this.unsubscribe = null
    this.stopping = true
    this.refreshQueued = false
    await this.refreshTail.catch(() => undefined)
    if (this.registrationId != null) {
      await this.mcpService.stopServer(this.registrationId).catch(() => undefined)
    }
    this.registrationId = null
    this.bridgeInfo = null
    await this.bridge.stop()
  }

  private queueRefresh(): void {
    if (this.stopping) return
    this.refreshQueued = true
    this.refreshTail = this.refreshTail
      .then(async () => {
        while (this.refreshQueued && !this.stopping) {
          this.refreshQueued = false
          await this.synchronizeRegistration(true)
        }
      })
      .catch((error) => {
        log.warn('failed to hot-reload custom tools MCP', { error: String(error) })
      })
  }

  private async synchronizeRegistration(forceRefresh: boolean): Promise<void> {
    if (this.bridgeInfo == null) throw new Error('Custom tools bridge is not running')
    const scriptPath = resolveRuntimeToolPath('custom-tools-mcp-server.mjs')
    if (scriptPath == null) throw new Error('custom-tools-mcp-server.mjs was not found')
    const enabled = this.customTools.listEnabledRecords().some((record) => record.type === 'http')
    const configJson = JSON.stringify({
      type: 'stdio',
      command: resolveStandaloneNodeRuntimePath(),
      args: [scriptPath],
      env: {
        SPARK_CUSTOM_TOOLS_BRIDGE_PORT: String(this.bridgeInfo.port),
        SPARK_CUSTOM_TOOLS_BRIDGE_TOKEN: this.bridgeInfo.token,
      },
    })
    const existing = this.repository
      .findByScope(MANAGED_MCP_SCOPE)
      .find((row) => row.name === CUSTOM_TOOLS_MCP_NAME)
    if (existing == null) {
      const created = this.mcpService.createServer(
        {
          scope: MANAGED_MCP_SCOPE,
          name: CUSTOM_TOOLS_MCP_NAME,
          configJson,
          enabled,
        },
        { manageLifecycle: false },
      )
      this.registrationId = created.id
      if (enabled) await this.mcpService.startServer(created.id)
      return
    }
    this.registrationId = existing.id
    const configChanged = existing.config_json !== configJson
    const enabledChanged = (existing.enabled === 1) !== enabled
    const mustReconcile = configChanged || enabledChanged || forceRefresh
    if (mustReconcile) {
      await this.mcpService.stopServer(existing.id)
    }
    if (configChanged || enabledChanged || forceRefresh) {
      this.mcpService.updateServer(
        existing.id,
        {
          ...(configChanged ? { configJson } : {}),
          ...(enabledChanged ? { enabled } : {}),
        },
        { manageLifecycle: false },
      )
    }
    // This runtime owns the managed registration lifecycle. Starting here also
    // makes the bridge ready before the later generic startAllEnabled pass.
    if (enabled) await this.mcpService.startServer(existing.id)
  }
}
