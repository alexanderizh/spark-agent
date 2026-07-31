import { buildComputerUseSystemPrompt, type ComputerUseMcpProvider } from '@spark/agent-runtime'
import { ComputerUseAgentBridge } from './ComputerUseAgentBridge.js'
import { ComputerUseAgentController } from './ComputerUseAgentController.js'
import { getSnapshotPreviewCapabilityService } from './SnapshotPreviewCapability.js'

export const COMPUTER_USE_AGENT_TOOL_NAMES = [
  'mcp__spark_computer__get_capabilities',
  'mcp__spark_computer__diagnose_native_host',
  'mcp__spark_computer__capture_app_snapshot',
  'mcp__spark_computer__start_task',
  'mcp__spark_computer__get_status',
  'mcp__spark_computer__wait_for_completion',
  'mcp__spark_computer__pause',
  'mcp__spark_computer__resume',
  'mcp__spark_computer__stop',
  'mcp__spark_computer__takeover',
  'mcp__spark_computer__bind_target',
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
      // Every permission mode may start and resume a task. The Broker requests
      // exact action approval later when the effective mode requires it.
      allowedTools: [...COMPUTER_USE_AGENT_TOOL_NAMES],
      systemPrompt: buildComputerUseSystemPrompt(capabilities),
    }
  }
  provider.revokeSession = (sessionId) => {
    bridge?.revokeSession(sessionId)
    revokeSnapshotSession(sessionId)
  }
  return provider
}

export async function disposeComputerUseMcpProvider(): Promise<void> {
  const active = bridge
  bridge = null
  await active?.stop()
}
