import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  toCustomToolSummary,
  type CustomToolDraft,
  type CustomToolRecord,
  type CustomToolWorkspace,
} from '@spark/protocol'
import { CustomToolAuthoringService } from '../../services/custom-tools/custom-tool-authoring.service.js'
import type { CustomToolService } from '../../services/custom-tools/custom-tool.service.js'

function httpDraft(overrides: Partial<CustomToolDraft> = {}): CustomToolDraft {
  return {
    id: 'weather_lookup',
    title: '天气查询',
    description: '根据城市名称查询当前天气，仅在用户询问实时天气时调用。',
    type: 'http',
    inputSchema: {
      type: 'object',
      properties: { city: { type: 'string', description: '城市名称' } },
      required: ['city'],
    },
    spec: {
      request: {
        method: 'GET',
        urlTemplate: 'https://api.example.com/weather?city={{city}}',
      },
      response: { format: 'text' },
    },
    risk: 'read',
    effect: 'read',
    idempotency: 'safe',
    timeoutMs: 30_000,
    ...overrides,
  } as CustomToolDraft
}

function promptDraft(): CustomToolDraft {
  return {
    id: 'text_summary',
    title: '文本摘要',
    description: '对用户明确提供的文本生成简短摘要，不读取其他本地内容。',
    type: 'prompt',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string', description: '需要摘要的文本' } },
      required: ['text'],
    },
    spec: { promptTemplate: '请摘要以下文本：{{text}}' },
    risk: 'read',
    effect: 'read',
    idempotency: 'safe',
    timeoutMs: 30_000,
  }
}

