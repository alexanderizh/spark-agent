import { z } from 'zod'

export const CanvasWorkflowScopeSchema = z.enum(['project', 'library', 'builtin'])
export type CanvasWorkflowScope = z.infer<typeof CanvasWorkflowScopeSchema>

export const CanvasWorkflowStatusSchema = z.enum(['draft', 'published', 'archived'])
export type CanvasWorkflowStatus = z.infer<typeof CanvasWorkflowStatusSchema>

export const CanvasWorkflowValueTypeSchema = z.enum([
  'text',
  'image',
  'video',
  'audio',
  'file',
  'asset',
  'node',
  'structured',
])
export type CanvasWorkflowValueType = z.infer<typeof CanvasWorkflowValueTypeSchema>

export const CanvasWorkflowNodeKindSchema = z.enum([
  'canvas_input',
  'canvas_param',
  'canvas_asset_ref',
  'canvas_operation',
  'canvas_transform',
  'canvas_subworkflow',
  'canvas_output',
])
export type CanvasWorkflowNodeKind = z.infer<typeof CanvasWorkflowNodeKindSchema>

const IdentifierSchema = z.string().trim().min(1).max(200)
const NameSchema = z.string().trim().min(1).max(160)

export const CanvasWorkflowNodeSchema = z.object({
  id: IdentifierSchema,
  kind: CanvasWorkflowNodeKindSchema,
  label: z.string().trim().min(1).max(200),
  sourceNodeType: z.string().trim().min(1).max(120).optional(),
  position: z.object({ x: z.number().finite(), y: z.number().finite() }),
  config: z.record(z.string(), z.unknown()).default({}),
})
export type CanvasWorkflowNode = z.infer<typeof CanvasWorkflowNodeSchema>

export const CanvasWorkflowEdgeTypeSchema = z.enum([
  'derived_from',
  'used_as_input',
  'generated',
  'group_contains',
  'references',
])
export type CanvasWorkflowEdgeType = z.infer<typeof CanvasWorkflowEdgeTypeSchema>

export const CanvasWorkflowEdgeSchema = z.object({
  id: IdentifierSchema,
  sourceNodeId: IdentifierSchema,
  targetNodeId: IdentifierSchema,
  type: CanvasWorkflowEdgeTypeSchema.optional(),
  sourceHandle: z.string().trim().max(120).optional(),
  targetHandle: z.string().trim().max(120).optional(),
})
export type CanvasWorkflowEdge = z.infer<typeof CanvasWorkflowEdgeSchema>

export const CanvasWorkflowInputSchema = z.object({
  id: IdentifierSchema,
  name: NameSchema,
  valueType: CanvasWorkflowValueTypeSchema,
  required: z.boolean().default(true),
  targetNodeId: IdentifierSchema.optional(),
  targetHandle: z.string().trim().max(120).optional(),
})
export type CanvasWorkflowInput = z.infer<typeof CanvasWorkflowInputSchema>

export const CanvasWorkflowOutputSchema = z.object({
  id: IdentifierSchema,
  name: NameSchema,
  valueType: CanvasWorkflowValueTypeSchema,
  sourceNodeId: IdentifierSchema.optional(),
  sourceHandle: z.string().trim().max(120).optional(),
})
export type CanvasWorkflowOutput = z.infer<typeof CanvasWorkflowOutputSchema>

export const CanvasWorkflowExposedParamSchema = z.object({
  id: IdentifierSchema,
  name: NameSchema,
  valueType: z.enum(['text', 'number', 'boolean', 'select']),
  nodeId: IdentifierSchema,
  path: z.string().trim().min(1).max(500),
  defaultValue: z.unknown().optional(),
})
export type CanvasWorkflowExposedParam = z.infer<typeof CanvasWorkflowExposedParamSchema>

export const CanvasWorkflowPackageSchema = z.object({
  schemaVersion: z.literal(1),
  graph: z.object({
    nodes: z.array(CanvasWorkflowNodeSchema).max(500),
    edges: z.array(CanvasWorkflowEdgeSchema).max(2_000),
  }),
  contract: z.object({
    inputs: z.array(CanvasWorkflowInputSchema).max(100),
    outputs: z.array(CanvasWorkflowOutputSchema).max(100),
    exposedParams: z.array(CanvasWorkflowExposedParamSchema).max(200),
  }),
  dependencies: z.object({
    modelCapabilities: z.array(z.string().trim().min(1).max(200)).max(100),
    canvasNodeKinds: z.array(z.string().trim().min(1).max(120)).max(100),
  }),
  provenance: z
    .object({
      extractedFromProjectId: IdentifierSchema.optional(),
      extractedFromCanvasId: IdentifierSchema.optional(),
      sourceNodeIds: z.array(IdentifierSchema).max(500).optional(),
      sourceAssetIds: z.array(IdentifierSchema).max(500).optional(),
    })
    .optional(),
})
export type CanvasWorkflowPackage = z.infer<typeof CanvasWorkflowPackageSchema>

export interface CanvasWorkflowDefinition {
  id: string
  projectId: string | null
  name: string
  description: string | null
  scope: CanvasWorkflowScope
  status: CanvasWorkflowStatus
  version: number
  tags: string[]
  package: CanvasWorkflowPackage
  createdAt: string
  updatedAt: string
}

