import { describe, expect, it } from 'vitest'
import {
  isVolcengineArkConversationEndpoint,
  resolveProviderProtocolEndpoint,
} from './providerConversationProtocol'

describe('ProviderConversationProtocolFields helpers', () => {
  it('previews Chat, Responses and Embeddings endpoints from the configured base URL', () => {
    const base = 'https://ark.cn-beijing.volces.com/api/v3'
    expect(resolveProviderProtocolEndpoint(base, 'chat')).toBe(`${base}/chat/completions`)
    expect(resolveProviderProtocolEndpoint(base, 'responses')).toBe(`${base}/responses`)
    expect(resolveProviderProtocolEndpoint(`${base}/chat/completions`, 'responses')).toBe(
      `${base}/responses`,
    )
    expect(resolveProviderProtocolEndpoint(`${base}/responses`, 'embedding')).toBe(
      `${base}/embeddings`,
    )
  })

  it('recognizes only the official Ark hostname and ignores hostname text in paths or queries', () => {
    expect(
      isVolcengineArkConversationEndpoint('https://ark.cn-beijing.volces.com/api/v3'),
    ).toBe(true)
    expect(
      isVolcengineArkConversationEndpoint(
        'https://api.example.com/proxy?target=ark.cn-beijing.volces.com',
      ),
    ).toBe(false)
    expect(isVolcengineArkConversationEndpoint('not-a-url')).toBe(false)
  })
})
