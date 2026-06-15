import { describe, expect, it } from 'vitest'
import {
  DialogOpenFileRequestSchema,
  IpcSchemaRegistry,
  ProviderCreateRequestSchema,
  SessionCreateRequestSchema,
  SessionSendTurnRequestSchema,
  SessionUpdateRequestSchema,
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
    expect(request.reasoningEffort).toBe('medium')
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
      operation: 'text_to_image',
      prompt: 'a polished product photo',
      providerProfileId: 'provider-media-1',
      modelId: 'gpt-image-2',
      modelParams: { size: '1024x1024' },
    })
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
})
