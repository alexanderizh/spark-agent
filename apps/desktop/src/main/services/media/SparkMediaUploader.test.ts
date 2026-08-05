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
  })

  it('does NOT cover minimax-hailuo (dead code — uses its own MinimaxHailuoFilesClient)', () => {
    expect(uploader.canHandle(provider('minimax-hailuo'))).toBe(false)
  })

  it('does NOT cover tencent-tokenhub (would force login on previously base64-inline images)', () => {
    expect(uploader.canHandle(provider('tencent-tokenhub'))).toBe(false)
  })
})
