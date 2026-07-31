import { z } from 'zod'
import {
  ComputerUseIdentifierSchema,
  ComputerUseIsoDateTimeSchema,
  Sha256Schema,
} from './common.js'
import type { ComputerAppIdentity } from './common.js'
import { AppControlCommandResultSchema } from './action.js'
import type { AppControlCommandResult } from './action.js'
import type { ComputerUseEvent } from './events.js'
import { NativeHostPermissionStateSchema } from './native-wire.js'
import type {
  NativeHostCapabilityManifest,
  NativeHostPlatform,
  NativeWindowDescriptor,
} from './native-wire.js'
import { AccessibleTextModeSchema } from './snapshot.js'
import type { ApplicationSnapshotRef } from './snapshot.js'
import {
  ComputerAppIdentityRuleSchema,
  ComputerEnvironmentSchema,
  ComputerTaskContractSchema,
} from './session.js'
import type { ComputerSession } from './session.js'
import type { VerificationSpec } from './verification.js'

const EmptyRequestSchema = z.object({}).strict()
const ComputerSessionIdRequestSchema = z
  .object({ computerSessionId: ComputerUseIdentifierSchema })
  .strict()

export const ComputerUseSettingsSchema = z
  .object({
    enabled: z.boolean(),
    environments: z
      .object({
        safeBrowser: z.boolean(),
        safeDesktop: z.boolean(),
        myDesktop: z.boolean(),
      })
      .strict(),
    allowedApps: z.array(ComputerAppIdentityRuleSchema).max(200),
    redactSensitiveContent: z.boolean(),
    fullRecordingEnabled: z.boolean(),
    evidenceRetentionDays: z.number().int().min(1).max(3_650),
    killSwitch: z.string().trim().min(1).max(120).nullable(),
    remote: z
      .object({
        observe: z.boolean(),
        approveL2: z.boolean(),
        control: z.boolean(),
      })
      .strict(),
  })
  .strict()
export type ComputerUseSettings = z.infer<typeof ComputerUseSettingsSchema>

const ComputerUseSettingsPatchSchema = ComputerUseSettingsSchema.partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'at least one setting is required')

export const ComputerUseStartRequestSchema = z
  .object({
    sessionId: ComputerUseIdentifierSchema,
    turnId: ComputerUseIdentifierSchema,
    workflowRunId: ComputerUseIdentifierSchema.nullable(),
    environment: ComputerEnvironmentSchema,
    providerProfileId: ComputerUseIdentifierSchema,
    modelId: ComputerUseIdentifierSchema,
    taskContract: ComputerTaskContractSchema,
    targetWindowId: ComputerUseIdentifierSchema.optional(),
  })
  .strict()
export type ComputerUseStartRequest = z.infer<typeof ComputerUseStartRequestSchema>

export const ComputerUseIpcSchemaRegistry = {
  'computer-use:get-capabilities': EmptyRequestSchema,
  'computer-use:diagnose-native-host': EmptyRequestSchema,
  'computer-use:get-settings': EmptyRequestSchema,
  'computer-use:update-settings': ComputerUseSettingsPatchSchema,
  'computer-use:start': ComputerUseStartRequestSchema,
  'computer-use:get-status': ComputerSessionIdRequestSchema,
  'computer-use:pause': ComputerSessionIdRequestSchema,
  'computer-use:resume': ComputerSessionIdRequestSchema,
  'computer-use:stop': z
    .object({
      computerSessionId: ComputerUseIdentifierSchema,
      reason: z.string().trim().min(1).max(2_000).optional(),
    })
    .strict(),
  'computer-use:takeover': ComputerSessionIdRequestSchema,
  'computer-use:approve-action': z
    .object({
      computerSessionId: ComputerUseIdentifierSchema,
      approvalId: ComputerUseIdentifierSchema,
      actionDigest: Sha256Schema,
      targetDigest: Sha256Schema,
      dataClassDigest: Sha256Schema.nullable(),
    })
    .strict(),
  'computer-use:deny-action': z
    .object({
      computerSessionId: ComputerUseIdentifierSchema,
      approvalId: ComputerUseIdentifierSchema,
      reason: z.string().trim().min(1).max(2_000).optional(),
    })
    .strict(),
  'computer-use:list-apps': EmptyRequestSchema,
  'computer-use:list-windows': z.object({ appId: ComputerUseIdentifierSchema.optional() }).strict(),
  'computer-use:list-sessions': z
    .object({
      sessionId: ComputerUseIdentifierSchema,
      limit: z.number().int().min(1).max(100).optional(),
    })
    .strict(),
  'computer-use:get-timeline': z
    .object({
      computerSessionId: ComputerUseIdentifierSchema,
      afterSeq: z.number().int().nonnegative().optional(),
      limit: z.number().int().min(1).max(500).optional(),
    })
    .strict(),
  'computer-use:get-verification': z
    .object({
      computerSessionId: ComputerUseIdentifierSchema,
      verificationId: ComputerUseIdentifierSchema,
    })
    .strict(),
  'computer-use:resolve-app-command': AppControlCommandResultSchema,
} as const

