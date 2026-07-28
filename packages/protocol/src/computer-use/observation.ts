import { z } from 'zod'
import {
  ComputerAppIdentitySchema,
  ComputerDisplayGeometrySchema,
  ComputerRectSchema,
  ComputerUseIdentifierSchema,
  ComputerUseIsoDateTimeSchema,
  ComputerWindowIdentitySchema,
} from './common.js'

export const ComputerElementActionSchema = z.enum([
  'invoke',
  'set_value',
  'select',
  'scroll',
  'focus',
  'expand',
  'collapse',
])
export type ComputerElementAction = z.infer<typeof ComputerElementActionSchema>

export const ComputerElementRefSchema = z
  .object({
    id: ComputerUseIdentifierSchema,
    treeVersion: ComputerUseIdentifierSchema,
    role: z.string().trim().min(1).max(120),
    name: z.string().max(2_000),
    value: z.string().max(100_000).optional(),
    bounds: ComputerRectSchema,
    enabled: z.boolean(),
    focused: z.boolean(),
    actions: z.array(ComputerElementActionSchema).max(20),
  })
  .strict()
export type ComputerElementRef = z.infer<typeof ComputerElementRefSchema>

export const ComputerObservationSchema = z
  .object({
    frameId: ComputerUseIdentifierSchema,
    treeVersion: ComputerUseIdentifierSchema,
    capturedAt: ComputerUseIsoDateTimeSchema,
    display: ComputerDisplayGeometrySchema,
    foreground: z
      .object({
        app: ComputerAppIdentitySchema,
        window: ComputerWindowIdentitySchema,
      })
      .strict(),
    screenshot: z
      .object({
        snapshotId: ComputerUseIdentifierSchema,
        width: z.number().int().positive().max(131_072),
        height: z.number().int().positive().max(131_072),
      })
      .strict(),
    tree: z
      .object({
        mode: z.enum(['full', 'diff']),
        text: z.string().max(2_000_000),
        elementCount: z.number().int().nonnegative().max(100_000),
      })
      .strict(),
    elements: z.array(ComputerElementRefSchema).max(100_000),
    loading: z.boolean(),
    sensitiveRegions: z.array(ComputerRectSchema).max(10_000),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.tree.elementCount !== value.elements.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'tree.elementCount must match elements length',
        path: ['tree', 'elementCount'],
      })
    }
    value.elements.forEach((element, index) => {
      if (element.treeVersion !== value.treeVersion) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'element treeVersion must match observation treeVersion',
          path: ['elements', index, 'treeVersion'],
        })
      }
    })
  })
export type ComputerObservation = z.infer<typeof ComputerObservationSchema>
