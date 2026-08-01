import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createComputerUseMcpProvider,
  disposeComputerUseMcpProvider,
} from './ComputerUseMcpProvider.js'

afterEach(async () => {
  await disposeComputerUseMcpProvider()
})

describe('createComputerUseMcpProvider', () => {
  it('mounts spark_computer over authenticated loopback HTTP without ELECTRON_RUN_AS_NODE', async () => {
    const controller = {
      promptCapabilities: vi.fn(async () => ({
        platform: 'windows' as const,
        available: true,
        executionAvailable: true,
      })),
      invoke: vi.fn(async () => ({})),
      bindSessionContext: vi.fn(),
      stopOwnedSessions: vi.fn(async () => undefined),
    }
    const revokeSnapshotSession = vi.fn()
    const provider = createComputerUseMcpProvider({
      controller: controller as never,
      revokeSnapshotSession,
    })

    const config = await provider('session-1', '/workspace', {
      turnId: 'turn-1',
      providerProfileId: 'provider-1',
      modelId: 'vision-model',
      permissionMode: 'claude-ask',
    })

    expect(config?.server).toMatchObject({
      type: 'http',
      url: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/),
      headers: { authorization: expect.stringMatching(/^Bearer [A-Za-z0-9_-]{40,}$/) },
    })
    expect(config?.server).not.toHaveProperty('command')
    expect(config?.server).not.toHaveProperty('env')
    expect(config?.allowedTools).toContain('mcp__spark_computer__get_capabilities')
    expect(config?.allowedTools).toContain('mcp__spark_computer__diagnose_native_host')
    expect(config?.allowedTools).toContain('mcp__spark_computer__stop')
    expect(config?.allowedTools).toContain('mcp__spark_computer__start_task')
    expect(config?.allowedTools).toContain('mcp__spark_computer__wait_for_completion')
    expect(config?.allowedTools).toContain('mcp__spark_computer__resume')
    expect(config?.allowedTools).toContain('mcp__spark_computer__bind_target')

    const headers = {
      ...(config?.server.type === 'http' ? config.server.headers : {}),
      'content-type': 'application/json',
    }
    const serverUrl = config?.server.type === 'http' ? (config.server.url ?? '') : ''
    const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping', params: {} })
    await expect(
      fetch(serverUrl, {
        method: 'POST',
        headers,
        body,
      }),
    ).resolves.toMatchObject({ status: 200 })
    provider.revokeSession?.('session-1')
    expect(revokeSnapshotSession).toHaveBeenCalledWith('session-1')
    expect(controller.stopOwnedSessions).toHaveBeenCalledWith('session-1')
    await expect(
      fetch(serverUrl, {
        method: 'POST',
        headers,
        body,
      }),
    ).resolves.toMatchObject({ status: 401 })
  })

  it.each(['claude-bypass', 'codex-full-access'] as const)(
    'treats %s as true full access without start or resume approval',
    async (permissionMode) => {
      const controller = {
        promptCapabilities: vi.fn(async () => ({
          platform: 'macos' as const,
          available: true,
          executionAvailable: true,
        })),
        invoke: vi.fn(async () => ({})),
        bindSessionContext: vi.fn(),
        stopOwnedSessions: vi.fn(async () => undefined),
      }
      const provider = createComputerUseMcpProvider({ controller: controller as never })

      const config = await provider('session-full', '/workspace', {
        turnId: 'turn-full',
        providerProfileId: 'provider-1',
        modelId: 'vision-model',
        permissionMode,
      })

      expect(config?.allowedTools).toEqual(
        expect.arrayContaining(['mcp__spark_computer__start_task', 'mcp__spark_computer__resume']),
      )
      expect(controller.bindSessionContext).toHaveBeenCalledWith(
        'session-full',
        expect.objectContaining({ permissionMode }),
      )
    },
  )
})
