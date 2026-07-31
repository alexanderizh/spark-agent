import { describe, expect, it } from 'vitest'
import * as protocol from '../../index.js'

interface RuntimeSchema {
  safeParse(value: unknown): { success: boolean }
  parse(value: unknown): unknown
}

type SchemaRegistry = Record<string, RuntimeSchema>

function exportedRegistry(name: string): SchemaRegistry {
  const candidate = (protocol as Record<string, unknown>)[name]
  expect(candidate, `${name} must be exported by @spark/protocol`).toBeDefined()
  return candidate as SchemaRegistry
}

const taskContract = {
  objective: 'Save the document',
  successCriteria: [
    {
      kind: 'file',
      pathPolicyRef: 'workspace-output',
      assertion: { operator: 'exists', expected: true },
    },
  ],
  allowedApps: [{ kind: 'app_id', value: 'com.apple.TextEdit' }],
  allowedDomains: [],
  allowedDataClasses: ['internal'],
  forbiddenActions: [],
  maxSteps: 40,
  maxRuntimeMs: 300_000,
  maxConsecutiveNoops: 3,
  userPresence: 'required',
} as const

describe('computer use IPC schemas', () => {
  it('requires a fully governed task contract when starting a computer session', () => {
    const registry = exportedRegistry('ComputerUseIpcSchemaRegistry')
    const request = {
      sessionId: 'session-1',
      turnId: 'turn-1',
      workflowRunId: null,
      environment: 'my_desktop',
      providerProfileId: 'provider-1',
      modelId: 'gpt-computer',
      taskContract,
      targetWindowId: 'window-1',
    }

    expect(registry['computer-use:start']?.parse(request)).toEqual(request)
    const { taskContract: _contract, ...withoutContract } = request
    expect(registry['computer-use:start']?.safeParse(withoutContract).success).toBe(false)
  })

  it('exposes only the reviewed computer-use channels', () => {
    const registry = exportedRegistry('ComputerUseIpcSchemaRegistry')

    expect(Object.keys(registry).sort()).toEqual(
      [
        'computer-use:approve-action',
        'computer-use:bind-target',
        'computer-use:diagnose-native-host',
        'computer-use:deny-action',
        'computer-use:get-capabilities',
        'computer-use:get-settings',
        'computer-use:get-status',
        'computer-use:get-timeline',
        'computer-use:get-verification',
        'computer-use:list-apps',
        'computer-use:list-sessions',
        'computer-use:list-windows',
        'computer-use:pause',
        'computer-use:resume',
        'computer-use:resolve-app-command',
        'computer-use:start',
        'computer-use:stop',
        'computer-use:takeover',
        'computer-use:update-settings',
      ].sort(),
    )
  })

  it('registers computer-use and app-snapshot validation in the global IPC registry', () => {
    const registry = exportedRegistry('IpcSchemaRegistry')

    expect(registry['computer-use:start']).toBeDefined()
    expect(registry['computer-use:approve-action']).toBeDefined()
    expect(registry['app-snapshot:capture-frontmost']).toBeDefined()
    expect(registry['app-snapshot:delete']).toBeDefined()
  })

  it('binds approvals to the displayed action and target digests', () => {
    const registry = exportedRegistry('ComputerUseIpcSchemaRegistry')
    const request = {
      computerSessionId: 'computer-session-1',
      approvalId: 'approval-1',
      actionDigest: 'a'.repeat(64),
      targetDigest: 'b'.repeat(64),
      dataClassDigest: null,
    }

    expect(registry['computer-use:approve-action']?.safeParse(request).success).toBe(true)
    expect(
      registry['computer-use:approve-action']?.safeParse({ ...request, targetDigest: undefined })
        .success,
    ).toBe(false)
  })
})

describe('application snapshot IPC schemas', () => {
  it('captures only the frontmost app and never accepts PID, path or arbitrary region input', () => {
    const registry = exportedRegistry('ApplicationSnapshotIpcSchemaRegistry')
    const request = {
      sessionId: 'session-1',
      turnId: null,
      accessibleTextMode: 'visible_only',
    }

    expect(registry['app-snapshot:capture-frontmost']?.parse(request)).toEqual(request)
    expect(
      registry['app-snapshot:capture-frontmost']?.safeParse({
        ...request,
        processId: 2048,
      }).success,
    ).toBe(false)
    expect(
      registry['app-snapshot:capture-frontmost']?.safeParse({
        ...request,
        outputPath: '/tmp/window.png',
      }).success,
    ).toBe(false)
    expect(
      registry['app-snapshot:capture-frontmost']?.safeParse({
        ...request,
        sessionId: null,
        turnId: 'turn-1',
      }).success,
    ).toBe(false)
  })

  it('requires a finite expiry for TTL retention and rejects it for session retention', () => {
    const registry = exportedRegistry('ApplicationSnapshotIpcSchemaRegistry')
    const schema = registry['app-snapshot:update-retention']

    expect(
      schema?.safeParse({
        id: 'snapshot-1',
        retention: { mode: 'ttl', expiresAt: '2026-08-28T00:00:00.000Z' },
      }).success,
    ).toBe(true)
    expect(
      schema?.safeParse({ id: 'snapshot-1', retention: { mode: 'ttl', expiresAt: null } }).success,
    ).toBe(false)
    expect(
      schema?.safeParse({
        id: 'snapshot-1',
        retention: { mode: 'session', expiresAt: '2026-08-28T00:00:00.000Z' },
      }).success,
    ).toBe(false)
  })
})
