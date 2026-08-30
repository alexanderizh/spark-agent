import { describe, expect, it } from 'vitest'
import {
  CustomToolDraftSchema,
  CustomToolsExportPayloadSchema,
  CustomToolsIpcSchemaRegistry,
  assertJsonTemplateStructure,
  containsLiteralSecret,
  extractSqlNamedParams,
  extractTemplatePlaceholders,
  httpMethodRiskFloor,
  renderJsonBodyTemplate,
} from '../custom-tools.js'

interface TestParam {
  type: string
  description?: string
  items?: { type: string }
  enum?: Array<string | number>
}

interface TestHttpDraft {
  id: string
  title: string
  description: string
  type: 'http'
  inputSchema: { type: 'object'; properties: Record<string, TestParam>; required?: string[] }
  risk: string
  effect: string
  idempotency: string
  timeoutMs: number
  secretRefs?: Record<string, string>
  spec: {
    request: {
      method: string
      urlTemplate: string
      headers?: Array<Record<string, string>>
      body?: { mode: 'json'; jsonTemplate: string }
    }
    response: { format: string }
  }
}

/** 合法 HTTP GET 工具基线，供各拒绝分支变异 */
function validHttpDraft(): TestHttpDraft {
  return {
    id: 'jira_search',
    title: 'Jira 查询',
    description: '按 issue key 查询内部 Jira issue 详情',
    type: 'http',
    inputSchema: {
      type: 'object',
      properties: {
        issueKey: { type: 'string', description: 'issue 编号' },
      },
      required: ['issueKey'],
    },
    risk: 'read',
    effect: 'read',
    idempotency: 'safe',
    timeoutMs: 30_000,
    spec: {
      request: {
        method: 'GET',
        urlTemplate: 'https://jira.internal/v3/issue/{{issueKey}}',
        headers: [{ name: 'Accept', valueTemplate: 'application/json' }],
      },
      response: { format: 'json' },
    },
  }
}

function validProviderVisionDraft() {
  return {
    id: 'vision_fallback',
    title: '图像理解',
    description: '使用已有多模态 Provider 分析当前会话选择的图片附件',
    type: 'provider-vision' as const,
    inputSchema: {
      type: 'object' as const,
      properties: {
        images: { type: 'array' as const, items: { type: 'string' as const } },
        question: { type: 'string' as const },
      },
      required: ['images'],
    },
    risk: 'read' as const,
    effect: 'read' as const,
    idempotency: 'safe' as const,
    timeoutMs: 60_000,
    spec: {
      providerProfileId: 'vision-provider',
      instructions: '请完整、准确地描述图片内容，并回答用户提出的问题。',
      maxImages: 4,
      maxTokens: 4_096,
      autoRoute: { enabled: true, priority: 100 },
      exposeToAgent: false,
    },
  }
}

