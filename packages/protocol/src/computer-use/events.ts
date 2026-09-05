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

/**
 * Human-readable one-line description of the action (e.g. `点击 [12] button "搜索"`,
 * `输入 "comfyui"`). Optional: timeline consumers render it verbatim when present
 * and fall back to the generic per-type label otherwise.
 */
const ActionSummarySchema = z.string().max(400)

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
      summary: ActionSummarySchema.optional(),
    })
    .strict(),
  z
    .object({
      ...BaseComputerUseEventShape,
      type: z.literal('computer_action_blocked'),
      actionId: ComputerUseIdentifierSchema,
      errorCode: ComputerUseErrorCodeSchema,
      summary: ActionSummarySchema.optional(),
    })
    .strict(),
  z
    .object({
      ...BaseComputerUseEventShape,
      type: z.literal('computer_action_executed'),
      actionId: ComputerUseIdentifierSchema,
      beforeFrameId: ComputerUseIdentifierSchema,
      afterFrameId: ComputerUseIdentifierSchema,
      summary: ActionSummarySchema.optional(),
    })
    .strict(),
  z
    .object({
      ...BaseComputerUseEventShape,
      type: z.literal('computer_action_failed'),
      actionId: ComputerUseIdentifierSchema,
      errorCode: ComputerUseErrorCodeSchema,
      summary: ActionSummarySchema.optional(),
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
      // Empty when the task completed without persisted verification records —
      // the terminal event itself must always be emitted so downstream UI
      // (activity card, PIP panel) can close the session instead of hanging
      // on "in progress" forever.
      verificationIds: z.array(ComputerUseIdentifierSchema).max(100),
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