export interface ComputerUseCapabilitySummary {
  available: boolean
  platform: NativeHostPlatform
  nativeHost: NativeHostCapabilityManifest | null
  permissions: {
    screen: z.infer<typeof NativeHostPermissionStateSchema>
    accessibility: z.infer<typeof NativeHostPermissionStateSchema>
    input: z.infer<typeof NativeHostPermissionStateSchema>
  }
  unavailableReason?: string
}

export interface ComputerUseNativeHostDiagnosticReport {
  generatedAt: string
  correlationId: string
  app: {
    version: string
    packaged: boolean
  }
  runtime: {
    platform: NativeHostPlatform
    architecture: string
    osRelease: string
  }
  host: {
    available: boolean
    version: string | null
    protocolVersion: number | null
    platform: NativeHostPlatform | null
    architecture: string | null
    permissions: ComputerUseCapabilitySummary['permissions']
  }
  result: {
    diagnosticCode: string
    stage: string
    repairAction: string | null
    errorCode: string | null
    message: string
  }
  metrics: Array<{
    name: string
    count: number
    failures: number
    averageMs: number
    p95Ms: number
    p99Ms: number
  }>
}

export interface ComputerVerificationRecord {
  id: string
  computerSessionId: string
  spec: VerificationSpec
  status: 'pending' | 'passed' | 'failed' | 'inconclusive'
  evidenceSnapshotIds: string[]
  confidence: number | null
  createdAt: string
  completedAt: string | null
}

export interface ComputerUseIpcChannelMap {
  'computer-use:get-capabilities': [void, ComputerUseCapabilitySummary]
  'computer-use:diagnose-native-host': [void, ComputerUseNativeHostDiagnosticReport]
  'computer-use:get-settings': [void, ComputerUseSettings]
  'computer-use:update-settings': [Partial<ComputerUseSettings>, ComputerUseSettings]
  'computer-use:start': [ComputerUseStartRequest, { computerSession: ComputerSession }]
  'computer-use:get-status': [
    { computerSessionId: string },
    { computerSession: ComputerSession | null },
  ]
  'computer-use:pause': [{ computerSessionId: string }, { computerSession: ComputerSession }]
  'computer-use:resume': [{ computerSessionId: string }, { computerSession: ComputerSession }]
  'computer-use:stop': [
    { computerSessionId: string; reason?: string },
    { computerSession: ComputerSession },
  ]
  'computer-use:takeover': [{ computerSessionId: string }, { computerSession: ComputerSession }]
  'computer-use:approve-action': [
    {
      computerSessionId: string
      approvalId: string
      actionDigest: string
      targetDigest: string
      dataClassDigest: string | null
    },
    { accepted: boolean },
  ]
  'computer-use:deny-action': [
    { computerSessionId: string; approvalId: string; reason?: string },
    { accepted: boolean },
  ]
  'computer-use:list-apps': [void, { apps: ComputerAppIdentity[] }]
  'computer-use:list-windows': [{ appId?: string }, { windows: NativeWindowDescriptor[] }]
  'computer-use:list-sessions': [
    { sessionId: string; limit?: number },
    { computerSessions: ComputerSession[] },
  ]
  'computer-use:get-timeline': [
    { computerSessionId: string; afterSeq?: number; limit?: number },
    { events: ComputerUseEvent[]; nextSeq: number | null },
  ]
  'computer-use:get-verification': [
    { computerSessionId: string; verificationId: string },
    { verification: ComputerVerificationRecord | null },
  ]
  'computer-use:resolve-app-command': [AppControlCommandResult, { accepted: boolean }]
}

