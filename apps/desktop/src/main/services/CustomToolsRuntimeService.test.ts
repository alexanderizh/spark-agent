import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CustomToolRecord } from '@spark/protocol'

const mocks = vi.hoisted(() => ({
  rows: [] as Array<{
    id: string
    name: string
    scope: string
    config_json: string
    enabled: number
  }>,
  changeListener: null as (() => void) | null,
  bridgeStart: vi.fn(async () => ({ port: 43123, token: 'bridge-token' })),
  bridgeStop: vi.fn(async () => undefined),
}))

vi.mock('@spark/agent-runtime', () => ({
  MANAGED_MCP_SCOPE: 'managed',
  resolveRuntimeToolPath: () => '/runtime/custom-tools-mcp-server.mjs',
  CustomToolsBridgeService: class {
    start = mocks.bridgeStart
    stop = mocks.bridgeStop
  },
}))

vi.mock('@spark/storage', () => ({
  McpServerRepository: class {
    findByScope() {
      return mocks.rows
    }
  },
}))

vi.mock('./StandaloneNodeRuntime.js', () => ({
  resolveStandaloneNodeRuntimePath: () => '/runtime/node',
}))

import { CustomToolsRuntimeService } from './CustomToolsRuntimeService.js'

const EXPECTED_CONFIG = JSON.stringify({
  type: 'stdio',
  command: '/runtime/node',
  args: ['/runtime/custom-tools-mcp-server.mjs'],
  env: {
    SPARK_CUSTOM_TOOLS_BRIDGE_PORT: '43123',
    SPARK_CUSTOM_TOOLS_BRIDGE_TOKEN: 'bridge-token',
  },
})

function httpRecord(): CustomToolRecord {
  const now = new Date().toISOString()
  return {
    id: 'http_tool',
    title: 'HTTP tool',
    description: 'fixture',
    type: 'http',
    inputSchema: { type: 'object', properties: {} },
    risk: 'read',
    effect: 'read',
    idempotency: 'safe',
    timeoutMs: 3_000,
    spec: {
      request: { method: 'GET', urlTemplate: 'https://example.com' },
      response: { format: 'json' },
    },
    enabled: true,
    origin: 'local',
    lastTestAt: null,
    createdAt: now,
    updatedAt: now,
  }
}

describe('CustomToolsRuntimeService', () => {
  beforeEach(() => {
    mocks.rows = [
      {
        id: 'managed-custom-tools',
        name: 'spark_custom_tools',
        scope: 'managed',
        config_json: EXPECTED_CONFIG,
        enabled: 1,
      },
    ]
    mocks.changeListener = null
    mocks.bridgeStart.mockClear()
    mocks.bridgeStop.mockClear()
  })

  function createFixture() {
    const customTools = {
      listEnabledRecords: () => [httpRecord()],
      onChange: (listener: () => void) => {
        mocks.changeListener = listener
        return () => {
          mocks.changeListener = null
        }
      },
    }
    const mcpService = {
      createServer: vi.fn(),
      updateServer: vi.fn(() => ({ id: 'managed-custom-tools' })),
      startServer: vi.fn(async (): Promise<void> => undefined),
      stopServer: vi.fn(async (): Promise<void> => undefined),
    }
    const runtime = new CustomToolsRuntimeService(
      {} as never,
      customTools as never,
      mcpService as never,
    )
    return { runtime, mcpService }
  }

  it('starts an unchanged managed registration through its owned lifecycle', async () => {
    const { runtime, mcpService } = createFixture()

    await runtime.start()

    expect(mcpService.updateServer).not.toHaveBeenCalled()
    expect(mcpService.startServer).toHaveBeenCalledWith('managed-custom-tools')
    await runtime.stop()
  })

  it('keeps hot-reload subscribed after a transient initial MCP start failure', async () => {
    const { runtime, mcpService } = createFixture()
    mcpService.startServer.mockRejectedValueOnce(new Error('stdio start failed'))

    await expect(runtime.start()).rejects.toThrow(/stdio start failed/)
    expect(mocks.changeListener).not.toBeNull()

    mcpService.startServer.mockResolvedValue(undefined)
    mocks.changeListener?.()
    await vi.waitFor(() => expect(mcpService.updateServer).toHaveBeenCalledTimes(1))
    await vi.waitFor(() => expect(mcpService.startServer).toHaveBeenCalledTimes(2))
    await runtime.stop()
  })

  it('serializes and coalesces rapid hot-refresh requests', async () => {
    const { runtime, mcpService } = createFixture()
    await runtime.start()
    mcpService.startServer.mockClear()

    const stopResolvers: Array<() => void> = []
    mcpService.stopServer.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          stopResolvers.push(resolve)
        }),
    )

    mocks.changeListener?.()
    await vi.waitFor(() => expect(stopResolvers).toHaveLength(1))

    mocks.changeListener?.()
    mocks.changeListener?.()
    expect(stopResolvers).toHaveLength(1)

    stopResolvers[0]?.()
    await vi.waitFor(() => expect(stopResolvers).toHaveLength(2))
    expect(mcpService.updateServer).toHaveBeenCalledTimes(1)

    stopResolvers[1]?.()
    await vi.waitFor(() => expect(mcpService.updateServer).toHaveBeenCalledTimes(2))
    expect(mcpService.startServer).toHaveBeenCalledTimes(2)
    expect(mcpService.updateServer).toHaveBeenNthCalledWith(
      1,
      'managed-custom-tools',
      {},
      { manageLifecycle: false },
    )

    mcpService.stopServer.mockResolvedValue(undefined)
    await runtime.stop()
  })
})
