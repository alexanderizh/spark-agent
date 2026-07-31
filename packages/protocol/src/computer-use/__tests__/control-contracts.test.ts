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

const validObservation = {
  frameId: 'frame-17',
  treeVersion: 'tree-21',
  capturedAt: '2026-07-28T02:20:00.000Z',
  display: { id: 'display-main', width: 2560, height: 1600, scaleFactor: 2 },
  foreground: {
    app: { id: 'com.apple.TextEdit', name: 'TextEdit', processId: 2048 },
    window: {
      id: 'window-12',
      title: 'Untitled',
      bounds: { x: 120, y: 80, width: 960, height: 720 },
    },
  },
  screenshot: {
    snapshotId: 'snapshot-frame-17',
    width: 1920,
    height: 1440,
  },
  tree: {
    mode: 'full',
    text: 'Untitled\nSave',
    elementCount: 1,
  },
  elements: [
    {
      id: 'element-save',
      treeVersion: 'tree-21',
      role: 'button',
      name: 'Save',
      bounds: { x: 880, y: 760, width: 80, height: 32 },
      enabled: true,
      focused: false,
      actions: ['invoke'],
    },
  ],
  loading: false,
  sensitiveRegions: [],
} as const

describe('computer observation contract', () => {
  it('binds every semantic element to the current tree version', () => {
    const schema = exportedSchema('ComputerObservationSchema')

    expect(schema.parse(validObservation)).toEqual(validObservation)
    expect(
      schema.safeParse({
        ...validObservation,
        elements: [{ ...validObservation.elements[0], treeVersion: 'tree-stale' }],
      }).success,
    ).toBe(false)
  })

  it('rejects unknown observation fields and inconsistent tree counts', () => {
    const schema = exportedSchema('ComputerObservationSchema')

    expect(schema.safeParse({ ...validObservation, rawImagePath: '/tmp/frame.png' }).success).toBe(
      false,
    )
    expect(
      schema.safeParse({
        ...validObservation,
        tree: { ...validObservation.tree, elementCount: 2 },
      }).success,
    ).toBe(false)
    expect(
      schema.safeParse({
        ...validObservation,
        foreground: {
          ...validObservation.foreground,
          app: {
            ...validObservation.foreground.app,
            bundleId: 'com.apple.TextEdit',
            executableIdentity: 'apple:textedit:system',
            signingIdentity: 'anchor-apple:textedit',
          },
        },
      }).success,
    ).toBe(true)
  })
})

describe('computer action contract', () => {
  it('requires lease, observed frame, observed tree and target identity on every action', () => {
    const schema = exportedSchema('ComputerActionEnvelopeSchema')
    const envelope = {
      computerSessionId: 'computer-session-1',
      actionId: 'action-1',
      actuatorLeaseId: 'lease-1',
      observedFrameId: 'frame-17',
      observedTreeVersion: 'tree-21',
      targetAppId: 'com.apple.TextEdit',
      targetWindowId: 'window-12',
      action: { type: 'invoke_element', elementId: 'element-save', action: 'invoke' },
      policyContext: {
        effect: 'external_write',
        target: { kind: 'file_policy', id: 'workspace-document' },
        dataClasses: ['internal'],
      },
      intent: 'Save the current document',
      expectedPostcondition: {
        kind: 'accessibility',
        selector: { elementId: 'element-save' },
        assertion: { operator: 'enabled', expected: false },
      },
    }

    expect(schema.parse(envelope)).toEqual(envelope)
    expect(
      schema.safeParse({ ...envelope, executionLane: 'background_semantic' }).success,
    ).toBe(true)
    expect(schema.safeParse({ ...envelope, executionLane: 'foreground_input' }).success).toBe(
      false,
    )
    const { observedFrameId: _frame, ...withoutFrame } = envelope
    expect(schema.safeParse(withoutFrame).success).toBe(false)

    const { policyContext: _policyContext, ...withoutPolicyContext } = envelope
    expect(schema.safeParse(withoutPolicyContext).success).toBe(false)
  })

  it('accepts only structured policy effects, targets and unique data classes', () => {
    const schema = exportedSchema('ComputerPolicyContextSchema')
    const context = {
      effect: 'external_write',
      target: { kind: 'recipient', id: 'recipient-alice' },
      dataClasses: ['personal'],
    }

    expect(schema.parse(context)).toEqual(context)
    expect(schema.safeParse({ ...context, effect: 'send_without_approval' }).success).toBe(false)
    expect(
      schema.safeParse({ ...context, target: { ...context.target, label: 'Alice' } }).success,
    ).toBe(false)
    expect(schema.safeParse({ ...context, dataClasses: ['personal', 'personal'] }).success).toBe(
      false,
    )
  })

  it('bounds coordinate actions and rejects zero-effect scrolling', () => {
    const schema = exportedSchema('ComputerActionSchema')

    expect(schema.safeParse({ type: 'click', point: { x: 0.5, y: 0.25 } }).success).toBe(true)
    expect(schema.safeParse({ type: 'click', point: { x: 1.01, y: 0.25 } }).success).toBe(false)
    expect(schema.safeParse({ type: 'scroll', deltaX: 0, deltaY: 0 }).success).toBe(false)
    expect(schema.safeParse({ type: 'shell', command: 'rm -rf /' }).success).toBe(false)
    expect(
      schema.safeParse({
        type: 'invoke_element',
        elementId: 'element-save',
        action: 'launch_shell',
      }).success,
    ).toBe(false)
    expect(schema.safeParse({ type: 'keypress', keys: ['Command("rm -rf /")'] }).success).toBe(
      false,
    )
  })
})

describe('computer verification contract', () => {
  it('supports independent evidence without allowing arbitrary file paths', () => {
    const schema = exportedSchema('VerificationSpecSchema')

    expect(
      schema.safeParse({
        kind: 'file',
        pathPolicyRef: 'workspace-output',
        assertion: { operator: 'exists', expected: true },
      }).success,
    ).toBe(true)
    expect(
      schema.safeParse({
        kind: 'file',
        path: '/Users/example/.ssh/id_ed25519',
        assertion: { operator: 'exists', expected: true },
      }).success,
    ).toBe(false)
    expect(
      schema.safeParse({
        kind: 'file',
        pathPolicyRef: 'workspace-output',
        assertion: { operator: 'size_between', minBytes: 100, maxBytes: 10 },
      }).success,
    ).toBe(false)
    expect(
      schema.safeParse({
        kind: 'dom',
        windowId: 'browser-window-1',
        assertion: { selector: '#status', operator: 'text_contains', expected: false },
      }).success,
    ).toBe(false)
    expect(
      schema.safeParse({
        kind: 'external_readback',
        connectorId: 'connector-1',
        assertion: { resource: 'message-1', operator: 'exists', expected: 'yes' },
      }).success,
    ).toBe(false)
  })
})
