import { beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({
  handlers: new Map<string, (request: unknown) => Promise<unknown>>(),
}))

vi.mock('./typed-ipc.js', () => ({
  typedIpcHandle: (channel: string, handler: (request: unknown) => Promise<unknown>) =>
    harness.handlers.set(channel, handler),
}))

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/spark-user-data' } }))

import { registerVideoWorkbenchCapabilityIpc } from './registerVideoWorkbenchCapabilityIpc'

describe('registerVideoWorkbenchCapabilityIpc', () => {
  beforeEach(() => harness.handlers.clear())

  it('registers the capability query and returns the service snapshot', async () => {
    const snapshot = {
      available: true,
      source: 'managed' as const,
      version: '8.1.1',
      filters: {},
      encoders: {},
      checkedAt: '2026-08-25T00:00:00.000Z',
    }
    const getCapabilities = vi.fn(async () => snapshot)
    registerVideoWorkbenchCapabilityIpc({ capabilityService: { getCapabilities } as never })

    expect([...harness.handlers.keys()]).toEqual(['video-workbench:get-ffmpeg-capabilities'])
    await expect(
      harness.handlers.get('video-workbench:get-ffmpeg-capabilities')!({}),
    ).resolves.toBe(snapshot)
    expect(getCapabilities).toHaveBeenCalledTimes(1)
  })
})
