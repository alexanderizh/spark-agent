import { request as httpRequest } from 'node:http'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  PlatformBridgeService,
  type PlatformBridgeDeps,
} from '../../services/platform-bridge.service.js'

describe('PlatformBridgeService current-session scheduled tasks', () => {
  const service = new PlatformBridgeService()

  afterEach(async () => {
    await service.stop()
  })

  it('routes CRUD through the current-session facade and strips routing fields', async () => {
    const task = { id: 'schedule-1', scope: 'session', sessionId: 'session-1' }
    const sessionScheduleTools = {
      list: vi.fn(() => [task]),
      get: vi.fn(() => task),
      create: vi.fn(() => task),
      update: vi.fn(() => task),
      delete: vi.fn(() => ({ success: true as const })),
    }
    const port = await service.start({ sessionScheduleTools } as unknown as PlatformBridgeDeps)

    await expect(
      callRpc(port, 'session_schedule.list', { sessionId: 'session-1' }),
    ).resolves.toMatchObject({ ok: true, data: { tasks: [task] } })
    await expect(
      callRpc(port, 'session_schedule.get', {
        sessionId: 'session-1',
        id: 'schedule-1',
      }),
    ).resolves.toMatchObject({ ok: true, data: { task } })
    await expect(
      callRpc(port, 'session_schedule.create', {
        sessionId: 'session-1',
        name: 'Poll result',
        triggerType: 'interval',
        intervalSeconds: 60,
        promptTemplate: 'Check progress.',
      }),
    ).resolves.toMatchObject({ ok: true, data: { task } })
    await expect(
      callRpc(port, 'session_schedule.update', {
        sessionId: 'session-1',
        id: 'schedule-1',
        enabled: false,
      }),
    ).resolves.toMatchObject({ ok: true, data: { task } })
    await expect(
      callRpc(port, 'session_schedule.delete', {
        sessionId: 'session-1',
        id: 'schedule-1',
      }),
    ).resolves.toMatchObject({ ok: true, data: { success: true } })

    expect(sessionScheduleTools.list).toHaveBeenCalledWith('session-1')
    expect(sessionScheduleTools.get).toHaveBeenCalledWith('session-1', 'schedule-1')
    expect(sessionScheduleTools.create).toHaveBeenCalledWith('session-1', {
      name: 'Poll result',
      triggerType: 'interval',
      intervalSeconds: 60,
      promptTemplate: 'Check progress.',
    })
    expect(sessionScheduleTools.update).toHaveBeenCalledWith('session-1', 'schedule-1', {
      enabled: false,
    })
    expect(sessionScheduleTools.delete).toHaveBeenCalledWith('session-1', 'schedule-1')
  })
})

function callRpc(
  port: number,
  method: string,
  params: Record<string, unknown>,
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  const body = JSON.stringify({ method, params })
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port,
        path: '/rpc',
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
        },
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
        res.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
          } catch (error) {
            reject(error)
          }
        })
      },
    )
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}
