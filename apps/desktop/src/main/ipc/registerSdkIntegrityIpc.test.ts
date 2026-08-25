import type { SdkIntegrityInstallProgress } from '@spark/protocol'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const harness = vi.hoisted(() => ({
  handlers: new Map<string, (request: unknown) => Promise<unknown>>(),
  events: [] as Array<{ channel: string; payload: unknown }>,
}))

vi.mock('./typed-ipc.js', () => ({
  typedIpcHandle: (channel: string, handler: (request: unknown) => Promise<unknown>) =>
    harness.handlers.set(channel, handler),
  pushStreamEvent: (channel: string, payload: unknown) => harness.events.push({ channel, payload }),
}))

import { registerSdkIntegrityIpc } from './registerSdkIntegrityIpc'

const sdkIntegrity = {
  sdks: [],
  tools: [],
  checkedAt: '2026-08-25T00:00:00.000Z',
}

const capabilitySnapshot = {
  capabilities: [],
  checkedAt: '2026-08-25T00:00:00.000Z',
  manifestUpdatedAt: '2026-08-25',
  remoteAvailable: true,
}

describe('registerSdkIntegrityIpc', () => {
  beforeEach(() => {
    harness.handlers.clear()
    harness.events.length = 0
  })

  it('安装 Codex runtime 成功后同时发布 SDK 与可选功能快照', async () => {
    const checkIntegrity = vi.fn(async () => sdkIntegrity)
    const install = vi.fn(
      async (packageName: string, onProgress?: (progress: SdkIntegrityInstallProgress) => void) => {
        onProgress?.({
          packageName,
          state: 'done',
          downloaded: 10,
          total: 10,
          percent: 100,
          message: '安装完成',
        })
        return { success: true, message: '安装完成' }
      },
    )
    const capabilityManager = {
      list: vi.fn(async () => capabilitySnapshot),
    }

    registerSdkIntegrityIpc({ capabilityManager, checkIntegrity, install })

    expect([...harness.handlers.keys()].sort()).toEqual([
      'sdk:integrity-check',
      'sdk:integrity-install',
    ])

    const installHandler = harness.handlers.get('sdk:integrity-install')
    expect(installHandler).toBeDefined()
    if (installHandler == null) throw new Error('sdk:integrity-install handler not registered')
    const response = await installHandler({
      packageName: '@openai/codex-sdk',
    })

    expect(response).toEqual({ success: true, message: '安装完成' })
    expect(checkIntegrity).toHaveBeenCalledWith({ checkLatest: false })
    expect(capabilityManager.list).toHaveBeenCalledOnce()
    expect(harness.events).toEqual([
      {
        channel: 'stream:sdk:install-progress',
        payload: expect.objectContaining({ state: 'done', percent: 100 }),
      },
      { channel: 'stream:sdk:integrity', payload: sdkIntegrity },
      { channel: 'stream:optional-capability:snapshot', payload: capabilitySnapshot },
    ])
  })
})
