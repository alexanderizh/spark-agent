import { describe, expect, it } from 'vitest'
import type { ProviderProfile } from '@spark/protocol'
import {
  buildCanvasSessionRuntimeRequestCall,
  resolveCanvasSessionRuntimeModelUrl,
} from './canvasTextTaskRequestCall'

function profile(overrides: Partial<ProviderProfile> = {}): ProviderProfile {
  return {
    id: 'provider-1',
    name: 'Example',
    provider: 'openai',
    isDefault: false,
    defaultModel: 'gpt-5',
    modelIds: ['gpt-5'],
    modelType: 'text',
    codexApiKind: 'responses',
    apiEndpoint: 'https://api.example.com/v1',
    createdAt: '2026-07-18T00:00:00.000Z',
    keystoreRef: 'provider-1',
    ...overrides,
  }
}

describe('canvas session runtime request diagnostics', () => {
  it('resolves the concrete Responses and Chat endpoints used by remote Codex SDK profiles', () => {
    expect(resolveCanvasSessionRuntimeModelUrl(profile(), 'codex')).toBe(
      'https://api.example.com/v1/responses',
    )
    expect(resolveCanvasSessionRuntimeModelUrl(profile({ codexApiKind: 'chat' }), 'codex')).toBe(
      'https://api.example.com/v1/chat/completions',
    )
  })

  it('labels built-in CLI execution without pretending it is a captured HTTP request', () => {
    const local = profile({
      id: 'local-codex-cli',
      provider: 'codex-cli',
    })
    delete local.apiEndpoint
    expect(resolveCanvasSessionRuntimeModelUrl(local, 'codex')).toBe('local-cli://codex')
    expect(
      buildCanvasSessionRuntimeRequestCall({
        profile: local,
        adapter: 'codex',
        model: 'codex cli',
        invocation: { sdkOrCliRequest: { command: 'codex' } },
      }),
    ).toMatchObject({ method: 'CODEX CLI', url: 'local-cli://codex' })
  })

  it('preserves the final SDK invocation arguments in the request snapshot', () => {
    expect(
      buildCanvasSessionRuntimeRequestCall({
        profile: profile(),
        adapter: 'codex',
        model: 'gpt-5',
        invocation: {
          createSession: { permissionMode: 'codex-full-access' },
          sendTurn: { message: '最终消息', reasoningEffort: 'high' },
        },
      }),
    ).toMatchObject({
      method: 'CODEX SDK',
      url: 'https://api.example.com/v1/responses',
      body: {
        transport: 'session-runtime-sdk',
        model: 'gpt-5',
        apiKind: 'responses',
        sendTurn: { message: '最终消息', reasoningEffort: 'high' },
      },
    })
  })
})
