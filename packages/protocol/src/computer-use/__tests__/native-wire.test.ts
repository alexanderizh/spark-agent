import { describe, expect, it } from 'vitest'
import * as protocol from '../../index.js'

interface RuntimeSchema {
  safeParse(value: unknown): { success: boolean }
  parse(value: unknown): unknown
}

function exportedSchema(name: string): RuntimeSchema {
  const candidate = (protocol as Record<string, unknown>)[name]
  expect(candidate, `${name} must be exported by @spark/protocol`).toBeDefined()
  return candidate as RuntimeSchema
}

const actionEnvelope = {
  computerSessionId: 'computer-session-1',
  actionId: 'action-1',
  actuatorLeaseId: 'lease-1',
  observedFrameId: 'frame-1',
  observedTreeVersion: 'tree-1',
  targetAppId: 'com.apple.TextEdit',
  targetWindowId: 'window-1',
  action: { type: 'click', point: { x: 0.5, y: 0.25 } },
  policyContext: {
    effect: 'reversible_local',
    target: { kind: 'element', id: 'element-center' },
    dataClasses: [],
  },
  intent: 'Place the caret in the approved editor',
} as const

describe('native host wire protocol', () => {
  it('accepts a deduplicated permission request without arbitrary system targets', () => {
    const schema = exportedSchema('NativeHostRequestSchema')
    const request = {
      protocolVersion: 1,
      requestId: 'native-request-permissions',
      type: 'request_permissions',
      permissions: ['screen', 'accessibility'],
    }

    expect(schema.parse(request)).toEqual(request)
    expect(schema.safeParse({ ...request, permissions: ['screen', 'screen'] }).success).toBe(false)
    expect(schema.safeParse({ ...request, permissions: ['input'] }).success).toBe(false)
  })

  it('accepts a versioned execute request carrying a governed action envelope', () => {
    const schema = exportedSchema('NativeHostRequestSchema')
    const request = {
      protocolVersion: 1,
      requestId: 'native-request-1',
      type: 'execute_action',
      envelope: actionEnvelope,
    }

    expect(schema.parse(request)).toEqual(request)
  })

  it('keeps persistent capture opt-in and rejects non-boolean rollout values', () => {
    const schema = exportedSchema('NativeHostRequestSchema')
    const request = {
      protocolVersion: 1,
      requestId: 'native-observe-1',
      type: 'observe',
      snapshotId: 'snapshot-1',
      appId: 'app-1',
      windowId: 'window-1',
      previousTreeVersion: null,
      fullTree: true,
    }

    expect(schema.parse(request)).toEqual(request)
    expect(schema.parse({ ...request, persistentCapture: true })).toEqual({
      ...request,
      persistentCapture: true,
    })
    expect(schema.safeParse({ ...request, persistentCapture: 'true' }).success).toBe(false)
  })

  it('bounds text injection and drag duration below the native-host watchdog window', () => {
    const schema = exportedSchema('NativeHostRequestSchema')
    const request = {
      protocolVersion: 1,
      requestId: 'native-request-bounds',
      type: 'execute_action',
      envelope: actionEnvelope,
    }

    expect(
      schema.safeParse({
        ...request,
        envelope: { ...actionEnvelope, action: { type: 'type_text', text: 'x'.repeat(20_001) } },
      }).success,
    ).toBe(false)
    expect(
      schema.safeParse({
        ...request,
        envelope: {
          ...actionEnvelope,
          action: {
            type: 'drag',
            from: { x: 0.1, y: 0.1 },
            to: { x: 0.9, y: 0.9 },
            durationMs: 251,
          },
        },
      }).success,
    ).toBe(false)
  })

  it('fails closed on unknown protocol versions, message types and extra fields', () => {
    const schema = exportedSchema('NativeHostRequestSchema')
    const request = {
      protocolVersion: 1,
      requestId: 'native-request-1',
      type: 'execute_action',
      envelope: actionEnvelope,
    }

    expect(schema.safeParse({ ...request, protocolVersion: 2 }).success).toBe(false)
    expect(
      schema.safeParse({
        protocolVersion: 1,
        requestId: 'native-request-2',
        type: 'shell',
        command: 'open -a Terminal',
      }).success,
    ).toBe(false)
    expect(schema.safeParse({ ...request, executablePath: '/bin/sh' }).success).toBe(false)
  })

  it('requires a self-consistent capability manifest', () => {
    const schema = exportedSchema('NativeHostCapabilityManifestSchema')
    const manifest = {
      protocolVersion: 1,
      hostVersion: '1.0.0',
      platform: 'macos',
      architecture: 'arm64',
      backends: {
        screen: 'screen_capture_kit',
        accessibility: 'axui_element',
        input: 'cg_event',
      },
      features: {
        listWindows: true,
        captureWindow: true,
        fullTree: true,
        diffTree: true,
        semanticActions: true,
        absolutePointer: true,
        keyboard: true,
        clipboard: false,
      },
      permissions: {
        screen: 'granted',
        accessibility: 'granted',
        input: 'granted',
      },
      limits: {
        maxMessageBytes: 16_777_216,
        maxScreenshotWidth: 8192,
        maxScreenshotHeight: 8192,
        maxTreeElements: 100_000,
      },
    }

    expect(schema.parse(manifest)).toEqual(manifest)
    expect(
      schema.safeParse({
        ...manifest,
        backends: { ...manifest.backends, accessibility: 'unavailable' },
      }).success,
    ).toBe(false)
    expect(
      schema.safeParse({
        ...manifest,
        features: {
          ...manifest.features,
          fullTree: false,
          diffTree: true,
          semanticActions: false,
        },
      }).success,
    ).toBe(false)
  })

  it('returns stable structured errors instead of native exception strings', () => {
    const schema = exportedSchema('NativeHostResponseSchema')
    const response = {
      protocolVersion: 1,
      requestId: 'native-request-1',
      type: 'error',
      error: {
        code: 'stale_frame',
        message: 'The observed frame is no longer current',
        retryable: true,
      },
    }

    expect(schema.parse(response)).toEqual(response)
    expect(
      schema.safeParse({
        ...response,
        error: { ...response.error, stack: 'native stack with private paths' },
      }).success,
    ).toBe(false)
  })
})