describe('CustomToolAuthoringService', () => {
  let runtime: CustomToolService
  let authoring: CustomToolAuthoringService
  let workspace: CustomToolWorkspace | null

  function makeWorkspace(
    draft: CustomToolDraft,
    options: { enabled?: boolean; published?: boolean } = {},
  ): CustomToolWorkspace {
    const now = new Date(0).toISOString()
    const publishedVersion = options.published === true ? 1 : null
    const record: CustomToolRecord = {
      ...draft,
      enabled: options.enabled ?? false,
      origin: 'local',
      publishedVersion,
      draftVersion: 1,
      lastTestAt: null,
      createdAt: now,
      updatedAt: now,
    }
    return {
      tool: { ...record, secretStatus: {} },
      draft,
      published: publishedVersion == null ? null : draft,
      versions: [
        {
          version: 1,
          status: publishedVersion == null ? 'draft' : 'published',
          sourceVersion: null,
          createdAt: now,
          publishedAt: publishedVersion == null ? null : now,
        },
      ],
    }
  }

  beforeEach(() => {
    workspace = null
    runtime = {
      list: vi.fn(() => (workspace == null ? [] : [toCustomToolSummary(workspace.tool)])),
      getWorkspace: vi.fn(async (id: string) => {
        if (workspace == null || workspace.tool.id !== id) throw new Error('not found')
        return workspace
      }),
      createDraft: vi.fn(async (draft: CustomToolDraft) => {
        workspace = makeWorkspace(draft)
        return workspace
      }),
      saveDraft: vi.fn(async (id: string, draft: CustomToolDraft) => {
        if (workspace == null || workspace.tool.id !== id) throw new Error('not found')
        workspace = { ...workspace, draft }
        return workspace
      }),
      testRun: vi.fn(async () => ({
        ok: true,
        text: 'ok',
        meta: { durationMs: 1, bytes: 2, truncated: false },
      })),
      resolveSecrets: vi.fn(async () => ({})),
      publish: vi.fn(async (id: string) => {
        if (workspace == null || workspace.tool.id !== id) throw new Error('not found')
        workspace = makeWorkspace(workspace.draft, { enabled: true, published: true })
        return workspace
      }),
      setEnabled: vi.fn(async (id: string, enabled: boolean) => {
        if (workspace == null || workspace.tool.id !== id) throw new Error('not found')
        workspace = {
          ...workspace,
          tool: { ...workspace.tool, enabled },
        }
        return workspace.tool
      }),
      rollback: vi.fn(async () => {
        if (workspace == null) throw new Error('not found')
        return workspace
      }),
      delete: vi.fn(async (id: string) => {
        if (workspace == null || workspace.tool.id !== id) throw new Error('not found')
        workspace = null
      }),
    } as unknown as CustomToolService
    authoring = new CustomToolAuthoringService(runtime)
  })

  it('describes native HTTP/code authoring while keeping MCP and vision as optional adapters', () => {
    const guide = authoring.guide()

    expect(guide.adapters.map((adapter) => adapter.id)).toEqual([
      'http',
      'code',
      'provider-vision',
      'mcp-import',
    ])
    expect(guide.adapters.find((adapter) => adapter.id === 'code')).toMatchObject({
      available: true,
      purpose: expect.stringContaining('TypeScript'),
    })
    expect(guide.adapters.find((adapter) => adapter.id === 'mcp-import')?.purpose).toContain(
      '可选导入',
    )
    expect(guide.adapters.find((adapter) => adapter.id === 'provider-vision')?.purpose).toContain(
      '不是默认创建入口',
    )
  })

  it('keeps validation aligned with executable adapters and rejects secret values', () => {
    const unsupported = authoring.validate(promptDraft())
    expect(unsupported).toEqual({
      valid: false,
      issues: [expect.objectContaining({ path: 'type', message: expect.stringContaining('code') })],
    })

    const secretValue = httpDraft({
      secretRefs: { auth_token: 'sk-plain-text-value' },
      spec: {
        request: {
          method: 'GET',
          urlTemplate: 'https://api.example.com/weather?city={{city}}',
          headers: [{ name: 'Authorization', secretRef: 'auth_token' }],
        },
        response: { format: 'text' },
      },
    } as Partial<CustomToolDraft>)
    expect(authoring.validate(secretValue)).toEqual({
      valid: false,
      issues: [
        expect.objectContaining({
          path: 'secretRefs.auth_token',
          message: expect.stringContaining('不接受密钥值'),
        }),
      ],
    })
  })

  it('creates a disabled draft and enforces confirmation gates through the published lifecycle', async () => {
    const created = await authoring.createDraft(httpDraft())
    expect(created.tool).toMatchObject({
      id: 'weather_lookup',
      enabled: false,
      publishedVersion: null,
    })

    await expect(authoring.publish('weather_lookup', 1, false)).rejects.toThrow(/明确确认/)
    expect((await authoring.get('weather_lookup')).published).toBeNull()

    const published = await authoring.publish('weather_lookup', 1, true)
    expect(published.tool).toMatchObject({ enabled: true, publishedVersion: 1 })

    expect(await authoring.setEnabled('weather_lookup', false, undefined)).toMatchObject({
      enabled: false,
    })
    await expect(authoring.setEnabled('weather_lookup', true, false)).rejects.toThrow(/明确确认/)
    expect(await authoring.setEnabled('weather_lookup', true, true)).toMatchObject({
      enabled: true,
    })

    await expect(authoring.delete('weather_lookup', false)).rejects.toThrow(/明确确认/)
    expect(authoring.list()).toHaveLength(1)
    await expect(authoring.delete('weather_lookup', true)).resolves.toEqual({ success: true })
    expect(authoring.list()).toEqual([])
  })

  it('does not allow an Agent to change a tool identity while saving a draft', async () => {
    await authoring.createDraft(httpDraft())

    await expect(
      authoring.saveDraft('weather_lookup', httpDraft({ id: 'other_weather_tool' })),
    ).rejects.toThrow(/工具 ID 创建后不可修改/)
    expect((await authoring.get('weather_lookup')).draft.id).toBe('weather_lookup')
  })

  it('redacts Keychain values and common credential echoes from Agent test output', async () => {
    const draft = httpDraft({
      secretRefs: { auth_token: 'custom-tool:weather_lookup:auth_token' },
      spec: {
        request: {
          method: 'GET',
          urlTemplate: 'https://api.example.com/weather?city={{city}}',
          headers: [{ name: 'Authorization', secretRef: 'auth_token' }],
        },
        response: { format: 'text' },
      },
    } as Partial<CustomToolDraft>)
    await authoring.createDraft(draft)
    vi.mocked(runtime.resolveSecrets).mockResolvedValue({
      auth_token: 'exact-keychain-secret',
    })
    vi.mocked(runtime.testRun).mockResolvedValue({
      ok: true,
      text: 'echo=exact-keychain-secret Authorization: Bearer provider-token-value',
      meta: { durationMs: 1, bytes: 72, truncated: false },
    })

    const result = await authoring.test({
      id: 'weather_lookup',
      input: { city: '上海' },
      confirmExecute: true,
    })

    expect(result.text).toBe('echo=[redacted] Authorization: [redacted]')
    expect(result.text).not.toContain('exact-keychain-secret')
    expect(result.text).not.toContain('provider-token-value')
  })

  it('sanitizes legacy secret reference values before returning a workspace to an Agent', async () => {
    workspace = makeWorkspace(
      httpDraft({
        secretRefs: { auth_token: 'legacy-value-that-must-not-leak' },
        spec: {
          request: {
            method: 'GET',
            urlTemplate: 'https://api.example.com/weather?city={{city}}',
            headers: [{ name: 'Authorization', secretRef: 'auth_token' }],
          },
          response: { format: 'text' },
        },
      } as Partial<CustomToolDraft>),
    )

    const sanitized = await authoring.get('weather_lookup')
    expect(sanitized.tool.secretRefs).toEqual({
      auth_token: 'custom-tool:weather_lookup:auth_token',
    })
    expect(sanitized.draft.secretRefs).toEqual({
      auth_token: 'custom-tool:weather_lookup:auth_token',
    })
  })
})
