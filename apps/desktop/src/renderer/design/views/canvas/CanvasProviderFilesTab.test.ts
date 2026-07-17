import { describe, expect, it } from 'vitest'
import { isVolcengineArkFilesProfile, providerFilesApiKindForProfile } from './canvasProviderFiles'

describe('isVolcengineArkFilesProfile', () => {
  it('includes both media and chat profiles that can access Ark Files', () => {
    expect(isVolcengineArkFilesProfile({ mediaProvider: 'volcengine-ark' })).toBe(true)
    expect(
      isVolcengineArkFilesProfile({
        apiEndpoint: 'https://ark.cn-beijing.volces.com/api/v3',
      }),
    ).toBe(true)
    expect(
      isVolcengineArkFilesProfile({
        apiEndpoint: 'https://ark.cn-beijing.volces.com/api/coding/v3',
      }),
    ).toBe(true)
  })

  it('includes a configured public DashScope provider for Bailian Files', () => {
    expect(providerFilesApiKindForProfile({ mediaProvider: 'bailian' })).toBe('bailian')
    expect(
      providerFilesApiKindForProfile({
        apiEndpoint: 'https://dashscope.aliyuncs.com/api/v1/services/aigc',
      }),
    ).toBe('bailian')
  })

  it('does not expose unrelated provider profiles in the Volcengine channel tab', () => {
    expect(isVolcengineArkFilesProfile({ mediaProvider: 'xai' })).toBe(false)
    expect(isVolcengineArkFilesProfile({ apiEndpoint: 'https://api.openai.com/v1' })).toBe(false)
    expect(
      isVolcengineArkFilesProfile({
        apiEndpoint: 'https://api.example.com/proxy?target=ark.cn-beijing.volces.com',
      }),
    ).toBe(false)
  })
})
