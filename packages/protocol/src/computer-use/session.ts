import { z } from 'zod'
import { ComputerActionKindSchema } from './action.js'
import {
  ComputerDataClassSchema,
  ComputerUseIdentifierSchema,
  ComputerUseIsoDateTimeSchema,
} from './common.js'
import { VerificationSpecSchema } from './verification.js'

export { ComputerDataClassSchema } from './common.js'
export type { ComputerDataClass } from './common.js'

export const ComputerEnvironmentSchema = z.enum(['safe_browser', 'safe_desktop', 'my_desktop'])
export type ComputerEnvironment = z.infer<typeof ComputerEnvironmentSchema>

export const ComputerSessionStatusSchema = z.enum([
  'preflighting',
  'observing',
  'planning',
  'waiting_approval',
  'acting',
  'verifying',
  'paused',
  'handoff_required',
  'completed',
  'failed',
  'canceled',
])
export type ComputerSessionStatus = z.infer<typeof ComputerSessionStatusSchema>

export const ComputerUserPresenceSchema = z.enum(['required', 'optional', 'unattended'])
export type ComputerUserPresence = z.infer<typeof ComputerUserPresenceSchema>

export const ComputerAppIdentityRuleSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('app_id'), value: ComputerUseIdentifierSchema }).strict(),
  z.object({ kind: z.literal('bundle_id'), value: ComputerUseIdentifierSchema }).strict(),
  z.object({ kind: z.literal('executable_identity'), value: ComputerUseIdentifierSchema }).strict(),
  z.object({ kind: z.literal('signing_identity'), value: ComputerUseIdentifierSchema }).strict(),
])
export type ComputerAppIdentityRule = z.infer<typeof ComputerAppIdentityRuleSchema>

const AllowedDomainSchema = z
  .string()
  .trim()
  .max(253)
  .regex(
    /^(?:\*\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i,
    'expected a hostname or a leftmost wildcard hostname',
  )

export const ComputerTaskContractSchema = z
  .object({
    objective: z.string().trim().min(1).max(20_000),
    successCriteria: z.array(VerificationSpecSchema).min(1).max(100),
    // Kept for persisted-contract compatibility only. Desktop execution no longer uses an
    // application allowlist; new contracts store an empty array and legacy values are ignored.
    allowedApps: z.array(ComputerAppIdentityRuleSchema).max(200),
    allowedDomains: z.array(AllowedDomainSchema).max(500),
    allowedDataClasses: z.array(ComputerDataClassSchema).max(20),
    forbiddenActions: z
      .array(ComputerActionKindSchema)
      .max(ComputerActionKindSchema.options.length),
    maxSteps: z.number().int().min(1).max(10_000),
    maxRuntimeMs: z.number().int().min(1_000).max(86_400_000),
    maxConsecutiveNoops: z.number().int().min(1).max(100),
    userPresence: ComputerUserPresenceSchema,
  })
  .strict()
export type ComputerTaskContract = z.infer<typeof ComputerTaskContractSchema>

export const ComputerSessionSchema = z
  .object({
    id: ComputerUseIdentifierSchema,
    sessionId: ComputerUseIdentifierSchema,
    turnId: ComputerUseIdentifierSchema,
    workflowRunId: ComputerUseIdentifierSchema.nullable(),
    environment: ComputerEnvironmentSchema,
    status: ComputerSessionStatusSchema,
    providerProfileId: ComputerUseIdentifierSchema,
    modelId: ComputerUseIdentifierSchema,
    taskContract: ComputerTaskContractSchema,
    actuatorLeaseId: ComputerUseIdentifierSchema.nullable(),
    createdAt: ComputerUseIsoDateTimeSchema,
    updatedAt: ComputerUseIsoDateTimeSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (Date.parse(value.updatedAt) < Date.parse(value.createdAt)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'updatedAt must not be earlier than createdAt',
        path: ['updatedAt'],
      })
    }
  })
export type ComputerSession = z.infer<typeof ComputerSessionSchema>

export const ComputerActuatorLeaseSchema = z
  .object({
    id: ComputerUseIdentifierSchema,
    environmentKey: ComputerUseIdentifierSchema,
    computerSessionId: ComputerUseIdentifierSchema,
    operatorId: ComputerUseIdentifierSchema,
    acquiredAt: ComputerUseIsoDateTimeSchema,
    heartbeatAt: ComputerUseIsoDateTimeSchema,
    expiresAt: ComputerUseIsoDateTimeSchema,
    releasedAt: ComputerUseIsoDateTimeSchema.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    const acquiredAt = Date.parse(value.acquiredAt)
    const heartbeatAt = Date.parse(value.heartbeatAt)
    const expiresAt = Date.parse(value.expiresAt)
    if (heartbeatAt < acquiredAt) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'heartbeatAt must follow acquiredAt',
        path: ['heartbeatAt'],
      })
    }
    if (expiresAt <= heartbeatAt) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'expiresAt must follow heartbeatAt',
        path: ['expiresAt'],
      })
    }
    if (value.releasedAt !== null && Date.parse(value.releasedAt) < acquiredAt) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'releasedAt must follow acquiredAt',
        path: ['releasedAt'],
      })
    }
  })
export type ComputerActuatorLease = z.infer<typeof ComputerActuatorLeaseSchema>
