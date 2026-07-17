import { describe, expect, it } from 'vitest'
import { resolveProviderFilesApiKind } from './registerProviderFilesIpc.js'

describe('resolveProviderFilesApiKind', () => {
  it('recognizes explicit media providers and standard/Coding Volcengine endpoints', () => {
    expect(resolveProviderFilesApiKind({ mediaProvider: 'volcengine-ark' })).toBe('volcengine-ark')
    expect(
      resolveProviderFilesApiKind({
        apiEndpoint: 'https://ark.cn-beijing.volces.com/api/v3',
      }),
    ).toBe('volcengine-ark')
    expect(
      resolveProviderFilesApiKind({
        apiEndpoint: 'https://ark.cn-beijing.volces.com/api/coding/v3',
      }),
    ).toBe('volcengine-ark')
  })

  it('preserves xAI routing and rejects unrelated providers', () => {
    expect(resolveProviderFilesApiKind({ mediaProvider: 'xai' })).toBe('xai')
    expect(resolveProviderFilesApiKind({ mediaProvider: 'bailian' })).toBe('bailian')
    expect(
      resolveProviderFilesApiKind({
        apiEndpoint: 'https://dashscope.aliyuncs.com/api/v1/services/aigc',
      }),
    ).toBe('bailian')
    expect(resolveProviderFilesApiKind({ apiEndpoint: 'https://api.example.com/v1' })).toBeNull()
    expect(
      resolveProviderFilesApiKind({
        apiEndpoint: 'https://api.example.com/proxy?target=ark.cn-beijing.volces.com',
      }),
    ).toBeNull()
  })
})
