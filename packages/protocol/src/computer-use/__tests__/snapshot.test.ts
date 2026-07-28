import { describe, expect, it } from 'vitest'
import * as protocol from '../../index.js'

function exportedSchema(name: string): {
  safeParse(value: unknown): { success: boolean }
  parse(value: unknown): unknown
} {
  const candidate = (protocol as Record<string, unknown>)[name]
  expect(candidate, `${name} must be exported by @spark/protocol`).toBeDefined()
  return candidate as {
    safeParse(value: unknown): { success: boolean }
    parse(value: unknown): unknown
  }
}

const validSnapshot = {
  id: 'snapshot-01JZ9M5K6DY3F0V4EJKS9A4X2H',
  kind: 'user_context',
  sessionId: 'session-1',
  turnId: null,
  computerSessionId: null,
  app: {
    id: 'com.apple.TextEdit',
    name: 'TextEdit',
    processId: 2048,
  },
  window: {
    id: 'window-12',
    title: 'Untitled',
    bounds: { x: 120, y: 80, width: 960, height: 720 },
  },
  display: {
    id: 'display-main',
    width: 2560,
    height: 1600,
    scaleFactor: 2,
  },
  capturedAt: '2026-07-28T02:10:00.000Z',
  previewUrl: `spark-snapshot://snapshot/snapshot-01JZ9M5K6DY3F0V4EJKS9A4X2H/preview?cap=${'a'.repeat(43)}`,
  accessibleTextMode: 'app_exposed',
  redaction: {
    applied: true,
    reasonCodes: ['secure_text_field'],
    regionCount: 1,
  },
  imageSha256: 'a'.repeat(64),
} as const

describe('application snapshot contract', () => {
  it('exports a strict schema for a user-context application snapshot', () => {
    const schema = exportedSchema('ApplicationSnapshotRefSchema')

    expect(schema.parse(validSnapshot)).toEqual(validSnapshot)
    expect(schema.safeParse({ ...validSnapshot, rawFilePath: '/tmp/window.png' }).success).toBe(
      false,
    )
  })

  it('only accepts authenticated snapshot preview URLs and bounded window geometry', () => {
    const schema = exportedSchema('ApplicationSnapshotRefSchema')

    expect(
      schema.safeParse({ ...validSnapshot, previewUrl: 'file:///tmp/window.png' }).success,
    ).toBe(false)
    expect(
      schema.safeParse({
        ...validSnapshot,
        previewUrl: 'spark-snapshot://snapshot/snapshot-01JZ9M5K6DY3F0V4EJKS9A4X2H/preview',
      }).success,
    ).toBe(false)
    expect(
      schema.safeParse({
        ...validSnapshot,
        window: { ...validSnapshot.window, bounds: { x: 0, y: 0, width: 0, height: 720 } },
      }).success,
    ).toBe(false)
  })

  it('requires explicit redaction results even when no sensitive content was found', () => {
    const schema = exportedSchema('ApplicationSnapshotRefSchema')
    const { redaction: _redaction, ...withoutRedaction } = validSnapshot

    expect(schema.safeParse(withoutRedaction).success).toBe(false)
    expect(
      schema.safeParse({
        ...validSnapshot,
        redaction: { applied: false, reasonCodes: [], regionCount: 0 },
      }).success,
    ).toBe(true)
  })

  it('does not allow turn or computer-session ownership without a parent session', () => {
    const schema = exportedSchema('ApplicationSnapshotRefSchema')

    expect(
      schema.safeParse({
        ...validSnapshot,
        sessionId: null,
        turnId: 'turn-1',
      }).success,
    ).toBe(false)
    expect(
      schema.safeParse({
        ...validSnapshot,
        sessionId: null,
        computerSessionId: 'computer-session-1',
      }).success,
    ).toBe(false)
  })
})