describe('CustomToolDraftSchema', () => {
  it('accepts a valid http draft', () => {
    expect(CustomToolDraftSchema.parse(validHttpDraft())).toMatchObject({ id: 'jira_search' })
  })

  it('rejects unknown tool type', () => {
    const draft = { ...validHttpDraft(), type: 'graphql' }
    expect(() => CustomToolDraftSchema.parse(draft)).toThrow()
  })

  it('accepts a provider vision draft with host-only routing defaults', () => {
    expect(CustomToolDraftSchema.parse(validProviderVisionDraft())).toMatchObject({
      type: 'provider-vision',
      spec: { providerProfileId: 'vision-provider', exposeToAgent: false },
    })
  })

  it('rejects provider vision drafts without required string[] images', () => {
    const missingRequired = validProviderVisionDraft()
    missingRequired.inputSchema.required = []
    expect(() => CustomToolDraftSchema.parse(missingRequired)).toThrow(/必填参数/)

    const wrongItems = validProviderVisionDraft()
    wrongItems.inputSchema.properties.images = {
      type: 'array',
      items: { type: 'number' },
    } as never
    expect(() => CustomToolDraftSchema.parse(wrongItems)).toThrow(/string\[\]/)
  })

  it('rejects provider vision secrets and write effects', () => {
    expect(() =>
      CustomToolDraftSchema.parse({
        ...validProviderVisionDraft(),
        secretRefs: { api_key: 'custom-tool:vision_fallback:api_key' },
      }),
    ).toThrow(/Provider Keychain/)
    expect(() =>
      CustomToolDraftSchema.parse({
        ...validProviderVisionDraft(),
        risk: 'low-write',
        effect: 'create',
      }),
    ).toThrow(/固定为 read/)
    expect(() =>
      CustomToolDraftSchema.parse({
        ...validProviderVisionDraft(),
        spec: { ...validProviderVisionDraft().spec, exposeToAgent: true },
      }),
    ).toThrow()
  })

  it('rejects invalid slug (uppercase / leading digit / too short)', () => {
    for (const id of ['Jira_Search', '1jira', 'ab', 'jira-search']) {
      expect(() => CustomToolDraftSchema.parse({ ...validHttpDraft(), id })).toThrow()
    }
  })

  it('rejects description shorter than 10 chars', () => {
    expect(() =>
      CustomToolDraftSchema.parse({ ...validHttpDraft(), description: '太短了' }),
    ).toThrow()
  })

  it('rejects timeout outside [1s, 300s]', () => {
    expect(() => CustomToolDraftSchema.parse({ ...validHttpDraft(), timeoutMs: 500 })).toThrow()
    expect(() => CustomToolDraftSchema.parse({ ...validHttpDraft(), timeoutMs: 300_001 })).toThrow()
  })

  it('rejects unclosed placeholder brackets', () => {
    const draft = validHttpDraft()
    draft.spec.request.urlTemplate = 'https://jira.internal/v3/issue/{{issueKey}'
    expect(() => CustomToolDraftSchema.parse(draft)).toThrow()
  })

  it('rejects placeholder referencing undeclared param', () => {
    const draft = validHttpDraft()
    draft.spec.request.urlTemplate = 'https://jira.internal/v3/issue/{{notDeclared}}'
    expect(() => CustomToolDraftSchema.parse(draft)).toThrow()
  })

  it('rejects literal secrets in templates', () => {
    const draft = validHttpDraft()
    draft.spec.request.headers = [{ name: 'X-Token', valueTemplate: 'sk-abcdefghijklmnopqrst' }]
    expect(() => CustomToolDraftSchema.parse(draft)).toThrow(/密钥/)
  })

  it('rejects sensitive header with literal valueTemplate', () => {
    const draft = validHttpDraft()
    draft.spec.request.headers = [{ name: 'Authorization', valueTemplate: 'Bearer {{issueKey}}' }]
    expect(() => CustomToolDraftSchema.parse(draft)).toThrow(/secretRef/)
  })

  it('accepts sensitive header bound to secretRef', () => {
    const draft = validHttpDraft()
    draft.secretRefs = { auth_token: 'custom-tool:jira_search:auth_token' }
    draft.spec.request.headers = [{ name: 'Authorization', secretRef: 'auth_token' }]
    expect(CustomToolDraftSchema.parse(draft)).toMatchObject({
      secretRefs: { auth_token: expect.any(String) },
    })
  })

  it('rejects secretRef declared but never referenced by any header', () => {
    const draft = validHttpDraft()
    draft.secretRefs = { unused_secret: 'custom-tool:jira_search:unused_secret' }
    expect(() => CustomToolDraftSchema.parse(draft)).toThrow(/未被任何请求头引用/)
  })

  it('rejects header carrying both valueTemplate and secretRef', () => {
    const draft = validHttpDraft()
    draft.spec.request.headers = [
      { name: 'Accept', valueTemplate: 'json', secretRef: 'auth_token' },
    ]
    draft.secretRefs = { auth_token: 'ref' }
    expect(() => CustomToolDraftSchema.parse(draft)).toThrow()
  })

  describe('risk floor', () => {
    it('exposes per-method floors', () => {
      expect(httpMethodRiskFloor('GET')).toBe('read')
      expect(httpMethodRiskFloor('POST')).toBe('low-write')
      expect(httpMethodRiskFloor('DELETE')).toBe('destructive')
    })

    it('rejects POST tool with risk below low-write', () => {
      const draft = validHttpDraft()
      draft.spec.request.method = 'POST'
      draft.risk = 'read'
      expect(() => CustomToolDraftSchema.parse(draft)).toThrow(/不可低于/)
    })

    it('rejects DELETE tool with risk below destructive', () => {
      const draft = validHttpDraft()
      draft.spec.request.method = 'DELETE'
      draft.risk = 'high-write'
      draft.idempotency = 'unsafe'
      expect(() => CustomToolDraftSchema.parse(draft)).toThrow(/不可低于/)
    })

    it('allows raising risk above the floor', () => {
      const draft = validHttpDraft()
      draft.spec.request.method = 'POST'
      draft.risk = 'high-write'
      draft.effect = 'update'
      expect(CustomToolDraftSchema.parse(draft)).toMatchObject({ risk: 'high-write' })
    })
  })

  describe('risk/effect/idempotency consistency', () => {
    it('rejects read risk with non-read effect', () => {
      const draft = validHttpDraft()
      draft.effect = 'update'
      expect(() => CustomToolDraftSchema.parse(draft)).toThrow(/effect/)
    })

    it('rejects destructive risk without unsafe idempotency', () => {
      const draft = validHttpDraft()
      draft.spec.request.method = 'DELETE'
      draft.risk = 'destructive'
      draft.idempotency = 'safe'
      expect(() => CustomToolDraftSchema.parse(draft)).toThrow(/idempotency/)
    })
  })

  describe('input schema subset', () => {
    it('rejects required referencing undeclared param', () => {
      const draft = validHttpDraft()
      draft.inputSchema.required = ['issueKey', 'ghost']
      expect(() => CustomToolDraftSchema.parse(draft)).toThrow(/未声明/)
    })

    it('rejects enum values mismatching param type', () => {
      const draft = validHttpDraft()
      draft.inputSchema.properties.limit = { type: 'integer', enum: ['ten'] }
      expect(() => CustomToolDraftSchema.parse(draft)).toThrow()
    })

    it('rejects non-integer enum for integer param', () => {
      const draft = validHttpDraft()
      draft.inputSchema.properties.limit = { type: 'integer', enum: [1.5] }
      expect(() => CustomToolDraftSchema.parse(draft)).toThrow()
    })

    it('rejects array param without items and items on scalar param', () => {
      const draft = validHttpDraft()
      draft.inputSchema.properties.tags = { type: 'array' }
      expect(() => CustomToolDraftSchema.parse(draft)).toThrow(/items/)
      const draft2 = validHttpDraft()
      draft2.inputSchema.properties.issueKey = { type: 'string', items: { type: 'string' } }
      expect(() => CustomToolDraftSchema.parse(draft2)).toThrow(/仅数组参数/)
    })

    it('rejects unknown fields in input schema (strict)', () => {
      const draft = validHttpDraft()
      ;(draft.inputSchema as Record<string, unknown>).additionalProperties = false
      expect(() => CustomToolDraftSchema.parse(draft)).toThrow()
    })
  })

  describe('sql draft (M2 契约先行)', () => {
    interface TestSqlDraft {
      id: string
      title: string
      description: string
      type: 'sql'
      inputSchema: { type: 'object'; properties: Record<string, TestParam> }
      risk: string
      effect: string
      idempotency: string
      timeoutMs: number
      spec: {
        connection: { kind: 'sqlite'; databasePath: string }
        mode: string
        sqlTemplate: string
      }
    }

    function validSqlDraft(): TestSqlDraft {
      return {
        id: 'spark_stats',
        title: '会话统计',
        description: '对本地 spark.db 跑只读统计查询',
        type: 'sql',
        inputSchema: {
          type: 'object',
          properties: { status: { type: 'string' } },
        },
        risk: 'read',
        effect: 'read',
        idempotency: 'safe',
        timeoutMs: 30_000,
        spec: {
          connection: { kind: 'sqlite', databasePath: '/tmp/spark.db' },
          mode: 'readonly',
          sqlTemplate: 'SELECT * FROM sessions WHERE status = :status',
        },
      }
    }

    it('accepts a valid readonly sqlite draft', () => {
      expect(CustomToolDraftSchema.parse(validSqlDraft())).toMatchObject({ type: 'sql' })
    })

    it('rejects sql named param not declared in input schema', () => {
      const draft = validSqlDraft()
      draft.spec.sqlTemplate = 'SELECT * FROM sessions WHERE status = :ghost'
      expect(() => CustomToolDraftSchema.parse(draft)).toThrow(/未在输入参数中声明/)
    })

    it('rejects readwrite sqlite with risk below high-write', () => {
      const draft = validSqlDraft()
      draft.spec.mode = 'readwrite'
      draft.risk = 'low-write'
      draft.effect = 'update'
      expect(() => CustomToolDraftSchema.parse(draft)).toThrow(/不可低于/)
    })
  })

  describe('command / prompt drafts (M2/M3 契约先行)', () => {
    it('rejects command draft below low-write floor', () => {
      const draft = {
        id: 'build_report',
        title: '构建报表',
        description: '运行 workspace 内的报表脚本并返回结果',
        type: 'command' as const,
        inputSchema: {
          type: 'object' as const,
          properties: { issueId: { type: 'string' as const } },
        },
        risk: 'read' as const,
        effect: 'read' as const,
        idempotency: 'safe' as const,
        timeoutMs: 30_000,
        spec: {
          exec: {
            command: 'python',
            argsTemplate: ['scripts/build_report.py', '--issue', '{{issueId}}'],
            cwdMode: 'workspace-root' as const,
            envAllowlist: ['PATH', 'LANG'],
          },
        },
      }
      expect(() => CustomToolDraftSchema.parse(draft)).toThrow(/不可低于/)
    })

    it('rejects prompt draft with non-read risk', () => {
      const draft = {
        id: 'review_checklist',
        title: '评审清单',
        description: '输出团队代码评审清单供 Agent 组合使用',
        type: 'prompt' as const,
        inputSchema: { type: 'object' as const, properties: { lang: { type: 'string' as const } } },
        risk: 'low-write' as const,
        effect: 'read' as const,
        idempotency: 'safe' as const,
        timeoutMs: 30_000,
        spec: { promptTemplate: '请以 {{lang}} 输出评审清单' },
      }
      expect(() => CustomToolDraftSchema.parse(draft)).toThrow()
    })
  })
})

