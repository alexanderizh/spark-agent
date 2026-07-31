import { z } from 'zod'
import { ComputerActionEnvelopeSchema } from './action.js'
import {
  ComputerAppIdentitySchema,
  ComputerDisplayGeometrySchema,
  ComputerUseIdentifierSchema,
  ComputerWindowIdentitySchema,
  Sha256Schema,
} from './common.js'
import { ComputerUseErrorCodeSchema } from './errors.js'
import { ComputerObservationSchema } from './observation.js'
import { NATIVE_HOST_PROTOCOL_VERSION } from './native-version.js'

const NativeProtocolVersionSchema = z.literal(NATIVE_HOST_PROTOCOL_VERSION)

export const NativeHostPlatformSchema = z.enum(['macos', 'windows', 'linux'])
export type NativeHostPlatform = z.infer<typeof NativeHostPlatformSchema>

export const NativeHostPermissionStateSchema = z.enum([
  'granted',
  'denied',
  'not_determined',
  'restricted',
  'unsupported',
])
export type NativeHostPermissionState = z.infer<typeof NativeHostPermissionStateSchema>

export const NativeHostCapabilityManifestSchema = z
  .object({
    protocolVersion: NativeProtocolVersionSchema,
    hostVersion: z
      .string()
      .regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/, 'expected a semantic version'),
    platform: NativeHostPlatformSchema,
    architecture: z.enum(['x64', 'arm64']),
    backends: z
      .object({
        screen: z.enum([
          'screen_capture_kit',
          'windows_graphics_capture',
          'xdg_portal',
          'x11',
          'unavailable',
        ]),
        accessibility: z.enum(['axui_element', 'uia', 'at_spi', 'unavailable']),
        input: z.enum(['cg_event', 'send_input', 'xdg_remote_desktop', 'x11', 'unavailable']),
      })
      .strict(),
    features: z
      .object({
        listWindows: z.boolean(),
        captureWindow: z.boolean(),
        fullTree: z.boolean(),
        diffTree: z.boolean(),
        semanticActions: z.boolean(),
        absolutePointer: z.boolean(),
        keyboard: z.boolean(),
        clipboard: z.boolean(),
      })
      .strict(),
    permissions: z
      .object({
        screen: NativeHostPermissionStateSchema,
        accessibility: NativeHostPermissionStateSchema,
        input: NativeHostPermissionStateSchema,
      })
      .strict(),
    limits: z
      .object({
        maxMessageBytes: z.number().int().min(65_536).max(67_108_864),
        maxScreenshotWidth: z.number().int().min(1).max(32_768),
        maxScreenshotHeight: z.number().int().min(1).max(32_768),
        maxTreeElements: z.number().int().min(1).max(1_000_000),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    const expectedBackends = {
      macos: {
        screen: ['screen_capture_kit', 'unavailable'],
        accessibility: ['axui_element', 'unavailable'],
        input: ['cg_event', 'unavailable'],
      },
      windows: {
        screen: ['windows_graphics_capture', 'unavailable'],
        accessibility: ['uia', 'unavailable'],
        input: ['send_input', 'unavailable'],
      },
      linux: {
        screen: ['xdg_portal', 'x11', 'unavailable'],
        accessibility: ['at_spi', 'unavailable'],
        input: ['xdg_remote_desktop', 'x11', 'unavailable'],
      },
    } as const
    const expected = expectedBackends[value.platform]
    for (const backend of ['screen', 'accessibility', 'input'] as const) {
      if (!(expected[backend] as readonly string[]).includes(value.backends[backend])) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${value.backends[backend]} is not valid on ${value.platform}`,
          path: ['backends', backend],
        })
      }
    }
    if (
      value.backends.accessibility === 'unavailable' &&
      (value.features.fullTree || value.features.diffTree || value.features.semanticActions)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'accessibility features require an accessibility backend',
        path: ['features'],
      })
    }
    if (value.features.diffTree && !value.features.fullTree) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'diffTree requires fullTree baseline support',
        path: ['features', 'diffTree'],
      })
    }
    if (value.backends.screen === 'unavailable' && value.features.captureWindow) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'captureWindow requires a screen backend',
        path: ['features', 'captureWindow'],
      })
    }
    if (
      value.backends.input === 'unavailable' &&
      (value.features.absolutePointer || value.features.keyboard)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'input features require an input backend',
        path: ['features'],
      })
    }
  })
export type NativeHostCapabilityManifest = z.infer<typeof NativeHostCapabilityManifestSchema>

export const NativeBinaryPayloadDescriptorSchema = z
  .object({
    kind: z.enum(['image_png', 'image_webp']),
    byteLength: z.number().int().positive().max(67_108_864),
    sha256: Sha256Schema,
  })
  .strict()
export type NativeBinaryPayloadDescriptor = z.infer<typeof NativeBinaryPayloadDescriptorSchema>

const NativeRequestBase = {
  protocolVersion: NativeProtocolVersionSchema,
  requestId: ComputerUseIdentifierSchema,
}

const NativePermissionRequestListSchema = z
  .array(z.enum(['screen', 'accessibility']))
  .min(1)
  .max(2)
  .superRefine((permissions, context) => {
    if (new Set(permissions).size !== permissions.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'permissions must be unique' })
    }
  })

export const NativeHostRequestSchema = z.discriminatedUnion('type', [
  z.object({ ...NativeRequestBase, type: z.literal('get_capabilities') }).strict(),
  z
    .object({
      ...NativeRequestBase,
      type: z.literal('request_permissions'),
      permissions: NativePermissionRequestListSchema,
    })
    .strict(),
  z.object({ ...NativeRequestBase, type: z.literal('list_windows') }).strict(),
  z
    .object({
      ...NativeRequestBase,
      type: z.literal('capture_window'),
      snapshotId: ComputerUseIdentifierSchema,
      windowId: ComputerUseIdentifierSchema,
    })
    .strict(),
  z
    .object({
      ...NativeRequestBase,
      type: z.literal('observe'),
      snapshotId: ComputerUseIdentifierSchema,
      appId: ComputerUseIdentifierSchema,
      windowId: ComputerUseIdentifierSchema,
      previousTreeVersion: ComputerUseIdentifierSchema.nullable(),
      fullTree: z.boolean(),
    })
    .strict(),
  z
    .object({
      ...NativeRequestBase,
      type: z.literal('execute_action'),
      envelope: ComputerActionEnvelopeSchema,
    })
    .strict(),
  z
    .object({
      ...NativeRequestBase,
      type: z.literal('cancel_session'),
      computerSessionId: ComputerUseIdentifierSchema,
    })
    .strict(),
  z.object({ ...NativeRequestBase, type: z.literal('ping') }).strict(),
])
export type NativeHostRequest = z.infer<typeof NativeHostRequestSchema>

export const NativeWindowDescriptorSchema = z
  .object({
    app: ComputerAppIdentitySchema,
    window: ComputerWindowIdentitySchema,
    display: ComputerDisplayGeometrySchema,
    focused: z.boolean(),
    minimized: z.boolean(),
  })
  .strict()
export type NativeWindowDescriptor = z.infer<typeof NativeWindowDescriptorSchema>

const NativeResponseBase = {
  protocolVersion: NativeProtocolVersionSchema,
  requestId: ComputerUseIdentifierSchema,
}

export const NativeHostResponseSchema = z.discriminatedUnion('type', [
  z
    .object({
      ...NativeResponseBase,
      type: z.literal('capabilities'),
      manifest: NativeHostCapabilityManifestSchema,
    })
    .strict(),
  z
    .object({
      ...NativeResponseBase,
      type: z.literal('windows'),
      windows: z.array(NativeWindowDescriptorSchema).max(10_000),
    })
    .strict(),
  z
    .object({
      ...NativeResponseBase,
      type: z.literal('capture_result'),
      snapshotId: ComputerUseIdentifierSchema,
      width: z.number().int().positive().max(32_768),
      height: z.number().int().positive().max(32_768),
      payload: NativeBinaryPayloadDescriptorSchema,
    })
    .strict(),
  z
    .object({
      ...NativeResponseBase,
      type: z.literal('observation'),
      observation: ComputerObservationSchema,
      payload: NativeBinaryPayloadDescriptorSchema,
    })
    .strict(),
  z
    .object({
      ...NativeResponseBase,
      type: z.literal('action_result'),
      actionId: ComputerUseIdentifierSchema,
      status: z.enum(['executed', 'noop']),
    })
    .strict(),
  z.object({ ...NativeResponseBase, type: z.literal('ack') }).strict(),
  z.object({ ...NativeResponseBase, type: z.literal('pong') }).strict(),
  z
    .object({
      ...NativeResponseBase,
      type: z.literal('error'),
      error: z
        .object({
          code: ComputerUseErrorCodeSchema,
          message: z.string().trim().min(1).max(4_000),
          retryable: z.boolean(),
        })
        .strict(),
    })
    .strict(),
])
export type NativeHostResponse = z.infer<typeof NativeHostResponseSchema>
