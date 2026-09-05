import type { RuntimeToolDefinition } from '@spark/protocol'
import type { CustomToolService } from './custom-tool.service.js'

export interface CustomToolInvocationContext {
  sessionId?: string
  turnId?: string
  projectId?: string
  agentId?: string
  workflowId?: string
  correlationId?: string
  invocationSource?: 'model' | 'workflow' | 'test' | 'platform' | 'nested'
}

export interface NativeCustomToolCatalogEntry {
  qualifiedName: string
  toolId: string
  tool: RuntimeToolDefinition
  invoke(input: Record<string, unknown>): Promise<unknown>
}

/**
 * SparkWork-native custom tool catalog.
 *
 * This is the product/runtime boundary. It has no MCP server, transport or
 * process-registration semantics. Model engines may adapt a snapshot of this
 * catalog to their supported tool protocol, while UI, workflows and future
 * hosts can invoke the same entries directly.
 */
export class CustomToolRuntimeCatalog {
  constructor(private readonly service: CustomToolService) {}

  list(context: CustomToolInvocationContext = {}): NativeCustomToolCatalogEntry[] {
    return this.service
      .listEnabledRecords()
      .filter((record) => record.publishedVersion != null && record.type !== 'provider-vision')
      .map((record) => ({
        qualifiedName: `custom_${record.id}`,
        toolId: record.id,
        tool: {
          name: record.id,
          title: record.title,
          description: record.description,
          inputSchema: record.inputSchema,
          requiredCapabilities: [],
          risk: record.risk,
          effect: record.effect,
          idempotency: record.idempotency,
        },
        invoke: async (input: Record<string, unknown>) => {
          const result = await this.service.executeEnabled({
            toolId: record.id,
            input,
            source: 'model',
            ...(context.sessionId != null ? { sessionId: context.sessionId } : {}),
            ...(context.turnId != null ? { turnId: context.turnId } : {}),
            ...(context.projectId != null ? { projectId: context.projectId } : {}),
            ...(context.agentId != null ? { agentId: context.agentId } : {}),
            ...(context.workflowId != null ? { workflowId: context.workflowId } : {}),
            ...(context.correlationId != null ? { correlationId: context.correlationId } : {}),
            ...(context.invocationSource != null
              ? { invocationSource: context.invocationSource }
              : {}),
          })
          return {
            text: result.text,
            meta: result.meta,
            ...(result.traceId != null ? { traceId: result.traceId } : {}),
          }
        },
      }))
      .sort((left, right) => left.qualifiedName.localeCompare(right.qualifiedName))
  }
}