describe('JSON body 模板结构校验', () => {
  function draftWithBody(jsonTemplate: string) {
    const draft = validHttpDraft()
    draft.spec.request.method = 'POST'
    draft.risk = 'low-write'
    draft.effect = 'create'
    draft.inputSchema.properties.title = { type: 'string' }
    draft.spec.request = {
      ...draft.spec.request,
      body: { mode: 'json' as const, jsonTemplate },
    }
    return draft
  }

  it('accepts placeholders at value position and inside strings', () => {
    expect(() =>
      CustomToolDraftSchema.parse(draftWithBody('{"summary": "{{title}}", "limit": {{issueKey}}}')),
    ).not.toThrow()
  })

  it('rejects structurally broken json templates', () => {
    expect(() => CustomToolDraftSchema.parse(draftWithBody('{"a": {{bad-name}}}'))).toThrow(
      /占位符/,
    )
    expect(() => CustomToolDraftSchema.parse(draftWithBody('{"summary": "a" "b"}'))).toThrow(/JSON/)
    expect(() => CustomToolDraftSchema.parse(draftWithBody('{"unclosed": '))).toThrow(/JSON/)
  })

  it('rejects templates containing the U+FFFC sentinel character', () => {
    // 哨兵字符是渲染期的内部标记，模板原文含此字符会与打标记混淆
    expect(() => CustomToolDraftSchema.parse(draftWithBody('{"summary": "￼ctph0￼"}'))).toThrow(
      /哨兵/,
    )
    expect(() => assertJsonTemplateStructure('"￼"')).toThrow(/哨兵/)
    expect(() => renderJsonBodyTemplate('{"a": "￼"}', {})).toThrow(/哨兵/)
  })
})

