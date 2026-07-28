import { z } from 'zod'
import { ComputerRectSchema, ComputerUseIdentifierSchema } from './common.js'

export const ElementSelectorSchema = z
  .object({
    elementId: ComputerUseIdentifierSchema.optional(),
    role: z.string().trim().min(1).max(120).optional(),
    name: z.string().max(1_000).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.elementId === undefined && value.role === undefined && value.name === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'at least one element selector field is required',
      })
    }
  })
export type ElementSelector = z.infer<typeof ElementSelectorSchema>

export const ElementAssertionSchema = z.discriminatedUnion('operator', [
  z.object({ operator: z.literal('exists'), expected: z.boolean() }).strict(),
  z.object({ operator: z.literal('visible'), expected: z.boolean() }).strict(),
  z.object({ operator: z.literal('enabled'), expected: z.boolean() }).strict(),
  z.object({ operator: z.literal('focused'), expected: z.boolean() }).strict(),
  z.object({ operator: z.literal('value_equals'), expected: z.string().max(100_000) }).strict(),
  z
    .object({ operator: z.literal('text_contains'), expected: z.string().min(1).max(100_000) })
    .strict(),
])
export type ElementAssertion = z.infer<typeof ElementAssertionSchema>

export const DomAssertionSchema = z
  .object({
    selector: z.string().trim().min(1).max(2_000),
    operator: z.enum(['exists', 'visible', 'text_contains', 'attribute_equals']),
    expected: z.union([z.boolean(), z.string().max(100_000)]),
    attribute: z.string().trim().min(1).max(200).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      (value.operator === 'exists' || value.operator === 'visible') &&
      typeof value.expected !== 'boolean'
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'expected must be boolean',
        path: ['expected'],
      })
    }
    if (
      (value.operator === 'text_contains' || value.operator === 'attribute_equals') &&
      typeof value.expected !== 'string'
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'expected must be string',
        path: ['expected'],
      })
    }
    if (value.operator === 'attribute_equals' && value.attribute === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'attribute is required',
        path: ['attribute'],
      })
    }
  })
export type DomAssertion = z.infer<typeof DomAssertionSchema>

export const VisualAssertionSchema = z.discriminatedUnion('operator', [
  z
    .object({ operator: z.literal('text_present'), expected: z.string().min(1).max(20_000) })
    .strict(),
  z
    .object({ operator: z.literal('text_absent'), expected: z.string().min(1).max(20_000) })
    .strict(),
  z
    .object({ operator: z.literal('similarity_at_least'), expected: z.number().min(0).max(1) })
    .strict(),
  z.object({ operator: z.literal('changed'), expected: z.boolean() }).strict(),
])
export type VisualAssertion = z.infer<typeof VisualAssertionSchema>

const FileAssertionBaseSchema = z.discriminatedUnion('operator', [
  z.object({ operator: z.literal('exists'), expected: z.boolean() }).strict(),
  z
    .object({ operator: z.literal('sha256_equals'), expected: z.string().regex(/^[a-f0-9]{64}$/i) })
    .strict(),
  z
    .object({
      operator: z.literal('size_between'),
      minBytes: z.number().int().nonnegative(),
      maxBytes: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({ operator: z.literal('text_contains'), expected: z.string().min(1).max(100_000) })
    .strict(),
])
export const FileAssertionSchema = FileAssertionBaseSchema.superRefine((value, context) => {
  if (value.operator === 'size_between' && value.minBytes > value.maxBytes) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'minBytes must not exceed maxBytes',
      path: ['minBytes'],
    })
  }
})
export type FileAssertion = z.infer<typeof FileAssertionSchema>

export const ApplicationStateAssertionSchema = z
  .object({
    operator: z.enum(['running', 'frontmost', 'window_exists', 'window_title_contains']),
    expected: z.union([z.boolean(), z.string().max(2_000)]),
  })
  .strict()
  .superRefine((value, context) => {
    const expectsBoolean = value.operator !== 'window_title_contains'
    if (expectsBoolean !== (typeof value.expected === 'boolean')) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: expectsBoolean ? 'expected must be boolean' : 'expected must be string',
        path: ['expected'],
      })
    }
  })
export type ApplicationStateAssertion = z.infer<typeof ApplicationStateAssertionSchema>

const ExternalResourceSchema = z.string().trim().min(1).max(500)
export const ExternalAssertionSchema = z.discriminatedUnion('operator', [
  z
    .object({
      resource: ExternalResourceSchema,
      operator: z.literal('exists'),
      expected: z.boolean(),
    })
    .strict(),
  z
    .object({
      resource: ExternalResourceSchema,
      operator: z.literal('equals'),
      expected: z.union([z.boolean(), z.string().max(100_000), z.number().finite()]),
    })
    .strict(),
  z
    .object({
      resource: ExternalResourceSchema,
      operator: z.literal('contains'),
      expected: z.string().min(1).max(100_000),
    })
    .strict(),
  z
    .object({
      resource: ExternalResourceSchema,
      operator: z.literal('status_is'),
      expected: z.string().trim().min(1).max(500),
    })
    .strict(),
])
export type ExternalAssertion = z.infer<typeof ExternalAssertionSchema>

export const VerificationSpecSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('accessibility'),
      selector: ElementSelectorSchema,
      assertion: ElementAssertionSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('dom'),
      windowId: ComputerUseIdentifierSchema,
      assertion: DomAssertionSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('visual'),
      region: ComputerRectSchema.optional(),
      assertion: VisualAssertionSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('file'),
      pathPolicyRef: ComputerUseIdentifierSchema,
      assertion: FileAssertionSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('application_state'),
      appId: ComputerUseIdentifierSchema,
      assertion: ApplicationStateAssertionSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal('external_readback'),
      connectorId: ComputerUseIdentifierSchema,
      assertion: ExternalAssertionSchema,
    })
    .strict(),
])
export type VerificationSpec = z.infer<typeof VerificationSpecSchema>