export interface CanvasWorkflowListRequest {
  scope?: CanvasWorkflowScope
  projectId?: string
  status?: CanvasWorkflowStatus
  query?: string
  includeArchived?: boolean
  limit?: number
  offset?: number
}
export interface CanvasWorkflowListResponse {
  workflows: CanvasWorkflowDefinition[]
  total: number
  hasMore: boolean
}

export interface CanvasWorkflowGetRequest {
  id: string
}
export interface CanvasWorkflowGetResponse {
  workflow: CanvasWorkflowDefinition | null
}

export interface CanvasWorkflowCreateRequest {
  name: string
  description?: string | null
  scope: 'project' | 'library'
  projectId?: string
  status?: CanvasWorkflowStatus
  tags?: string[]
  package: CanvasWorkflowPackage
}
export interface CanvasWorkflowCreateResponse {
  workflow: CanvasWorkflowDefinition
}

export interface CanvasWorkflowUpdateRequest {
  id: string
  name?: string
  description?: string | null
  status?: CanvasWorkflowStatus
  tags?: string[]
  package?: CanvasWorkflowPackage
}
export interface CanvasWorkflowUpdateResponse {
  workflow: CanvasWorkflowDefinition
}

export interface CanvasWorkflowDuplicateRequest {
  id: string
  name?: string
  targetScope: 'project' | 'library'
  targetProjectId?: string
}
export interface CanvasWorkflowDuplicateResponse {
  workflow: CanvasWorkflowDefinition
}

export interface CanvasWorkflowArchiveRequest {
  id: string
  archived: boolean
}
export interface CanvasWorkflowArchiveResponse {
  workflow: CanvasWorkflowDefinition
}

export interface CanvasWorkflowDeleteRequest {
  id: string
}
export interface CanvasWorkflowDeleteResponse {
  deleted: boolean
}

function validateScopeProject(
  value: { scope: 'project' | 'library'; projectId: string | undefined },
  ctx: z.RefinementCtx,
  projectIdPath = 'projectId',
): void {
  if (value.scope === 'project' && !value.projectId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'projectId is required for project-scoped canvas workflows',
      path: [projectIdPath],
    })
  }
  if (value.scope === 'library' && value.projectId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'projectId is not allowed for personal-library canvas workflows',
      path: [projectIdPath],
    })
  }
}

const TagListSchema = z.array(z.string().trim().min(1).max(60)).max(30)

export const CanvasWorkflowIpcSchemaRegistry = {
  'canvas:workflow:list': z.object({
    scope: CanvasWorkflowScopeSchema.optional(),
    projectId: IdentifierSchema.optional(),
    status: CanvasWorkflowStatusSchema.optional(),
    query: z.string().trim().max(200).optional(),
    includeArchived: z.boolean().optional(),
    limit: z.number().int().min(1).max(200).optional(),
    offset: z.number().int().min(0).optional(),
  }),
  'canvas:workflow:get': z.object({ id: IdentifierSchema }),
  'canvas:workflow:create': z
    .object({
      name: NameSchema,
      description: z.string().trim().max(2_000).nullable().optional(),
      scope: z.enum(['project', 'library']),
      projectId: IdentifierSchema.optional(),
      status: CanvasWorkflowStatusSchema.optional(),
      tags: TagListSchema.optional(),
      package: CanvasWorkflowPackageSchema,
    })
    .superRefine((value, ctx) => {
      validateScopeProject({ scope: value.scope, projectId: value.projectId }, ctx)
    }),
  'canvas:workflow:update': z.object({
    id: IdentifierSchema,
    name: NameSchema.optional(),
    description: z.string().trim().max(2_000).nullable().optional(),
    status: CanvasWorkflowStatusSchema.optional(),
    tags: TagListSchema.optional(),
    package: CanvasWorkflowPackageSchema.optional(),
  }),
  'canvas:workflow:duplicate': z
    .object({
      id: IdentifierSchema,
      name: NameSchema.optional(),
      targetScope: z.enum(['project', 'library']),
      targetProjectId: IdentifierSchema.optional(),
    })
    .superRefine((value, ctx) => {
      validateScopeProject(
        { scope: value.targetScope, projectId: value.targetProjectId },
        ctx,
        'targetProjectId',
      )
    }),
  'canvas:workflow:archive': z.object({
    id: IdentifierSchema,
    archived: z.boolean(),
  }),
  'canvas:workflow:delete': z.object({ id: IdentifierSchema }),
} as const

export interface CanvasWorkflowIpcChannelMap {
  'canvas:workflow:list': [CanvasWorkflowListRequest, CanvasWorkflowListResponse]
  'canvas:workflow:get': [CanvasWorkflowGetRequest, CanvasWorkflowGetResponse]
  'canvas:workflow:create': [CanvasWorkflowCreateRequest, CanvasWorkflowCreateResponse]
  'canvas:workflow:update': [CanvasWorkflowUpdateRequest, CanvasWorkflowUpdateResponse]
  'canvas:workflow:duplicate': [CanvasWorkflowDuplicateRequest, CanvasWorkflowDuplicateResponse]
  'canvas:workflow:archive': [CanvasWorkflowArchiveRequest, CanvasWorkflowArchiveResponse]
  'canvas:workflow:delete': [CanvasWorkflowDeleteRequest, CanvasWorkflowDeleteResponse]
}
