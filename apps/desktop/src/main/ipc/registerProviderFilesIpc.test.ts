import { describe, expect, it } from 'vitest'
import {
  resolveProviderFilesApiKind,
  toMinimaxProviderFile,
} from './registerProviderFilesIpc.js'

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
    // minimax-hailuo 走自带 Files client（mm_file:// 上传链路），必须被识别为独立渠道
    expect(resolveProviderFilesApiKind({ mediaProvider: 'minimax-hailuo' })).toBe('minimax-hailuo')
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

  it('maps MiniMax files to active canvas-ready media with MIME inferred from the filename', () => {
    expect(
      toMinimaxProviderFile({
        fileId: '398574688191234048',
        filename: 'reference.MP4',
        bytes: 1024,
        purpose: 'video_generation_input',
      }),
    ).toMatchObject({
      id: '398574688191234048',
      providerKind: 'minimax-hailuo',
      status: 'active',
      mimeType: 'video/mp4',
    })
  })
})
