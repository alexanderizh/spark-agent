import { z } from 'zod'
import {
  ComputerAppIdentitySchema,
  ComputerDisplayGeometrySchema,
  ComputerUseIdentifierSchema,
  ComputerUseIsoDateTimeSchema,
  ComputerWindowIdentitySchema,
  Sha256Schema,
} from './common.js'

export const ApplicationSnapshotKindSchema = z.enum([
  'user_context',
  'execution_before',
  'execution_after',
  'verification',
  'manual_checkpoint',
])
export type ApplicationSnapshotKind = z.infer<typeof ApplicationSnapshotKindSchema>

export const AccessibleTextModeSchema = z.enum(['visible_only', 'app_exposed'])
export type AccessibleTextMode = z.infer<typeof AccessibleTextModeSchema>

export const SnapshotRedactionReasonSchema = z.enum([
  'secure_text_field',
  'password_pattern',
  'credential_pattern',
  'user_defined_region',
  'policy_blocked_content',
])
export type SnapshotRedactionReason = z.infer<typeof SnapshotRedactionReasonSchema>

export const SnapshotRedactionSummarySchema = z
  .object({
    applied: z.boolean(),
    reasonCodes: z.array(SnapshotRedactionReasonSchema).max(100),
    regionCount: z.number().int().nonnegative().max(10_000),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.applied !== (value.regionCount > 0 || value.reasonCodes.length > 0)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'applied must reflect whether redaction reasons or regions exist',
        path: ['applied'],
      })
    }
  })
export type SnapshotRedactionSummary = z.infer<typeof SnapshotRedactionSummarySchema>

const SnapshotPreviewUrlSchema = z
  .string()
  .max(1_024)
  .regex(
    /^spark-snapshot:\/\/snapshot\/[^/?#]+\/preview\?cap=[A-Za-z0-9_-]{43,128}$/,
    'previewUrl must use the authenticated spark-snapshot protocol',
  )

export const ApplicationSnapshotRefSchema = z
  .object({
    id: ComputerUseIdentifierSchema,
    kind: ApplicationSnapshotKindSchema,
    sessionId: ComputerUseIdentifierSchema.nullable(),
    turnId: ComputerUseIdentifierSchema.nullable(),
    computerSessionId: ComputerUseIdentifierSchema.nullable(),
    app: ComputerAppIdentitySchema,
    window: ComputerWindowIdentitySchema,
    display: ComputerDisplayGeometrySchema,
    capturedAt: ComputerUseIsoDateTimeSchema,
    previewUrl: SnapshotPreviewUrlSchema.optional(),
    accessibleTextMode: AccessibleTextModeSchema,
    redaction: SnapshotRedactionSummarySchema,
    imageSha256: Sha256Schema,
  })
  .strict()
  .superRefine((value, context) => {
    if (value.sessionId === null && (value.turnId !== null || value.computerSessionId !== null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'turn and computer-session ownership require sessionId',
        path: ['sessionId'],
      })
    }
    if (value.previewUrl !== undefined) {
      const encodedId = encodeURIComponent(value.id)
      const expectedPrefix = `spark-snapshot://snapshot/${encodedId}/preview?cap=`
      if (!value.previewUrl.startsWith(expectedPrefix)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'previewUrl snapshot ID must match id',
          path: ['previewUrl'],
        })
      }
    }
  })
export type ApplicationSnapshotRef = z.infer<typeof ApplicationSnapshotRefSchema>
