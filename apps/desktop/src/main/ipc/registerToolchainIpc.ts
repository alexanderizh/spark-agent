/**
 * 设置 → 工具链（只读清单）IPC。
 *
 * 聚合四路数据一次返回：SDK 内置（协议常量）+ 平台服务器（agent-runtime 注册表）+
 * MCP 扩展（McpService，未连接不拉起）+ 统一目录（listUnifiedTools）。
 * 聚合逻辑在 @spark/agent-runtime 的 buildToolchainInventory（纯函数），
 * 本层只负责喂数据与统一日志，不往 ipc/index.ts 里堆逻辑。
 */
import type { UnifiedToolCatalogEntry } from '@spark/agent-runtime'
import { buildToolchainInventory, type ToolchainMcpServerSnapshot } from '@spark/agent-runtime'
import type { McpServerItem, ToolchainInventoryResponse } from '@spark/protocol'
import { createLogger } from '@spark/shared'
import { typedIpcHandle } from './typed-ipc.js'

const log = createLogger('ipc:toolchain')

export interface ToolchainInventoryBackend {
  /** 统一目录快照（自定义工具/工具包/连接器）；与执行期同一目录，所见即所得。 */
  listUnifiedTools(): Promise<UnifiedToolCatalogEntry[]>
  /** 全量 MCP 服务器配置（含停用；仅查看语义下不修改任何状态）。 */
  listMcpServers(): McpServerItem[]
  /** 已连接服务器的实时状态；未连接返回 disconnected 快照。 */
  getServerStatus(serverId: string): { connected: boolean; toolCount: number }
  /** 已连接服务器的工具清单；未连接返回空数组（不主动启动进程）。 */
  getServerTools(serverId: string): Array<{ name: string; description: string }>
}

export function registerToolchainIpc(backend: ToolchainInventoryBackend): void {
  typedIpcHandle('toolchain:inventory', async (): Promise<ToolchainInventoryResponse> => {
    // 两路数据各自降级：单路失败只丢对应分组，不拖垮整页清单。
    const [unifiedTools, mcpItems] = await Promise.all([
      backend.listUnifiedTools().catch((err: unknown) => {
        log.warn(
          `unified tools snapshot failed: ${err instanceof Error ? err.message : String(err)}`,
        )
        return [] as UnifiedToolCatalogEntry[]
      }),
      (async () => {
        try {
          return backend.listMcpServers()
        } catch (err) {
          log.warn(`mcp server list failed: ${err instanceof Error ? err.message : String(err)}`)
          return [] as McpServerItem[]
        }
      })(),
    ])

    // configJson/scope 原样上交，传输归一化由 agent-runtime 的 resolveMcpConfig 权威完成。
    const mcpServers: ToolchainMcpServerSnapshot[] = mcpItems.map((item) => {
      const status = backend.getServerStatus(item.id)
      const tools = item.enabled && status.connected ? backend.getServerTools(item.id) : []
      return {
        name: item.name,
        enabled: item.enabled,
        connected: status.connected,
        tools: tools.map((tool) => ({
          name: tool.name,
          ...(tool.description.length > 0 ? { description: tool.description } : {}),
        })),
        configJson: item.configJson,
        scope: item.scope,
      }
    })

    const inventory = buildToolchainInventory({ unifiedTools, mcpServers })
    log.info(
      `toolchain:inventory requested, groups=${inventory.groups.length}, ` +
        `sdkBuiltin=${inventory.groups.find((g) => g.kind === 'sdk-builtin')?.toolCount ?? 0}, ` +
        `mcpExtensions=${mcpServers.length}, unifiedTools=${unifiedTools.length}`,
    )
    return inventory
  })
}