describe('CustomToolsIpcSchemaRegistry', () => {
  it('supports saved tools, standalone drafts, and saved-secret draft tests', () => {
    const schema = CustomToolsIpcSchemaRegistry['custom-tools:test-run']
    expect(schema.parse({ toolId: 'jira_search', input: {} })).toMatchObject({
      toolId: 'jira_search',
    })
    expect(schema.parse({ draftSpec: validHttpDraft(), input: {} })).toMatchObject({
      draftSpec: { id: 'jira_search' },
    })
    expect(
      schema.parse({ toolId: 'jira_search', draftSpec: validHttpDraft(), input: {} }),
    ).toMatchObject({ toolId: 'jira_search', draftSpec: { id: 'jira_search' } })
    expect(() => schema.parse({ input: {} })).toThrow()
    expect(() =>
      schema.parse({ toolId: 'other_tool', draftSpec: validHttpDraft(), input: {} }),
    ).toThrow(/不一致/)
  })

  it('rejects update when spec.id mismatches target id', () => {
    expect(() =>
      CustomToolsIpcSchemaRegistry['custom-tools:update'].parse({
        id: 'other_tool',
        spec: validHttpDraft(),
      }),
    ).toThrow(/不一致/)
  })

  it('validates write-secret shape', () => {
    expect(
      CustomToolsIpcSchemaRegistry['custom-tools:write-secret'].parse({
        id: 'jira_search',
        name: 'auth_token',
        value: 'secret-value',
      }),
    ).toMatchObject({ name: 'auth_token' })
    expect(() =>
      CustomToolsIpcSchemaRegistry['custom-tools:write-secret'].parse({
        id: 'jira_search',
        name: 'auth_token',
        value: '',
      }),
    ).toThrow()
  })
})

