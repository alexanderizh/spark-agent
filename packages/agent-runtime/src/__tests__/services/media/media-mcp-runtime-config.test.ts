import { describe, expect, it, vi } from 'vitest'
import type { MediaModelManifest } from '@spark/protocol'

/**
 * spark_media 运行时配置路由：
 * 渠道落库的 apiEndpointFullUrl 必须原样透传到子进程配置，否则「完整 URL」会话侧静默失效。
 */

vi.mock('@spark/storage', () => ({
  ProviderProfileRepository: class {
    private readonly rows: unknown[]
    constructor(_db: unknown) {
      this.rows = runtimeRows
    }
    listAll() {
      return this.rows
    }
  },
  MediaModelManifestRepository: class {
    constructor(_db: unknown) {}
  },
}))

let runtimeRows: unknown[] = []

vi.mock('../../../services/provider-credential-resolver.js', () => ({
  resolveProviderApiKey: vi.fn(async () => 'sk-test'),
}))

vi.mock('../../../services/media/media-model-catalog.service.js', () => ({
  MediaModelCatalogService: class {
    constructor(_repo: unknown) {}
    seedBuiltinManifests() {}
  },
}))

let resolvedManifest: MediaModelManifest | null = null

vi.mock('../../../services/media/media-model-resolver.js', () => ({
  resolveProfileMediaModels: () => (resolvedManifest ? [{ manifest: resolvedManifest }] : []),
}))

const { resolveMediaMcpProviderRoutes } =
  await import('../../../services/media/media-mcp-runtime-config.js')

function manifest(): MediaModelManifest {
  return {
    id: 'custom:full-url-image:channel',
    providerKind: 'custom',
    modelId: 'full-url-image',
    displayName: 'Full URL image',
    contractVersion: 2,
    adapterMode: 'template',
    domains: ['image'],
    capabilities: [
      {
        id: 'image.generate',
        label: 'Generate image',
        input: { required: ['prompt'] },
        output: { types: ['image'] },
        paramSchema: { type: 'object', properties: {} },
      },
    ],
    invocation: {
      mode: 'sync',
      endpoint: '/images',
      method: 'POST',
      contentType: 'json',
      requestTemplate: {},
      response: { kind: 'inline_base64', jsonPaths: ['data[].b64_json'] },
    },
    docs: { sourceUrls: [] },
  } as MediaModelManifest
}

function providerRow(config: Record<string, unknown>) {
  return {
    id: 'provider-1',
    name: 'Full URL Provider',
    enabled: 1,
    keystore_ref: 'keystore-ref',
    config_json: JSON.stringify({
      defaultModel: 'full-url-image',
      modelType: 'image',
      mediaProvider: 'custom',
      mediaApiType: 'sync',
      apiEndpoint: 'https://provider.example/full/generate',
      mediaCapabilities: ['image.generate'],
      ...config,
    }),
  }
}

describe('resolveMediaMcpProviderRoutes — 渠道「完整 URL」透传', () => {
  it('把 apiEndpointFullUrl 透传到子进程运行时路由', async () => {
    resolvedManifest = manifest()
    runtimeRows = [providerRow({ apiEndpointFullUrl: true })]

    const routes = await resolveMediaMcpProviderRoutes({} as never)

    expect(routes).toHaveLength(1)
    expect(routes[0]).toMatchObject({
      id: 'provider-1',
      baseUrl: 'https://provider.example/full/generate',
      apiEndpointFullUrl: true,
    })
  })

  it('未开启开关时不写入该字段（子进程按既有拼接逻辑处理）', async () => {
    resolvedManifest = manifest()
    runtimeRows = [providerRow({})]

    const routes = await resolveMediaMcpProviderRoutes({} as never)

    expect(routes).toHaveLength(1)
    expect(routes[0]?.apiEndpointFullUrl).toBeUndefined()
  })
})
