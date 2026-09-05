import { z } from 'zod'
import type {
  ToolHostCapabilityContext,
  ToolHostCapabilityDefinition,
} from './tool-host-capability-broker.js'

export interface ToolPackageWorkflowCapabilityDeps {
  listWorkflows?: (context: ToolHostCapabilityContext) => Promise<unknown>
  getWorkflowStatus?: (
    context: ToolHostCapabilityContext,
    input: z.infer<typeof WorkflowStatusSchema>,
  ) => Promise<unknown>
  runWorkflow?: (
    context: ToolHostCapabilityContext,
    input: z.infer<typeof WorkflowRunSchema>,
  ) => Promise<unknown>
}

const WorkflowStatusSchema = z.object({
  sessionId: z.string().min(1).max(200),
})

const WorkflowRunSchema = z.object({
  workflowId: z.string().min(1).max(200),
  objective: z.string().min(1).max(8_000),
  providerProfileId: z.string().min(1).max(200).optional(),
  modelId: z.string().min(1).max(300).optional(),
  workspaceId: z.string().min(1).max(200).optional(),
})

export function createToolPackageWorkflowCapabilities(
  deps: ToolPackageWorkflowCapabilityDeps,
): ToolHostCapabilityDefinition[] {
  const definitions: ToolHostCapabilityDefinition[] = []
  const listWorkflows = deps.listWorkflows
  if (listWorkflows != null) {
    definitions.push({
      name: 'workflows.list',
      description: 'List enabled Spark workflows and their configured execution agents.',
      inputSchema: z.toJSONSchema(z.object({})) as Record<string, unknown>,
      outputSchema: { type: 'object' },
      risk: 'read',
      invoke: async (context, input) => {
        z.object({}).parse(input)
        return listWorkflows(context)
      },
    })
  }
  const runWorkflow = deps.runWorkflow
  if (runWorkflow != null) {
    definitions.push({
      name: 'workflows.run',
      description: 'Start an enabled Spark workflow in a governed Agent session.',
      inputSchema: z.toJSONSchema(WorkflowRunSchema) as Record<string, unknown>,
      outputSchema: { type: 'object' },
      risk: 'high-write',
      requiresCallConfirmation: true,
      invoke: async (context, input) => runWorkflow(context, WorkflowRunSchema.parse(input)),
    })
  }
  const getWorkflowStatus = deps.getWorkflowStatus
  if (getWorkflowStatus != null) {
    definitions.push({
      name: 'workflows.status',
      description: 'Read the latest managed workflow run status for a Spark session.',
      inputSchema: z.toJSONSchema(WorkflowStatusSchema) as Record<string, unknown>,
      outputSchema: { type: 'object' },
      risk: 'read',
      invoke: async (context, input) =>
        getWorkflowStatus(context, WorkflowStatusSchema.parse(input)),
    })
  }
  return definitions
}
