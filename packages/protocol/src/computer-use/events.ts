import { z } from 'zod'
import { ApplicationSnapshotKindSchema } from './snapshot.js'
import { ComputerEnvironmentSchema } from './session.js'
import { ComputerRiskLevelSchema } from './policy.js'
import { ComputerUseErrorCodeSchema } from './errors.js'
import { ComputerUseIdentifierSchema, ComputerUseIsoDateTimeSchema } from './common.js'

const BaseComputerUseEventShape = {
  id: ComputerUseIdentifierSchema,
  sessionId: ComputerUseIdentifierSchema,
  turnId: ComputerUseIdentifierSchema,
  computerSessionId: ComputerUseIdentifierSchema,
  timestamp: ComputerUseIsoDateTimeSchema,
  seq: z.number().int().nonnegative(),
}

export const ComputerUseEventSchema = z.discriminatedUnion('type', [
  z
    .object({
      ...BaseComputerUseEventShape,
      type: z.literal('computer_session_started'),
      environment: ComputerEnvironmentSchema,
    })
    .strict(),
  z
    .object({
      ...BaseComputerUseEventShape,
      type: z.literal('computer_observation_created'),
      frameId: ComputerUseIdentifierSchema,
      treeVersion: ComputerUseIdentifierSchema,
    })
    .strict(),
  z
    .object({
      ...BaseComputerUseEventShape,
      type: z.literal('computer_action_requested'),
      actionId: ComputerUseIdentifierSchema,
      riskLevel: ComputerRiskLevelSchema,
    })
    .strict(),
  z
    .object({
      ...BaseComputerUseEventShape,
      type: z.literal('computer_action_blocked'),
      actionId: ComputerUseIdentifierSchema,
      errorCode: ComputerUseErrorCodeSchema,
    })
    .strict(),
  z
    .object({
      ...BaseComputerUseEventShape,
      type: z.literal('computer_action_executed'),
      actionId: ComputerUseIdentifierSchema,
      beforeFrameId: ComputerUseIdentifierSchema,
      afterFrameId: ComputerUseIdentifierSchema,
    })
    .strict(),
  z
    .object({
      ...BaseComputerUseEventShape,
      type: z.literal('computer_action_failed'),
      actionId: ComputerUseIdentifierSchema,
      errorCode: ComputerUseErrorCodeSchema,
    })
    .strict(),
  z
    .object({
      ...BaseComputerUseEventShape,
      type: z.literal('computer_approval_requested'),
      approvalId: ComputerUseIdentifierSchema,
      actionId: ComputerUseIdentifierSchema,
      riskLevel: z.enum(['L2', 'L3']),
    })
    .strict(),
  z
    .object({
      ...BaseComputerUseEventShape,
      type: z.literal('computer_approval_resolved'),
      approvalId: ComputerUseIdentifierSchema,
      actionId: ComputerUseIdentifierSchema,
      decision: z.enum(['approved', 'denied', 'expired']),
    })
    .strict(),
  z
    .object({
      ...BaseComputerUseEventShape,
      type: z.literal('computer_verification_started'),
      verificationId: ComputerUseIdentifierSchema,
    })
    .strict(),
  z
    .object({
      ...BaseComputerUseEventShape,
      type: z.literal('computer_verification_completed'),
      verificationId: ComputerUseIdentifierSchema,
      status: z.enum(['passed', 'failed', 'inconclusive']),
    })
    .strict(),
  z
    .object({
      ...BaseComputerUseEventShape,
      type: z.literal('computer_handoff_required'),
      errorCode: ComputerUseErrorCodeSchema,
    })
    .strict(),
  z
    .object({
      ...BaseComputerUseEventShape,
      type: z.literal('computer_session_completed'),
      verificationIds: z.array(ComputerUseIdentifierSchema).min(1).max(100),
    })
    .strict(),
  z
    .object({
      ...BaseComputerUseEventShape,
      type: z.literal('computer_session_failed'),
      errorCode: ComputerUseErrorCodeSchema,
    })
    .strict(),
  z
    .object({
      ...BaseComputerUseEventShape,
      type: z.literal('computer_session_canceled'),
      errorCode: z.literal('session_canceled'),
    })
    .strict(),
])
export type ComputerUseEvent = z.infer<typeof ComputerUseEventSchema>
export type ComputerUseEventType = ComputerUseEvent['type']

const BaseApplicationSnapshotEventShape = {
  id: ComputerUseIdentifierSchema,
  snapshotId: ComputerUseIdentifierSchema,
  sessionId: ComputerUseIdentifierSchema.nullable(),
  turnId: ComputerUseIdentifierSchema.nullable(),
  computerSessionId: ComputerUseIdentifierSchema.nullable(),
  timestamp: ComputerUseIsoDateTimeSchema,
}

export const ApplicationSnapshotEventSchema = z.discriminatedUnion('type', [
  z
    .object({
      ...BaseApplicationSnapshotEventShape,
      type: z.literal('app_snapshot_created'),
      kind: ApplicationSnapshotKindSchema,
    })
    .strict(),
  z
    .object({
      ...BaseApplicationSnapshotEventShape,
      type: z.literal('app_snapshot_deleted'),
    })
    .strict(),
])
export type ApplicationSnapshotEvent = z.infer<typeof ApplicationSnapshotEventSchema>
export type ApplicationSnapshotEventType = ApplicationSnapshotEvent['type']
