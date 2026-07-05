import { describe, expect, it } from 'vitest'
import {
  DialogOpenFileRequestSchema,
  IpcSchemaRegistry,
  ProviderCreateRequestSchema,
  SessionCreateRequestSchema,
  SessionSendTurnRequestSchema,
  SessionUpdateRequestSchema,
  SessionSetGoalRequestSchema,
  SessionGoalControlRequestSchema,
} from '../schemas/index.js'
import { BUILTIN_MEDIA_MODEL_MANIFESTS, MediaModelManifestSchema } from '../media-model-manifest.js'

describe('IPC schemas', () => {
  it('does not hard-code runtime permission defaults during session creation', () => {
    const request = SessionCreateRequestSchema.parse({
      providerProfileId: '00000000-0000-4000-8000-000000000001',
    })

    expect(request.agentAdapter).toBeUndefined()
    expect(request.permissionMode).toBeUndefined()
    expect(request.chatMode).toBe('agent')
    expect(request.reasoningEffort).toBe('max')
  })

  it('preserves selected agent fields during session creation', () => {
    const request = SessionCreateRequestSchema.parse({
      providerProfileId: '00000000-0000-4000-8000-000000000001',
      modelId: 'claude-sonnet-4-20250514',
      agentId: 'review-agent',
      agentAdapter: 'claude-sdk',
      permissionMode: 'claude-auto-edits',
      reasoningEffort: 'high',
    })

    expect(request).toMatchObject({
      agentId: 'review-agent',
      agentAdapter: 'claude-sdk',
      permissionMode: 'claude-auto-edits',
      reasoningEffort: 'high',
    })
  })

  it('accepts max reasoning effort and rejects removed low effort', () => {
    const request = SessionCreateRequestSchema.parse({
      providerProfileId: '00000000-0000-4000-8000-000000000001',
      reasoningEffort: 'max',
    })

    expect(request.reasoningEffort).toBe('max')
    expect(() =>
      SessionCreateRequestSchema.parse({
        providerProfileId: '00000000-0000-4000-8000-000000000001',
        reasoningEffort: 'low',
      }),
    ).toThrow()
  })

  it('preserves selected agent fields during session updates', () => {
    const request = SessionUpdateRequestSchema.parse({
      sessionId: '00000000-0000-4000-8000-000000000002',
      providerProfileId: '00000000-0000-4000-8000-000000000001',
      modelId: 'claude-sonnet-4-20250514',
      agentId: 'review-agent',
      agentAdapter: 'claude-sdk',
      permissionMode: 'claude-auto-edits',
      reasoningEffort: 'high',
    })

    expect(request).toMatchObject({
      agentId: 'review-agent',
      agentAdapter: 'claude-sdk',
      permissionMode: 'claude-auto-edits',
      reasoningEffort: 'high',
    })
  })

  it('preserves runtime overrides when sending a turn', () => {
    const request = SessionSendTurnRequestSchema.parse({
      sessionId: '00000000-0000-4000-8000-000000000002',
      message: 'hello',
      providerProfileId: '00000000-0000-4000-8000-000000000001',
      modelId: 'claude-sonnet-4-20250514',
      agentId: 'review-agent',
      agentAdapter: 'claude-sdk',
      permissionMode: 'claude-auto-edits',
      chatMode: 'agent',
      reasoningEffort: 'high',
    })

    expect(request).toMatchObject({
      agentId: 'review-agent',
      agentAdapter: 'claude-sdk',
      permissionMode: 'claude-auto-edits',
      chatMode: 'agent',
      reasoningEffort: 'high',
    })
  })

  it('validates Spark-managed Goal IPC payloads', () => {
    const request = SessionSetGoalRequestSchema.parse({
      sessionId: '00000000-0000-4000-8000-000000000002',
      objective: 'Implement durable goals with validation',
      successCriteria: ['Goal can pause and resume'],
      validation: { commands: ['pnpm --filter @spark/agent-runtime typecheck'] },
      budget: { maxIterations: 12, maxConsecutiveFailures: 3 },
      mode: 'auto',
    })

    expect(request.mode).toBe('auto')
    expect(request.budget?.maxIterations).toBe(12)

    const control = SessionGoalControlRequestSchema.parse({
      sessionId: '00000000-0000-4000-8000-000000000002',
      action: 'pause',
    })
    expect(control.action).toBe('pause')
  })

  it('accepts file and image attachments when sending a turn', () => {
    const request = SessionSendTurnRequestSchema.parse({
      sessionId: '00000000-0000-4000-8000-000000000002',
      message: 'please inspect these',
      attachments: [
        { type: 'image', path: '/tmp/screenshot.png' },
        { type: 'file', path: '/tmp/notes.md' },
      ],
    })

    expect(request.attachments).toEqual([
      { type: 'image', path: '/tmp/screenshot.png' },
      { type: 'file', path: '/tmp/notes.md' },
    ])
  })

  it('accepts multi-file open dialog options', () => {
    const request = DialogOpenFileRequestSchema.parse({
      title: 'Add attachments',
      multiple: true,
      filters: [{ name: 'All Files', extensions: ['*'] }],
    })

    expect(request).toMatchObject({ multiple: true })
  })

  it('validates built-in media model manifests', () => {
    expect(BUILTIN_MEDIA_MODEL_MANIFESTS.length).toBeGreaterThan(5)
    for (const manifest of BUILTIN_MEDIA_MODEL_MANIFESTS) {
      expect(() => MediaModelManifestSchema.parse(manifest)).not.toThrow()
    }
  })

  it('accepts provider media model refs', () => {
    const request = ProviderCreateRequestSchema.parse({
      name: 'APIMart Media',
      provider: 'openai',
      defaultModel: 'gpt-image-2',
      apiKey: 'sk-test',
      modelType: 'image',
      mediaProvider: 'apimart',
      mediaModelRefs: [
        { manifestId: 'apimart:gpt-image-2', enabled: true, defaults: { size: '1024x1024' } },
      ],
    })

    expect(request.mediaModelRefs?.[0]?.manifestId).toBe('apimart:gpt-image-2')
  })

  it('accepts a complete custom manifest on a provider media model ref', () => {
    const manifest = {
      id: 'custom:studio-image',
      providerKind: 'custom',
      modelId: 'studio-image-v1',
      displayName: 'Studio Image',
      domains: ['image'],
      capabilities: [
        {
          id: 'image.generate',
          label: '文生图',
          input: { required: ['prompt'] },
          output: { types: ['image'] },
          paramSchema: { type: 'object', properties: { quality: { type: 'string' } } },
        },
      ],
      invocation: {
        mode: 'sync',
        endpoint: '/images/generations',
        method: 'POST',
        contentType: 'json',
        requestTemplate: { model: '{{modelId}}', prompt: '{{prompt}}' },
        response: { kind: 'url', jsonPaths: ['data[].url'], download: true },
      },
      docs: { sourceUrls: [] },
    }
    const request = ProviderCreateRequestSchema.parse({
      name: 'Studio Media',
      provider: 'openai-compatible',
      defaultModel: 'studio-image-v1',
      apiKey: 'sk-test',
      modelType: 'image',
      mediaProvider: 'custom',
      mediaModelRefs: [{ manifestId: manifest.id, modelId: manifest.modelId, manifest }],
    })

    expect(request.mediaModelRefs?.[0]?.manifest?.invocation.endpoint).toBe('/images/generations')
  })

  it('rejects a custom manifest whose id differs from the provider ref', () => {
    expect(() =>
      ProviderCreateRequestSchema.parse({
        name: 'Broken Media',
        provider: 'openai-compatible',
        defaultModel: 'broken-v1',
        apiKey: 'sk-test',
        modelType: 'image',
        mediaProvider: 'custom',
        mediaModelRefs: [
          {
            manifestId: 'custom:expected',
            modelId: 'broken-v1',
            manifest: {
              id: 'custom:different',
              providerKind: 'custom',
              modelId: 'broken-v1',
              displayName: 'Broken',
              domains: ['image'],
              capabilities: [
                {
                  id: 'image.generate',
                  label: '文生图',
                  input: { required: ['prompt'] },
                  output: { types: ['image'] },
                  paramSchema: {},
                },
              ],
              invocation: {
                mode: 'sync',
                endpoint: '/images',
                method: 'POST',
                contentType: 'json',
                requestTemplate: {},
                response: { kind: 'url', jsonPaths: ['url'], download: true },
              },
              docs: { sourceUrls: [] },
            },
          },
        ],
      }),
    ).toThrow(/manifestId/i)
  })

  it('validates canvas media model discovery and selected model task payloads', () => {
    const listRequest = IpcSchemaRegistry['canvas:media-models:list'].parse({
      providerProfileId: 'provider-media-1',
      capability: 'image.generate',
      enabledOnly: true,
      catalogOnly: true,
    })
    expect(listRequest.capability).toBe('image.generate')
    expect(listRequest.catalogOnly).toBe(true)

    const describeRequest = IpcSchemaRegistry['canvas:media-models:describe'].parse({
      manifestId: 'apimart:gpt-image-2',
      providerProfileId: 'provider-media-1',
    })
    expect(describeRequest.manifestId).toBe('apimart:gpt-image-2')

    const taskRequest = IpcSchemaRegistry['canvas:task:create-media'].parse({
      operation: 'storyboard_grid',
      prompt: 'a polished product photo',
      providerProfileId: 'provider-media-1',
      modelId: 'gpt-image-2',
      modelParams: { size: '1024x1024' },
    })
    expect(taskRequest.operation).toBe('storyboard_grid')
    expect(taskRequest.modelId).toBe('gpt-image-2')

    const deleteRequest = IpcSchemaRegistry['canvas:project:delete'].parse({
      projectId: 'canvas_project_1',
    })
    expect(deleteRequest.projectId).toBe('canvas_project_1')

    const downloadRequest = IpcSchemaRegistry['canvas:asset:download'].parse({
      sourceUrl: 'safe-file://x/YXNzZXQ',
      type: 'image',
      mimeType: 'image/png',
      suggestedFileName: 'result.png',
    })
    expect(downloadRequest.suggestedFileName).toBe('result.png')
  })

  it('validates inline-manifest dry-run payload for canvas media contract preview', () => {
    const manifest = BUILTIN_MEDIA_MODEL_MANIFESTS.find(
      (item) => item.modelId === 'doubao-seedream-5-0-lite',
    )
    expect(manifest).toBeDefined()
    const valid = IpcSchemaRegistry['canvas:media:prune-model-params-by-inline-manifest'].parse({
      manifest,
      capabilityId: manifest!.capabilities[0]!.id,
      modelParams: { prompt: 'a red apple', size: '1024x1024' },
    })
    expect(valid.capabilityId).toBe(manifest!.capabilities[0]!.id)
    expect(valid.modelParams.prompt).toBe('a red apple')

    // 缺少 capabilityId 时 schema 应拒绝（min(1)）
    expect(() =>
      IpcSchemaRegistry['canvas:media:prune-model-params-by-inline-manifest'].parse({
        manifest,
        capabilityId: '',
        modelParams: { prompt: 'x' },
      }),
    ).toThrow(/capabilityId/)

    // manifest 结构不合法时应被 MediaModelManifestSchema 拒绝
    expect(() =>
      IpcSchemaRegistry['canvas:media:prune-model-params-by-inline-manifest'].parse({
        manifest: { modelId: 'broken' },
        capabilityId: 'image.generate',
        modelParams: {},
      }),
    ).toThrow()
  })

  it('preserves Codex Responses API mode for provider creation', () => {
    const request = ProviderCreateRequestSchema.parse({
      name: 'Third Party Codex',
      provider: 'openai-compatible',
      defaultModel: 'provider-coder',
      apiEndpoint: 'https://provider.example.com/v1',
      apiKey: 'sk-provider',
      codexApiKind: 'responses',
    })

    expect(request.provider).toBe('openai-compatible')
    expect(request.codexApiKind).toBe('responses')
  })

  it('validates provider draft connection and model fetch payloads', () => {
    const testRequest = IpcSchemaRegistry['provider:test-connection'].parse({
      provider: 'openai-compatible',
      apiEndpoint: 'https://api.deepseek.com',
      defaultModel: 'deepseek-v4-flash',
      codexApiKind: 'chat',
      apiKey: 'sk-test',
    })
    expect(testRequest.provider).toBe('openai-compatible')

    const fetchRequest = IpcSchemaRegistry['provider:fetch-models'].parse({
      provider: 'openai-compatible',
      apiEndpoint: 'https://open.bigmodel.cn/api/coding/paas/v4',
      modelsUrl: 'https://open.bigmodel.cn/api/coding/paas/v4/models',
      isFullUrl: false,
    })
    expect(fetchRequest.modelsUrl).toContain('/models')
  })

  it('validates GitHub connector verification payloads', () => {
    const request = IpcSchemaRegistry['github-connector:verify'].parse({
      token: 'github_pat_test_1234567890',
      apiBaseUrl: 'https://api.github.com',
    })

    expect(request.token).toContain('github_pat_')
    expect(request.apiBaseUrl).toBe('https://api.github.com')
  })

  it('validates GitHub connector connect and update payloads', () => {
    const connectRequest = IpcSchemaRegistry['github-connector:connect'].parse({
      token: 'github_pat_test_1234567890',
      selectedRepos: ['openai/codex', 'owner/repo'],
      enabledCapabilities: ['identity', 'repositories', 'issues', 'pull_requests', 'mcp_tools'],
      allowWrites: true,
    })
    expect(connectRequest.selectedRepos).toHaveLength(2)
    expect(connectRequest.allowWrites).toBe(true)

    const updateRequest = IpcSchemaRegistry['github-connector:update'].parse({
      enabled: true,
      selectedRepos: ['owner/repo'],
      enabledCapabilities: ['identity', 'repositories'],
    })
    expect(updateRequest.enabled).toBe(true)
    expect(updateRequest.selectedRepos?.[0]).toBe('owner/repo')
  })
})
