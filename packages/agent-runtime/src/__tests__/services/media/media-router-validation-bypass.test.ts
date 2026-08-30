import { describe, expect, it, vi } from 'vitest'
import type { MediaModelManifest } from '@spark/protocol'
import type {
  MediaGenerateInput,
  MediaProviderAdapter,
  MediaProviderContext,
} from '../../../services/media/media-adapter.types.js'
import {
  MediaRouterService,
  type MediaProviderProfile,
} from '../../../services/media/media-router.service.js'

const manifest: MediaModelManifest = {
  id: 'wan:warning-test',
  providerKind: 'wan',
  modelId: 'warning-test',
  displayName: 'Warning test',
  domains: ['image'],
  capabilities: [
    {
      id: 'image.edit',
      label: 'Edit',
      input: { required: ['prompt', 'image'], maxImages: 1 },
      output: { types: ['image'] },
      paramSchema: { type: 'object', properties: {} },
    },
  ],
  invocation: {
    mode: 'sync',
    endpoint: '/edit',
    method: 'POST',
    contentType: 'json',
    requestTemplate: {},
    response: { kind: 'url', jsonPaths: ['data.url'], download: true },
  },
  docs: { sourceUrls: [] },
}

describe('MediaRouterService validation bypass', () => {
  it('lets an explicitly confirmed canvas request reach the provider adapter', async () => {
    const invoke = vi.fn(async (_input: MediaGenerateInput, _context: MediaProviderContext) => ({
      provider: 'wan',
      model: 'warning-test',
      mode: 'sync' as const,
      assets: [],
    }))
    const adapter: MediaProviderAdapter = {
      id: 'wan',
      supports: () => true,
      invoke,
    }
    const provider: MediaProviderProfile = {
      id: 'custom-provider',
      name: 'Custom provider',
      apiKey: 'key',
      defaultModel: 'warning-test',
      mediaProvider: 'wan',
      mediaModelManifests: [manifest],
    }
    const router = new MediaRouterService()
    router.register(adapter)
    const input: MediaGenerateInput = {
      operation: 'image_edit',
      capability: 'image.edit',
      prompt: 'blend',
      inputFiles: [
        { type: 'image', url: 'https://example.com/a.png' },
        { type: 'image', url: 'https://example.com/b.png' },
      ],
      outputDir: '/tmp',
    }

    await expect(
      router.invoke(input, {
        providers: [provider],
        providerProfileId: provider.id,
      }),
    ).rejects.toMatchObject({ code: 'invalid_input' })

    await expect(
      router.invoke(input, {
        providers: [provider],
        providerProfileId: provider.id,
        skipValidation: true,
      }),
    ).resolves.toMatchObject({ providerProfileId: provider.id })
    expect(invoke).toHaveBeenCalledTimes(1)
    expect(invoke).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ skipParameterValidation: true }),
    )
  })

  it('does not let the manifest adapter re-block a user-confirmed parameter warning', async () => {
    const templateManifest: MediaModelManifest = {
      ...manifest,
      id: 'custom:warning-test',
      providerKind: 'custom',
      capabilities: [
        {
          id: 'image.edit',
          label: 'Edit',
          input: { required: ['prompt'] },
          output: { types: ['image'] },
          paramSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              strength: { type: 'number', maximum: 1 },
            },
          },
        },
      ],
      invocation: {
        ...manifest.invocation,
        requestTemplate: {
          model: '{{modelId}}',
          prompt: '{{prompt}}',
          strength: '{{providerParams.strength}}',
        },
        response: { kind: 'url', jsonPaths: ['data.url'], download: false },
      },
    }
    const provider: MediaProviderProfile = {
      id: 'template-provider',
      name: 'Template provider',
      apiKey: 'key',
      apiEndpoint: 'https://provider.example/v1',
      defaultModel: 'warning-test',
      mediaProvider: 'custom',
      mediaModelManifests: [templateManifest],
    }
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        new Response(JSON.stringify({ data: { url: 'https://cdn.example/result.png' } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    )
    const router = new MediaRouterService()
    const input: MediaGenerateInput = {
      operation: 'image_edit',
      capability: 'image.edit',
      prompt: 'blend',
      modelParams: { strength: 2 },
      outputDir: '/tmp',
    }

    await expect(
      router.invoke(input, {
        providers: [provider],
        providerProfileId: provider.id,
        skipValidation: true,
        fetch: fetchMock as unknown as typeof fetch,
      }),
    ).resolves.toMatchObject({ providerProfileId: provider.id })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined
    expect(JSON.parse(String(requestInit?.body))).toMatchObject({ strength: 2 })
  })
})
