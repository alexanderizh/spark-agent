import { z } from 'zod'
import {
  ComputerDataClassSchema,
  ComputerUseIdentifierSchema,
  ComputerUseIsoDateTimeSchema,
  Sha256Schema,
} from './common.js'
import { ComputerUseErrorCodeSchema } from './errors.js'

export const ComputerRiskLevelSchema = z.enum(['L0', 'L1', 'L2', 'L3', 'L4'])
export type ComputerRiskLevel = z.infer<typeof ComputerRiskLevelSchema>

export const ComputerPolicyEffectSchema = z.enum([
  'read_only',
  'reversible_local',
  'external_write',
  'high_impact',
  'restricted',
])
export type ComputerPolicyEffect = z.infer<typeof ComputerPolicyEffectSchema>

export const ComputerPolicyTargetKindSchema = z.enum([
  'application',
  'window',
  'element',
  'domain',
  'recipient',
  'file_policy',
  'system_setting',
  'account',
  'unknown',
])
export type ComputerPolicyTargetKind = z.infer<typeof ComputerPolicyTargetKindSchema>

export const ComputerPolicyTargetSchema = z
  .object({
    kind: ComputerPolicyTargetKindSchema,
    id: ComputerUseIdentifierSchema,
  })
  .strict()
export type ComputerPolicyTarget = z.infer<typeof ComputerPolicyTargetSchema>

export const ComputerPolicyContextSchema = z
  .object({
    effect: ComputerPolicyEffectSchema,
    target: ComputerPolicyTargetSchema,
    dataClasses: z.array(ComputerDataClassSchema).max(ComputerDataClassSchema.options.length),
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.dataClasses).size !== value.dataClasses.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'dataClasses must not contain duplicates',
        path: ['dataClasses'],
      })
    }
  })
export type ComputerPolicyContext = z.infer<typeof ComputerPolicyContextSchema>

export const ComputerPolicyDecisionKindSchema = z.enum([
  'allow',
  'require_approval',
  'require_handoff',
  'deny',
])
export type ComputerPolicyDecisionKind = z.infer<typeof ComputerPolicyDecisionKindSchema>

export const ComputerPolicyReasonCodeSchema = z.union([
  z.enum(['read_only_action', 'within_task_scope', 'valid_approval']),
  ComputerUseErrorCodeSchema,
])
export type ComputerPolicyReasonCode = z.infer<typeof ComputerPolicyReasonCodeSchema>

export const ComputerPolicyDecisionSchema = z
  .object({
    actionId: ComputerUseIdentifierSchema,
    riskLevel: ComputerRiskLevelSchema,
    decision: ComputerPolicyDecisionKindSchema,
    reasonCode: ComputerPolicyReasonCodeSchema,
    requiresUserPresence: z.boolean(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.riskLevel === 'L4' &&
      value.decision !== 'require_handoff' &&
      value.decision !== 'deny'
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'L4 actions must be denied or handed off to the user',
        path: ['decision'],
      })
    }
    if (value.riskLevel === 'L4' && !value.requiresUserPresence) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'L4 actions require local user presence for handoff',
        path: ['requiresUserPresence'],
      })
    }
    const allowReasons: ComputerPolicyReasonCode[] = [
      'read_only_action',
      'within_task_scope',
      'valid_approval',
    ]
    if (value.decision === 'allow' && !allowReasons.includes(value.reasonCode)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'allowed actions require a stable allow reason',
        path: ['reasonCode'],
      })
    }
    if (value.decision === 'deny' && allowReasons.includes(value.reasonCode)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'denied actions require a stable error reason',
        path: ['reasonCode'],
      })
    }
    if (value.decision === 'require_approval' && value.reasonCode !== 'approval_required') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'approval decisions must use approval_required',
        path: ['reasonCode'],
      })
    }
    if (value.decision === 'require_handoff' && value.reasonCode !== 'handoff_required') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'handoff decisions must use handoff_required',
        path: ['reasonCode'],
      })
    }
  })
export type ComputerPolicyDecision = z.infer<typeof ComputerPolicyDecisionSchema>

export const ComputerApprovalTicketSchema = z
  .object({
    id: ComputerUseIdentifierSchema,
    computerSessionId: ComputerUseIdentifierSchema,
    actionId: ComputerUseIdentifierSchema,
    riskLevel: z.enum(['L2', 'L3']),
    actionDigest: Sha256Schema,
    targetDigest: Sha256Schema,
    dataClassDigest: Sha256Schema.nullable(),
    approvedBy: z.enum(['local_user', 'remote_device']),
    approverId: ComputerUseIdentifierSchema,
    approvedAt: ComputerUseIsoDateTimeSchema,
    expiresAt: ComputerUseIsoDateTimeSchema,
    nonce: z
      .string()
      .min(16)
      .max(512)
      .regex(/^[^\p{Cc}]+$/u, 'nonce must not contain control characters'),
    usedAt: ComputerUseIsoDateTimeSchema.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    const approvedAt = Date.parse(value.approvedAt)
    const expiresAt = Date.parse(value.expiresAt)
    if (expiresAt <= approvedAt) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'expiresAt must be later than approvedAt',
        path: ['expiresAt'],
      })
    }
    if (value.usedAt !== null) {
      const usedAt = Date.parse(value.usedAt)
      if (usedAt < approvedAt || usedAt > expiresAt) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'usedAt must be within the approval validity window',
          path: ['usedAt'],
        })
      }
    }
    if (value.approvedBy === 'remote_device' && value.riskLevel !== 'L2') {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'remote devices may only approve L2 actions',
        path: ['approvedBy'],
      })
    }
  })
export type ComputerApprovalTicket = z.infer<typeof ComputerApprovalTicketSchema>
