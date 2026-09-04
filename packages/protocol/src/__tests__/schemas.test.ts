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
import { inferRolePolicy, ProviderMediaDefaultsSchema } from '../media-config.js'

describe('ProviderMediaDefaultsSchema', () => {
  it('accepts a provider-wide media interface timeout', () => {
    expect(ProviderMediaDefaultsSchema.parse({ timeoutMs: 6_000_000 })).toEqual({
      timeoutMs: 6_000_000,
    })
  })

  it('rejects interface timeouts outside the supported range', () => {
    expect(() => ProviderMediaDefaultsSchema.parse({ timeoutMs: 999 })).toThrow()
    expect(() => ProviderMediaDefaultsSchema.parse({ timeoutMs: 172_800_001 })).toThrow()
  })
})

describe('IPC schemas', () => {
  it('accepts all selectable capability ids in their product order', () => {
    const ids = [
      'codex-runtime',
      'office-viewer',
      'local-depth',
      'ffmpeg',
      'chromium',
      'voice-pack',
    ] as const

    expect(
      ids.map(
        (capabilityId) =>
          IpcSchemaRegistry['optional-capability:install'].parse({ capabilityId }).capabilityId,
      ),
    ).toEqual(ids)

    expect(() =>
      IpcSchemaRegistry['optional-capability:install'].parse({
        capabilityId: 'computer-use',
      }),
    ).toThrow()
    expect(
      IpcSchemaRegistry['optional-capability:cancel'].parse({
        capabilityId: 'office-viewer',
      }),
    ).toEqual({ capabilityId: 'office-viewer' })
    expect(() =>
      IpcSchemaRegistry['optional-capability:cancel'].parse({
        capabilityId: 'computer-use',
      }),
    ).toThrow()
  })

  it('validates session image optimization batches', () => {
    expect(
      IpcSchemaRegistry['file:prepare-session-images'].parse({
        sourcePaths: ['/tmp/one.png', '/tmp/two.jpg'],
      }),
    ).toEqual({ sourcePaths: ['/tmp/one.png', '/tmp/two.jpg'] })

    expect(() =>
      IpcSchemaRegistry['file:prepare-session-images'].parse({
        sourcePaths: Array.from({ length: 21 }, (_, index) => `/tmp/${index}.png`),
      }),
    ).toThrow()
  })

  it('validates persistent pasted-text attachment payloads', () => {
    expect(
      IpcSchemaRegistry['file:save-pasted-text'].parse({
        text: '需要持久保留的长文本',
        suggestedBaseName: 'pasted-text-摘要',
      }),
    ).toEqual({
      text: '需要持久保留的长文本',
      suggestedBaseName: 'pasted-text-摘要',
    })
    expect(() => IpcSchemaRegistry['file:save-pasted-text'].parse({ text: '' })).toThrow()
    expect(() =>
      IpcSchemaRegistry['file:save-pasted-text'].parse({
        text: 'content',
        suggestedBaseName: 'x'.repeat(121),
      }),
    ).toThrow()
  })

  it('accepts the canvas log scope and rejects unknown log scopes', () => {
    expect(IpcSchemaRegistry['log:read'].parse({ scope: 'canvas' })).toEqual({ scope: 'canvas' })
    expect(() => IpcSchemaRegistry['log:read'].parse({ scope: 'tasks' })).toThrow()
  })

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

  it('preserves the Provider enabled flag through IPC validation', () => {
    expect(
      IpcSchemaRegistry['provider:update'].parse({
        id: '00000000-0000-4000-8000-000000000001',
        enabled: false,
      }),
    ).toEqual({
      id: '00000000-0000-4000-8000-000000000001',
      enabled: false,
    })
  })

  it('accepts the API protocol format switch through provider:update validation', () => {
    expect(
      IpcSchemaRegistry['provider:update'].parse({
        id: '00000000-0000-4000-8000-000000000001',
        provider: 'openai',
        name: 'Switched',
      }),
    ).toMatchObject({
      id: '00000000-0000-4000-8000-000000000001',
      provider: 'openai',
      name: 'Switched',
    })
    expect(() =>
      IpcSchemaRegistry['provider:update'].parse({
        id: '00000000-0000-4000-8000-000000000001',
        provider: 'unsupported-kind',
      }),
    ).toThrow()
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

  it('preserves debug mode during session creation', () => {
    const request = SessionCreateRequestSchema.parse({
      providerProfileId: '00000000-0000-4000-8000-000000000001',
      debugMode: true,
    })

    expect(request.debugMode).toBe(true)
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
      clientMessageId: '00000000-0000-4000-8000-000000000123',
      providerProfileId: '00000000-0000-4000-8000-000000000001',
      modelId: 'claude-sonnet-4-20250514',
      agentId: 'review-agent',
      agentAdapter: 'claude-sdk',
      permissionMode: 'claude-auto-edits',
      chatMode: 'agent',
      reasoningEffort: 'high',
      skillIds: ['builtin:canvas-studio', 'skill-extra'],
    })

    expect(request).toMatchObject({
      clientMessageId: '00000000-0000-4000-8000-000000000123',
      agentId: 'review-agent',
      agentAdapter: 'claude-sdk',
      permissionMode: 'claude-auto-edits',
      chatMode: 'agent',
      reasoningEffort: 'high',
      skillIds: ['builtin:canvas-studio', 'skill-extra'],
    })
  })

  it('validates queue recovery requests with a provider/model-only runtime patch', () => {
    const sessionId = '00000000-0000-4000-8000-000000000002'
    const providerProfileId = '00000000-0000-4000-8000-000000000001'
    expect(
      SessionSendTurnRequestSchema.parse({
        sessionId,
        message: 'retry failed turn',
        resumePausedQueue: true,
      }).resumePausedQueue,
    ).toBe(true)
    expect(
      IpcSchemaRegistry['session:resume-queue'].parse({
        sessionId,
        runtimePatch: {
          providerProfileId,
          modelId: 'model-new',
          cliSparkOverride: { providerProfileId, modelId: 'spark-model-new' },
        },
      }),
    ).toEqual({
      sessionId,
      runtimePatch: {
        providerProfileId,
        modelId: 'model-new',
        cliSparkOverride: { providerProfileId, modelId: 'spark-model-new' },
      },
    })
    expect(
      IpcSchemaRegistry['session:send-queued-turn-now'].safeParse({
        sessionId,
        turnId: '00000000-0000-4000-8000-000000000003',
        runtimePatch: { providerProfileId, modelId: 'model-new', agentId: 'not-allowed' },
      }).success,
    ).toBe(false)
  })

  it('preserves the local CLI Spark override across session requests', () => {
    const cliSparkOverride = {
      providerProfileId: '00000000-0000-4000-8000-000000000003',
      modelId: 'claude-sonnet-4-20250514',
    }
    expect(
      SessionCreateRequestSchema.parse({
        providerProfileId: 'local-cli',
        cliSparkOverride,
      }).cliSparkOverride,
    ).toEqual(cliSparkOverride)
    expect(
      SessionUpdateRequestSchema.parse({
        sessionId: '00000000-0000-4000-8000-000000000002',
        cliSparkOverride,
      }).cliSparkOverride,
    ).toEqual(cliSparkOverride)
    expect(
      SessionSendTurnRequestSchema.parse({
        sessionId: '00000000-0000-4000-8000-000000000002',
        message: 'hello',
        cliSparkOverride,
      }).cliSparkOverride,
    ).toEqual(cliSparkOverride)
    expect(
      SessionUpdateRequestSchema.parse({
        sessionId: '00000000-0000-4000-8000-000000000002',
        cliSparkOverride: null,
      }).cliSparkOverride,
    ).toBeNull()
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

  it('accepts application snapshot IDs without changing legacy attachment semantics', () => {
    const request = SessionSendTurnRequestSchema.parse({
      sessionId: '00000000-0000-4000-8000-000000000002',
      message: 'use the app context I just captured',
      attachments: [{ type: 'file', path: '/tmp/notes.md' }],
      appSnapshotIds: ['snapshot-01JZ9M5K6DY3F0V4EJKS9A4X2H'],
    })

    expect(request.attachments).toEqual([{ type: 'file', path: '/tmp/notes.md' }])
    expect(request.appSnapshotIds).toEqual(['snapshot-01JZ9M5K6DY3F0V4EJKS9A4X2H'])
    expect(
      SessionSendTurnRequestSchema.safeParse({
        sessionId: '00000000-0000-4000-8000-000000000002',
        message: 'duplicate snapshots must not be hydrated twice',
        appSnapshotIds: ['snapshot-1', 'snapshot-1'],
      }).success,
    ).toBe(false)
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

  it('records documented prompt units and overflow behavior for Bailian image models', () => {
    const qwen = BUILTIN_MEDIA_MODEL_MANIFESTS.find(
      (manifest) => manifest.id === 'bailian:qwen-image-2.0',
    )
    const wan = BUILTIN_MEDIA_MODEL_MANIFESTS.find(
      (manifest) => manifest.id === 'bailian:wan2.7-image',
    )

    expect(qwen?.safety).toMatchObject({
      maxPromptLength: 1300,
      promptLengthUnit: 'tokens',
      promptOverflowBehavior: 'truncate',
    })
    expect(wan?.safety).toMatchObject({
      maxPromptLength: 5000,
      promptLengthUnit: 'characters',
      promptOverflowBehavior: 'truncate',
    })
  })

  it('exposes image size examples and custom-size contracts for OpenAI and Bailian', () => {
    const openAi = BUILTIN_MEDIA_MODEL_MANIFESTS.find(
      (manifest) => manifest.id === 'openai-images:gpt-image-2',
    )!
    const wan = BUILTIN_MEDIA_MODEL_MANIFESTS.find(
      (manifest) => manifest.id === 'bailian:wan2.7-image',
    )!
    const qwen = BUILTIN_MEDIA_MODEL_MANIFESTS.find(
      (manifest) => manifest.id === 'bailian:qwen-image-2.0',
    )!
    const property = (manifest: typeof openAi, capabilityId: string, name: string) =>
      (
        manifest.capabilities.find((item) => item.id === capabilityId)!.paramSchema
          .properties as Record<string, Record<string, unknown>>
      )[name]

    expect(property(openAi, 'image.generate', 'size')).toMatchObject({
      examples: [
        'auto',
        '1024x1024',
        '1536x1024',
        '1024x1536',
        '2048x2048',
        '2048x1152',
        '3840x2160',
        '2160x3840',
      ],
      'x-allow-custom': true,
    })
    expect(property(wan, 'image.generate', 'size')).toMatchObject({
      examples: ['2048*2048', '2048*1536', '1536*2048', '2048*1152', '1152*2048'],
      'x-allow-custom': true,
    })
    expect(property(qwen, 'image.generate', 'size')).toMatchObject({
      enum: ['2048*2048', '2688*1536', '1536*2688', '2368*1728', '1728*2368'],
      'x-allow-custom': true,
    })
  })

  it('keeps Volcengine and MiniMax image examples scoped to model contracts', () => {
    const property = (manifestId: string, capabilityId: string, name: string) => {
      const manifest = BUILTIN_MEDIA_MODEL_MANIFESTS.find((entry) => entry.id === manifestId)!
      const capability = manifest.capabilities.find((entry) => entry.id === capabilityId)!
      return (capability.paramSchema.properties as Record<string, Record<string, unknown>>)[name]
    }

    expect(
      property('volcengine:doubao-seedream-5-0-pro-260628', 'image.generate', 'size'),
    ).toMatchObject({
      examples: ['2560x1440', '1440x2560', '2048x1536'],
      'x-allow-custom': true,
    })
    expect(property('minimax:image-01', 'image.generate', 'width')).toMatchObject({
      minimum: 512,
      maximum: 2048,
      multipleOf: 8,
      examples: [1024, 1280, 1536, 2048],
      'x-allow-custom': true,
    })
    expect(property('minimax:image-01-live', 'image.generate', 'width')).toBeUndefined()
    expect(property('minimax:image-01-live', 'image.generate', 'aspectRatio')).toMatchObject({
      enum: ['1:1', '16:9', '4:3', '3:2', '2:3', '3:4', '9:16'],
    })
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
      expect(capability!.label).toContain('多模态参考')
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
      'doubao-seedream-5-0-pro-260628',
      'doubao-seedream-5-0-260128',
      'doubao-seedream-5-0-lite-260128',
    ]
    const findM = (id: string) => BUILTIN_MEDIA_MODEL_MANIFESTS.find((m) => m.modelId === id)

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
    const liteAlias = findM('doubao-seedream-5-0-260128')!
    const pro = findM('doubao-seedream-5-0-pro-260628')!
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

    // 5.0 Lite 的兼容 ID 与 Lite 共享 2K/3K/4K 能力。
    expect(sizeEnumOf(liteAlias)).toEqual(liteSizes)

    // 4.5：2K/4K + 16 像素值（≥18）；不含 3K
    for (const m of [fourFive]) {
      const sizes = sizeEnumOf(m)
      expect(sizes.length).toBeGreaterThanOrEqual(18)
      expect(sizes).not.toContain('3K')
      expect(sizes).toContain('2K')
      expect(sizes).toContain('4K')
      expect(sizes).toContain('2048x2048')
    }

    // 5.0 Pro：仅 1K/2K，直接尺寸范围也与 Lite 不同。
    const proSizes = sizeEnumOf(pro)
    expect(proSizes).toContain('1K')
    expect(proSizes).toContain('2K')
    expect(proSizes).not.toContain('3K')
    expect(proSizes).not.toContain('4K')

    // 4.0：1K/2K/4K + 24 像素值（≥27）；含 1K 档
    const fourZeroSizes = sizeEnumOf(fourZero)
    expect(fourZeroSizes.length).toBeGreaterThanOrEqual(27)
    expect(fourZeroSizes).toContain('1K')
    expect(fourZeroSizes).toContain('1024x1024')
    expect(fourZeroSizes).toContain('1512x648')

    // size 字段全部标记 x-allow-custom: true（前端 AutoComplete 渲染）
    for (const m of [lite, liteAlias, pro, fourFive, fourZero]) {
      const size = (
        m.capabilities[0]!.paramSchema.properties as Record<string, Record<string, unknown>>
      ).size
      expect(size?.['x-allow-custom']).toBe(true)
      expect(size?.pattern).toBe('^\\d+\\s*[xX]\\s*\\d+$')
    }

    // 高阶参数不再自动注入 defaults：watermark 由 provider 官方默认(true)兜底；
    // 5.0 lite 仍显式 outputFormat=jpeg（输出格式，产品设定）。
    expect(lite.capabilities[0]!.defaults?.watermark).toBeUndefined()
    expect(lite.capabilities[0]!.defaults?.outputFormat).toBe('jpeg')
    expect(fourZero.capabilities[0]!.defaults?.watermark).toBeUndefined()

    // 5.0 Pro 支持多图编辑和 fast prompt 优化，不支持组图、流式或联网搜索。
    const proProps = pro.capabilities[0]!.paramSchema.properties as Record<
      string,
      Record<string, unknown>
    >
    expect(proProps.optimizePromptMode?.enum).toEqual(['standard', 'fast'])
    expect(proProps.searchEnabled).toBeUndefined()
    expect(proProps.sequentialImageGeneration).toBeUndefined()
    expect(proProps.seed).toBeUndefined()
    expect(proProps.guidanceScale).toBeUndefined()
    expect(pro.capabilities.map((c) => c.id)).toEqual(['image.generate', 'image.edit'])
    expect(pro.capabilities.find((c) => c.id === 'image.edit')?.input.maxImages).toBe(10)

    // 5.0 lite / 4.5 / 4.0：含 optimizePromptMode；lite/4.5 暂不暴露 fast，4.0 支持 fast。
    for (const m of [lite, fourFive]) {
      const props = m.capabilities[0]!.paramSchema.properties as Record<
        string,
        Record<string, unknown>
      >
      expect(props.optimizePromptMode?.enum).toEqual(['standard'])
      expect(props.stream).toBeUndefined()
    }
    const fourZeroProps = fourZero.capabilities[0]!.paramSchema.properties as Record<
      string,
      Record<string, unknown>
    >
    expect(fourZeroProps.optimizePromptMode?.enum).toEqual(['standard', 'fast'])
    // 当前 adapter 还不支持 SSE 解析，stream 不进入用户可配置 schema。
    expect(fourZeroProps.stream).toBeUndefined()

    // image.edit maxImages=14（文档：参考图最多 14 张，输入+输出≤15）
    for (const m of [lite, fourFive, fourZero]) {
      const editCap = m.capabilities.find((c) => c.id === 'image.edit')
      expect(editCap?.input?.maxImages).toBe(14)
    }

    // invocation.response 改为 url（与默认 responseFormat=url 对齐）
    for (const m of [lite, liteAlias, pro, fourFive, fourZero]) {
      expect(m.invocation.response.kind).toBe('url')
    }

    // docs.lastCheckedAt 已刷新
    for (const m of [lite, liteAlias, pro, fourFive, fourZero]) {
      expect(m.docs.lastCheckedAt).toBe('2026-07-16')
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
      relationManifest: [
        {
          blockId: 'ref-1',
          sourceNodeId: 'node-1',
          relation: 'character',
          order: 0,
          modelReference: { channel: 'reference_images', ordinal: 1, label: '参考图 #1' },
        },
      ],
      inputBindings: [
        {
          id: 'manual:node-1:reference',
          sourceNodeId: 'node-1',
          origin: 'manual',
          kind: 'image',
          relation: 'character',
          role: 'reference',
          enabled: true,
          order: 0,
          promptBlockId: 'ref-1',
        },
      ],
      mediaInputMode: 'reference',
      capabilityId: 'image.edit',
      providerProfileId: 'provider-media-1',
      modelId: 'gpt-image-2',
      modelParams: { size: '1024x1024' },
    })
    expect(taskRequest.operation).toBe('storyboard_grid')
    expect(taskRequest.modelId).toBe('gpt-image-2')
    expect(taskRequest.promptDocument?.version).toBe(2)
    expect(taskRequest.systemPrompt).toBe('hidden capability')
    expect(taskRequest.relationManifest?.[0]?.relation).toBe('character')
    expect(taskRequest.inputBindings?.[0]?.sourceNodeId).toBe('node-1')
    expect(taskRequest.mediaInputMode).toBe('reference')
    expect(taskRequest.capabilityId).toBe('image.edit')

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

  it('bounds HTML viewer payloads and accepts explicit themes', () => {
    expect(
      IpcSchemaRegistry['html:open-window'].parse({
        html: '<main>safe</main>',
        title: '预览',
        theme: 'dark',
      }),
    ).toEqual({ html: '<main>safe</main>', title: '预览', theme: 'dark' })
    expect(() =>
      IpcSchemaRegistry['html:open-external'].parse({ html: 'x'.repeat(200_001) }),
    ).toThrow()
  })

  it('validates HTML render runtime doc tokens and document bounds', () => {
    expect(
      IpcSchemaRegistry['html:put-runtime-doc'].parse({
        token: 'hr-html-1-abc123de',
        document: '<!doctype html><html></html>',
      }),
    ).toEqual({ token: 'hr-html-1-abc123de', document: '<!doctype html><html></html>' })
    expect(() =>
      IpcSchemaRegistry['html:put-runtime-doc'].parse({ token: 'bad token!', document: 'x' }),
    ).toThrow()
    expect(() =>
      IpcSchemaRegistry['html:put-runtime-doc'].parse({
        token: 'hr-html-1-abc123de',
        document: 'x'.repeat(220_001),
      }),
    ).toThrow()
    expect(() => IpcSchemaRegistry['html:release-runtime-doc'].parse({ token: '' })).toThrow()
  })

  it('validates sub-app download history payloads', () => {
    expect(
      IpcSchemaRegistry['browser:sub-app-reveal-download'].parse({
        filePath: '/Users/test/Downloads/video.mp4',
      }),
    ).toEqual({ filePath: '/Users/test/Downloads/video.mp4' })
    expect(
      IpcSchemaRegistry['browser:sub-app-preview-download'].parse({
        filePath: '/Users/test/Downloads/video.mp4',
      }),
    ).toEqual({ filePath: '/Users/test/Downloads/video.mp4' })
    expect(() =>
      IpcSchemaRegistry['browser:sub-app-preview-download'].parse({ filePath: '' }),
    ).toThrow()
  })
})
