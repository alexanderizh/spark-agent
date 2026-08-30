import { describe, expect, it } from 'vitest'

import {
  getMinimaxImageEndpointPath,
  getMinimaxVideoEndpointPath,
  normalizeMinimaxBaseUrl,
  resolveMinimaxEndpoint,
} from '../minimax-media-endpoints.js'

describe('MiniMax media endpoints', () => {
  it('removes an optional trailing API version before appending a versioned path', () => {
    expect(normalizeMinimaxBaseUrl(' http://127.0.0.1:13005/v2/ ')).toBe('http://127.0.0.1:13005')
    expect(resolveMinimaxEndpoint('http://127.0.0.1:13005/v2', '/v2/video_generation')).toBe(
      'http://127.0.0.1:13005/v2/video_generation',
    )
  })

  it('maps MiniMax models to their actual image/video endpoint paths', () => {
    expect(getMinimaxImageEndpointPath()).toBe('/v1/image_generation')
    expect(getMinimaxVideoEndpointPath('MiniMax-H3')).toBe('/v2/video_generation')
    expect(getMinimaxVideoEndpointPath('MiniMax-Hailuo-2.3')).toBe('/v1/video_generation')
    expect(getMinimaxVideoEndpointPath('MiniMax-Hailuo-2.3-Fast')).toBe('/v1/video_generation')
    expect(getMinimaxVideoEndpointPath('video-agent')).toBe('/v1/video_template_generation')
  })
})
