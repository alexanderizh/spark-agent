import type { ComputerSession } from '@spark/protocol'
import { describe, expect, it, vi } from 'vitest'
import { ComputerControlTrayService } from './ComputerControlTrayService.js'

const SESSION = {
  id: 'computer-1',
  sessionId: 'session-1',
  turnId: 'turn-1',
  workflowRunId: null,
  environment: 'my_desktop',
  status: 'acting',
  providerProfileId: 'provider-1',
  modelId: 'model-1',
  actuatorLeaseId: 'lease-1',
  createdAt: '2026-07-31T00:00:00.000Z',
  updatedAt: '2026-07-31T00:00:00.000Z',
  taskContract: {
    objective: 'Edit the document',
    successCriteria: [],
    allowedApps: [{ kind: 'app_id', value: 'com.apple.TextEdit' }],
    allowedDomains: [],
    allowedDataClasses: ['public'],
    forbiddenActions: [],
    maxSteps: 10,
    maxRuntimeMs: 60_000,
    maxConsecutiveNoops: 3,
    userPresence: 'required',
  },
} satisfies ComputerSession

describe('ComputerControlTrayService', () => {
  it('projects active sessions without exposing objective or input content', () => {
    const service = new ComputerControlTrayService(
      {
        listActiveSessionIds: () => [SESSION.id],
        getSession: () => SESSION,
      },
      { pause: vi.fn(), stop: vi.fn() },
    )

    expect(service.list()).toEqual([
      {
        computerSessionId: SESSION.id,
        label: '所有应用',
        status: 'acting',
        canPause: true,
      },
    ])
    expect(JSON.stringify(service.list())).not.toContain(SESSION.taskContract.objective)
  })

  it('routes pause, takeover, and stop through the governed broker', async () => {
    const pause = vi.fn()
    const stop = vi.fn()
    const service = new ComputerControlTrayService(
      { listActiveSessionIds: () => [], getSession: () => null },
      { pause, stop },
    )

    await service.pause(SESSION.id)
    await service.takeover(SESSION.id)
    await service.stop(SESSION.id)

    expect(pause).toHaveBeenNthCalledWith(1, SESSION.id)
    expect(pause).toHaveBeenNthCalledWith(2, SESSION.id)
    expect(stop).toHaveBeenCalledWith(SESSION.id)
  })
})
