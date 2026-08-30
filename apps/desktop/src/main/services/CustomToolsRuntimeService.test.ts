import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  rows: [] as Array<{ id: string; name: string; scope: string }>,
  deleteById: vi.fn(() => true),
}))

vi.mock('@spark/agent-runtime', () => ({ MANAGED_MCP_SCOPE: 'managed' }))
vi.mock('@spark/storage', () => ({
  McpServerRepository: class {
    findByScope() {
      return mocks.rows
    }

    deleteById = mocks.deleteById
  },
}))

import { CustomToolsRuntimeService } from './CustomToolsRuntimeService.js'

describe('CustomToolsRuntimeService legacy migration', () => {
  beforeEach(() => {
    mocks.rows = []
    mocks.deleteById.mockClear()
  })

  it('stops and removes only the legacy managed custom-tools MCP registration', async () => {
    mocks.rows = [
      { id: 'playwright', name: 'playwright', scope: 'managed' },
      { id: 'legacy-custom-tools', name: 'spark_custom_tools', scope: 'managed' },
    ]
    const mcpService = { stopServer: vi.fn(async () => undefined) }
    const runtime = new CustomToolsRuntimeService({} as never, mcpService as never)

    await runtime.start()

    expect(mcpService.stopServer).toHaveBeenCalledWith('legacy-custom-tools')
    expect(mocks.deleteById).toHaveBeenCalledWith('legacy-custom-tools')
    expect(mocks.deleteById).not.toHaveBeenCalledWith('playwright')
  })

  it('does nothing when an installation never had the legacy registration', async () => {
    const mcpService = { stopServer: vi.fn(async () => undefined) }
    const runtime = new CustomToolsRuntimeService({} as never, mcpService as never)

    await runtime.start()
    await runtime.stop()

    expect(mcpService.stopServer).not.toHaveBeenCalled()
    expect(mocks.deleteById).not.toHaveBeenCalled()
  })
})
