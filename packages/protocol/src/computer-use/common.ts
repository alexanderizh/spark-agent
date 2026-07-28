import { z } from 'zod'

export const ComputerUseIdentifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[^\p{Cc}]+$/u, 'identifier must not contain control characters')

export const ComputerUseIsoDateTimeSchema = z.string().datetime({ offset: true })

export const ComputerDataClassSchema = z.enum([
  'public',
  'internal',
  'personal',
  'sensitive',
  'credential',
  'financial',
  'health',
  'legal',
])
export type ComputerDataClass = z.infer<typeof ComputerDataClassSchema>

export const ComputerRectSchema = z
  .object({
    x: z.number().finite().min(-131_072).max(131_072),
    y: z.number().finite().min(-131_072).max(131_072),
    width: z.number().finite().positive().max(131_072),
    height: z.number().finite().positive().max(131_072),
  })
  .strict()
export type ComputerRect = z.infer<typeof ComputerRectSchema>

export const ComputerAppIdentitySchema = z
  .object({
    id: ComputerUseIdentifierSchema,
    name: z.string().trim().min(1).max(300),
    processId: z.number().int().positive().optional(),
    bundleId: ComputerUseIdentifierSchema.optional(),
    executableIdentity: ComputerUseIdentifierSchema.optional(),
    signingIdentity: ComputerUseIdentifierSchema.optional(),
  })
  .strict()
export type ComputerAppIdentity = z.infer<typeof ComputerAppIdentitySchema>

export const ComputerWindowIdentitySchema = z
  .object({
    id: ComputerUseIdentifierSchema,
    title: z.string().max(2_000),
    bounds: ComputerRectSchema,
  })
  .strict()
export type ComputerWindowIdentity = z.infer<typeof ComputerWindowIdentitySchema>

export const ComputerDisplayGeometrySchema = z
  .object({
    id: ComputerUseIdentifierSchema,
    width: z.number().int().positive().max(131_072),
    height: z.number().int().positive().max(131_072),
    scaleFactor: z.number().finite().positive().max(8),
  })
  .strict()
export type ComputerDisplayGeometry = z.infer<typeof ComputerDisplayGeometrySchema>

export const Sha256Schema = z
  .string()
  .regex(/^[a-f0-9]{64}$/, 'expected a lowercase SHA-256 hex digest')
