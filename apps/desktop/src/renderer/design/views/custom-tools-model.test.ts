import { describe, expect, it } from 'vitest'
import type { CustomToolDetails } from '@spark/protocol'
import {
  buildCustomToolDraft,
  createCustomToolEditorDraft,
  editorDraftFromTool,
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
})
