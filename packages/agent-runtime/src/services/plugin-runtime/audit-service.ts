import { randomUUID } from 'node:crypto'
import type { PluginRuntimeAuditRepository } from '@spark/storage'
import type { RuntimeToolDefinition } from '@spark/protocol'

export class RuntimeAuditService {
  constructor(private readonly repository: PluginRuntimeAuditRepository) {}

  record(params: {
    pluginId: string
    runtimeId: string
    accountId?: string
    tool: RuntimeToolDefinition
    outcome: 'success' | 'error' | 'denied'
    durationMs: number
    errorCode?: string
    resourceIds?: string[]
  }): void {
    this.repository.record({
      id: randomUUID(),
      pluginId: params.pluginId,
      runtimeId: params.runtimeId,
      ...(params.accountId !== undefined ? { accountId: params.accountId } : {}),
      toolName: params.tool.name,
      risk: params.tool.risk,
      effect: params.tool.effect,
      outcome: params.outcome,
      durationMs: params.durationMs,
      ...(params.errorCode !== undefined ? { errorCode: params.errorCode } : {}),
      ...(params.resourceIds !== undefined ? { resourceIds: params.resourceIds } : {}),
    })
  }
}
