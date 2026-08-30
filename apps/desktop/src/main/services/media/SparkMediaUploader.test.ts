import { describe, expect, it } from 'vitest'
import { SparkMediaUploader } from './SparkMediaUploader'
import type { MediaProviderKind } from '@spark/protocol'

const provider = (value: string) => value as MediaProviderKind

describe('SparkMediaUploader.canHandle', () => {
  const uploader = new SparkMediaUploader()

  it('covers providers whose input resolvers query fallbackUploader', () => {
    expect(uploader.canHandle(provider('xai'))).toBe(true)
    expect(uploader.canHandle(provider('volcengine-ark'))).toBe(true)
    expect(uploader.canHandle(provider('bailian'))).toBe(true)
    expect(uploader.canHandle(provider('apimart'))).toBe(true)
    // minimax-hailuo：仅在官方 mm_file 上传失败后，由 minimax-hailuo-media-input
    // 查询 fallbackUploader 回退 Spark 平台上传（H3 V2 通道接受公网 URL），非死代码。
    expect(uploader.canHandle(provider('minimax-hailuo'))).toBe(true)
  })

  it('does NOT cover tencent-tokenhub (would force login on previously base64-inline images)', () => {
    expect(uploader.canHandle(provider('tencent-tokenhub'))).toBe(false)
  })
})