describe('CustomToolsExportPayloadSchema', () => {
  it('accepts formatVersion 1 and rejects others', () => {
    expect(CustomToolsExportPayloadSchema.parse({ formatVersion: 1, tools: [] })).toMatchObject({
      formatVersion: 1,
    })
    expect(() => CustomToolsExportPayloadSchema.parse({ formatVersion: 2, tools: [] })).toThrow()
  })

  it('rejects oversized tool batches', () => {
    const entries = Array.from({ length: 101 }, () => ({ spec: validHttpDraft() }))
    expect(() =>
      CustomToolsExportPayloadSchema.parse({ formatVersion: 1, tools: entries }),
    ).toThrow()
  })
})

describe('模板/密钥辅助函数', () => {
  it('extracts placeholders and sql named params', () => {
    expect(extractTemplatePlaceholders('a {{one}} b {{ two }} c')).toEqual(['one', 'two'])
    expect(extractSqlNamedParams('SELECT :a FROM t WHERE b = :b_two AND c = ::cast')).toEqual([
      'a',
      'b_two',
    ])
  })

  it('detects common literal secret shapes', () => {
    expect(containsLiteralSecret('sk-abcdefghij1234567890')).toBe(true)
    expect(containsLiteralSecret('AKIAABCDEFGHIJKLMNOP')).toBe(true)
    expect(containsLiteralSecret('ghp_abcdefghijklmnopqrstuv')).toBe(true)
    expect(containsLiteralSecret('-----BEGIN RSA PRIVATE KEY-----')).toBe(true)
    expect(containsLiteralSecret('Bearer eyJhbGciOiJIUzI1NiJ9.payload')).toBe(true)
    expect(containsLiteralSecret('https://example.com/{{issueKey}}')).toBe(false)
    expect(containsLiteralSecret('普通模板文本 {{param}}')).toBe(false)
  })
})
