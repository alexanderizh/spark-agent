import { describe, expect, it, vi } from 'vitest'
import type { SessionGetQueueResponse } from '@spark/protocol'
import { MobileBridgeService, type MobileBridgeDeps } from './MobileBridgeService.js'

describe('MobileBridgeService 会话队列端点', () => {
  const sessionId = 'session 1' as SessionGetQueueResponse['sessionId']

  const queuedTurn = (turnId: string) => ({
    turnId,
    message: `queued ${turnId}`,
    enqueuedAt: '2026-11-25T00:00:00.000Z',
  })

  const snapshotWith = (turnIds: string[]): SessionGetQueueResponse => ({
    sessionId,
    running: true,
    queuedTurns: turnIds.map(queuedTurn),
  })

  it('GET /v1/sessions/:id/queue returns the authoritative queue snapshot', async () => {
    const snapshot = snapshotWith(['turn-queued'])
    const getSessionQueue = vi.fn(async () => snapshot)
    const service = new MobileBridgeService()
    service.setDeps({ getSessionQueue } as unknown as MobileBridgeDeps)

    const result = await service.invokeRelay('GET', '/v1/sessions/session%201/queue', undefined)

    expect(result.status).toBe(200)
    expect(result.body).toEqual(snapshot)
    expect(getSessionQueue).toHaveBeenCalledWith(sessionId)
  })

  it('DELETE /v1/sessions/:id/queue/:turnId cancels one queued turn', async () => {
    const cancelQueuedTurn = vi.fn(async () => ({
      cancelled: true,
      queuedTurns: snapshotWith(['turn-b']).queuedTurns,
    }))
    const service = new MobileBridgeService()
    service.setDeps({ cancelQueuedTurn } as unknown as MobileBridgeDeps)

    const result = await service.invokeRelay(
      'DELETE',
      '/v1/sessions/session%201/queue/turn%2Aa',
      undefined,
    )

    expect(result.status).toBe(200)
    expect(result.body).toEqual({ cancelled: true, queuedTurns: snapshotWith(['turn-b']).queuedTurns })
    expect(cancelQueuedTurn).toHaveBeenCalledWith(sessionId, 'turn*a')
  })

  it('POST /v1/sessions/:id/queue/:turnId/send-now starts a queued turn immediately', async () => {
    const sendQueuedTurnNow = vi.fn(async () => ({
      started: true,
      queuedTurns: snapshotWith(['turn-b']).queuedTurns,
    }))
    const service = new MobileBridgeService()
    service.setDeps({ sendQueuedTurnNow } as unknown as MobileBridgeDeps)

    const result = await service.invokeRelay(
      'POST',
      '/v1/sessions/session%201/queue/turn-a/send-now',
      undefined,
    )

    expect(result.status).toBe(200)
    expect(sendQueuedTurnNow).toHaveBeenCalledWith(sessionId, 'turn-a')
  })

  it('POST /v1/sessions/:id/queue/reorder reorders the queue', async () => {
    const reorderQueuedTurns = vi.fn(async () => ({
      changed: true,
      running: true,
      queuedTurns: snapshotWith(['turn-b', 'turn-a']).queuedTurns,
    }))
    const service = new MobileBridgeService()
    service.setDeps({ reorderQueuedTurns } as unknown as MobileBridgeDeps)

    const result = await service.invokeRelay('POST', '/v1/sessions/session%201/queue/reorder', {
      turnIds: ['turn-b', 'turn-a'],
    })

    expect(result.status).toBe(200)
    expect(reorderQueuedTurns).toHaveBeenCalledWith(sessionId, ['turn-b', 'turn-a'])
  })

  it('POST /v1/sessions/:id/queue/reorder rejects an invalid turnIds payload', async () => {
    const reorderQueuedTurns = vi.fn()
    const service = new MobileBridgeService()
    service.setDeps({ reorderQueuedTurns } as unknown as MobileBridgeDeps)

    const empty = await service.invokeRelay('POST', '/v1/sessions/session%201/queue/reorder', {
      turnIds: [],
    })
    expect(empty.status).toBe(400)
    expect(reorderQueuedTurns).not.toHaveBeenCalled()

    const notStrings = await service.invokeRelay('POST', '/v1/sessions/session%201/queue/reorder', {
      turnIds: ['a', 3],
    })
    expect(notStrings.status).toBe(400)
    expect(reorderQueuedTurns).not.toHaveBeenCalled()
  })

  it('POST /v1/sessions/:id/queue/clear cancels all queued turns', async () => {
    const clearQueuedTurns = vi.fn(async () => ({
      cancelledCount: 2,
      queuedTurns: [],
    }))
    const service = new MobileBridgeService()
    service.setDeps({ clearQueuedTurns } as unknown as MobileBridgeDeps)

    const result = await service.invokeRelay('POST', '/v1/sessions/session%201/queue/clear', undefined)

    expect(result.status).toBe(200)
    expect(result.body).toEqual({ cancelledCount: 2, queuedTurns: [] })
    expect(clearQueuedTurns).toHaveBeenCalledWith(sessionId)
  })
})
