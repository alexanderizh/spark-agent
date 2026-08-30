import { describe, expect, it, vi } from 'vitest'
import { CodexRuntimeMcpResourceCoordinator } from '../../../services/session/codex-runtime-mcp-resources.js'
import type { CodexRuntimeResource, SDKMcpServerConfig } from '../../../sdk/types.js'

function resource(id: string): CodexRuntimeResource {
  return { id, dispose: vi.fn(async () => undefined) }
}

describe('CodexRuntimeMcpResourceCoordinator', () => {
  it('collects and deduplicates runtime resources by opaque server identity', () => {
    const coordinator = new CodexRuntimeMcpResourceCoordinator()
    const serverA: SDKMcpServerConfig = { type: 'http', url: 'http://127.0.0.1/a' }
    const serverB: SDKMcpServerConfig = { type: 'http', url: 'http://127.0.0.1/b' }
    const shared = resource('mcp:shared')
    coordinator.register(serverA, shared)
    coordinator.register(serverB, shared)

    expect(coordinator.buildConfig([serverA, serverB, serverA])).toEqual({
      codexRuntimeResources: [shared],
    })
  })

  it('rejects two different resources claiming the same lease identity', () => {
    const coordinator = new CodexRuntimeMcpResourceCoordinator()
    const serverA: SDKMcpServerConfig = { type: 'http', url: 'http://127.0.0.1/a' }
    const serverB: SDKMcpServerConfig = { type: 'http', url: 'http://127.0.0.1/b' }
    coordinator.register(serverA, resource('mcp:conflict'))
    coordinator.register(serverB, resource('mcp:conflict'))

    expect(() => coordinator.buildConfig([serverA, serverB])).toThrow(/Conflicting/)
  })
})
