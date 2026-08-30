import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CustomToolRecord } from '@spark/protocol'
import { CustomToolsBridgeService } from '../../services/custom-tools/custom-tools-bridge.service.js'
import type { CustomToolService } from '../../services/custom-tools/custom-tool.service.js'

function makeRecord(type: 'http' | 'provider-vision'): CustomToolRecord {
  const now = new Date().toISOString()
  const common = {
    id: type === 'http' ? 'weather_lookup' : 'vision_fallback',
    title: type === 'http' ? '天气查询' : '图像理解',
    description: 'bridge behavior-lock fixture',
    inputSchema: { type: 'object' as const, properties: {} },
    risk: 'read' as const,
    effect: 'read' as const,
    idempotency: 'safe' as const,
    timeoutMs: 3_000,
    enabled: true,
    origin: 'local' as const,
    lastTestAt: null,
    createdAt: now,
    updatedAt: now,
  }
  if (type === 'http') {
    return {
      ...common,
      type,
      spec: {
        request: { method: 'GET', urlTemplate: 'https://example.com/weather' },
        response: { format: 'json' },
      },
    }
  }
  return {
    ...common,
    type,
    spec: {
      providerProfileId: 'vision-provider',
      instructions: 'Describe the image.',
      maxImages: 4,
      maxTokens: 1_024,
      autoRoute: { enabled: true, priority: 100 },
      exposeToAgent: false,
    },
  }
}

describe('CustomToolsBridgeService', () => {
  let bridge: CustomToolsBridgeService | null = null

  afterEach(async () => {
    await bridge?.stop()
    bridge = null
  })

  function createFixture() {
    const records = [makeRecord('http'), makeRecord('provider-vision')]
    const executeEnabled = vi.fn(async () => ({
      text: 'sunny',
      meta: { durationMs: 2, bytes: 5, truncated: false },
    }))
    const service = {
      listEnabledRecords: () => records,
      executeEnabled,
    } as unknown as CustomToolService
    const currentBridge = new CustomToolsBridgeService(service)
    bridge = currentBridge
    return { bridge: currentBridge, executeEnabled }
  }

  async function rpc(
    port: number,
    token: string | null,
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<Response> {
    return fetch(`http://127.0.0.1:${port}/rpc`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token != null ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ method, params }),
    })
  }

  it('rejects requests without the loopback bearer token', async () => {
    const { bridge: currentBridge } = createFixture()
    const info = await currentBridge.start()

    const response = await rpc(info.port, null, 'customTools.list')

    expect(response.status).toBe(401)
  })

  it('lists and invokes HTTP tools while hiding provider vision tools', async () => {
    const { bridge: currentBridge, executeEnabled } = createFixture()
    const info = await currentBridge.start()

    const listResponse = await rpc(info.port, info.token, 'customTools.list')
    const listPayload = await listResponse.json()
    expect(listPayload).toMatchObject({
      ok: true,
      data: { tools: [{ name: 'weather_lookup', title: '天气查询' }] },
    })
    expect(JSON.stringify(listPayload)).not.toContain('vision_fallback')

    const callResponse = await rpc(info.port, info.token, 'customTools.call', {
      toolId: 'weather_lookup',
      input: { city: 'Shanghai' },
      sessionId: 'session-1',
    })
    expect(callResponse.status).toBe(200)
    expect(await callResponse.json()).toMatchObject({ ok: true, data: { text: 'sunny' } })
    expect(executeEnabled).toHaveBeenCalledWith({
      toolId: 'weather_lookup',
      input: { city: 'Shanghai' },
      sessionId: 'session-1',
    })

    const visionResponse = await rpc(info.port, info.token, 'customTools.call', {
      toolId: 'vision_fallback',
      input: { images: ['/tmp/private.png'] },
    })
    expect(visionResponse.status).toBe(400)
    expect(await visionResponse.json()).toMatchObject({ ok: false })
    expect(executeEnabled).toHaveBeenCalledTimes(1)
  })
})