export const ApplicationSnapshotRetentionPolicySchema = z
  .object({
    mode: z.enum(['session', 'computer_run', 'ttl', 'manual']),
    expiresAt: ComputerUseIsoDateTimeSchema.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.mode === 'ttl' && value.expiresAt === null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'TTL retention requires expiresAt',
        path: ['expiresAt'],
      })
    }
    if (value.mode !== 'ttl' && value.expiresAt !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'expiresAt is only valid for TTL retention',
        path: ['expiresAt'],
      })
    }
  })
export type ApplicationSnapshotRetentionPolicy = z.infer<
  typeof ApplicationSnapshotRetentionPolicySchema
>

export const ApplicationSnapshotCaptureRequestSchema = z
  .object({
    sessionId: ComputerUseIdentifierSchema.nullable(),
    turnId: ComputerUseIdentifierSchema.nullable(),
    accessibleTextMode: AccessibleTextModeSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.sessionId === null && value.turnId !== null) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'turnId requires sessionId',
        path: ['sessionId'],
      })
    }
  })
export type ApplicationSnapshotCaptureRequest = z.infer<
  typeof ApplicationSnapshotCaptureRequestSchema
>

export const ApplicationSnapshotIpcSchemaRegistry = {
  'app-snapshot:get-capabilities': EmptyRequestSchema,
  'app-snapshot:request-permissions': z
    .object({
      permissions: z
        .array(z.enum(['screen', 'accessibility']))
        .min(1)
        .max(2),
    })
    .strict(),
  'app-snapshot:capture-frontmost': ApplicationSnapshotCaptureRequestSchema,
  'app-snapshot:get': z.object({ id: ComputerUseIdentifierSchema }).strict(),
  'app-snapshot:list-for-session': z.object({ sessionId: ComputerUseIdentifierSchema }).strict(),
  'app-snapshot:delete': z.object({ id: ComputerUseIdentifierSchema }).strict(),
  'app-snapshot:update-retention': z
    .object({
      id: ComputerUseIdentifierSchema,
      retention: ApplicationSnapshotRetentionPolicySchema,
    })
    .strict(),
} as const

export interface ApplicationSnapshotCapabilities {
  available: boolean
  platform: NativeHostPlatform
  permissions: {
    screen: z.infer<typeof NativeHostPermissionStateSchema>
    accessibility: z.infer<typeof NativeHostPermissionStateSchema>
  }
  supportsAppExposedText: boolean
  unavailableReason?: string
}

export interface ApplicationSnapshotIpcChannelMap {
  'app-snapshot:get-capabilities': [void, ApplicationSnapshotCapabilities]
  'app-snapshot:request-permissions': [
    { permissions: Array<'screen' | 'accessibility'> },
    ApplicationSnapshotCapabilities,
  ]
  'app-snapshot:capture-frontmost': [
    ApplicationSnapshotCaptureRequest,
    { snapshot: ApplicationSnapshotRef },
  ]
  'app-snapshot:get': [{ id: string }, { snapshot: ApplicationSnapshotRef | null }]
  'app-snapshot:list-for-session': [{ sessionId: string }, { snapshots: ApplicationSnapshotRef[] }]
  'app-snapshot:delete': [{ id: string }, { deleted: boolean }]
  'app-snapshot:update-retention': [
    { id: string; retention: ApplicationSnapshotRetentionPolicy },
    { snapshot: ApplicationSnapshotRef },
  ]
}
