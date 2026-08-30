import { describe, expect, it } from 'vitest'
import { isVolcengineArkFilesProfile, providerFilesApiKindForProfile } from './canvasProviderFiles'

describe('providerFilesApiKindForProfile', () => {
  it('recognizes explicit media providers', () => {
    expect(providerFilesApiKindForProfile({ mediaProvider: 'volcengine-ark' })).toBe(
      'volcengine-ark',
    )
    expect(providerFilesApiKindForProfile({ mediaProvider: 'bailian' })).toBe('bailian')
    expect(providerFilesApiKindForProfile({ mediaProvider: 'xai' })).toBe('xai')
    expect(providerFilesApiKindForProfile({ mediaProvider: 'minimax-hailuo' })).toBe(
      'minimax-hailuo',
    )
  })

  it('does not infer the channel from the hostname alone (chat and media share the endpoint)', () => {
    // 火山方舟等域名聊天与多媒体共用，仅给 apiEndpoint 不应判定为多媒体渠道，
    // 否则会把「火山 claude」等纯聊天渠道误纳入 Files 下拉。
    expect(
      providerFilesApiKindForProfile({
        apiEndpoint: 'https://ark.cn-beijing.volces.com/api/v3',
      }),
    ).toBeNull()
    expect(
      providerFilesApiKindForProfile({
        apiEndpoint: 'https://ark.cn-beijing.volces.com/api/coding/v3',
      }),
    ).toBeNull()
    expect(
      providerFilesApiKindForProfile({
        apiEndpoint: 'https://dashscope.aliyuncs.com/api/v1/services/aigc',
      }),
    ).toBeNull()
    expect(providerFilesApiKindForProfile({ apiEndpoint: 'https://api.x.ai/v1' })).toBeNull()
    expect(providerFilesApiKindForProfile({ apiEndpoint: 'https://api.openai.com/v1' })).toBeNull()
    expect(
      providerFilesApiKindForProfile({
        apiEndpoint: 'https://api.example.com/proxy?target=ark.cn-beijing.volces.com',
      }),
    ).toBeNull()
  })
})

describe('isVolcengineArkFilesProfile', () => {
  it('only matches the explicit volcengine-ark media provider', () => {
    expect(isVolcengineArkFilesProfile({ mediaProvider: 'volcengine-ark' })).toBe(true)
    expect(isVolcengineArkFilesProfile({ mediaProvider: 'xai' })).toBe(false)
    // 聊天渠道（火山方舟 claude 端点）不应暴露在 Ark Files tab
    expect(
      isVolcengineArkFilesProfile({
        apiEndpoint: 'https://ark.cn-beijing.volces.com/api/v3',
      }),
    ).toBe(false)
  })

  it('recognizes legacy Volcano image/video profiles by their model metadata', () => {
    expect(
      providerFilesApiKindForProfile({
        provider: 'openai',
        apiEndpoint: 'https://ark.cn-beijing.volces.com/api/v3',
        modelType: 'video',
        defaultModel: 'doubao-seedance-2-5-260628',
      }),
    ).toBe('volcengine-ark')
  })
})
