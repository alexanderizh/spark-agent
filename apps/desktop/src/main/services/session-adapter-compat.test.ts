import { describe, expect, it } from 'vitest'

import { LOCAL_CLI_PROVIDER_ID, LOCAL_CODEX_CLI_PROVIDER_ID } from '@spark/protocol'

import {
  resolveCompatibleSessionAdapter,
  type AdapterCompatProviderInput,
} from './session-adapter-compat.js'

const anthropicProvider: AdapterCompatProviderInput = {
  id: 'ark-coding-plan',
  providerType: 'anthropic',
}

const openaiResponsesProvider: AdapterCompatProviderInput = {
  id: 'openai-responses',
  providerType: 'openai',
}

const openaiChatProvider: AdapterCompatProviderInput = {
  id: 'openai-chat',
  providerType: 'openai',
  codexApiKind: 'chat',
}

describe('resolveCompatibleSessionAdapter', () => {
  it('anthropic 渠道：codex 引擎改落 claude-sdk（语音会话 403 根因组合）', () => {
    expect(resolveCompatibleSessionAdapter(anthropicProvider, 'codex')).toBe('claude-sdk')
  })

  it('anthropic 渠道：claude 系引擎保留，spark 偏好保留', () => {
    expect(resolveCompatibleSessionAdapter(anthropicProvider, 'claude-sdk')).toBe('claude-sdk')
    expect(resolveCompatibleSessionAdapter(anthropicProvider, 'claude')).toBe('claude-sdk')
    expect(resolveCompatibleSessionAdapter(anthropicProvider, 'spark')).toBe('spark')
  })

  it('openai responses 渠道：codex 保留、claude 系改落 codex、spark 保留', () => {
    expect(resolveCompatibleSessionAdapter(openaiResponsesProvider, 'codex')).toBe('codex')
    expect(resolveCompatibleSessionAdapter(openaiResponsesProvider, 'claude-sdk')).toBe('codex')
    expect(resolveCompatibleSessionAdapter(openaiResponsesProvider, 'spark')).toBe('spark')
  })

  it('openai chat-completions 渠道：spark 引擎改落 codex', () => {
    expect(resolveCompatibleSessionAdapter(openaiChatProvider, 'spark')).toBe('codex')
    expect(resolveCompatibleSessionAdapter(openaiChatProvider, 'codex')).toBe('codex')
  })

  it('本地 CLI 内置渠道只保留自家引擎', () => {
    expect(
      resolveCompatibleSessionAdapter(
        { id: LOCAL_CODEX_CLI_PROVIDER_ID, providerType: 'openai' },
        'claude-sdk',
      ),
    ).toBe('codex')
    expect(
      resolveCompatibleSessionAdapter(
        { id: LOCAL_CLI_PROVIDER_ID, providerType: 'anthropic' },
        'codex',
      ),
    ).toBe('claude-sdk')
  })

  it('auto-router 行按其声明的引擎归一，spark 不接管 router', () => {
    const claudeRouter: AdapterCompatProviderInput = {
      id: 'router-1',
      providerType: 'auto-router',
      autoRouterAdapter: 'claude',
    }
    const codexRouter: AdapterCompatProviderInput = {
      id: 'router-2',
      providerType: 'auto-router',
      autoRouterAdapter: 'codex',
    }
    expect(resolveCompatibleSessionAdapter(claudeRouter, 'codex')).toBe('claude-sdk')
    expect(resolveCompatibleSessionAdapter(codexRouter, 'claude-sdk')).toBe('codex')
    expect(resolveCompatibleSessionAdapter(claudeRouter, 'claude-sdk')).toBe('claude-sdk')
    expect(resolveCompatibleSessionAdapter(codexRouter, 'spark')).toBe('codex')
    expect(resolveCompatibleSessionAdapter(claudeRouter, 'spark')).toBe('claude-sdk')
  })

  it('codexApiKind 缺省按 responses 口径处理（spark 可保留）', () => {
    expect(resolveCompatibleSessionAdapter({ id: 'legacy', providerType: 'openai' }, 'spark')).toBe(
      'spark',
    )
  })
})
