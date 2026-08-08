import { request as httpRequest } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { createBasicCustomMediaManifest } from '@spark/protocol'
import {
  PlatformBridgeService,
  type PlatformBridgeDeps,
} from '../../../services/platform-bridge.service.js'

describe('custom media Platform bridge', () => {
  const services: PlatformBridgeService[] = []

  afterEach(async () => {
    await Promise.all(services.splice(0).map((service) => service.stop()))
  })

  it('routes guide and read-only validation without requiring database startup', async () => {
    const service = new PlatformBridgeService()
    services.push(service)
    const port = await service.start({
      providerRepo: { listAll: () => [] },
    } as unknown as PlatformBridgeDeps)

    const guide = await callRpc(port, 'providers.media_guide', {
      modelId: 'bridge-image-model',
      domain: 'image',
      mode: 'sync',
    })
    expect(guide.ok).toBe(true)
    expect(guide.data).toMatchObject({
      starterManifest: { modelId: 'bridge-image-model', adapterMode: 'template' },
    })

    const manifest = {
      ...createBasicCustomMediaManifest({
        modelId: 'bridge-image-model',
        modelType: 'image',
        mode: 'sync',
      }),
      contractVersion: 2 as const,
      adapterMode: 'template' as const,
      docs: { sourceUrls: ['https://media.example/docs/images'] },
    }
    const validation = await callRpc(port, 'providers.media_validate', {
      name: 'Bridge 媒体渠道',
      apiEndpoint: 'https://media.example/v1',
      defaultModel: 'bridge-image-model',
      models: [{ modelId: 'bridge-image-model', manifest }],
    })

    expect(validation.ok).toBe(true)
    expect(validation.data).toMatchObject({ valid: true })
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
    req.end(body)
  })
}
