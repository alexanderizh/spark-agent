import { z } from 'zod'
import type {
  ToolHostCapabilityContext,
  ToolHostCapabilityDefinition,
} from './tool-host-capability-broker.js'

const ComputerInspectSchema = z.object({
  action: z.enum(['list_apps', 'list_windows', 'get_screen_state', 'get_app_state', 'get_status']),
  arguments: z.record(z.string(), z.unknown()).default({}),
})
const ComputerExecuteSchema = z.object({
  action: z.enum([
    'open_app',
    'capture_app_snapshot',
    'start_task',
    'wait_for_completion',
    'pause',
    'resume',
    'stop',
    'takeover',
    'bind_target',
  ]),
  arguments: z.record(z.string(), z.unknown()).default({}),
})

export interface ToolPackageComputerCapabilityDeps {
  computerCapabilities?: (context: ToolHostCapabilityContext) => Promise<unknown>
  computerInvoke?: (
    context: ToolHostCapabilityContext,
    action: string,
    args: Record<string, unknown>,
  ) => Promise<unknown>
}

export function createToolPackageComputerCapabilities(
  deps: ToolPackageComputerCapabilityDeps,
): ToolHostCapabilityDefinition[] {
  if (deps.computerInvoke == null && deps.computerCapabilities == null) return []
  const definitions: ToolHostCapabilityDefinition[] = []
  const capabilities = deps.computerCapabilities
  if (capabilities != null)
    definitions.push({
      name: 'computer.capabilities',
      description: 'Inspect governed Computer Use availability and platform capabilities.',
      inputSchema: z.toJSONSchema(z.object({})) as Record<string, unknown>,
      outputSchema: { type: 'object' },
      risk: 'read',
      invoke: async (context, input) => {
        z.object({}).parse(input)
        return capabilities(context)
      },
    })
  const invokeComputer = deps.computerInvoke
  if (invokeComputer != null) {
    definitions.push(
      {
        name: 'computer.inspect',
        description: 'Read governed desktop application, window, screen, or task state.',
        inputSchema: z.toJSONSchema(ComputerInspectSchema) as Record<string, unknown>,
        outputSchema: { type: 'object' },
        risk: 'read',
        sensitiveDataPolicy:
          'Desktop state may contain private on-screen content and is not logged by the broker.',
        invoke: async (context, input) => {
          const request = ComputerInspectSchema.parse(input)
          return invokeComputer(context, request.action, request.arguments)
        },
      },
      {
        name: 'computer.execute',
        description: 'Run or control a governed Computer Use desktop task.',
        inputSchema: z.toJSONSchema(ComputerExecuteSchema) as Record<string, unknown>,
        outputSchema: { type: 'object' },
        risk: 'high-write',
        supportsCancellation: true,
        requiresCallConfirmation: true,
        invoke: async (context, input) => {
          const request = ComputerExecuteSchema.parse(input)
          return invokeComputer(context, request.action, request.arguments)
        },
      },
    )
  }
  return definitions
}
