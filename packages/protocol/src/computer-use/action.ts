import { z } from 'zod'
import { ComputerUseIdentifierSchema } from './common.js'
import { ComputerPolicyContextSchema } from './policy.js'
import { VerificationSpecSchema } from './verification.js'

export const ComputerActionKindSchema = z.enum([
  'observe',
  'invoke_element',
  'set_value',
  'select_text',
  'click',
  'move',
  'drag',
  'scroll',
  'keypress',
  'type_text',
  'wait_for',
  'focus_window',
  'app_command',
])
export type ComputerActionKind = z.infer<typeof ComputerActionKindSchema>

export const ComputerKeySchema = z.union([
  z.enum([
    'Alt',
    'Backspace',
    'Control',
    'Delete',
    'End',
    'Enter',
    'Escape',
    'Home',
    'Meta',
    'PageDown',
    'PageUp',
    'Shift',
    'Space',
    'Tab',
    'ArrowDown',
    'ArrowLeft',
    'ArrowRight',
    'ArrowUp',
    'F1',
    'F2',
    'F3',
    'F4',
    'F5',
    'F6',
    'F7',
    'F8',
    'F9',
    'F10',
    'F11',
    'F12',
    'F13',
    'F14',
    'F15',
    'F16',
    'F17',
    'F18',
    'F19',
    'F20',
    'F21',
    'F22',
    'F23',
    'F24',
  ]),
  z.string().regex(/^[A-Za-z0-9]$/, 'expected a named key or one ASCII letter/digit'),
])
export type ComputerKey = z.infer<typeof ComputerKeySchema>

export const NormalizedPointSchema = z
  .object({
    x: z.number().finite().min(0).max(1),
    y: z.number().finite().min(0).max(1),
  })
  .strict()
export type NormalizedPoint = z.infer<typeof NormalizedPointSchema>

export const WaitConditionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('loading_stopped') }).strict(),
  z.object({ kind: z.literal('element_present'), elementId: ComputerUseIdentifierSchema }).strict(),
  z.object({ kind: z.literal('element_absent'), elementId: ComputerUseIdentifierSchema }).strict(),
  z.object({ kind: z.literal('window_focused'), windowId: ComputerUseIdentifierSchema }).strict(),
  z
    .object({ kind: z.literal('snapshot_changed'), previousFrameId: ComputerUseIdentifierSchema })
    .strict(),
])
export type WaitCondition = z.infer<typeof WaitConditionSchema>

export const AppControlCommandSchema = z.discriminatedUnion('name', [
  z.object({ name: z.literal('set_theme'), theme: z.enum(['light', 'dark', 'system']) }).strict(),
  z
    .object({
      name: z.literal('navigate'),
      view: z.enum([
        'chat',
        'workflows',
        'agents',
        'board',
        'canvas',
        'canvas-workflows',
        'scheduled-tasks',
        'skills',
        'providers',
        'mcp',
        'memory',
        'settings',
        'account-center',
      ]),
    })
    .strict(),
  z
    .object({
      name: z.literal('prefill_composer'),
      text: z.string().min(1).max(4_000),
      sensitive: z.boolean().optional(),
    })
    .strict(),
])
export type AppControlCommand = z.infer<typeof AppControlCommandSchema>

export const AppControlCommandRequestSchema = z
  .object({
    commandId: ComputerUseIdentifierSchema,
    computerSessionId: ComputerUseIdentifierSchema,
    actionId: ComputerUseIdentifierSchema,
    command: AppControlCommandSchema,
  })
  .strict()
export type AppControlCommandRequest = z.infer<typeof AppControlCommandRequestSchema>

export const AppControlCommandResultSchema = z
  .object({
    commandId: ComputerUseIdentifierSchema,
    computerSessionId: ComputerUseIdentifierSchema,
    actionId: ComputerUseIdentifierSchema,
    status: z.enum(['applied', 'rejected']),
    uiRevision: z.number().int().nonnegative(),
  })
  .strict()
export type AppControlCommandResult = z.infer<typeof AppControlCommandResultSchema>

const ComputerActionBaseSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('observe'), fullTree: z.boolean().optional() }).strict(),
  z
    .object({
      type: z.literal('invoke_element'),
      elementId: ComputerUseIdentifierSchema,
      action: z.enum(['invoke', 'select', 'focus', 'expand', 'collapse']).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('set_value'),
      elementId: ComputerUseIdentifierSchema,
      value: z.string().max(20_000),
      sensitive: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('select_text'),
      elementId: ComputerUseIdentifierSchema,
      text: z.string().min(1).max(20_000),
      prefix: z.string().max(2_000).optional(),
      suffix: z.string().max(2_000).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('click'),
      point: NormalizedPointSchema,
      button: z.enum(['left', 'right', 'middle']).optional(),
      count: z.number().int().min(1).max(3).optional(),
    })
    .strict(),
  z.object({ type: z.literal('move'), point: NormalizedPointSchema }).strict(),
  z
    .object({
      type: z.literal('drag'),
      from: NormalizedPointSchema,
      to: NormalizedPointSchema,
      durationMs: z.number().int().min(50).max(250).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('scroll'),
      elementId: ComputerUseIdentifierSchema.optional(),
      point: NormalizedPointSchema.optional(),
      deltaX: z.number().finite().min(-100_000).max(100_000),
      deltaY: z.number().finite().min(-100_000).max(100_000),
    })
    .strict(),
  z
    .object({
      type: z.literal('keypress'),
      keys: z.array(ComputerKeySchema).min(1).max(8),
    })
    .strict(),
  z
    .object({
      type: z.literal('type_text'),
      text: z.string().min(1).max(20_000),
      sensitive: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('wait_for'),
      condition: WaitConditionSchema,
      timeoutMs: z.number().int().min(50).max(120_000),
    })
    .strict(),
  z.object({ type: z.literal('focus_window'), windowId: ComputerUseIdentifierSchema }).strict(),
  z.object({ type: z.literal('app_command'), command: AppControlCommandSchema }).strict(),
])

export const ComputerActionSchema = ComputerActionBaseSchema.superRefine((value, context) => {
  if (value.type === 'scroll' && value.deltaX === 0 && value.deltaY === 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'scroll must have a non-zero delta',
      path: ['deltaY'],
    })
  }
})
export type ComputerAction = z.infer<typeof ComputerActionSchema>

export const ComputerExecutionLaneSchema = z.enum([
  'background_semantic',
  'foreground_input',
  'passive',
])
export type ComputerExecutionLane = z.infer<typeof ComputerExecutionLaneSchema>

export function computerExecutionLaneForAction(action: ComputerAction): ComputerExecutionLane {
  if (
    action.type === 'invoke_element' ||
    action.type === 'set_value' ||
    action.type === 'select_text' ||
    action.type === 'app_command'
  ) {
    return 'background_semantic'
  }
  if (action.type === 'observe' || action.type === 'wait_for') return 'passive'
  return 'foreground_input'
}

export const ComputerActionEnvelopeSchema = z
  .object({
    computerSessionId: ComputerUseIdentifierSchema,
    actionId: ComputerUseIdentifierSchema,
    actuatorLeaseId: ComputerUseIdentifierSchema,
    observedFrameId: ComputerUseIdentifierSchema,
    observedTreeVersion: ComputerUseIdentifierSchema,
    targetAppId: ComputerUseIdentifierSchema,
    targetWindowId: ComputerUseIdentifierSchema,
    action: ComputerActionSchema,
    executionLane: ComputerExecutionLaneSchema.optional(),
    policyContext: ComputerPolicyContextSchema,
    intent: z.string().trim().min(1).max(4_000),
    expectedPostcondition: VerificationSpecSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const expected = computerExecutionLaneForAction(value.action)
    if (value.executionLane != null && value.executionLane !== expected) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `executionLane must be ${expected} for ${value.action.type}`,
        path: ['executionLane'],
      })
    }
  })
export type ComputerActionEnvelope = z.infer<typeof ComputerActionEnvelopeSchema>
