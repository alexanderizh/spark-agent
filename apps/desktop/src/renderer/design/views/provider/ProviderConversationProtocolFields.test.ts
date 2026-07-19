import { describe, expect, it } from 'vitest'
import { isVolcengineArkConversationEndpoint } from './providerConversationProtocol'

describe('ProviderConversationProtocolFields helpers', () => {
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
