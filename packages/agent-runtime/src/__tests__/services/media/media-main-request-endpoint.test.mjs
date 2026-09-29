import { describe, expect, it } from 'vitest'
import { resolveMainRequestUrl } from '../../../services/media/media-main-request-endpoint.mjs'

describe('resolveMainRequestUrl（spark_media 主调用地址）', () => {
  it('未开启开关时保持调用方派生地址', () => {
    expect(
      resolveMainRequestUrl(
        { baseUrl: 'https://api.example/v1' },
        'https://api.example/v1/images/generations',
      ),
    ).toBe('https://api.example/v1/images/generations')
    expect(resolveMainRequestUrl({}, 'https://api.example/v1/audio/speech')).toBe(
      'https://api.example/v1/audio/speech',
    )
  })

  it('开启开关后返回所填完整地址原文', () => {
    expect(
      resolveMainRequestUrl(
        { baseUrl: 'https://api.example/coding/v3/messages', apiEndpointFullUrl: true },
        'https://api.example/coding/v3/messages/images/generations',
      ),
    ).toBe('https://api.example/coding/v3/messages')
  })

  it('开启开关但渠道地址为空时回退到派生地址，避免发出空 URL', () => {
    expect(resolveMainRequestUrl({ baseUrl: '   ', apiEndpointFullUrl: true }, 'https://x/y')).toBe(
      'https://x/y',
    )
  })
})
