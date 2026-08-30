import { z } from 'zod'
import type { CanvasWorkflowExecutionPlan } from './canvas-workflow-compiler.js'
import type { CanvasWorkflowDefinition, CanvasWorkflowPackage } from './canvas-workflow.js'

export const CanvasWorkflowRunStatusSchema = z.enum([
  'queued',
  'running',
  'paused',
  'completed',
  'failed',
  'cancelled',
])
export type CanvasWorkflowRunStatus = z.infer<typeof CanvasWorkflowRunStatusSchema>

export const CanvasWorkflowRunStepStatusSchema = z.enum([
  'blocked',
  'ready',
  'running',
  'completed',
  'failed',
  'cancelled',
  'skipped',
])
export type CanvasWorkflowRunStepStatus = z.infer<typeof CanvasWorkflowRunStepStatusSchema>

export interface CanvasWorkflowVersion {
  workflowId: string
  version: number
  name: string
  package: CanvasWorkflowPackage
  createdAt: string
}

export interface CanvasWorkflowRunStep {
  id: string
  runId: string
  nodeId: string
  stepIndex: number
  status: CanvasWorkflowRunStepStatus
  dependsOnNodeIds: string[]
  taskId: string | null
  input: Record<string, unknown>
  output: Record<string, unknown> | null
  error: Record<string, unknown> | null
  attempt: number
  startedAt: string | null
  finishedAt: string | null
  updatedAt: string
}

export interface CanvasWorkflowRun {
  id: string
  workflowId: string
  workflowVersion: number
  projectId: string
  status: CanvasWorkflowRunStatus
  inputs: Record<string, unknown>
  exposedParams: Record<string, unknown>
  outputs: Record<string, unknown>
  error: Record<string, unknown> | null
  idempotencyKey: string
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
  updatedAt: string
  steps: CanvasWorkflowRunStep[]
}

export interface CanvasWorkflowVersionListRequest {
  workflowId: string
  limit?: number
  offset?: number
}
export interface CanvasWorkflowVersionListResponse {
  versions: CanvasWorkflowVersion[]
}

export interface CanvasWorkflowPublishRequest {
  id: string
}
export interface CanvasWorkflowPublishResponse {
  workflow: CanvasWorkflowDefinition
  version: CanvasWorkflowVersion
}

export interface CanvasWorkflowRunCreateRequest {
  workflowId: string
  workflowVersion?: number
  projectId: string
  inputs: Record<string, unknown>
  exposedParams: Record<string, unknown>
  idempotencyKey: string
}
export interface CanvasWorkflowRunCreateResponse {
  run: CanvasWorkflowRun
  plan: Readonly<CanvasWorkflowExecutionPlan>
}

export interface CanvasWorkflowRunListRequest {
  projectId?: string
  workflowId?: string
  status?: CanvasWorkflowRunStatus
  limit?: number
  offset?: number
}
export interface CanvasWorkflowRunListResponse {
  runs: CanvasWorkflowRun[]
}

export interface CanvasWorkflowRunGetRequest {
  id: string
}
export interface CanvasWorkflowRunGetResponse {
  run: CanvasWorkflowRun | null
}

export interface CanvasWorkflowRunStepUpdateRequest {
  runId: string
  nodeId: string
  status: Exclude<CanvasWorkflowRunStepStatus, 'blocked'>
  taskId?: string | null
  input?: Record<string, unknown>
  output?: Record<string, unknown> | null
  error?: Record<string, unknown> | null
}
export interface CanvasWorkflowRunStepUpdateResponse {
  run: CanvasWorkflowRun
}

export interface CanvasWorkflowRunControlRequest {
  id: string
  nodeId?: string
}
export interface CanvasWorkflowRunControlResponse {
  run: CanvasWorkflowRun
}

export interface CanvasWorkflowRunResumeResponse extends CanvasWorkflowRunControlResponse {
  plan: Readonly<CanvasWorkflowExecutionPlan>
}

const IdentifierSchema = z.string().trim().min(1).max(200)
const PaginationSchema = {
  limit: z.number().int().min(1).max(200).optional(),
  offset: z.number().int().min(0).optional(),
}
const ValueMapSchema = z.record(z.string().trim().min(1).max(200), z.unknown())

export const CanvasWorkflowRuntimeIpcSchemaRegistry = {
  'canvas:workflow:version:list': z.object({
    workflowId: IdentifierSchema,
    ...PaginationSchema,
  }),
  'canvas:workflow:publish': z.object({ id: IdentifierSchema }),
  'canvas:workflow:run:create': z.object({
    workflowId: IdentifierSchema,
    workflowVersion: z.number().int().positive().optional(),
    projectId: IdentifierSchema,
    inputs: ValueMapSchema,
    exposedParams: ValueMapSchema,
    idempotencyKey: IdentifierSchema,
  }),
  'canvas:workflow:run:list': z.object({
    projectId: IdentifierSchema.optional(),
    workflowId: IdentifierSchema.optional(),
    status: CanvasWorkflowRunStatusSchema.optional(),
    ...PaginationSchema,
  }),
  'canvas:workflow:run:get': z.object({ id: IdentifierSchema }),
  'canvas:workflow:run:step-update': z.object({
    runId: IdentifierSchema,
    nodeId: IdentifierSchema,
    status: CanvasWorkflowRunStepStatusSchema.exclude(['blocked']),
    taskId: IdentifierSchema.nullable().optional(),
    input: ValueMapSchema.optional(),
    output: ValueMapSchema.nullable().optional(),
    error: ValueMapSchema.nullable().optional(),
  }),
  'canvas:workflow:run:cancel': z.object({ id: IdentifierSchema }),
  'canvas:workflow:run:retry': z.object({ id: IdentifierSchema, nodeId: IdentifierSchema }),
  'canvas:workflow:run:resume': z.object({ id: IdentifierSchema }),
} as const

export interface CanvasWorkflowRuntimeIpcChannelMap {
  'canvas:workflow:version:list': [
    CanvasWorkflowVersionListRequest,
    CanvasWorkflowVersionListResponse,
  ]
  'canvas:workflow:publish': [CanvasWorkflowPublishRequest, CanvasWorkflowPublishResponse]
  'canvas:workflow:run:create': [CanvasWorkflowRunCreateRequest, CanvasWorkflowRunCreateResponse]
  'canvas:workflow:run:list': [CanvasWorkflowRunListRequest, CanvasWorkflowRunListResponse]
  'canvas:workflow:run:get': [CanvasWorkflowRunGetRequest, CanvasWorkflowRunGetResponse]
  'canvas:workflow:run:step-update': [
    CanvasWorkflowRunStepUpdateRequest,
    CanvasWorkflowRunStepUpdateResponse,
  ]
  'canvas:workflow:run:cancel': [CanvasWorkflowRunControlRequest, CanvasWorkflowRunControlResponse]
  'canvas:workflow:run:retry': [CanvasWorkflowRunControlRequest, CanvasWorkflowRunControlResponse]
  'canvas:workflow:run:resume': [CanvasWorkflowRunControlRequest, CanvasWorkflowRunResumeResponse]
}
