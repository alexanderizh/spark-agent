import { describe, expect, it } from 'vitest'
import type { CustomToolDetails } from '@spark/protocol'
import {
  buildCustomToolDraft,
  createCustomToolEditorDraft,
  editorDraftFromTool,
  parseCurlToEditorDraft,
  parseTestInput,
  requiresHttpTestConfirmation,
  secretNamesFromHeaders,
} from './custom-tools-model'

describe('custom tools editor model', () => {
  it('builds a safe read-only GET tool and derives Keychain references from headers', () => {
    const editor = createCustomToolEditorDraft('http')
    editor.headersJson = JSON.stringify([
      { name: 'Authorization', secretRef: 'api_token' },
      { name: 'Accept', valueTemplate: 'application/json' },
    ])
    const draft = buildCustomToolDraft(editor)
    expect(draft).toMatchObject({
      type: 'http',
      risk: 'read',
      effect: 'read',
      idempotency: 'safe',
      secretRefs: { api_token: 'custom-tool:custom_http_tool:api_token' },
    })
    expect(secretNamesFromHeaders(editor.headersJson)).toEqual(['api_token'])
  })

  it('derives destructive semantics for DELETE instead of trusting free-form UI values', () => {
    const editor = createCustomToolEditorDraft('http')
    editor.method = 'DELETE'
    const draft = buildCustomToolDraft(editor)
    expect(draft).toMatchObject({
      risk: 'destructive',
      effect: 'delete',
      idempotency: 'unsafe',
    })
    expect(requiresHttpTestConfirmation('DELETE')).toBe(true)
    expect(requiresHttpTestConfirmation('POST')).toBe(true)
    expect(requiresHttpTestConfirmation('GET')).toBe(false)
  })

  it('builds a host-only provider vision tool with fixed attachment schema', () => {
    const editor = createCustomToolEditorDraft('provider-vision', 'vision-provider', 'qwen-vl')
    const draft = buildCustomToolDraft(editor)
    expect(draft).toMatchObject({
      type: 'provider-vision',
      inputSchema: {
        properties: { images: { type: 'array', items: { type: 'string' } } },
        required: ['images'],
      },
      spec: {
        providerProfileId: 'vision-provider',
        model: 'qwen-vl',
        exposeToAgent: false,
        autoRoute: { enabled: true, priority: 100 },
      },
    })
    expect(draft.secretRefs).toBeUndefined()
  })

  it('builds and restores a native code tool without an MCP project', () => {
    const editor = createCustomToolEditorDraft('code')
    editor.codeToolIdsText = 'weather_lookup\ncompany_search\nweather_lookup'
    editor.codeRisk = 'low-write'
    editor.codeEffect = 'create'
    editor.codeIdempotency = 'unsafe'
    const draft = buildCustomToolDraft(editor)
    expect(draft).toMatchObject({
      type: 'code',
      risk: 'low-write',
      spec: {
        runtime: { kind: 'trusted-worker', language: 'typescript' },
        permissions: { toolIds: ['weather_lookup', 'company_search'] },
        trust: 'trusted-local',
      },
    })

    const details = {
      ...draft,
      enabled: true,
      origin: 'local',
      publishedVersion: 1,
      draftVersion: 1,
      lastTestAt: null,
      createdAt: '2026-08-31T00:00:00.000Z',
      updatedAt: '2026-08-31T00:00:00.000Z',
      secretStatus: {},
    } as CustomToolDetails
    expect(editorDraftFromTool(details)).toMatchObject({
      kind: 'code',
      codeToolIdsText: 'weather_lookup\ncompany_search',
      codeRisk: 'low-write',
    })
  })

  it('restores provider vision settings from persisted details', () => {
    const base = buildCustomToolDraft(
      createCustomToolEditorDraft('provider-vision', 'vision-provider', 'qwen-vl'),
    )
    const details = {
      ...base,
      enabled: true,
      origin: 'local',
      lastTestAt: null,
      createdAt: '2026-08-31T00:00:00.000Z',
      updatedAt: '2026-08-31T00:00:00.000Z',
      secretStatus: {},
    } as CustomToolDetails
    expect(editorDraftFromTool(details)).toMatchObject({
      kind: 'provider-vision',
      providerProfileId: 'vision-provider',
      model: 'qwen-vl',
    })
  })

  it('accepts only object-shaped test input', () => {
    expect(parseTestInput('{"query":"x"}')).toEqual({ query: 'x' })
    expect(() => parseTestInput('[]')).toThrow(/JSON 对象/)
  })

  it('parses cURL as data and moves sensitive headers into Keychain fields', () => {
    const editor = parseCurlToEditorDraft(
      `curl --request POST 'https://api.example.com/v1/search?q={{query}}' --header 'Authorization: Bearer secret-token-value' --header 'Accept: application/json' --data-raw '{"query":"{{query}}"}'`,
    )
    expect(editor).toMatchObject({
      kind: 'http',
      method: 'POST',
      urlTemplate: 'https://api.example.com/v1/search?q={{query}}',
      secretValues: { authorization_secret: 'Bearer secret-token-value' },
    })
    expect(JSON.parse(editor.headersJson)).toEqual([
      { name: 'Authorization', secretRef: 'authorization_secret' },
      { name: 'Accept', valueTemplate: 'application/json' },
      { name: 'Content-Type', valueTemplate: 'application/json' },
    ])
    expect(buildCustomToolDraft(editor)).toMatchObject({
      secretRefs: {
        authorization_secret: expect.stringContaining('authorization_secret'),
      },
    })
  })

  it('rejects ambiguous or file-reading cURL options instead of silently changing semantics', () => {
    expect(() => parseCurlToEditorDraft('curl -K secrets.conf https://example.com')).toThrow(
      /暂不支持/,
    )
    expect(() =>
      parseCurlToEditorDraft("curl https://example.com --data-binary '@payload.json'"),
    ).toThrow(/本地文件/)
    expect(() => parseCurlToEditorDraft('wget https://example.com')).toThrow(/curl/)
    expect(() => parseCurlToEditorDraft('curl https://user:password@example.com/data')).toThrow(
      /不允许内嵌用户名或密码/,
    )
    expect(() =>
      parseCurlToEditorDraft('curl https://example.com/data?api_key=plain-text-secret'),
    ).toThrow(/敏感查询参数 api_key/)
  })
})
