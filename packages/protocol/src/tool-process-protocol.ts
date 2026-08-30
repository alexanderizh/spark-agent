import { z } from 'zod'
import { TOOL_PROCESS_PROTOCOL_VERSION } from './tool-package.js'

const FrameBaseSchema = z.object({
  protocolVersion: z.literal(TOOL_PROCESS_PROTOCOL_VERSION),
  requestId: z.string().min(1).max(160),
  invocationId: z.string().min(1).max(160).optional(),
  sequence: z.number().int().nonnegative(),
})

export const ToolProcessHostFrameSchema = z.discriminatedUnion('type', [
  FrameBaseSchema.extend({
    type: z.literal('initialize'),
    packageId: z.string().min(1).max(160),
    packageVersion: z.string().min(1).max(160),
    capabilityProtocolVersion: z.literal(1),
  }),
  FrameBaseSchema.extend({
    type: z.literal('invoke'),
    invocationId: z.string().min(1).max(160),
    toolName: z.string().min(1).max(160),
    input: z.unknown(),
    context: z.record(z.string(), z.unknown()).default({}),
  }),
  FrameBaseSchema.extend({
    type: z.literal('cancel'),
    invocationId: z.string().min(1).max(160),
  }),
  FrameBaseSchema.extend({
    type: z.literal('capability.result'),
    invocationId: z.string().min(1).max(160),
    result: z.unknown(),
  }),
  FrameBaseSchema.extend({
    type: z.literal('capability.error'),
    invocationId: z.string().min(1).max(160),
    code: z.string().min(1).max(160),
    message: z.string().min(1).max(4_000),
  }),
  FrameBaseSchema.extend({ type: z.literal('shutdown') }),
])
export type ToolProcessHostFrame = z.infer<typeof ToolProcessHostFrameSchema>

export const ToolProcessChildFrameSchema = z.discriminatedUnion('type', [
  FrameBaseSchema.extend({ type: z.literal('ready') }),
  FrameBaseSchema.extend({
    type: z.literal('result'),
    invocationId: z.string().min(1).max(160),
    result: z.unknown(),
  }),
  FrameBaseSchema.extend({
    type: z.literal('error'),
    invocationId: z.string().min(1).max(160).optional(),
    code: z.string().min(1).max(160),
    message: z.string().min(1).max(4_000),
  }),
  FrameBaseSchema.extend({
    type: z.literal('log'),
    level: z.enum(['debug', 'info', 'warn', 'error']),
    message: z.string().max(32_000),
  }),
  FrameBaseSchema.extend({
    type: z.literal('progress'),
    invocationId: z.string().min(1).max(160),
    progress: z.number().min(0).max(1).optional(),
    message: z.string().max(4_000).optional(),
  }),
  FrameBaseSchema.extend({
    type: z.literal('capability.request'),
    invocationId: z.string().min(1).max(160),
    capability: z.string().min(1).max(160),
    input: z.unknown(),
  }),
])
export type ToolProcessChildFrame = z.infer<typeof ToolProcessChildFrameSchema>
