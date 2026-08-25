import { beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({
  handlers: new Map<string, (request: any) => Promise<any>>(),
  events: [] as Array<{ channel: string; payload: any }>,
}))

vi.mock('./typed-ipc.js', () => ({
  typedIpcHandle: (channel: string, handler: (request: any) => Promise<any>) =>
    harness.handlers.set(channel, handler),
  pushStreamEvent: (channel: string, payload: any) => harness.events.push({ channel, payload }),
}))

vi.mock('electron', () => ({ app: { getPath: () => '/tmp/spark-user-data' } }))

import { registerOptionalCapabilityIpc } from './registerOptionalCapabilityIpc'

const snapshot = {
  capabilities: [],
  checkedAt: '2026-08-02T00:00:00.000Z',
  manifestUpdatedAt: '2026-08-02',
  remoteAvailable: true,
}

describe('registerOptionalCapabilityIpc', () => {
  beforeEach(() => {
    harness.handlers.clear()
    harness.events.length = 0
  })

  it('registers the lifecycle handlers and publishes refreshed snapshots', async () => {
    const manager = {
      list: vi.fn(async () => snapshot),
      check: vi.fn(async () => snapshot),
      install: vi.fn(async () => ({ success: true, message: 'ok', snapshot })),
      update: vi.fn(async () => ({ success: true, message: 'ok', snapshot })),
      repair: vi.fn(async () => ({ success: true, message: 'ok', snapshot })),
      cancel: vi.fn(async () => ({ success: true, message: 'ok', snapshot })),
      uninstall: vi.fn(async () => ({ success: true, message: 'ok', snapshot })),
      setAutoUpdate: vi.fn(async () => snapshot),
    }
    registerOptionalCapabilityIpc({ manager })

    expect([...harness.handlers.keys()].sort()).toEqual([
      'optional-capability:cancel',
      'optional-capability:check',
      'optional-capability:install',
      'optional-capability:list',
      'optional-capability:repair',
      'optional-capability:set-auto-update',
      'optional-capability:uninstall',
      'optional-capability:update',
      'video-workbench:get-ffmpeg-capabilities',
    ])

    await harness.handlers.get('optional-capability:check')!({ forceRemote: true })
    await harness.handlers.get('optional-capability:install')!({ capabilityId: 'office-viewer' })

    expect(manager.check).toHaveBeenCalledWith(true)
    expect(manager.install).toHaveBeenCalledWith('office-viewer')
    expect(harness.events).toEqual([
      { channel: 'stream:optional-capability:snapshot', payload: snapshot },
      { channel: 'stream:optional-capability:snapshot', payload: snapshot },
    ])
  })
})
