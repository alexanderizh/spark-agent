import { buildComputerUseSystemPrompt, type ComputerUseMcpProvider } from '@spark/agent-runtime'
import { ComputerUseAgentBridge } from './ComputerUseAgentBridge.js'
import { ComputerUseAgentController } from './ComputerUseAgentController.js'
import { getSnapshotPreviewCapabilityService } from './SnapshotPreviewCapability.js'

export const COMPUTER_USE_AGENT_TOOL_NAMES = [
  'mcp__spark_computer__get_capabilities',
  'mcp__spark_computer__diagnose_native_host',
  'mcp__spark_computer__list_apps',
  'mcp__spark_computer__list_windows',
  'mcp__spark_computer__get_screen_state',
  'mcp__spark_computer__get_app_state',
  'mcp__spark_computer__open_app',
  'mcp__spark_computer__capture_app_snapshot',
  'mcp__spark_computer__start_task',
  'mcp__spark_computer__get_status',
  'mcp__spark_computer__wait_for_completion',
  'mcp__spark_computer__pause',
  'mcp__spark_computer__resume',
  'mcp__spark_computer__stop',
  'mcp__spark_computer__takeover',
  'mcp__spark_computer__bind_target',
  // Atomic agent-directed control — the session model operates the desktop
  // directly, one governed action per call, each response carrying the fresh
  // Markdown tree + full-resolution screenshot.
  'mcp__spark_computer__click',
  'mcp__spark_computer__type_text',
  'mcp__spark_computer__set_value',
  'mcp__spark_computer__invoke_element',
  'mcp__spark_computer__press_key',
  'mcp__spark_computer__scroll',
  'mcp__spark_computer__drag',
  'mcp__spark_computer__select_text',
  'mcp__spark_computer__perform_secondary_action',
  'mcp__spark_computer__screenshot',
] as const

let bridge: ComputerUseAgentBridge | null = null

export function createComputerUseMcpProvider(
  options: {
    controller?: ComputerUseAgentController
    revokeSnapshotSession?: (sessionId: string) => void
  } = {},
): ComputerUseMcpProvider {
  const controller = options.controller ?? new ComputerUseAgentController()
  const revokeSnapshotSession =
    options.revokeSnapshotSession ??
    ((sessionId: string) => getSnapshotPreviewCapabilityService().revokeSession(sessionId))
  const provider: ComputerUseMcpProvider = async (sessionId, _workspaceRootPath, context) => {
    controller.bindSessionContext(sessionId, context)
    bridge ??= new ComputerUseAgentBridge({
      invoke: (ownerSessionId, toolName, args) => controller.invoke(ownerSessionId, toolName, args),
    })
    const binding = await bridge.issueSession(sessionId)
    const capabilities = await controller.promptCapabilities()
    return {
      server: {
        type: 'http',
        url: `http://127.0.0.1:${binding.port}/mcp`,
        headers: {
          authorization: `Bearer ${binding.token}`,
        },
      },
      // Desktop task authorization is task-scoped and identical in every permission mode.
      allowedTools: [...COMPUTER_USE_AGENT_TOOL_NAMES],
      systemPrompt: buildComputerUseSystemPrompt(capabilities),
    }
  }
  // turn 边界轻清理：只撤销本 turn 的 HTTP grant 与快照会话，不取消正在运行的
  // 桌面任务。任务生命周期交由 agent 管理（主动 stop / 用户 ESC 兜底）。
  provider.revokeSession = (sessionId) => {
    bridge?.revokeSession(sessionId)
    revokeSnapshotSession(sessionId)
  }
  // 真正停止该会话拥有的桌面任务，仅在会话彻底销毁 / 用户 cancelTurn 时调用。
  provider.stopOwnedSessions = (sessionId) => {
    void controller.stopOwnedSessions(sessionId)
  }
  return provider
}

export async function disposeComputerUseMcpProvider(): Promise<void> {
  const active = bridge
  bridge = null
  await active?.stop()
}
