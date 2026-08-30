import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { request as httpRequest } from 'node:http'
import type { CustomToolSummary } from '@spark/protocol'
import {
  PlatformBridgeService,
  type PlatformBridgeDeps,
} from '../../services/platform-bridge.service.js'

function summary(id: string): CustomToolSummary {
  return {
    id,
    title: id,
    description: `用于验证 Agent 自定义工具列表边界的测试工具 ${id}`,
    type: 'http',
    risk: 'read',
    effect: 'read',
    idempotency: 'safe',
    timeoutMs: 30_000,
    enabled: false,
    origin: 'local',
    publishedVersion: null,
    draftVersion: 1,
    hasUnpublishedDraft: true,
    secretNames: [],
    lastTestAt: null,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  }
}

describe('PlatformBridgeService custom tool authoring RPC', () => {
  let service: PlatformBridgeService
  let port = 0

  beforeEach(async () => {
    service = new PlatformBridgeService()
    port = await service.start({
      customToolService: {
        list: vi.fn(() => [summary('tool_one'), summary('tool_two'), summary('tool_three')]),
      },
    } as unknown as PlatformBridgeDeps)
  })

  afterEach(async () => {
    await service.stop()
  })

  function callRpc(
    method: string,
    params: Record<string, unknown>,
  ): Promise<{ ok: boolean; data?: unknown; error?: string }> {
    const body = JSON.stringify({ method, params })
    return new Promise((resolve, reject) => {
      const request = httpRequest(
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
        (response) => {
          const chunks: Buffer[] = []
          response.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
          response.on('end', () => {
            try {
              resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
            } catch (error) {
              reject(error)
            }
          })
        },
      )
      request.on('error', reject)
      request.end(body)
    })
  }

  it('bounds list results and reports total/truncated without changing the runtime list', async () => {
    await expect(callRpc('custom_tools.list', { limit: 2 })).resolves.toEqual({
      ok: true,
      data: {
        tools: [summary('tool_one'), summary('tool_two')],
        total: 3,
        truncated: true,
      },
    })
  })

  it('rejects invalid list limits at the bridge boundary', async () => {
    await expect(callRpc('custom_tools.list', { limit: 101 })).resolves.toEqual({
      ok: false,
      error: 'limit must be an integer between 1 and 100',
    })
  })
})
