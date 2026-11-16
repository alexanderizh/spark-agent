import { describe, expect, it, vi } from 'vitest'
import type { SessionGetQueueResponse } from '@spark/protocol'
import { MobileBridgeService, type MobileBridgeDeps } from './MobileBridgeService.js'

describe('MobileBridgeService 会话队列端点', () => {
  it('GET /v1/sessions/:id/queue returns the authoritative queue snapshot', async () => {
    const sessionId = 'session 1' as SessionGetQueueResponse['sessionId']
    const snapshot: SessionGetQueueResponse = {
      sessionId,
      running: true,
      queuedTurns: [
        {
          turnId: 'turn-queued',
          message: 'follow-up',
          enqueuedAt: '2026-11-16T00:00:00.000Z',
        },
      ],
    }
    const getSessionQueue = vi.fn(async () => snapshot)
    const service = new MobileBridgeService()
    service.setDeps({ getSessionQueue } as unknown as MobileBridgeDeps)

    const result = await service.invokeRelay('GET', '/v1/sessions/session%201/queue', undefined)

    expect(result.status).toBe(200)
    expect(result.body).toEqual(snapshot)
    expect(getSessionQueue).toHaveBeenCalledWith(sessionId)
  })
})
