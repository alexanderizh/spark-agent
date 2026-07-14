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
import { validateMediaModelManifestSemantics } from '../media-model-manifest-validation.js'
import { inferRolePolicy } from '../media-config.js'

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

  it('accepts the managed Spark platform provider id during session creation', () => {
    const request = SessionCreateRequestSchema.parse({
      providerProfileId: 'spark-platform-newapi',
    })

    expect(request.providerProfileId).toBe('spark-platform-newapi')
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

  it('accepts all Spark reasoning efforts and rejects unknown values', () => {
    for (const reasoningEffort of ['minimal', 'low', 'medium', 'high', 'xhigh', 'max']) {
      const request = SessionCreateRequestSchema.parse({
        providerProfileId: '00000000-0000-4000-8000-000000000001',
        reasoningEffort,
      })
      expect(request.reasoningEffort).toBe(reasoningEffort)
    }
    expect(() =>
      SessionCreateRequestSchema.parse({
        providerProfileId: '00000000-0000-4000-8000-000000000001',
        reasoningEffort: 'unlimited',
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

  it('requires session-scoped correlation when answering a structured question', () => {
    expect(
      IpcSchemaRegistry['session:answer-question'].parse({
        sessionId: 'session-1',
        questionId: 'tool-use-1',
        answers: { answers: [{ question: '继续吗？', answer: '继续' }] },
      }),
    ).toMatchObject({ sessionId: 'session-1', questionId: 'tool-use-1' })
    expect(() =>
      IpcSchemaRegistry['session:answer-question'].parse({
        questionId: 'tool-use-1',
        answers: {},
      }),
    ).toThrow()
    expect(IpcSchemaRegistry['session:list-pending-questions'].parse({})).toEqual({})
  })

  it('validates SMS authentication IPC payloads', () => {
    expect(
      IpcSchemaRegistry['auth:send-sms'].parse({
        phone: '13800138000',
        captchaId: 'captcha-id',
        captchaText: 'abcd',
        type: 'register',
      }),
    ).toEqual({
      phone: '13800138000',
      captchaId: 'captcha-id',
      captchaText: 'abcd',
    })
    expect(
      IpcSchemaRegistry['auth:login-sms'].parse({
        phone: '13800138000',
        smsCode: '123456',
      }),
    ).toEqual({ phone: '13800138000', smsCode: '123456' })
    expect(IpcSchemaRegistry['auth:client-config'].parse({})).toEqual({})

    expect(() =>
      IpcSchemaRegistry['auth:send-sms'].parse({
        phone: '1380013800',
        captchaId: 'captcha-id',
        captchaText: 'abcd',
      }),
    ).toThrow()
    expect(() =>
      IpcSchemaRegistry['auth:login-sms'].parse({
        phone: '13800138000',
        smsCode: '12345',
      }),
    ).toThrow()
  })

  it('accepts auto router provider ids for routing model profile cards', () => {
    const create = IpcSchemaRegistry['model:create'].parse({
      providerId: 'codex-auto-router',
      name: 'Auto Codex',
      configJson: JSON.stringify({
        kind: 'router',
        adapter: 'codex',
        candidates: {
          default: {
            providerProfileId: '00000000-0000-4000-8000-000000000001',
            modelId: 'qwen-coder',
          },
        },
      }),
    })
    const list = IpcSchemaRegistry['model:list'].parse({ providerId: 'claude-auto-router' })

    expect(create.providerId).toBe('codex-auto-router')
    expect(list.providerId).toBe('claude-auto-router')
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

  it('Seedance 2.0 image_to_video exposes reference-image input roles', () => {
    const seedance2Ids = [
      'volcengine:doubao-seedance-2-0-260128',
      'volcengine:doubao-seedance-2-0-fast-260128',
      'volcengine:doubao-seedance-2-0-mini-260615',
    ]

    for (const id of seedance2Ids) {
      const manifest = BUILTIN_MEDIA_MODEL_MANIFESTS.find((entry) => entry.id === id)
      expect(manifest, `missing manifest ${id}`).toBeDefined()
      const capability = manifest!.capabilities.find((item) => item.id === 'video.image_to_video')
      expect(capability, `missing image_to_video for ${id}`).toBeDefined()
      expect(capability!.label).toContain('参考图')
      expect(capability!.input.maxImages).toBe(9)
      expect(inferRolePolicy(capability!).imageRoles).toEqual([
        'first_frame',
        'last_frame',
        'reference_image',
      ])
    }
  })

  it('Seedream manifests expose full size enum + x-allow-custom + corrected defaults', () => {
    const seedreamIds = [
      'doubao-seedream-4-0-250828',
      'doubao-seedream-4-5-251128',
      'doubao-seedream-5-0-260128',
      'doubao-seedream-5-0-lite-260128',
    ]
    const findM = (id: string) =>
      BUILTIN_MEDIA_MODEL_MANIFESTS.find((m) => m.modelId === id)

    // 4 个 manifest 都通过 schema + 语义校验
    for (const modelId of seedreamIds) {
      const manifest = findM(modelId)
      expect(manifest, `missing manifest ${modelId}`).toBeDefined()
      const parsed = MediaModelManifestSchema.safeParse(manifest)
      expect(parsed.success, `${modelId}: ${parsed.error}`).toBe(true)
      const issues = validateMediaModelManifestSemantics(manifest!)
      expect(issues, `${modelId}: ${JSON.stringify(issues)}`).toEqual([])
    }

    const lite = findM('doubao-seedream-5-0-lite-260128')!
    const five = findM('doubao-seedream-5-0-260128')!
    const fourFive = findM('doubao-seedream-4-5-251128')!
    const fourZero = findM('doubao-seedream-4-0-250828')!

    const sizeEnumOf = (m: typeof lite) => {
      const cap = m.capabilities[0]!
      const size = (cap.paramSchema.properties as Record<string, Record<string, unknown>>).size
      return (size?.enum as string[]) ?? []
    }

    // 5.0 lite：2K/3K/4K + 24 像素值（≥27）；含 3K 档及代表尺寸
    const liteSizes = sizeEnumOf(lite)
    expect(liteSizes.length).toBeGreaterThanOrEqual(27)
    expect(liteSizes).toContain('3K')
    expect(liteSizes).toContain('3072x3072')
    expect(liteSizes).toContain('6240x2656')

    // 5.0 主 / 4.5：2K/4K + 16 像素值（≥18）；不含 3K
    for (const m of [five, fourFive]) {
      const sizes = sizeEnumOf(m)
      expect(sizes.length).toBeGreaterThanOrEqual(18)
      expect(sizes).not.toContain('3K')
      expect(sizes).toContain('2K')
      expect(sizes).toContain('4K')
      expect(sizes).toContain('2048x2048')
    }

    // 4.0：1K/2K/4K + 24 像素值（≥27）；含 1K 档
    const fourZeroSizes = sizeEnumOf(fourZero)
    expect(fourZeroSizes.length).toBeGreaterThanOrEqual(27)
    expect(fourZeroSizes).toContain('1K')
    expect(fourZeroSizes).toContain('1024x1024')
    expect(fourZeroSizes).toContain('1512x648')

    // size 字段全部标记 x-allow-custom: true（前端 AutoComplete 渲染）
    for (const m of [lite, five, fourFive, fourZero]) {
      const size = (m.capabilities[0]!.paramSchema.properties as Record<string, Record<string, unknown>>).size
      expect(size?.['x-allow-custom']).toBe(true)
    }

    // 默认值修正：watermark=true（文档默认）；5.0 lite outputFormat=jpeg
    expect(lite.capabilities[0]!.defaults?.watermark).toBe(true)
    expect(lite.capabilities[0]!.defaults?.outputFormat).toBe('jpeg')
    expect(fourZero.capabilities[0]!.defaults?.watermark).toBe(true)

    // 5.0 主：独有 guidanceScale；不含 optimizePromptMode/searchEnabled/sequential
    const fiveProps = five.capabilities[0]!.paramSchema.properties as Record<string, unknown>
    expect(fiveProps.guidanceScale).toBeDefined()
    expect(fiveProps.optimizePromptMode).toBeUndefined()
    expect(fiveProps.searchEnabled).toBeUndefined()
    expect(fiveProps.sequentialImageGeneration).toBeUndefined()

    // 5.0 主 manifest 只剩 image.generate（文档明确不支持 image 输入/组图/联网搜索）
    expect(five.capabilities.map((c) => c.id)).toEqual(['image.generate'])

    // 5.0 主 forbidden searchEnabled 仍生效（paramPolicy.aliases 兜底让其通过语义校验）
    expect(
      five.capabilities[0]!.paramPolicy?.forbidden?.some((f) => f.name === 'searchEnabled'),
    ).toBe(true)

    // 5.0 lite / 4.5 / 4.0：含 optimizePromptMode；lite/4.5 暂不暴露 fast，4.0 支持 fast。
    for (const m of [lite, fourFive]) {
      const props = m.capabilities[0]!.paramSchema.properties as Record<string, Record<string, unknown>>
      expect(props.optimizePromptMode?.enum).toEqual(['standard'])
      expect(props.stream).toBeUndefined()
    }
    const fourZeroProps = fourZero.capabilities[0]!.paramSchema.properties as Record<string, Record<string, unknown>>
    expect(fourZeroProps.optimizePromptMode?.enum).toEqual(['standard', 'fast'])
    // 当前 adapter 还不支持 SSE 解析，stream 不进入用户可配置 schema。
    expect(fourZeroProps.stream).toBeUndefined()

    // image.edit maxImages=14（文档：参考图最多 14 张，输入+输出≤15）
    for (const m of [lite, fourFive, fourZero]) {
      const editCap = m.capabilities.find((c) => c.id === 'image.edit')
      expect(editCap?.input?.maxImages).toBe(14)
    }

    // invocation.response 改为 url（与默认 responseFormat=url 对齐）
    for (const m of [lite, five, fourFive, fourZero]) {
      expect(m.invocation.response.kind).toBe('url')
    }

    // docs.lastCheckedAt 已刷新
    for (const m of [lite, five, fourFive, fourZero]) {
      expect(m.docs.lastCheckedAt).toBe('2026-07-05')
    }
  })

  it('Seedance 2.0 text-to-video manifests expose multimodal reference mime types', () => {
    const seedance2Ids = [
      'doubao-seedance-2-0-260128',
      'doubao-seedance-2-0-fast-260128',
      'doubao-seedance-2-0-mini-260615',
    ]
    for (const modelId of seedance2Ids) {
      const manifest = BUILTIN_MEDIA_MODEL_MANIFESTS.find((m) => m.modelId === modelId)
      expect(manifest, `missing manifest ${modelId}`).toBeDefined()
      const cap = manifest!.capabilities.find((item) => item.id === 'video.generate')
      expect(cap?.input.maxImages).toBe(9)
      expect(cap?.input.acceptedMimeTypes).toEqual(
        expect.arrayContaining(['image/png', 'video/mp4', 'audio/wav', 'audio/mpeg']),
      )
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
      promptDocument: {
        version: 2,
        blocks: [{ kind: 'text', id: 'text-1', text: '用户输入' }],
      },
      systemPrompt: 'hidden capability',
      relationManifest: [{ blockId: 'ref-1', sourceNodeId: 'node-1', relation: 'character', order: 0 }],
      providerProfileId: 'provider-media-1',
      modelId: 'gpt-image-2',
      modelParams: { size: '1024x1024' },
    })
    expect(taskRequest.operation).toBe('storyboard_grid')
    expect(taskRequest.modelId).toBe('gpt-image-2')
    expect(taskRequest.promptDocument?.version).toBe(2)
    expect(taskRequest.systemPrompt).toBe('hidden capability')
    expect(taskRequest.relationManifest?.[0]?.relation).toBe('character')

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

  it('validates canvas asset batch download payload', () => {
    const batchRequest = IpcSchemaRegistry['canvas:asset:download-batch'].parse({
      items: [
        { sourceUrl: 'https://example.com/a.png', type: 'image', suggestedFileName: 'a.png' },
        { contentText: 'hello', type: 'text', suggestedFileName: 'b.txt' },
      ],
    })
    expect(batchRequest.items).toHaveLength(2)
    expect(batchRequest.items[0]!.suggestedFileName).toBe('a.png')
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
